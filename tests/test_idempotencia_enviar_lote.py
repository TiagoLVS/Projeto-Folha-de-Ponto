import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api import app
from backend.database.repository import payload_hash_for


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
        mock_registrar.return_value = {"created": True, "payload_hash": payload_hash_for("2026-09", [1]), "status": "PROCESSANDO"}
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
            {"created": True, "payload_hash": payload_hash_for("2026-09", [1, 2]), "status": "PROCESSANDO"},
            {"created": False, "payload_hash": payload_hash_for("2026-09", [1, 2]), "status": "CONCLUIDO", "response_body": {"jobId": "k2", "status": "completed", "sentCount": 2}, "response_status_code": 200},
        ]
        mock_listar.return_value = [{"id_folha": 1}, {"id_folha": 2}]
        mock_enviar.return_value = {"status": "ENVIADO"}

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
        self.assertEqual(response_2.json()["sentCount"], 2)
        self.assertEqual(response_1.json(), response_2.json())
        self.assertEqual(mock_enviar.call_count, 2)
        mock_listar.assert_called_once()

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
        mock_registrar.return_value = {"created": False, "payload_hash": payload_hash_for("2026-09", [1, 2]), "status": "PROCESSANDO"}

        response = self.client.post(
            "/folhas/enviar-lote",
            json={"month": "2026-09", "professorIds": [1, 2]},
            headers={"Idempotency-Key": "k4"},
        )

        self.assertEqual(response.status_code, 409)
        self.assertIn("a requisição original ainda está em processamento", response.json()["detail"].lower())
        mock_enviar.assert_not_called()

    def test_payloads_invalidos_nao_reservam_lote(self):
        with patch('backend.api.registrar_requisicao_idempotente') as reserve:
            for ids in (None, '12', [], [True], [1.5], [0], [-1], [1, '1'], [{}]):
                with self.subTest(ids=ids):
                    response = self.client.post('/folhas/enviar-lote', json={'month': '2026-09', 'professorIds': ids}, headers={'Idempotency-Key': 'valida'})
                    self.assertEqual(response.status_code, 422)
            for month in (None, [], 202609, '1999-09', '2026-13'):
                self.assertEqual(self.client.post('/folhas/enviar-lote', json={'month': month, 'professorIds': [1]}, headers={'Idempotency-Key': 'valida'}).status_code, 422)
            self.assertEqual(self.client.post('/folhas/enviar-lote', json={'month': '2026-09', 'professorIds': [1]}).status_code, 422)
            reserve.assert_not_called()


if __name__ == "__main__":
    unittest.main()
