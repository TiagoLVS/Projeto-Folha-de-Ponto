"""Testes reais em schemas descartáveis de FOLHA_TEST_DSN; nunca usa o .env."""
import asyncio
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZipFile
import psycopg
import pymupdf
from backend.api import app
from backend.database import repository
from backend.services import geracao
from backend.models.calendario import GeracaoPayload
from test_calendario import planilha


def request(method, url, payload=None, content=None, content_type='application/json'):
    path, _, query = url.partition('?')
    events = []
    data = content if content is not None else json.dumps(payload).encode() if payload is not None else b''
    async def receive():
        return {'type': 'http.request', 'body': data, 'more_body': False}
    async def send(event):
        events.append(event)
    asyncio.run(app({'type': 'http', 'asgi': {'version': '3.0', 'spec_version': '2.4'}, 'http_version': '1.1', 'method': method, 'scheme': 'http', 'path': path, 'raw_path': path.encode(), 'query_string': query.encode(), 'root_path': '', 'headers': [(b'content-type', content_type.encode())], 'server': ('test', 80), 'client': ('test', 1234)}, receive, send))
    start = next(e for e in events if e['type'] == 'http.response.start')
    content = b''.join(e.get('body', b'') for e in events if e['type'] == 'http.response.body')
    headers = dict(start['headers'])
    return start['status'], json.loads(content) if b'application/json' in headers.get(b'content-type', b'') else content


@unittest.skipUnless(os.getenv('FOLHA_TEST_DSN'), 'Defina FOLHA_TEST_DSN para banco descartável.')
class TestCalendarioIntegracao(unittest.TestCase):
    def setUp(self):
        self.dsn = os.environ['FOLHA_TEST_DSN']
        self.schema = 'calendar_' + uuid4().hex
        with psycopg.connect(self.dsn, autocommit=True) as conn:
            conn.execute(f'CREATE SCHEMA {self.schema}')
        self.addCleanup(self.drop)
        patcher = patch.object(repository, 'conectar', self.connect)
        patcher.start(); self.addCleanup(patcher.stop)
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        patcher = patch.object(geracao, 'PASTA_GERADAS', self.folder)
        patcher.start(); self.addCleanup(patcher.stop)
        patcher = patch('smtplib.SMTP', side_effect=AssertionError('Não enviar e-mails nestes testes'))
        self.smtp = patcher.start(); self.addCleanup(patcher.stop)
        with self.connect() as conn:
            conn.execute(Path('database/folha_pontos.sql').read_text())
        self.professor = request('POST', '/servidores', dict(name='Ana Silva', registration='12345', email='ana@example.com', department='Ensino', workload=40))[1]['id_servidor']

    def connect(self):
        return psycopg.connect(self.dsn, options=f'-c search_path={self.schema}')

    def drop(self):
        with psycopg.connect(self.dsn, autocommit=True) as conn:
            conn.execute(f'DROP SCHEMA {self.schema} CASCADE')

    def event(self, **kwargs):
        status, result = request('POST', '/datas-especiais', {'data': '2027-02-15', 'especificacao': 'Recesso acadêmico', 'tipo': 'RECESSO', **kwargs})
        self.assertEqual(status, 201, result)
        return result

    def generate(self, **kwargs):
        return request('POST', '/folhas/gerar', dict(id_servidor=self.professor, competencia='2027-02', **kwargs))

    def test_crud_duplicidade_filtros_validacao_e_timestamps(self):
        first = self.event()
        status, _ = request('POST', '/datas-especiais', dict(data='2027-02-15', especificacao='  RECESSO   ACADÊMICO  ', tipo='OUTRO'))
        self.assertEqual(status, 409)
        self.event(especificacao='Evento diferente', tipo='OUTRO')
        self.assertEqual(len(request('GET', '/datas-especiais?ano=2027&mes=2')[1]), 2)
        self.assertEqual(len(request('GET', '/datas-especiais?tipo=RECESSO&inicio=2027-02-15&fim=2027-02-15')[1]), 1)
        self.assertEqual(request('GET', '/datas-especiais?ano=2028')[1], [])
        for query in ('mes=2', 'mes=13&ano=2027', 'tipo=INVALIDO', 'inicio=2027-03-01&fim=2027-02-01'):
            self.assertEqual(request('GET', '/datas-especiais?' + query)[0], 422)
        identifier = first['id_data_especial']
        self.assertEqual(request('GET', f'/datas-especiais/{identifier}')[0], 200)
        status, updated = request('PUT', f'/datas-especiais/{identifier}', dict(data='2027-02-16', especificacao='Alterado', tipo='FERIADO'))
        self.assertEqual(status, 200)
        self.assertGreater(updated['atualizado_em'], first['atualizado_em'])
        self.assertEqual(request('DELETE', f'/datas-especiais/{identifier}'), (204, b''))
        self.assertEqual(request('DELETE', f'/datas-especiais/{identifier}')[0], 404)
        self.assertEqual(request('GET', f'/datas-especiais/{identifier}')[0], 404)
        self.assertEqual(request('POST', '/datas-especiais', dict(data='2027-02-30', especificacao=' ', tipo='OUTRO'))[0], 422)
        for identifier in ('0', '-1', '9223372036854775808', 'abc'):
            self.assertEqual(request('GET', f'/datas-especiais/{identifier}')[0], 422)
            self.assertEqual(request('GET', f'/folhas/geradas/{identifier}')[0], 422)

    def test_importacao_parcial_repetida_e_preserva_classificacao_manual(self):
        self.event(tipo='FERIADO')
        path = self.folder / 'eventos.xlsx'
        planilha(path, [('15/02/2027', 'RECESSO ACADÊMICO'), ('15/02/2027', 'recesso acadêmico'), ('16/02/2027', 'Ponto facultativo'), ('31/02/2027', 'Inválido'), ('17/02/2027', '')])
        content = b'--test\r\nContent-Disposition: form-data; name="arquivo"; filename="eventos.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n' + path.read_bytes() + b'\r\n--test--\r\n'
        def upload():
            return request('POST', '/datas-especiais/importar', content=content, content_type='multipart/form-data; boundary=test')
        status, result = upload()
        self.assertEqual(status, 200, result)
        self.assertEqual([result[k] for k in ('total', 'novos', 'atualizados', 'ignorados', 'invalidos')], [5, 1, 1, 1, 2])
        self.assertEqual([upload()[1][k] for k in ('novos', 'atualizados')], [0, 0])
        with self.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM data_especial').fetchone()[0], 2)
            self.assertEqual(conn.execute("SELECT tipo FROM data_especial WHERE data='2027-02-15'").fetchone()[0], 'FERIADO')
            row = conn.execute('SELECT total,novos,atualizados,ignorados,invalidos FROM importacao_calendario ORDER BY id_importacao LIMIT 1').fetchone()
            self.assertEqual(row, (5, 1, 1, 1, 2))

    def test_geracao_snapshot_versao_download_e_preservacao_folha_recebida(self):
        event = self.event()
        with self.connect() as conn:
            comp = conn.execute('INSERT INTO competencia(ano,mes) VALUES(2027,2) RETURNING id_competencia').fetchone()[0]
        original = self.folder / 'recebida.pdf'; original.write_bytes(b'original imutavel')
        folha = repository.salvar_folha(self.professor, comp, str(original), original.name, '12345', '2027-02', 'OK', None)
        status, doc = self.generate()
        self.assertEqual(status, 201, doc)
        self.assertEqual(doc['situacao'], 'MODELO_EM_BRANCO')
        self.assertEqual(doc['id_folha_referencia'], folha)
        self.assertNotIn('caminho_arquivo', doc)
        docid = doc['id_documento']
        status, pdf = request('GET', f'/folhas/geradas/{docid}/download')
        self.assertEqual(status, 200)
        self.assertTrue(pdf.startswith(b'%PDF'))
        self.assertEqual(hashlib.sha256(pdf).hexdigest(), doc['sha256'])
        with pymupdf.open(stream=pdf, filetype='pdf') as parsed:
            self.assertIn('Recesso acadêmico', ''.join(p.get_text() for p in parsed))
        self.assertEqual(self.generate()[0], 409)
        request('DELETE', f'/datas-especiais/{event["id_data_especial"]}')
        snapshot = request('GET', f'/folhas/geradas/{docid}')[1]['eventos'][0]
        self.assertEqual(snapshot['especificacao'], 'Recesso acadêmico')
        self.assertIsNone(snapshot['id_data_especial'])
        self.assertEqual(request('GET', f'/folhas/geradas/{docid}/download')[1], pdf)
        second = self.generate(nova_versao=True)[1]
        self.assertEqual(second['versao'], 2)
        self.assertEqual(request('GET', f'/folhas/geradas/{second["id_documento"]}')[1]['eventos'], [])
        self.assertEqual(len(request('GET', '/folhas/geradas?competencia=2027-02')[1]), 2)
        self.assertEqual(original.read_bytes(), b'original imutavel')
        self.assertEqual(repository.buscar_folha_para_envio(folha)['caminho_arquivo'], str(original))
        self.smtp.assert_not_called()
        with self.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM envio').fetchone()[0], 0)

    def test_lote_parcial_zip_e_protecao_do_armazenamento(self):
        status, result = request('POST', '/folhas/gerar-lote', dict(ids_servidores=[self.professor, 99999], competencia='2027-02'))
        self.assertEqual(status, 200)
        self.assertEqual((result['gerados'], result['nao_gerados']), (1, 1))
        doc = result['documentos'][0]
        status, zipdata = request('POST', '/folhas/geradas/download-lote', dict(ids_documentos=[doc['id_documento']]))
        self.assertEqual(status, 200)
        with ZipFile(io.BytesIO(zipdata)) as archive:
            self.assertEqual(archive.namelist(), [doc['nome_arquivo']])
            self.assertTrue(archive.read(archive.namelist()[0]).startswith(b'%PDF'))
        self.assertEqual(request('POST', '/folhas/geradas/download-lote', dict(ids_documentos=[9999]))[0], 404)
        self.assertEqual(request('POST', '/folhas/gerar-lote', dict(ids_servidores=[self.professor, self.professor], competencia='2027-02'))[0], 422)
        with self.connect() as conn:
            conn.execute('UPDATE folha_gerada SET caminho_arquivo=%s WHERE id_documento=%s', ('/etc/passwd', doc['id_documento']))
        self.assertEqual(request('GET', f'/folhas/geradas/{doc["id_documento"]}/download')[0], 404)

    def test_falha_de_persistencia_remove_pdf_e_reverte_competencia(self):
        with patch.object(geracao, 'salvar_gerada', side_effect=RuntimeError('Erro simulado')):
            with self.assertRaises(RuntimeError):
                geracao.gerar_folha(GeracaoPayload(id_servidor=self.professor, competencia='2027-03'))
        self.assertEqual(list(self.folder.rglob('*.pdf')), [])
        with self.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM competencia').fetchone()[0], 0)

    def test_geracao_concorrente_nao_duplica_primeira_versao(self):
        from concurrent.futures import ThreadPoolExecutor
        from backend.database.geracao import ConflitoGeracao
        def generate(_):
            try:
                return geracao.gerar_folha(GeracaoPayload(id_servidor=self.professor, competencia='2027-02'))['versao']
            except ConflitoGeracao:
                return 'conflito'
        with ThreadPoolExecutor(max_workers=3) as executor:
            result = list(executor.map(generate, range(3)))
        self.assertEqual(result.count(1), 1)
        self.assertEqual(result.count('conflito'), 2)
