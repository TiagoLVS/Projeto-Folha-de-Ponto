"""Envio de modelos em branco com banco descartável e SMTP simulado."""
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4
import psycopg
from backend.services import geracao
from backend.models.calendario import GeracaoPayload
import test_persistencia as base


@unittest.skipUnless(os.getenv('FOLHA_TEST_DSN'),'Defina FOLHA_TEST_DSN para banco descartável.')
class TestEnvioGeradas(unittest.TestCase):
    connect=base.TestPersistencia.connect
    drop_schema=base.TestPersistencia.drop_schema
    professor=base.TestPersistencia.professor

    def setUp(self):
        base.TestPersistencia.setUp(self)
        context=patch.object(geracao,'PASTA_GERADAS',self.folder/'geradas');context.start();self.addCleanup(context.stop)

    def generate(self,person,new=False,month='2026-09'):
        return geracao.gerar_folha(GeracaoPayload(id_servidor=person,competencia=month,nova_versao=new))

    def send(self,docs,key=None,month='2026-09',reenviar=False):
        return base.request('POST','/folhas/geradas/enviar-lote',{'ids_documentos':[d['id_documento'] for d in docs],'competencia':month,**({'reenviar':True} if reenviar else {})},headers={'Idempotency-Key':key or str(uuid4())})

    def test_reenvio_explicito_preserva_idempotencia_e_bloqueia_pendente(self):
        doc=self.generate(self.professor())
        self.assertEqual(self.send([doc])[1]['enviados'],1)
        self.assertEqual(self.send([doc])[1]['ignorados'],1)
        preview=base.request('GET','/folhas/geradas/para-envio?competencia=2026-09')[1]['documentos'][0]
        self.assertFalse(preview['apto']);self.assertTrue(preview['apto_reenvio'])
        key=str(uuid4())
        first=self.send([doc],key,reenviar=True)
        self.assertEqual(first[1]['enviados'],1)
        self.assertEqual(self.send([doc],key,reenviar=True),first)
        self.assertEqual(self.smtp.call_count,2)
        with self.connect() as conn:
            conn.execute("INSERT INTO envio(id_documento,email_destino) VALUES(%s,'ana@exemplo.com')",(doc['id_documento'],))
        self.assertEqual(self.send([doc],reenviar=True)[1]['ignorados'],1)
        self.assertEqual(self.smtp.call_count,2)
        preview=base.request('GET','/folhas/geradas/para-envio?competencia=2026-09')[1]['documentos'][0]
        self.assertFalse(preview['apto_reenvio'])

    def test_envia_todos_sem_ocr_previa_versao_recente_historico_e_deduplicacao(self):
        person=self.professor();other=self.professor('67890');bad=self.professor('55555')
        with self.connect() as conn:conn.execute("UPDATE servidor SET email='bruno@example.com',nome='Bruno' WHERE id_servidor=%s",(other,))
        old=self.generate(person);latest=self.generate(person,True);second=self.generate(other);invalid=self.generate(bad)
        with self.connect() as conn:conn.execute("UPDATE servidor SET email='invalido' WHERE id_servidor=%s",(bad,))
        status,preview=base.request('GET','/folhas/geradas/para-envio?competencia=2026-09')
        self.assertEqual(status,200,preview);self.assertTrue(preview['configurado'])
        self.assertEqual(len(preview['documentos']),3)
        self.assertNotIn(old['id_documento'],[d['id_documento'] for d in preview['documentos']])
        self.assertEqual(sum(d['apto'] for d in preview['documentos']),2)
        key=str(uuid4());status,result=self.send([latest,second,invalid],key)
        self.assertEqual(status,200,result);self.assertEqual([result[k] for k in ('enviados','ignorados','falhas')],[2,0,1]);self.assertEqual(self.smtp.call_count,2)
        self.assertEqual(self.send([latest,second,invalid],key),(status,result));self.assertEqual(self.smtp.call_count,2)
        result=self.send([latest,second])[1];self.assertEqual(result['ignorados'],2);self.assertEqual(self.smtp.call_count,2)
        history=base.request('GET','/emails/historico?competencia=2026-09')[1]
        self.assertEqual(len(history),2);self.assertTrue(all(r['origem']=='GERADA' and r['id_folha'] is None for r in history))
        self.assertEqual({call.args[0]['To'] for call in self.smtp.call_args_list},{'ana@exemplo.com','bruno@example.com'})
        for call in self.smtp.call_args_list:
            message=call.args[0];self.assertIn('preenchimento',message['Subject']);self.assertEqual(len(list(message.iter_attachments())),1)
        with self.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM folha_ponto').fetchone()[0],0)
            self.assertEqual(conn.execute("SELECT count(*) FROM folha_gerada WHERE situacao='MODELO_EM_BRANCO'").fetchone()[0],4)

    def test_falha_parcial_e_reenvio_pelo_historico(self):
        docs=[self.generate(self.professor()),self.generate(self.professor('67890'))]
        self.smtp.side_effect=[('ERRO','Falha simulada',None),('ENVIADO','',None)]
        status,result=self.send(docs);self.assertEqual(status,200,result);self.assertEqual(result['enviados'],1);self.assertEqual(result['falhas'],1)
        logs=base.request('GET','/emails/historico?status=ERRO')[1];self.assertEqual(len(logs),1)
        self.smtp.side_effect=None
        payload={'log_ids':[logs[0]['id']]}
        status,result=base.request('POST','/emails/reenviar-erros',payload,headers={'Idempotency-Key':str(uuid4())})
        self.assertEqual(status,200,result);self.assertEqual(result['reenviados'],1);self.assertEqual(result['falhas'],0)
        count=self.smtp.call_count
        result=base.request('POST','/emails/reenviar-erros',payload,headers={'Idempotency-Key':str(uuid4())})[1]
        self.assertEqual(result['ignorados'],1);self.assertEqual(self.smtp.call_count,count)

    def test_anexo_legado_recebe_nome_do_servidor_e_competencia(self):
        person=self.professor()
        with self.connect() as conn:
            conn.execute("UPDATE servidor SET nome='Ana Sílva' WHERE id_servidor=%s",(person,))
        doc=self.generate(person)
        path,_=geracao.arquivo_documento(doc['id_documento'])
        content=path.read_bytes()
        legacy=path.with_name('Folha_21_2026-09_v1_ccfb936145224d8cbdc9ea3d23630b15.pdf')
        path.rename(legacy)
        with self.connect() as conn:
            conn.execute('UPDATE folha_gerada SET caminho_arquivo=%s,nome_arquivo=%s WHERE id_documento=%s',(str(legacy),legacy.name,doc['id_documento']))
        self.assertEqual(self.send([doc])[1]['enviados'],1)
        attachment=list(self.smtp.call_args.args[0].iter_attachments())[0]
        self.assertEqual(attachment.get_filename(),'Ana_Silva-2026-09.pdf')
        self.assertEqual(attachment.get_payload(decode=True),content)
        self.assertTrue(legacy.is_file())

    def test_modo_teste_destinatario_e_envio_real_sao_diferentes(self):
        doc=self.generate(self.professor())
        with patch.dict(os.environ,DIGEP_MODO_TESTE='true'):
            preview=base.request('GET','/folhas/geradas/para-envio?competencia=2026-09')[1]
            self.assertEqual(preview['destinatario_teste'],'digep@example.com')
            self.assertEqual(self.send([doc])[1]['enviados'],1)
            self.assertEqual(self.smtp.call_args.args[0]['To'],'digep@example.com')
        self.assertEqual(self.send([doc])[1]['enviados'],1)
        self.assertEqual(self.smtp.call_args.args[0]['To'],'ana@exemplo.com')

    def test_arquivo_versao_competencia_email_e_ids_invalidos_nao_enviam(self):
        person=self.professor();old=self.generate(person);latest=self.generate(person,True)
        self.assertEqual(self.send([old])[1]['falhas'],1)
        self.assertEqual(self.send([latest],month='2026-10')[1]['falhas'],1)
        path=geracao.arquivo_documento(latest['id_documento'])[0];path.unlink()
        self.assertEqual(self.send([latest])[1]['falhas'],1)
        self.assertEqual(self.send([latest,latest])[0],422)
        self.assertEqual(self.smtp.call_count,0)
        with patch.dict(os.environ,DIGEP_EMAIL='',SMTP_USER='',SMTP_PASSWORD='',DIGEP_SENHA_APP=''):
            self.assertEqual(self.send([latest])[0],422)
        with self.connect() as conn:self.assertEqual(conn.execute('SELECT count(*) FROM envio').fetchone()[0],0)

    def test_pendente_nao_duplica_e_banco_exige_origem(self):
        doc=self.generate(self.professor())
        with self.connect() as conn:conn.execute("INSERT INTO envio(id_documento,email_destino) VALUES(%s,'ana@exemplo.com')",(doc['id_documento'],))
        self.assertEqual(self.send([doc])[1]['ignorados'],1);self.assertEqual(self.smtp.call_count,0)
        with self.assertRaises(psycopg.errors.CheckViolation),self.connect() as conn:
            conn.execute("INSERT INTO envio(email_destino) VALUES('a@example.com')")

    def test_migracao_005_pode_ser_reaplicada_preservando_logs(self):
        doc=self.generate(self.professor());self.send([doc])
        with self.connect() as conn:
            before=conn.execute('SELECT * FROM envio').fetchall()
            migration=Path('database/migrations/005_envio_modelos.sql').read_text()
            conn.execute(migration);conn.execute(migration)
            self.assertEqual(conn.execute('SELECT * FROM envio').fetchall(),before)
