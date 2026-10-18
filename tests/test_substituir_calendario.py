"""Substituição anual somente em banco de testes; PDFs/snapshots preservados."""
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import UUID,uuid4
from backend.services import calendario,geracao
from backend.models.calendario import GeracaoPayload
import test_persistencia as base
from test_calendario import planilha
from test_refinamentos import pdf_texto


@unittest.skipUnless(os.getenv('FOLHA_TEST_DSN'),'Defina FOLHA_TEST_DSN para banco descartável.')
class TestSubstituirCalendario(unittest.TestCase):
    connect=base.TestPersistencia.connect
    drop_schema=base.TestPersistencia.drop_schema
    professor=base.TestPersistencia.professor

    def setUp(self):
        base.TestPersistencia.setUp(self)
        context=patch.object(geracao,'PASTA_GERADAS',self.folder/'geradas');context.start();self.addCleanup(context.stop)
        self.antiga=self.event('2026-02-15','Recesso antigo')
        self.outra=self.event('2027-01-01','Feriado de outro ano')

    def event(self,day,text):
        status,row=base.request('POST','/datas-especiais',{'data':day,'especificacao':text,'tipo':'OUTRO'})
        self.assertEqual(status,201,row);return row

    def preview(self,rows=None,pdf=False):
        if pdf:
            content=pdf_texto('16/02/2026 Recesso atualizado');name='novo.pdf';mime='application/pdf'
        else:
            path=self.folder/'novo.xlsx';planilha(path,rows if rows is not None else [('16/02/2026','Recesso atualizado')]);content=path.read_bytes();name='novo.xlsx';mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        status,data=base.request('POST','/datas-especiais/importar',body=base.multipart(content,filename=name,mime=mime,fields={'modo':'substituir','ano':'2026'}),content_type='multipart/form-data; boundary=test')
        self.assertEqual(status,200,data);return data

    def confirm(self,preview,key=None):
        return base.request('POST','/datas-especiais/importar/confirm',{'token':preview['token']},headers={'Idempotency-Key':key or str(uuid4())})

    def all(self):return base.request('GET','/datas-especiais')[1]

    def test_substitui_so_ano_confirmado_preserva_pdf_e_snapshot(self):
        doc=geracao.gerar_folha(GeracaoPayload(id_servidor=self.professor(),competencia='2026-02'))
        path=geracao.arquivo_documento(doc['id_documento'])[0];original=path.read_bytes()
        preview=self.preview()
        self.assertEqual(preview['modo'],'substituir');self.assertEqual(preview['ano'],2026)
        self.assertEqual(preview['existentes_a_remover'],1);self.assertTrue(preview['pode_confirmar'])
        self.assertIn(self.antiga['id_data_especial'],[r['id_data_especial'] for r in self.all()])
        key=str(uuid4());status,result=self.confirm(preview,key)
        self.assertEqual(status,200,result);self.assertEqual(result['removidos'],1);self.assertEqual(result['novos'],1)
        records=self.all();self.assertEqual(len(records),2)
        self.assertIn(self.outra['id_data_especial'],[r['id_data_especial'] for r in records])
        self.assertNotIn(self.antiga['id_data_especial'],[r['id_data_especial'] for r in records])
        self.assertEqual(path.read_bytes(),original)
        with self.connect() as conn:
            snapshot=conn.execute('SELECT especificacao,id_data_especial FROM folha_gerada_evento WHERE id_documento=%s',(doc['id_documento'],)).fetchone()
            self.assertEqual(snapshot,('Recesso antigo',None))
            audit=conn.execute('SELECT detalhes FROM importacao_calendario').fetchone()[0]
            self.assertEqual(audit[0]['substituicao']['eventos_anteriores'][0][2],'Recesso antigo')
        self.assertEqual(self.confirm(preview,key),(status,result))
        self.event('2026-03-01','Evento posterior')
        self.assertEqual(self.confirm(preview),(status,result))
        self.assertEqual(len(self.all()),3)

    def test_pdf_tambem_substitui_ano(self):
        preview=self.preview(pdf=True);self.assertTrue(preview['pode_confirmar'])
        status,result=self.confirm(preview);self.assertEqual(status,200,result);self.assertEqual(result['removidos'],1)
        self.assertTrue(any(r['data']=='2026-02-16' for r in self.all()))

    def test_invalidos_fora_do_ano_e_vazio_nao_apagam_calendario(self):
        for rows in ([('31/02/2026','Inválido')],[('01/01/2027','Ano diferente')],[],[('16/02/2026','Válido'),('31/02/2026','Inválido')]):
            with self.subTest(rows=rows):
                preview=self.preview(rows)
                self.assertFalse(preview['pode_confirmar'])
                self.assertEqual(self.confirm(preview)[0],422)
                self.assertEqual(len(self.all()),2)
                self.assertIn(self.antiga['id_data_especial'],[r['id_data_especial'] for r in self.all()])

    def test_mudanca_desde_previa_rejeita_sem_apagar(self):
        preview=self.preview();self.event('2026-04-21','Alteração concorrente')
        status,error=self.confirm(preview)
        self.assertEqual(status,409,error);self.assertIn('mudou',error['detail']);self.assertEqual(len(self.all()),3)

    def test_falha_na_gravacao_reverte_exclusao(self):
        preview=self.preview()
        with patch.object(calendario,'importar_datas',side_effect=RuntimeError('Falha simulada')):
            with self.assertRaises(RuntimeError):calendario.confirmar_pdf(UUID(preview['token']))
        self.assertEqual(len(self.all()),2)
        self.assertIn(self.antiga['id_data_especial'],[r['id_data_especial'] for r in self.all()])
        with self.connect() as conn:self.assertEqual(conn.execute('SELECT count(*) FROM importacao_calendario').fetchone()[0],0)
        self.assertEqual(self.confirm(preview)[0],200)
