import os
import tempfile
import unittest

import pandas as pd

from backend.services.ler_planilha import ler_planilha


class TestLerPlanilha(unittest.TestCase):

    def criar_planilha(self, dados):
        arquivo = tempfile.NamedTemporaryFile(
            suffix=".xlsx",
            delete=False
        )
        arquivo.close()

        pd.DataFrame(dados).to_excel(
            arquivo.name,
            index=False
        )

        return arquivo.name

    def test_planilha_valida(self):
        caminho = self.criar_planilha({
            "Nome": ["João Silva"],
            "Matrícula": ["123456"],
            "CPF": ["12345678901"],
            "E-mail": ["joao@exemplo.com"],
            "Carga Horária": ["40"],
            "Acumula cargo (Sim/Não)": ["Não"],
        })

        try:
            resultado = ler_planilha(caminho)

            self.assertEqual(resultado["lidos"], 1)
            self.assertEqual(len(resultado["validos"]), 1)
            self.assertEqual(len(resultado["invalidos"]), 0)

            servidor = resultado["validos"][0]

            self.assertEqual(servidor["nome"], "João Silva")
            self.assertEqual(servidor["matricula"], "123456")
            self.assertEqual(servidor["cpf"], "12345678901")
            self.assertEqual(servidor["email_pessoal"], "joao@exemplo.com")
            self.assertEqual(servidor["carga_horaria"], 40)
            self.assertFalse(servidor["acumula_cargo"])

        finally:
            os.remove(caminho)

    def test_nome_com_numero_e_invalido(self):
        caminho = self.criar_planilha({
            "Nome": ["João123"],
            "Matrícula": ["123456"],
            "CPF": ["12345678901"],
            "E-mail": ["joao@exemplo.com"],
            "Carga Horária": ["40"],
            "Acumula cargo (Sim/Não)": ["Não"],
        })

        try:
            resultado = ler_planilha(caminho)

            self.assertEqual(len(resultado["validos"]), 0)
            self.assertEqual(len(resultado["invalidos"]), 1)
            self.assertIn(
                "Nome possui números",
                resultado["invalidos"][0]["erros"]
            )

        finally:
            os.remove(caminho)

    def test_cpf_invalido(self):
        caminho = self.criar_planilha({
            "Nome": ["João Silva"],
            "Matrícula": ["123456"],
            "CPF": ["123"],
            "E-mail": ["joao@exemplo.com"],
            "Carga Horária": ["40"],
            "Acumula cargo (Sim/Não)": ["Não"],
        })

        try:
            resultado = ler_planilha(caminho)

            self.assertEqual(len(resultado["validos"]), 0)
            self.assertIn(
                "CPF deve possuir 11 dígitos",
                resultado["invalidos"][0]["erros"]
            )

        finally:
            os.remove(caminho)

    def test_email_invalido(self):
        caminho = self.criar_planilha({
            "Nome": ["João Silva"],
            "Matrícula": ["123456"],
            "CPF": ["12345678901"],
            "E-mail": ["email-invalido"],
            "Carga Horária": ["40"],
            "Acumula cargo (Sim/Não)": ["Não"],
        })

        try:
            resultado = ler_planilha(caminho)

            self.assertEqual(len(resultado["validos"]), 0)
            self.assertIn(
                "E-mail possui formato inválido",
                resultado["invalidos"][0]["erros"]
            )

        finally:
            os.remove(caminho)

    def test_carga_horaria_invalida(self):
        caminho = self.criar_planilha({
            "Nome": ["João Silva"],
            "Matrícula": ["123456"],
            "CPF": ["12345678901"],
            "E-mail": ["joao@exemplo.com"],
            "Carga Horária": ["abc"],
            "Acumula cargo (Sim/Não)": ["Não"],
        })

        try:
            resultado = ler_planilha(caminho)

            self.assertEqual(len(resultado["validos"]), 0)
            self.assertIn(
                "Carga Horária deve ser numérica e maior que zero",
                resultado["invalidos"][0]["erros"]
            )

        finally:
            os.remove(caminho)

    def test_acumulacao_invalida(self):
        caminho = self.criar_planilha({
            "Nome": ["João Silva"],
            "Matrícula": ["123456"],
            "CPF": ["12345678901"],
            "E-mail": ["joao@exemplo.com"],
            "Carga Horária": ["40"],
            "Acumula cargo (Sim/Não)": ["Talvez"],
        })

        try:
            resultado = ler_planilha(caminho)

            self.assertEqual(len(resultado["validos"]), 0)
            self.assertIn(
                "Acumulação deve ser Sim ou Não",
                resultado["invalidos"][0]["erros"]
            )

        finally:
            os.remove(caminho)

    def test_matricula_duplicada(self):
        caminho = self.criar_planilha({
            "Nome": ["João Silva", "Maria Silva"],
            "Matrícula": ["123456", "123456"],
            "CPF": ["12345678901", "98765432100"],
            "E-mail": [
                "joao@exemplo.com",
                "maria@exemplo.com"
            ],
            "Carga Horária": ["40", "40"],
            "Acumula cargo (Sim/Não)": ["Não", "Não"],
        })

        try:
            resultado = ler_planilha(caminho)

            self.assertEqual(resultado["lidos"], 2)
            self.assertEqual(len(resultado["validos"]), 0)
            self.assertEqual(resultado["duplicados"], 1)

            self.assertIn(
                "Matrícula duplicada: 123456",
                resultado["invalidos"][0]["erros"]
            )

        finally:
            os.remove(caminho)

    def test_coluna_obrigatoria_faltando(self):
        caminho = self.criar_planilha({
            "Nome": ["João Silva"],
            "Matrícula": ["123456"],
            "CPF": ["12345678901"],
            "E-mail": ["joao@exemplo.com"],
            "Carga Horária": ["40"],
        })

        try:
            with self.assertRaises(ValueError) as contexto:
                ler_planilha(caminho)

            self.assertIn(
                "Acumula cargo (Sim/Não)",
                str(contexto.exception)
            )

        finally:
            os.remove(caminho)


if __name__ == "__main__":
    unittest.main()
