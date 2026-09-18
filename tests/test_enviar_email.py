import os
import tempfile
import unittest
from unittest.mock import patch

from enviar_email import (
    email_valido,
    normalizar_matricula,
    carregar_configuracao_email,
    preparar_email,
)


class TestEnviarEmail(unittest.TestCase):

    def test_email_valido(self):
        self.assertTrue(
            email_valido("teste@exemplo.com")
        )

    def test_email_invalido(self):
        self.assertFalse(
            email_valido("email-invalido")
        )

    def test_normalizar_matricula(self):
        self.assertEqual(
            normalizar_matricula(67890.0),
            "67890"
        )

    def test_pdf_inexistente(self):
        mensagem, status, erro = preparar_email(
            "Maria",
            "maria@exemplo.com",
            "arquivo_inexistente.pdf",
            "digep@exemplo.com"
        )

        self.assertIsNone(mensagem)
        self.assertEqual(status, "ERRO")
        self.assertEqual(
            erro,
            "Folha de ponto não encontrada"
        )

    def test_email_invalido_na_preparacao(self):
        mensagem, status, erro = preparar_email(
            "Maria",
            "email-invalido",
            "qualquer.pdf",
            "digep@exemplo.com"
        )

        self.assertIsNone(mensagem)
        self.assertEqual(status, "ERRO")
        self.assertEqual(
            erro,
            "E-mail do destinatário inválido"
        )

    def test_preparacao_com_pdf_existente(self):
        with tempfile.TemporaryDirectory() as pasta:
            caminho_pdf = os.path.join(
                pasta,
                "folha_teste.pdf"
            )

            with open(caminho_pdf, "wb") as arquivo:
                arquivo.write(
                    b"%PDF-1.4\n%%EOF"
                )

            mensagem, status, erro = preparar_email(
                "Maria",
                "maria@exemplo.com",
                caminho_pdf,
                "digep@exemplo.com"
            )

            self.assertIsNotNone(mensagem)
            self.assertEqual(status, "PENDENTE")
            self.assertEqual(erro, "")

    def test_credenciais_ausentes(self):
        with patch.dict(
            os.environ,
            {},
            clear=True
        ):
            with self.assertRaises(RuntimeError):
                carregar_configuracao_email()


if __name__ == "__main__":
    unittest.main()