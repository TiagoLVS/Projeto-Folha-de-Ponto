"""Integração com PostgreSQL isolado: FOLHA_TEST_DSN='...' python -m unittest discover -s tests."""
import asyncio
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

import psycopg

from backend.api import app
from backend.database import repository


def request(method, path, payload=None, body=None, content_type='application/json', headers=None):
    """Exercita o app ASGI completo, incluindo validação, sem servidor HTTP."""
    events = []
    body = body if body is not None else json.dumps(payload).encode() if payload is not None else b''

    async def receive():
        return {'type': 'http.request', 'body': body, 'more_body': False}

    async def send(event):
        events.append(event)

    asyncio.run(app({
        'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
        'method': method, 'scheme': 'http', 'path': path,
        'raw_path': path.encode(), 'query_string': b'', 'root_path': '',
        'headers': [(b'content-type', content_type.encode())] + [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        'server': ('test', 80), 'client': ('test', 1234),
    }, receive, send))
    status = next(e['status'] for e in events if e['type'] == 'http.response.start')
    data = b''.join(e.get('body', b'') for e in events if e['type'] == 'http.response.body')
    return status, json.loads(data)


@unittest.skipUnless(os.getenv('FOLHA_TEST_DSN'), 'Defina FOLHA_TEST_DSN para um banco de testes.')
class TestPersistencia(unittest.TestCase):
    def setUp(self):
        self.dsn = os.environ['FOLHA_TEST_DSN']
        self.schema = 'test_' + uuid4().hex
        with psycopg.connect(self.dsn, autocommit=True) as conn:
            conn.execute(f'CREATE SCHEMA {self.schema}')
        self.addCleanup(self.drop_schema)
        self.connection = patch.object(repository, 'conectar', self.connect)
        self.connection.start()
        self.addCleanup(self.connection.stop)
        with self.connect() as conn:
            conn.execute(Path('database/folha_pontos.sql').read_text())
        self.payload = {'name': 'Ana', 'registration': '12345', 'email': 'ANA@EXEMPLO.COM', 'department': 'Ensino', 'workload': 40}

    def connect(self):
        return psycopg.connect(self.dsn, options=f'-c search_path={self.schema}')

    def drop_schema(self):
        with psycopg.connect(self.dsn, autocommit=True) as conn:
            conn.execute(f'DROP SCHEMA {self.schema} CASCADE')

    def professor(self, registration='12345'):
        status, data = request('POST', '/servidores', {**self.payload, 'registration': registration})
        self.assertEqual(status, 201)
        self.assertEqual(data['carga_horaria'], 40)
        return data['id_servidor']

    def folha(self, status='REVISAR'):
        return repository.salvar_folha(None, None, '/tmp/original.pdf', 'original.pdf', '00000', '2026-01', status, 'Conferir')

    def test_cadastro_listagem_edicao_e_duplicidade(self):
        self.assertEqual(request('GET', '/servidores'), (200, []))
        id_servidor = self.professor()
        second = self.professor('67890')
        payload = {**self.payload, 'name': ' Ana Atualizada ', 'registration': '54321', 'workload': 20}
        status, updated = request('PUT', f'/servidores/{id_servidor}', payload)
        self.assertEqual(status, 200)
        self.assertEqual(updated['nome'], 'Ana Atualizada')
        self.assertEqual(updated['email'], 'ana@exemplo.com')
        self.assertEqual(updated['carga_horaria'], 20)
        status, records = request('GET', '/servidores')
        self.assertEqual(status, 200)
        self.assertIn(updated, records)
        self.assertEqual(request('PUT', f'/servidores/{second}', payload)[0], 409)
        self.assertEqual(request('POST', '/servidores', payload)[0], 409)
        self.assertEqual(request('PUT', '/servidores/9999', self.payload)[0], 404)
        self.assertEqual(request('PUT', f'/servidores/{id_servidor}', {**payload, 'email': 'inválido'})[0], 422)

    def test_correcao_ocr_e_consulta_para_email(self):
        person = self.professor()
        folha = self.folha('ERRO')
        status, saved = request('PATCH', f'/folhas/{folha}', {'id_servidor': person, 'competencia': '2026-09'})
        self.assertEqual(status, 200)
        self.assertEqual(saved['status_ocr'], 'OK')
        self.assertEqual(repository.buscar_folha_para_envio(folha)['id_servidor'], person)
        self.assertEqual(repository.listar_folhas_para_envio(2026, 9, [person])[0]['id_folha'], folha)
        other = self.professor('67890')
        status, saved = request('PATCH', f'/folhas/{folha}', {'id_servidor': other, 'competencia': '2026-10'})
        self.assertEqual(status, 200)
        self.assertEqual(repository.listar_folhas_para_envio(2026, 9, [person]), [])
        self.assertEqual(repository.listar_folhas_para_envio(2026, 10, [other])[0]['id_folha'], folha)
        with self.connect() as conn:
            row = conn.execute('SELECT matricula_lida, competencia_lida, caminho_arquivo, mensagem_ocr FROM folha_ponto WHERE id_folha = %s', (folha,)).fetchone()
        self.assertEqual(row, ('00000', '2026-01', '/tmp/original.pdf', None))
        # Repetir a confirmação não cria novas folhas nem competências.
        self.assertEqual(request('PATCH', f'/folhas/{folha}', {'id_servidor': other, 'competencia': '2026-10'})[0], 200)

    def test_conflito_nao_substitui_folhas(self):
        person = self.professor()
        first, second = self.folha(), self.folha()
        payload = {'id_servidor': person, 'competencia': '2026-09'}
        self.assertEqual(request('PATCH', f'/folhas/{first}', payload)[0], 200)
        self.assertEqual(request('PATCH', f'/folhas/{second}', payload)[0], 409)
        with self.connect() as conn:
            rows = conn.execute('SELECT id_servidor, status_ocr FROM folha_ponto ORDER BY id_folha').fetchall()
        self.assertEqual(rows, [(person, 'OK'), (None, 'REVISAR')])

    def test_confirmacao_invalida_nao_altera_banco(self):
        person = self.professor()
        folha = self.folha()
        for period in ('2026-13', '2026-00', '1999-12', '09/2026'):
            self.assertEqual(request('PATCH', f'/folhas/{folha}', {'id_servidor': person, 'competencia': period})[0], 422)
        self.assertEqual(request('PATCH', f'/folhas/{folha}', {'id_servidor': True, 'competencia': '2026-09'})[0], 422)
        self.assertEqual(request('PATCH', f'/folhas/{folha}', {'id_servidor': 9999, 'competencia': '2026-09'})[0], 404)
        self.assertEqual(request('PATCH', '/folhas/9999', {'id_servidor': person, 'competencia': '2026-09'})[0], 404)
        with self.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM competencia').fetchone()[0], 0)
            self.assertEqual(conn.execute('SELECT status_ocr FROM folha_ponto').fetchone()[0], 'REVISAR')

    def test_envio_idempotente_persistido_nao_reenvia(self):
        person = self.professor()
        folha = self.folha()
        request('PATCH', f'/folhas/{folha}', {'id_servidor': person, 'competencia': '2026-09'})
        payload = {'month': '2026-09', 'professorIds': [str(person)]}
        headers = {'Idempotency-Key': 'lote-persistido'}
        with patch('backend.api.enviar_folha_do_banco', return_value={'status': 'ENVIADO'}) as send:
            first = request('POST', '/folhas/enviar-lote', payload, headers=headers)
            second = request('POST', '/folhas/enviar-lote', payload, headers=headers)
            self.assertEqual(first[0], 200)
            self.assertEqual(first, second)
            self.assertEqual(first[1]['sentCount'], 1)
            send.assert_called_once()
            self.assertEqual(request('POST', '/folhas/enviar-lote', {**payload, 'month': '2026-10'}, headers=headers)[0], 409)
        self.assertEqual(repository.obter_requisicao_idempotente('lote-persistido')['status'], 'CONCLUIDO')

    def test_requisicoes_concorrentes_reservam_apenas_um_lote(self):
        from concurrent.futures import ThreadPoolExecutor
        payload = {'month': '2026-09', 'professorIds': [1]}
        hash_value = repository.payload_hash_for('2026-09', [1])
        def reserve(_):
            return repository.registrar_requisicao_idempotente('concorrente', hash_value, payload)
        with ThreadPoolExecutor(max_workers=4) as executor:
            records = list(executor.map(reserve, range(4)))
        self.assertEqual(sum(record['created'] for record in records), 1)
        with patch('backend.api.enviar_folha_do_banco') as send:
            status, _ = request('POST', '/folhas/enviar-lote', payload, headers={'Idempotency-Key': 'concorrente'})
            self.assertEqual(status, 409)
            send.assert_not_called()

    def test_falha_no_lote_tambem_e_memorizada(self):
        person = self.professor()
        folha = self.folha()
        request('PATCH', f'/folhas/{folha}', {'id_servidor': person, 'competencia': '2026-09'})
        payload = {'month': '2026-09', 'professorIds': [person]}
        headers = {'Idempotency-Key': 'lote-falhou'}
        with patch('backend.api.enviar_folha_do_banco', side_effect=RuntimeError('Falha SMTP')) as send:
            first = request('POST', '/folhas/enviar-lote', payload, headers=headers)
            self.assertEqual(first[0], 502)
            self.assertEqual(request('POST', '/folhas/enviar-lote', payload, headers=headers), first)
            send.assert_called_once()

    def test_migracao_pode_ser_aplicada_novamente(self):
        with self.connect() as conn:
            conn.execute(Path('database/migrations/001_idempotency_request.sql').read_text())
        self.assertIsNone(repository.obter_requisicao_idempotente('nao-existe'))

    def test_documento_manual_guardado_sem_ocr(self):
        person = self.professor()
        content = b'%PDF-1.4\n%%EOF'
        body = b'--test\r\nContent-Disposition: form-data; name="arquivo"; filename="folha.pdf"\r\nContent-Type: application/pdf\r\n\r\n' + content + b'\r\n--test--\r\n'
        with tempfile.TemporaryDirectory() as directory, patch('backend.services.processar_folha.PASTA_FOLHAS', Path(directory)):
            status, record = request('POST', '/folhas/registrar', body=body, content_type='multipart/form-data; boundary=test')
            self.assertEqual(status, 201)
            folha = record['id_folha']
            self.assertEqual(request('PATCH', f'/folhas/{folha}', {'id_servidor': person, 'competencia': '2026-09'})[0], 200)
            saved = repository.buscar_folha_para_envio(folha)
            self.assertEqual(Path(saved['caminho_arquivo']).read_bytes(), content)
            self.assertEqual(saved['status_ocr'], 'OK')


if __name__ == '__main__':
    unittest.main()
