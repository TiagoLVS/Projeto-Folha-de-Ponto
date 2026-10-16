import unittest

from backend.ocr.reader import (
    extrair_matricula,
    extrair_competencia,
)


class TestOCR(unittest.TestCase):

    def test_extrair_matricula(self):
        texto = "Nome: João Silva\nMatrícula: 123456"
        resultado = extrair_matricula(texto)

        self.assertEqual(resultado, "123456")

    def test_extrair_matricula_com_registro(self):
        texto = "Servidor: João Silva\nRegistro: 987654"
        resultado = extrair_matricula(texto)

        self.assertEqual(resultado, "987654")

    def test_matricula_nao_encontrada(self):
        texto = "Nome: João Silva\nCargo: Professor"
        resultado = extrair_matricula(texto)

        self.assertIsNone(resultado)

    def test_extrair_competencia(self):
        texto = "Competência: 08/2026"
        resultado = extrair_competencia(texto)

        self.assertEqual(resultado, (8, 2026))

    def test_extrair_competencia_com_mes_ano(self):
        texto = "Mês/Ano: 9/2026"
        resultado = extrair_competencia(texto)

        self.assertEqual(resultado, (9, 2026))

    def test_competencia_nao_encontrada(self):
        texto = "Nome: João Silva\nMatrícula: 123456"
        resultado = extrair_competencia(texto)

        self.assertEqual(resultado, (None, None))


if __name__ == "__main__":
    unittest.main()
