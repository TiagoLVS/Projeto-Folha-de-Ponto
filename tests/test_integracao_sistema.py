import os
import unittest
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch
from openpyxl import Workbook
import test_persistencia as base
from test_persistencia import request, multipart, pdf
from backend.services import lease, folhas_recebidas
from backend.services.ler_planilha import ler_planilha


@unittest.skipUnless(os.getenv('FOLHA_TEST_DSN'),'Defina FOLHA_TEST_DSN para banco descartável.')
class TestIntegracaoSistema(unittest.TestCase):
    setUp=base.TestPersistencia.setUp
    connect=base.TestPersistencia.connect
    drop_schema=base.TestPersistencia.drop_schema
    professor=base.TestPersistencia.professor
    upload=base.TestPersistencia.upload

    def sheet(self,rows):
        book=Workbook();book.active.append(['Nome','Matrícula','CPF','E-mail','Carga Horária','Acumula cargo (Sim/Não)'])
        for row in rows:book.active.append(row)
        path=self.folder/'cadastros.xlsx';book.save(path);book.close();return path.read_bytes()

    def preview(self,content,filename='cadastros.xlsx'):
        return request('POST','/servidores/importar/preview',body=multipart(content,filename=filename,mime='application/vnd.ms-excel'),content_type='multipart/form-data; boundary=test')

    def test_preview_confirmacao_idempotente_xlsx_preserva_zeros_e_conflitos(self):
        data=self.sheet([['Ana Silva','0012345','00123456789','ana@example.com','40h','Não'],['Bruno Costa','0012346','00123456789','bruno@example.com','20h','Sim'],['Inválido','0012347','','bad','40h','Não']])
        status,preview=self.preview(data);self.assertEqual(status,200,preview)
        self.assertTrue(all(not row['valido'] for row in preview['registros']))
        data=self.sheet([['Ana Silva','0012345','00123456789','ana@example.com','40h','Não']])
        status,preview=self.preview(data);self.assertEqual(status,200)
        self.assertEqual(request('GET','/servidores')[1],[])
        self.assertEqual(preview['registros'][0]['cpf'],'00123456789')
        key=uuid4().hex;payload={'token':preview['token']}
        first=request('POST','/servidores/importar/confirm',payload,headers={'Idempotency-Key':key})
        self.assertEqual(first[0],200,first);self.assertEqual(first[1]['novos'],1)
        self.assertEqual(request('POST','/servidores/importar/confirm',payload,headers={'Idempotency-Key':key}),first)
        records=request('GET','/servidores')[1];self.assertEqual(records[0]['matricula'],'0012345');self.assertEqual(records[0]['carga_horaria'],40)
        again=self.preview(data)[1];self.assertEqual(again['registros'][0]['acao'],'ignorado')
        changed=self.sheet([['Ana Atualizada','0012345','00123456789','nova@example.com','20h','Sim']])
        preview=self.preview(changed)[1];self.assertEqual(preview['registros'][0]['acao'],'atualizado')
        self.assertEqual(request('POST','/servidores/importar/confirm',{'token':preview['token']},headers={'Idempotency-Key':'atualizar'})[1]['atualizados'],1)
        conflict=self.sheet([['Outra Pessoa','0012999','00123456789','outra@example.com','40h','Não']])
        preview=self.preview(conflict)[1];self.assertFalse(preview['registros'][0]['valido']);self.assertIn('outra matrícula',preview['registros'][0]['motivo'])

    def test_xls_real_importado_e_preview_expirado(self):
        status,preview=self.preview(Path('tests/fixtures/servidores.xls').read_bytes(),'servidores.xls')
        self.assertEqual(status,200,preview);self.assertEqual(preview['registros'][0]['matricula'],'0012345')
        self.assertEqual(preview['registros'][0]['cpf'],'00123456789')
        with self.connect() as conn: conn.execute("UPDATE importacao_servidor_preview SET expira_em=clock_timestamp()-interval '1 second' WHERE token=%s",(preview['token'],))
        self.assertEqual(request('POST','/servidores/importar/confirm',{'token':preview['token']},headers={'Idempotency-Key':'expirado'})[0],410)

    def test_lock_duas_sessoes_expiracao_concorrencia_e_protecao(self):
        a,b=str(uuid4()),str(uuid4())
        self.assertFalse(request('GET','/sistema/lock',headers={'X-Client-Id':a})[1]['locked'])
        self.assertTrue(request('POST','/sistema/lock/adquirir',headers={'X-Client-Id':a})[1]['holder'])
        self.assertTrue(request('GET','/sistema/lock',headers={'X-Client-Id':b})[1]['locked'])
        self.assertEqual(request('POST','/sistema/lock/adquirir',headers={'X-Client-Id':b})[0],423)
        self.assertEqual(request('POST','/servidores',self.payload,headers={'X-Client-Id':b})[0],423)
        self.assertEqual(request('POST','/servidores',self.payload)[0],423)
        self.assertEqual(request('POST','/servidores',self.payload,headers={'X-Client-Id':a})[0],201)
        self.assertEqual(request('POST','/sistema/lock/renovar',headers={'X-Client-Id':a})[0],200)
        self.assertEqual(request('DELETE','/sistema/lock',headers={'X-Client-Id':b})[0],423)
        self.assertEqual(request('DELETE','/sistema/lock',headers={'X-Client-Id':a})[0],204)
        from concurrent.futures import ThreadPoolExecutor
        def acquire(value):
            try: return lease.alterar(value,'adquirir')['holder']
            except Exception as e: return e.status_code
        with ThreadPoolExecutor(max_workers=2) as executor:
            results=list(executor.map(acquire,[a,b]))
        self.assertEqual(results.count(True),1);self.assertEqual(results.count(423),1)
        with self.connect() as conn: conn.execute("UPDATE sistema_lock SET expires_at=clock_timestamp()-interval '1 second'")
        self.assertEqual(request('POST','/sistema/lock/adquirir',headers={'X-Client-Id':b})[0],200)

    def test_historico_email_filtros_reenvio_e_validacao_backend(self):
        person=self.professor();document=self.upload(person)[1];identifier=document['id_folha']
        payload={'month':'2026-09','professorIds':[str(person)]}
        self.assertEqual(request('POST','/folhas/enviar-lote',payload,headers={'Idempotency-Key':'revisar'})[0],422)
        with patch('backend.routes.integracao.enviar_apos_confirmacao',return_value={'status':'NAO_CONFIGURADO','mensagem':'Teste'}):
            request('PATCH',f'/folhas/{identifier}',{'id_servidor':person,'competencia':'2026-09'})
        with self.connect() as conn:
            log=conn.execute("INSERT INTO envio(id_folha,email_destino,status_envio,mensagem_erro) VALUES(%s,'ana@example.com','ERRO','Falha teste') RETURNING id_envio",(identifier,)).fetchone()[0]
        status,logs=request('GET','/emails/historico?cpf=00000012345&status=ERRO&competencia=2026-09')
        self.assertEqual(status,200);self.assertEqual(logs[0]['id'],log)
        self.assertEqual(request('GET','/emails/historico?nome=Outro')[1],[])
        payload={'log_ids':[log]};headers={'Idempotency-Key':'reenvio'}
        first=request('POST','/emails/reenviar-erros',payload,headers=headers)
        self.assertEqual(first[0],200,first);self.assertEqual(first[1]['reenviados'],1)
        self.assertEqual(request('POST','/emails/reenviar-erros',payload,headers=headers),first)
        self.assertEqual(self.smtp.call_count,1)
        self.assertEqual(request('POST','/emails/reenviar-erros',payload,headers={'Idempotency-Key':'nova-chave'})[1]['ignorados'],1)
        self.assertEqual(self.smtp.call_count,1)
        self.assertEqual(request('POST','/folhas/enviar-lote',{'month':'2026-09','professorIds':[str(person), '9999']},headers={'Idempotency-Key':'inexistente'})[0],422)

    def test_lote_parcial_preserva_pdfs_validos_e_concorrencia_de_upload(self):
        person=self.professor();good=pdf()
        results=[self.upload(person,period=period,content=content)[0] for period,content in [('2026-09',good),('2026-10',b'not pdf'),('2026-11',good)]]
        self.assertEqual(results,[201,422,201]);self.assertEqual(len(request('GET','/folhas')[1]),2)
        from concurrent.futures import ThreadPoolExecutor
        path=self.folder/'fonte.pdf';path.write_bytes(good)
        def upload(_):
            try:return folhas_recebidas.salvar_upload(path,person,'2026-12')['id_folha']
            except Exception as error:return error.status_code
        with ThreadPoolExecutor(max_workers=2) as executor: results=list(executor.map(upload,range(2)))
        self.assertEqual(results.count(409),1)
        self.assertEqual(len(request('GET','/folhas')[1]),3)

    def test_erro_email_nao_desfaz_confirmacao(self):
        person=self.professor();identifier=self.upload(person)[1]['id_folha']
        with patch('backend.routes.integracao.enviar_apos_confirmacao',side_effect=RuntimeError('Erro interno')):
            status,value=request('PATCH',f'/folhas/{identifier}',{'id_servidor':person,'competencia':'2026-09'})
        self.assertEqual(status,200);self.assertEqual(value['envio']['status'],'ERRO')
        self.assertTrue(request('GET','/folhas')[1][0]['confirmado_em'])
