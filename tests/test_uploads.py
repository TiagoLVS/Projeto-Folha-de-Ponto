import asyncio
import pymupdf
from io import BytesIO
from pathlib import Path
import unittest
from unittest.mock import patch
from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
import backend.api as api
from starlette.datastructures import Headers
from backend.api import salvar_planilha_temporaria, salvar_upload_temporario

def criar_pdf_valido(texto="Documento de teste"):
    documento = pymupdf.open()
    pagina = documento.new_page()
    pagina.insert_text((72, 72), texto)
    conteudo = documento.tobytes()
    documento.close()
    return conteudo

class TestUploads(unittest.TestCase):
    def test_xlsx_e_salvo_e_xls_recusado(self):
        arquivo = UploadFile(filename='professores.xlsx', file=BytesIO(b'planilha'))
        path = asyncio.run(salvar_planilha_temporaria(arquivo))
        try:
            self.assertEqual(path.read_bytes(), b'planilha')
        finally:
            path.unlink()
        with self.assertRaises(HTTPException) as error:
            asyncio.run(salvar_planilha_temporaria(UploadFile(filename='professores.xls', file=BytesIO(b'antigo'))))
        self.assertEqual(error.exception.status_code, 400)

    def test_limite_upload_em_ambos_endpoints(self):
        for save, filename, mime in ((salvar_planilha_temporaria, 'professores.xlsx', 'application/octet-stream'), (salvar_upload_temporario, 'folha.pdf', 'application/pdf')):
            with self.subTest(filename=filename), patch('backend.api.LIMITE_UPLOAD', 4):
                file = UploadFile(filename=filename, file=BytesIO(b'12345'), headers=Headers({'content-type': mime}))
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(save(file))
                self.assertEqual(error.exception.status_code, 413)
                file = UploadFile(filename=filename, file=BytesIO(b'1234'), headers=Headers({'content-type': mime}))
                path = asyncio.run(save(file))
                self.assertEqual(Path(path).read_bytes(), b'1234')
                path.unlink()

class TestUploadMultiplosPDFs(unittest.TestCase):
    def test_processa_dois_pdfs(self):
        cliente = TestClient(api.app)
        pdf_teste = criar_pdf_valido("Folha de teste")

        with patch(
            "backend.api.processar_folha",
            side_effect=[
                {"status": "OK", "matricula": "123"},
                {"status": "OK", "matricula": "456"},
            ],
        ) as processar:
            resposta = cliente.post(
                "/folhas/processar-lote",
                files=[
                    ("arquivos", ("folha1.pdf", pdf_teste, "application/pdf")),
                    ("arquivos", ("folha2.pdf", pdf_teste, "application/pdf")),
                ],
            )

        self.assertEqual(resposta.status_code, 200)
        dados = resposta.json()
        self.assertEqual(dados["quantidade"], 2)
        self.assertEqual(len(dados["resultados"]), 2)
        self.assertTrue(dados["resultados"][0]["sucesso"])
        self.assertTrue(dados["resultados"][1]["sucesso"])
        self.assertEqual(processar.call_count, 2)

    def test_nao_considera_arquivo_com_conteudo_invalido_como_sucesso(self):
        cliente = TestClient(api.app)

        with patch("backend.api.processar_folha") as processar:
            resposta = cliente.post(
                "/folhas/processar-lote",
                files=[
                    (
                        "arquivos",
                        ("folha.pdf", b"isto nao e um PDF", "application/pdf"),
                    ),
                ],
            )

        self.assertEqual(resposta.status_code, 200)
        dados = resposta.json()
        self.assertEqual(dados["quantidade"], 1)
        self.assertFalse(dados["resultados"][0]["sucesso"])
        self.assertTrue(dados["resultados"][0]["erro"])
        processar.assert_not_called()

    def test_rejeita_lote_com_arquivo_invalido(self):
        cliente = TestClient(api.app)

        with patch("backend.api.processar_folha") as processar:
            resposta = cliente.post(
                "/folhas/processar-lote",
                files=[
                    ("arquivos", ("folha.pdf", b"%PDF-1.4 documento", "application/pdf")),
                    ("arquivos", ("notas.txt", b"texto qualquer", "text/plain")),
                ],
            )

        self.assertEqual(resposta.status_code, 400)
        processar.assert_not_called()

    def test_continua_quando_um_pdf_falha(self):
        cliente = TestClient(api.app)

        with patch(
            "backend.api.processar_folha",
            side_effect=[
                {"status": "OK", "matricula": "123"},
                RuntimeError("Falha simulada no processamento"),
                {"status": "OK", "matricula": "789"},
            ],
        ) as processar:
            resposta = cliente.post(
                "/folhas/processar-lote",
                files=[
                    ("arquivos", ("folha1.pdf", criar_pdf_valido("Folha 1"), "application/pdf")),
                    ("arquivos", ("folha2.pdf", criar_pdf_valido("Folha 2"), "application/pdf")),
                    ("arquivos", ("folha3.pdf", criar_pdf_valido("Folha 3"), "application/pdf")),
                ],
            )

        self.assertEqual(resposta.status_code, 200)

        dados = resposta.json()

        self.assertEqual(dados["quantidade"], 3)
        self.assertEqual(processar.call_count, 3)

        resultados = dados["resultados"]

        self.assertTrue(resultados[0]["sucesso"])
        self.assertFalse(resultados[1]["sucesso"])
        self.assertIn("Falha simulada", resultados[1]["erro"])
        self.assertTrue(resultados[2]["sucesso"])
