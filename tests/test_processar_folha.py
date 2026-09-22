import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services.processar_folha import processar_folha


class TestProcessarFolha(unittest.TestCase):

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        storage = patch("backend.services.processar_folha.PASTA_FOLHAS", Path(directory.name))
        storage.start()
        self.addCleanup(storage.stop)

    def criar_arquivo(self, extensao=".pdf"):
        arquivo = tempfile.NamedTemporaryFile(
            suffix=extensao,
            delete=False
        )
        arquivo.write(b"arquivo de teste")
        arquivo.close()
        return arquivo.name

    def test_arquivo_inexistente(self):
        caminho = "/tmp/arquivo_que_nao_existe.pdf"

        with self.assertRaises(FileNotFoundError):
            processar_folha(caminho)

    @patch("backend.services.processar_folha.salvar_folha")
    @patch("backend.services.processar_folha.obter_competencia")
    @patch("backend.services.processar_folha.buscar_servidor_por_matricula")
    @patch("backend.services.processar_folha.executar_ocr")
    def test_processamento_com_sucesso(
        self,
        mock_ocr,
        mock_buscar_servidor,
        mock_competencia,
        mock_salvar_folha
    ):
        caminho = self.criar_arquivo()

        try:
            mock_ocr.return_value = {
                "matricula": "123456",
                "mes": 9,
                "ano": 2026,
                "competencia": "2026-09",
                "texto": "Matrícula: 123456 Competência: 09/2026",
            }

            mock_buscar_servidor.return_value = {
                "id_servidor": 10,
                "matricula": "123456",
                "nome": "João Silva",
                "cpf": "12345678901",
                "email": "joao@exemplo.com",
                "acumula_cargo": False,
            }

            mock_competencia.return_value = 20
            mock_salvar_folha.return_value = 30

            resultado = processar_folha(caminho)

            self.assertEqual(resultado["status_ocr"], "OK")
            self.assertEqual(resultado["matricula"], "123456")
            self.assertEqual(resultado["competencia"], "2026-09")
            self.assertEqual(resultado["id_folha"], 30)
            self.assertEqual(resultado["servidor"]["nome"], "João Silva")

            mock_ocr.assert_called_once()
            mock_buscar_servidor.assert_called_once_with("123456")
            mock_competencia.assert_called_once_with(9, 2026)
            mock_salvar_folha.assert_called_once()

        finally:
            if os.path.exists(caminho):
                os.remove(caminho)

    @patch("backend.services.processar_folha.salvar_folha")
    @patch("backend.services.processar_folha.obter_competencia")
    @patch("backend.services.processar_folha.buscar_servidor_por_matricula")
    @patch("backend.services.processar_folha.executar_ocr")
    def test_matricula_nao_encontrada(
        self,
        mock_ocr,
        mock_buscar_servidor,
        mock_competencia,
        mock_salvar_folha
    ):
        caminho = self.criar_arquivo()

        try:
            mock_ocr.return_value = {
                "matricula": "999999",
                "mes": 9,
                "ano": 2026,
                "competencia": "2026-09",
                "texto": "Matrícula: 999999",
            }

            mock_buscar_servidor.return_value = None
            mock_competencia.return_value = 20
            mock_salvar_folha.return_value = 31

            resultado = processar_folha(caminho)

            self.assertEqual(resultado["status_ocr"], "REVISAR")
            self.assertEqual(resultado["matricula"], "999999")
            self.assertIn(
                "Matrícula não encontrada no banco.",
                resultado["mensagem"]
            )

        finally:
            if os.path.exists(caminho):
                os.remove(caminho)

    @patch("backend.services.processar_folha.salvar_folha")
    @patch("backend.services.processar_folha.obter_competencia")
    @patch("backend.services.processar_folha.buscar_servidor_por_matricula")
    @patch("backend.services.processar_folha.executar_ocr")
    def test_competencia_nao_identificada(
        self,
        mock_ocr,
        mock_buscar_servidor,
        mock_competencia,
        mock_salvar_folha
    ):
        caminho = self.criar_arquivo()

        try:
            mock_ocr.return_value = {
                "matricula": "123456",
                "mes": None,
                "ano": None,
                "competencia": None,
                "texto": "Matrícula: 123456",
            }

            mock_buscar_servidor.return_value = {
                "id_servidor": 10,
                "matricula": "123456",
                "nome": "João Silva",
            }

            mock_salvar_folha.return_value = 32

            resultado = processar_folha(caminho)

            self.assertEqual(resultado["status_ocr"], "REVISAR")
            self.assertIn(
                "Competência não identificada pelo OCR.",
                resultado["mensagem"]
            )

            mock_competencia.assert_not_called()

        finally:
            if os.path.exists(caminho):
                os.remove(caminho)

    @patch("backend.services.processar_folha.salvar_folha")
    @patch("backend.services.processar_folha.executar_ocr")
    def test_erro_durante_ocr(
        self,
        mock_ocr,
        mock_salvar_folha
    ):
        caminho = self.criar_arquivo()

        try:
            mock_ocr.side_effect = RuntimeError(
                "Falha no processamento OCR"
            )

            mock_salvar_folha.return_value = 33

            resultado = processar_folha(caminho)

            self.assertEqual(resultado["status_ocr"], "ERRO")
            self.assertEqual(resultado["id_folha"], 33)
            self.assertIn(
                "Falha no processamento OCR",
                resultado["mensagem"]
            )

            mock_salvar_folha.assert_called_once()

        finally:
            if os.path.exists(caminho):
                os.remove(caminho)


if __name__ == "__main__":
    unittest.main()
