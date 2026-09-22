import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import app


class TestIdempotenciaEnviarLote(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @patch("backend.api.listar_folhas_para_envio")
    @patch("backend.api.enviar_folha_do_banco")
    @patch("backend.api.registrar_requisicao_idempotente")
    @patch("backend.api.finalizar_requisicao_idempotente")
    def test_primeira_requisicao_com_chave(
        self,
        mock_finalizar,
        mock_registrar,
        mock_enviar,
        mock_listar,
    ):
        mock_registrar.return_value = {"created": True, "payload_hash": "5738a78b74ea9ab782a696bd5267d794880e8d4d4ef6ebdd0242a36959e89414", "status": "PROCESSANDO"}
        mock_listar.return_value = [{"id_folha": 1, "email": "a@a.com", "nome": "Ana", "caminho_arquivo": "x.pdf"}]
        mock_enviar.return_value = {"id_envio": 10, "status": "ENVIADO", "mensagem_erro": None}

        response = self.client.post(
            "/folhas/enviar-lote",
            json={"month": "2026-09", "professorIds": [1]},
            headers={"Idempotency-Key": "k1"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "completed")
        self.assertEqual(response.json()["sentCount"], 1)
        mock_enviar.assert_called_once()

    @patch("backend.api.listar_folhas_para_envio")
    @patch("backend.api.enviar_folha_do_banco")
    @patch("backend.api.registrar_requisicao_idempotente")
    @patch("backend.api.finalizar_requisicao_idempotente")
    def test_repeticao_mesma_chave_mesmo_payload_nao_reenvia(
        self,
        mock_finalizar,
        mock_registrar,
        mock_enviar,
        mock_listar,
    ):
        mock_registrar.side_effect = [
            {"created": True, "payload_hash": "40130c2393baa23301834134758890b4d57ac57719e494d5c281b2d498419c31", "status": "CONCLUIDO", "response_body": {"jobId": "k1", "status": "completed", "sentCount": 1}, "response_status_code": 200},
            {"created": False, "payload_hash": "40130c2393baa23301834134758890b4d57ac57719e494d5c281b2d498419c31", "status": "CONCLUIDO", "response_body": {"jobId": "k1", "status": "completed", "sentCount": 1}, "response_status_code": 200},
        ]

        response_1 = self.client.post(
            "/folhas/enviar-lote",
            json={"month": "2026-09", "professorIds": [1, 2]},
            headers={"Idempotency-Key": "k2"},
        )
        response_2 = self.client.post(
            "/folhas/enviar-lote",
            json={"month": "2026-09", "professorIds": [2, 1]},
            headers={"Idempotency-Key": "k2"},
        )

        self.assertEqual(response_1.status_code, 200)
        self.assertEqual(response_2.status_code, 200)
        self.assertEqual(response_2.json()["sentCount"], 1)
        mock_enviar.assert_not_called()

    @patch("backend.api.listar_folhas_para_envio")
    @patch("backend.api.enviar_folha_do_banco")
    @patch("backend.api.registrar_requisicao_idempotente")
    @patch("backend.api.finalizar_requisicao_idempotente")
    def test_mesma_chave_payload_diferente_retorna_409(
        self,
        mock_finalizar,
        mock_registrar,
        mock_enviar,
        mock_listar,
    ):
        mock_registrar.return_value = {"created": False, "payload_hash": "hash1", "status": "CONCLUIDO"}

        response = self.client.post(
            "/folhas/enviar-lote",
            json={"month": "2026-09", "professorIds": [1, 2]},
            headers={"Idempotency-Key": "k3"},
        )

        self.assertEqual(response.status_code, 409)
        mock_enviar.assert_not_called()

    @patch("backend.api.listar_folhas_para_envio")
    @patch("backend.api.enviar_folha_do_banco")
    @patch("backend.api.registrar_requisicao_idempotente")
    @patch("backend.api.finalizar_requisicao_idempotente")
    def test_concorrencia_em_processamento_nao_inicia_segundo_lote(
        self,
        mock_finalizar,
        mock_registrar,
        mock_enviar,
        mock_listar,
    ):
        mock_registrar.return_value = {"created": False, "payload_hash": "40130c2393baa23301834134758890b4d57ac57719e494d5c281b2d498419c31", "status": "PROCESSANDO"}

        response = self.client.post(
            "/folhas/enviar-lote",
            json={"month": "2026-09", "professorIds": [1, 2]},
            headers={"Idempotency-Key": "k4"},
        )

        self.assertEqual(response.status_code, 409)
        self.assertIn("a requisição original ainda está em processamento", response.json()["detail"].lower())
        mock_enviar.assert_not_called()


if __name__ == "__main__":
    unittest.main()
