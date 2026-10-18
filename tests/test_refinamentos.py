"""Limites, calendário PDF/OCR e regra de jornada; SMTP nunca é utilizado."""
import shutil
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZipFile

import psycopg
import pymupdf
from pydantic import ValidationError
from backend.config import MAX_GENERATION_BATCH, MAX_GENERATED_DOWNLOAD_BATCH, positivo
from backend.models.calendario import GeracaoLotePayload, DownloadLotePayload
from backend.models.servidor import ServidorPayload
from backend.services import geracao
from backend.services.calendario_pdf import ler_calendario_pdf, interpretar_texto
from backend.services.ler_planilha import ler_planilha, COLUNAS_ESPERADAS
from backend.services.modelo_folha import renderizar_pdf
from openpyxl import Workbook
import test_persistencia as base


def pdf_texto(texto):
    with pymupdf.open() as doc:
        page=doc.new_page();page.insert_text((30,40),texto,fontsize=10)
        return doc.tobytes()


def pdf_calendario_undf():
    with pymupdf.open() as doc:
        for text in Path('tests/fixtures/calendario_undf_2026.txt').read_text().split('\f'):
            height=max(842,len(text.splitlines())*12+80)
            page=doc.new_page(width=1000,height=height)
            page.insert_text((30,40),text.replace('–','-').replace('—','-'),fontsize=8)
        return doc.tobytes()


class TestRefinamentos(unittest.TestCase):
    def test_limites_1_100_101_500_rejeita_501_e_repetidos(self):
        self.assertEqual(MAX_GENERATION_BATCH,500)
        self.assertEqual(MAX_GENERATED_DOWNLOAD_BATCH,500)
        for size in (1,100,101,500):
            ids=list(range(1,size+1))
            self.assertEqual(len(GeracaoLotePayload(ids_servidores=ids,competencia='2027-01').ids_servidores),size)
            self.assertEqual(len(DownloadLotePayload(ids_documentos=ids).ids_documentos),size)
        for ids in ([1,1],list(range(1,502)),[],[True],['1']):
            with self.assertRaises(ValidationError):GeracaoLotePayload(ids_servidores=ids,competencia='2027-01')
            with self.assertRaises(ValidationError):DownloadLotePayload(ids_documentos=ids)
        with patch.dict(os.environ,MAX_GENERATION_BATCH='0'):
            with self.assertRaises(ValueError):positivo('MAX_GENERATION_BATCH',500,5000)

    def test_lote_500_sequencial_com_497_sucessos_e_3_falhas(self):
        active=0
        def generate(payload):
            nonlocal active
            active+=1;self.assertEqual(active,1)
            try:
                if payload.id_servidor in (7,100,500):raise LookupError('Falha esperada')
                return dict(id_documento=payload.id_servidor,nova_versao=payload.nova_versao)
            finally:active-=1
        with patch.object(geracao,'gerar_folha',side_effect=generate) as mock:
            result=geracao.gerar_lote(GeracaoLotePayload(ids_servidores=list(range(1,501)),competencia='2027-01',nova_versao=True))
        self.assertEqual(mock.call_count,500)
        self.assertEqual([result[k] for k in ('total','gerados','nao_gerados')],[500,497,3])
        self.assertEqual([r['id_servidor'] for r in result['falhas']],[7,100,500])
        self.assertTrue(all(r['nova_versao'] for r in result['documentos']))

    def test_zip_500_limite_bytes_e_protecao_de_ids(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'real.pdf';path.write_bytes(pdf_texto('Teste'))
            with patch.object(geracao,'arquivo_documento',side_effect=lambda id:(path,f'Folha_{id}.pdf')):
                with geracao.criar_zip(list(range(1,501))) as file,ZipFile(file) as archive:
                    self.assertEqual(len(archive.namelist()),500)
                    self.assertTrue(archive.read('Folha_500.pdf').startswith(b'%PDF'))
                with patch.object(geracao,'MAX_GENERATED_ZIP_BYTES',1):
                    with self.assertRaises(ValueError):geracao.criar_zip([1])
                for ids in ([1,1],list(range(1,502))):
                    with self.assertRaises(ValueError):geracao.criar_zip(ids)

    def test_pdf_misto_ocr_somente_na_pagina_sem_texto(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'misto.pdf'
            with pymupdf.open() as doc:
                doc.new_page().insert_text((30,40),'21/04/2027 Tiradentes');doc.new_page();doc.save(path)
            with patch('backend.ocr.reader.pytesseract.image_to_string',return_value='15/02/2027 Recesso academico') as ocr:
                records=ler_calendario_pdf(path)
            ocr.assert_called_once()
            self.assertEqual([(r['pagina'],r['origem']) for r in records],[(1,'TEXTO'),(2,'OCR')])

    def test_pdf_digital_multiplas_datas_sem_ocr_e_classificacao(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'calendario.pdf';path.write_bytes(pdf_texto('01/01/2027 - Feriado - Ano novo\n15/02/2027\nRecesso academico\n21/04/2027 Tiradentes\n16/02/2027 - Ponto facultativo'))
            with patch('backend.ocr.reader.pytesseract.image_to_string',side_effect=AssertionError('PDF digital não deve usar OCR')):
                records=ler_calendario_pdf(path)
            self.assertEqual(len(records),4)
            self.assertEqual([r['evento'].tipo.value for r in records],['FERIADO','RECESSO','OUTRO','PONTO_FACULTATIVO'])
            self.assertTrue(all(r['origem']=='TEXTO' for r in records))

    def test_pdf_escaneado_fallback_ocr_e_linha_insegura(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'scan.pdf';path.write_bytes(pdf_texto(''))
            with patch('backend.ocr.reader.pytesseract.image_to_string',return_value='21/04/2027 Tiradentes\n2l/O4/2027 Ruido\n31/02/2027 Data impossivel') as ocr:
                records=ler_calendario_pdf(path)
            ocr.assert_called_once()
            self.assertEqual(records[0]['evento'].data.isoformat(),'2027-04-21')
            self.assertEqual(sum('erro' in r for r in records),2)
            self.assertTrue(all(r['origem']=='OCR' and r['pagina']==1 for r in records))
            with patch('backend.ocr.reader.pytesseract.image_to_string',side_effect=RuntimeError('Timeout')):
                self.assertIn('erro',ler_calendario_pdf(path)[0])
            path.write_bytes(b'%PDF-corrompido')
            with self.assertRaises(ValueError):ler_calendario_pdf(path)

    @unittest.skipUnless(shutil.which('tesseract'),'Tesseract não instalado; CI instala o executável e o idioma por.')
    def test_ocr_real_de_pdf_escaneado_sintetico(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'escaneado.pdf'
            with pymupdf.open() as native:
                page=native.new_page();page.insert_text((40,80),'21/04/2027 Tiradentes',fontsize=24)
                pix=page.get_pixmap(matrix=pymupdf.Matrix(2,2))
                with pymupdf.open() as scan:
                    scan.new_page().insert_image(page.rect,stream=pix.tobytes('png'));scan.save(path)
            with patch.dict(os.environ,OCR_LANG='por'),patch('backend.ocr.reader.pytesseract.pytesseract.tesseract_cmd',shutil.which('tesseract')):
                records=ler_calendario_pdf(path)
            self.assertEqual(records[0]['origem'],'OCR')
            self.assertEqual(records[0]['evento'].data.isoformat(),'2027-04-21')
            self.assertEqual(records[0]['evento'].especificacao,'Tiradentes')

    def test_limite_de_entradas_expandidas_do_pdf(self):
        with patch('backend.services.calendario_pdf.MAX_LINHAS',2):
            with self.assertRaisesRegex(ValueError,'excede'):
                interpretar_texto('20/12/2027 a 31/12/2027 - Recesso',1,'TEXTO')

    def test_calendario_undf_2026_sem_ocr_grade_listas_e_intervalos(self):
        original=Path('tests/fixtures/calendario_undf_2026.txt').read_text()
        parsed=[r for i,text in enumerate(original.split('\f'),1) for r in interpretar_texto(text,i,'TEXTO')]
        self.assertEqual(len(parsed),316)
        self.assertTrue(all('evento' in r for r in parsed))
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'calendario.pdf';path.write_bytes(pdf_calendario_undf())
            with patch('backend.ocr.reader.pytesseract.image_to_string',side_effect=AssertionError('PDF digital não deve usar OCR')):
                records=ler_calendario_pdf(path)
        self.assertEqual(len(records),316)
        self.assertTrue(all('evento' in r for r in records))
        unique={(r['evento'].data.isoformat(),r['evento'].especificacao) for r in records}
        self.assertEqual(len(unique),279)
        self.assertTrue(all(r['evento'].data.year==2026 for r in records))
        for day in ('2026-02-14','2026-02-16','2026-02-18'):
            self.assertIn((day,'Recesso Acadêmico'),unique)
        for day in ('2026-03-02','2026-03-31'):
            self.assertIn((day,'Período para solicitação de Trancamento de Matrícula'),unique)
        self.assertIn(('2026-01-05','Período de Férias Acadêmicas'),unique)
        self.assertIn(('2026-02-03','Período de Férias Acadêmicas'),unique)
        self.assertIn(('2026-12-25','Natal'),unique)
        self.assertTrue(all(r['origem']=='TEXTO' for r in records))

    def test_contexto_de_ano_nao_inventa_datas_sem_cabecalho(self):
        self.assertIn('erro',interpretar_texto('01/01 - Evento sem ano',1,'TEXTO')[0])
        rows=interpretar_texto('JANEIRO/2026\nDom\n1\n01/01 - Evento\n32/01 - Data inválida\nTexto duvidoso',1,'TEXTO')
        self.assertEqual(sum('evento' in r for r in rows),1)
        self.assertEqual(sum('erro' in r for r in rows),2)

    def test_intervalos_explicitos_e_ambiguidades(self):
        records=interpretar_texto('20/12/2027 a 31/12/2027 - Recesso',1,'TEXTO')
        self.assertEqual(len(records),12)
        self.assertEqual(records[-1]['evento'].data.isoformat(),'2027-12-31')
        for text in ('31/12/2027 a 20/12/2027 Recesso','01/01/2027','01/01/2027 02/01/2027 Evento','1/1/2027 Evento'):
            self.assertIn('erro',interpretar_texto(text,1,'OCR')[0])

    def test_carga_20_40_booleano_estrito_e_pdf_sem_acumulacao(self):
        data=dict(name='Ana',registration='12345',cpf='00123456789',email='ana@example.com')
        for workload in (20,40):
            for accumulates in (True,False):
                payload=ServidorPayload(**data,workload=workload,acumula_cargo=accumulates)
                self.assertEqual(payload.workload,workload)
                with pymupdf.open(stream=renderizar_pdf(dict(nome='Ana',matricula='12345',carga_horaria=workload),'2027-01',[],1),filetype='pdf') as doc:
                    text=doc[0].get_text();self.assertIn(f'{workload}h',text);self.assertNotIn('Acumula',text)
        for value in (10,30,35,41,True,20.0,'20'):
            with self.assertRaises(ValidationError):ServidorPayload(**data,workload=value)
        with self.assertRaises(ValidationError):ServidorPayload(**data,workload=20,acumula_cargo='Sim')

    def test_importacao_cargas_e_acumulacao(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'servidores.xlsx';book=Workbook();sheet=book.active;sheet.append(COLUNAS_ESPERADAS)
            values=[('20','Sim'),('20h','Não'),('40','Nao'),('40h','Sim'),('35','Não'),('20hh','Sim')]
            for i,(workload,acc) in enumerate(values):sheet.append(['Ana',str(10000+i),str(i).zfill(11),'a@example.com',workload,acc])
            book.save(path);book.close();result=ler_planilha(path)
            self.assertEqual([r['carga_horaria'] for r in result['validos']],[20,20,40,40])
            self.assertEqual([r['acumula_cargo'] for r in result['validos']],[True,False,False,True])
            self.assertEqual(len(result['invalidos']),2)


@unittest.skipUnless(os.getenv('FOLHA_TEST_DSN'),'Defina FOLHA_TEST_DSN para banco descartável.')
class TestRefinamentosBanco(unittest.TestCase):
    setUp=base.TestPersistencia.setUp
    connect=base.TestPersistencia.connect
    drop_schema=base.TestPersistencia.drop_schema
    professor=base.TestPersistencia.professor

    def test_cadastro_edicao_carga_e_acumulacao(self):
        for workload,acc in ((20,False),(40,True)):
            status,person=base.request('POST','/servidores',{**self.payload,'registration':str(10000+workload),'cpf':str(workload).zfill(11),'workload':workload,'acumula_cargo':acc})
            self.assertEqual(status,201,person)
            status,updated=base.request('PUT',f'/servidores/{person["id_servidor"]}',{**self.payload,'registration':person['matricula'],'cpf':person['cpf'],'workload':60-workload,'acumula_cargo':not acc})
            self.assertEqual(status,200,updated);self.assertEqual(updated['carga_horaria'],60-workload);self.assertEqual(updated['acumula_cargo'],not acc)
        for workload in (10,30,35,41,None):
            self.assertEqual(base.request('POST','/servidores',{**self.payload,'workload':workload})[0],422)
        with self.assertRaises(psycopg.errors.CheckViolation),self.connect() as conn:
            conn.execute("INSERT INTO servidor(nome,matricula,carga_horaria) VALUES('Invalido','99999',35)")

    def test_calendario_rejeita_tamanho_e_excesso_de_paginas(self):
        content=pdf_texto('21/04/2027 Tiradentes')
        with patch('backend.api.LIMITE_UPLOAD',1):
            self.assertEqual(base.request('POST','/datas-especiais/importar',body=base.multipart(content,filename='calendario.pdf'),content_type='multipart/form-data; boundary=test')[0],413)
        with pymupdf.open() as doc:
            for i in range(21):doc.new_page()
            content=doc.tobytes()
        self.assertEqual(base.request('POST','/datas-especiais/importar',body=base.multipart(content,filename='calendario.pdf'),content_type='multipart/form-data; boundary=test')[0],422)

    def test_calendario_undf_previa_e_confirmacao_removem_repeticoes(self):
        status,preview=base.request('POST','/datas-especiais/importar',body=base.multipart(pdf_calendario_undf(),filename='Calendario-2026.pdf'),content_type='multipart/form-data; boundary=test')
        self.assertEqual(status,200,preview)
        self.assertEqual(preview['validos'],316)
        self.assertEqual(base.request('GET','/datas-especiais')[1],[])
        status,result=base.request('POST','/datas-especiais/importar/confirm',{'token':preview['token']},headers={'Idempotency-Key':str(uuid4())})
        self.assertEqual(status,200,result)
        self.assertEqual([result[k] for k in ('novos','ignorados','invalidos')],[279,37,0])
        self.assertEqual(len(base.request('GET','/datas-especiais?ano=2026')[1]),279)

    def test_pdf_previa_confirmacao_idempotente_auditoria_e_limites(self):
        content=pdf_texto('21/04/2027 Tiradentes\n31/02/2027 Invalido')
        status,preview=base.request('POST','/datas-especiais/importar',body=base.multipart(content,filename='calendario.pdf'),content_type='multipart/form-data; boundary=test')
        self.assertEqual(status,200,preview);self.assertEqual(preview['status'],'PREVIA');self.assertEqual(preview['validos'],1);self.assertEqual(preview['invalidos'],1)
        self.assertEqual(base.request('GET','/datas-especiais')[1],[])
        key={'Idempotency-Key':str(uuid4())};payload={'token':preview['token']}
        first=base.request('POST','/datas-especiais/importar/confirm',payload,headers=key)
        self.assertEqual(first[0],200,first);self.assertEqual(first[1]['novos'],1)
        self.assertEqual(base.request('POST','/datas-especiais/importar/confirm',payload,headers=key),first)
        self.assertEqual(first[1]['detalhes'][0]['pagina'],1)
        with self.connect() as conn:self.assertEqual(conn.execute('SELECT count(*) FROM importacao_calendario').fetchone()[0],1)
        for name,mime,data in [('falso.pdf','application/pdf',b'xlsx'),('falso.pdf','image/png',content),('falso.xls','application/vnd.ms-excel',b'xls')]:
            self.assertIn(base.request('POST','/datas-especiais/importar',body=base.multipart(data,filename=name,mime=mime),content_type='multipart/form-data; boundary=test')[0],(400,422))
        self.assertEqual(base.request('POST','/folhas/gerar-lote',{'ids_servidores':list(range(1,502)),'competencia':'2027-01'})[0],422)
        self.assertEqual(base.request('POST','/folhas/geradas/download-lote',{'ids_documentos':list(range(1,502))})[0],422)
        self.assertEqual(base.request('GET','/folhas/configuracao')[1]['max_generation_batch'],500)
