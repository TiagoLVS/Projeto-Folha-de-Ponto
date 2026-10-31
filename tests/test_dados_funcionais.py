"""Dados da planilha estendida: API, importação, migração e PDF em banco descartável."""
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from openpyxl import Workbook
import pymupdf
from backend.database import repository
from backend.models.calendario import GeracaoPayload
from backend.services import geracao, importacao_servidores as imports
from backend.services.ler_planilha import ler_planilha, importar_planilha, COLUNAS_ESPERADAS
import test_persistencia as base

EXTRAS = ['UA','Cargo','Padrão','Função','Exercício']
DATA = dict(ua='001 – UnDF',cargo='PROF-D20',padrao='PD-4V',funcao='Coordenação',exercicio='Escola Superior de Engenharia, Tecnologia e Inovação')

@unittest.skipUnless(os.getenv('FOLHA_TEST_DSN'),'Defina FOLHA_TEST_DSN para banco descartável.')
class TestDadosFuncionais(unittest.TestCase):
    setUp=base.TestPersistencia.setUp
    connect=base.TestPersistencia.connect
    drop_schema=base.TestPersistencia.drop_schema

    def planilha(self, extended=True, fields=None):
        path=self.folder/'servidores.xlsx'
        book=Workbook();book.active.append(COLUNAS_ESPERADAS+(EXTRAS if extended else []))
        book.active.append(['Ana Silva','0012345','001.234.567-89','ana@example.com','40h','Não']+(list((DATA if fields is None else fields).values()) if extended else []))
        book.save(path);book.close();return path

    def test_cadastro_edicao_consulta_limites_e_pdf_snapshot(self):
        payload=dict(name='Ana Silva',registration='0012345',cpf='00123456789',email='ana@example.com',department='Ensino',workload=40,**DATA)
        status,result=base.request('POST','/servidores',payload)
        self.assertEqual(status,201,result);identifier=result['id_servidor']
        self.assertEqual({k:result[k] for k in DATA},DATA)
        self.assertEqual(base.request('GET','/servidores')[1][0]['exercicio'],DATA['exercicio'])
        with patch.object(geracao,'PASTA_GERADAS',self.folder/'geradas'):
            document=geracao.gerar_folha(GeracaoPayload(id_servidor=identifier,competencia='2026-10'))
            path,_=geracao.arquivo_documento(document['id_documento'])
            with pymupdf.open(path) as pdf:
                text=''.join(p.get_text() for p in pdf)
                for expected in ('001 - UnDF','PROF-D20','PD-4V','Coordenação',DATA['exercicio']):self.assertIn(expected,text)
            original=path.read_bytes()
            updated={**payload,'cargo':'TUT-M40','funcao':None}
            status,result=base.request('PUT',f'/servidores/{identifier}',updated)
            self.assertEqual(status,200,result);self.assertEqual(result['cargo'],'TUT-M40');self.assertIsNone(result['funcao'])
            snapshot=geracao.buscar_gerada(document['id_documento'])['dados_professor']
            self.assertEqual(snapshot['cargo'],'PROF-D20');self.assertEqual(path.read_bytes(),original)
            old_client={k:v for k,v in payload.items() if k not in DATA}
            self.assertEqual(base.request('PUT',f'/servidores/{identifier}',old_client)[1]['cargo'],'TUT-M40')
        self.assertEqual(base.request('POST','/servidores',{**payload,'ua':'x'*201})[0],422)
        with self.connect() as conn:
            before=conn.execute('SELECT * FROM servidor').fetchall()
            migration=Path('database/migrations/006_dados_funcionais_servidor.sql').read_text()
            conn.execute(migration);conn.execute(migration)
            self.assertEqual(before,conn.execute('SELECT * FROM servidor').fetchall())

    def test_importacao_estendida_preserva_ausentes_e_limpa_vazios(self):
        path=self.planilha();preview=imports.preview(path)
        self.assertEqual(preview['registros'][0]['exercicio'],DATA['exercicio'])
        result=imports.confirmar(preview['token']);self.assertEqual(result['novos'],1)
        self.assertEqual(imports.confirmar(preview['token']),result)
        self.assertEqual(imports.confirmar(imports.preview(path)['token'])['ignorados'],1)
        legacy=self.planilha(False)
        self.assertEqual(imports.confirmar(imports.preview(legacy)['token'])['ignorados'],1)
        self.assertEqual(repository.listar_servidores()[0]['funcao'],'Coordenação')
        # O caminho antigo de importação também preserva as colunas ausentes.
        importar_planilha(legacy)
        self.assertEqual(repository.listar_servidores()[0]['cargo'],'PROF-D20')
        changed={**DATA,'cargo':'TUT-M40','funcao':None}
        extended=self.planilha(fields=changed)
        preview=imports.preview(extended);self.assertEqual(preview['registros'][0]['acao'],'atualizado')
        self.assertIsNone(preview['registros'][0]['funcao'])
        self.assertEqual(imports.confirmar(preview['token'])['atualizados'],1)
        saved=repository.listar_servidores()[0];self.assertEqual(saved['cargo'],'TUT-M40');self.assertIsNone(saved['funcao'])
        invalid=ler_planilha(self.planilha(fields={**DATA,'ua':'x'*201}))
        self.assertEqual(len(invalid['validos']),0);self.assertIn('UA',invalid['invalidos'][0]['erros'][0])
