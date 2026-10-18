import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from zipfile import ZipFile
from openpyxl import Workbook
from pydantic import ValidationError
import pymupdf
from backend.models.calendario import DataEspecialPayload, FiltrosCalendario, GeracaoLotePayload, DownloadLotePayload
from backend.services.calendario import interpretar_data, ler_calendario, sugerir_tipo
from backend.services.modelo_folha import renderizar_pdf


def planilha(path, rows, header=('Data', 'Especificação')):
    book = Workbook()
    book.active.append(header)
    for row in rows:
        book.active.append(row)
    book.save(path)
    book.close()


class TestCalendario(unittest.TestCase):
    def test_datas_inequivocas_e_bissexto(self):
        for value in ('29/02/2028', date(2028, 2, 29), datetime(2028, 2, 29)):
            self.assertEqual(interpretar_data(value), date(2028, 2, 29))
        for value in ('29/02/2027', '2/3/2027', '2027-02-03', 45678, True, None, datetime(2027, 2, 3, 12)):
            with self.subTest(value=value), self.assertRaises(ValueError):
                interpretar_data(value)

    def test_tipos_conservadores(self):
        for text, kind in [('Tiradentes', 'OUTRO'), ('Recesso acadêmico', 'RECESSO'), ('Ponto facultativo', 'PONTO_FACULTATIVO'), ('Feriado nacional', 'FERIADO'), ('Aula sobre feriados', 'OUTRO')]:
            self.assertEqual(sugerir_tipo(text).value, kind)

    def test_validacao_payloads(self):
        p = DataEspecialPayload(data='2027-04-21', especificacao='  Festa   acadêmica ', tipo='OUTRO')
        self.assertEqual(p.especificacao, 'Festa acadêmica')
        for data in ('2027-02-29', '21/04/2027', 1, '2027-04-21T00:00:00'):
            with self.assertRaises(ValidationError):
                DataEspecialPayload(data=data, especificacao='Evento', tipo='OUTRO')
        for ids in ([], [1, 1], [True], ['1'], [0], list(range(1, 502))):
            for model, key in ((GeracaoLotePayload, 'ids_servidores'), (DownloadLotePayload, 'ids_documentos')):
                with self.assertRaises(ValidationError):
                    model(**{key: ids, **({'competencia': '2027-02'} if model == GeracaoLotePayload else {})})
        with self.assertRaises(ValidationError):
            FiltrosCalendario(mes=2)
        self.assertEqual(FiltrosCalendario(ano=2028, mes=2).limites(), (date(2028, 2, 1), date(2028, 2, 29)))

    def test_planilha_parcial_com_datas_formulas_e_linhas_vazias(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'calendario.xlsx'
            planilha(path, [(datetime(2027, 2, 15), 'Recesso'), ('16/02/2027', 'Ponto facultativo'), ('31/02/2027', 'Inválido'), ('17/02/2027', ''), ('18/02/2027', '=1+1'), (45678, 'Número'), (None, None)])
            result = ler_calendario(path)
            self.assertEqual(len(result), 6)
            self.assertEqual(sum('erro' in item for item in result), 4)
            self.assertEqual(result[0]['evento'].data, date(2027, 2, 15))
            self.assertEqual(result[4]['linha'], 6)
            self.assertIn('Fórmulas', result[4]['erro'])

    def test_cabecalho_e_arquivos_invalidos(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'calendario.xlsx'
            for header in [('Data', 'Descrição'), ('Data', 'Data', 'Especificação')]:
                planilha(path, [], header)
                with self.assertRaisesRegex(ValueError, 'primeira linha'):
                    ler_calendario(path)
            path.write_bytes(b'nao sou excel')
            with self.assertRaisesRegex(ValueError, 'corrompido'):
                ler_calendario(path)
            with ZipFile(path, 'w') as archive:
                archive.writestr('[Content_Types].xml', '<invalid')
            with self.assertRaises(ValueError):
                ler_calendario(path)

    def test_pdf_dias_bissexto_dados_e_campos_em_branco(self):
        professor = dict(nome='Ana Silva', matricula='12345', departamento='Ensino', carga_horaria=40)
        events = [dict(data=date(2028, 2, 15), especificacao='Recesso acadêmico', tipo='RECESSO'), dict(data=date(2028, 2, 15), especificacao='Evento adicional', tipo='OUTRO')]
        pdf = renderizar_pdf(professor, '2028-02', events, 2)
        with pymupdf.open(stream=pdf, filetype='pdf') as doc:
            text = ''.join(page.get_text() for page in doc)
        for value in ['Ana Silva', '12345', '40h', 'FEVEREIRO/2028', '29', 'Recesso acadêmico', 'Evento adicional', 'SÁBADO', 'ENTRADA', 'SAÍDA', 'CHEFIA IMEDIATA', 'REGISTRO DE FREQUÊNCIA']:
            # Quebras de linha são esperadas dentro das células da tabela.
            self.assertIn(value, ' '.join(text.split()))
        self.assertNotIn('30/02/2028', text)
        self.assertNotIn('08:00', text)
        self.assertNotIn('17:00', text)

    def test_pdf_textos_longos_multiplas_paginas(self):
        events = [dict(data=date(2027, 1, 1), especificacao=('Evento longo ' * 20) + str(i), tipo='OUTRO') for i in range(30)]
        pdf = renderizar_pdf(dict(nome='Professor ' * 25, matricula='12345', departamento=None, carga_horaria=None), '2027-01', events, 1)
        with pymupdf.open(stream=pdf, filetype='pdf') as doc:
            self.assertGreater(len(doc), 1)
            text = ''.join(page.get_text() for page in doc)
            self.assertIn('31', text)
            self.assertIn('CARGA HORÁRIA:', text)
            for page in doc:
                for block in page.get_text('blocks'):
                    self.assertGreaterEqual(block[0], 0)
                    self.assertLessEqual(block[2], page.rect.width)
                    self.assertLessEqual(block[3], page.rect.height)

    def test_modelo_institucional_28_29_30_31_dias_em_uma_pagina(self):
        for month,last in [('2027-02',28),('2028-02',29),('2027-04',30),('2027-01',31)]:
            with self.subTest(month=month):
                pdf=renderizar_pdf(dict(nome='Ana Silva',matricula='0012345',cpf='12345678901',departamento='Não deve virar UA',carga_horaria=40),month,[],1)
                with pymupdf.open(stream=pdf,filetype='pdf') as doc:
                    self.assertEqual(len(doc),1)
                    text=doc[0].get_text()
                    for word in ['43.061.297/0001-08','REGISTRO DE FREQUÊNCIA','UA:','MATRÍCULA:','CARGO:','PADRÃO:','FUNÇÃO:','EXERCÍCIO:','SÁBADO','DOMINGO',str(last),'institucional-v1']:
                        self.assertIn(word,text)
                    self.assertNotIn('12345678901',text)
                    self.assertNotIn('Não deve virar UA',text)
                    for word in doc[0].get_text('words'):
                        self.assertLessEqual(word[2],595);self.assertLessEqual(word[3],842)
