import unittest
from unittest.mock import patch
from backend.services.enviar_email import enviar_apos_confirmacao
from backend.api import corrigir_folha, ConfirmacaoFolhaPayload
from fastapi import HTTPException


class TestEnvioAutomatico(unittest.TestCase):
    def setUp(self):
        self.folha = {
            'id_folha': 1, 'id_servidor': 2, 'id_competencia': 3,
            'caminho_arquivo': '/tmp/folha.pdf', 'email': 'ana@example.com',
            'nome': 'Ana', 'status_ocr': 'OK',
        }
        def patched(name, **kwargs):
            context = patch(name, **kwargs)
            result = context.start()
            self.addCleanup(context.stop)
            return result
        self.config = patched('backend.services.enviar_email.carregar_configuracao_email', return_value=('digep@example.com', 'test-only', False))
        self.reserve = patched('backend.database.repository.registrar_requisicao_idempotente', return_value={'created': True, 'status': 'PROCESSANDO'})
        self.finish = patched('backend.database.repository.finalizar_requisicao_idempotente')
        self.send = patched('backend.services.enviar_email.enviar_folha_do_banco', return_value={'status': 'ENVIADO'})

    def test_dispara_e_registra_resultado(self):
        result = enviar_apos_confirmacao(self.folha)
        self.assertEqual(result['status'], 'ENVIADO')
        self.send.assert_called_once_with(self.folha)
        self.assertTrue(self.reserve.call_args.args[0].startswith('confirmacao:'))
        self.assertEqual(self.finish.call_args.args[1:], ('CONCLUIDO', 200, result))

    def test_sem_configuracao_nao_reserva_nem_envia(self):
        self.config.side_effect = RuntimeError('Configuração ausente')
        self.assertEqual(enviar_apos_confirmacao(self.folha)['status'], 'NAO_CONFIGURADO')
        self.reserve.assert_not_called()
        self.send.assert_not_called()

    def test_repeticao_recupera_sucesso_ou_falha_sem_reenviar(self):
        for status in ('CONCLUIDO', 'ERRO'):
            with self.subTest(status=status):
                saved = {'status': 'ENVIADO' if status == 'CONCLUIDO' else 'ERRO', 'mensagem': 'Resultado anterior'}
                self.reserve.return_value = {'created': False, 'status': status, 'response_body': saved}
                self.assertEqual(enviar_apos_confirmacao(self.folha), saved)
        self.send.assert_not_called()
        self.finish.assert_not_called()

    def test_envio_pendente_nao_dispara_outro(self):
        self.reserve.return_value = {'created': False, 'status': 'PROCESSANDO'}
        self.assertEqual(enviar_apos_confirmacao(self.folha)['status'], 'PROCESSANDO')
        self.send.assert_not_called()

    def test_falha_smtp_e_persistida_sem_expor_erro_interno(self):
        self.send.side_effect = RuntimeError('detalhe interno')
        result = enviar_apos_confirmacao(self.folha)
        self.assertEqual(result['status'], 'ERRO')
        self.assertNotIn('detalhe interno', result['mensagem'])
        self.assertEqual(self.finish.call_args.args[1], 'ERRO')

    def test_chave_distingue_arquivo_vinculo_destino_e_modo_teste(self):
        enviar_apos_confirmacao(self.folha)
        original = self.reserve.call_args.args[0]
        enviar_apos_confirmacao(dict(self.folha))
        self.assertEqual(self.reserve.call_args.args[0], original)
        for changes in ({'id_servidor': 20}, {'id_competencia': 30}, {'caminho_arquivo': '/tmp/outro.pdf'}, {'email': 'outro@example.com'}):
            enviar_apos_confirmacao({**self.folha, **changes})
            self.assertNotEqual(self.reserve.call_args.args[0], original)
        self.config.return_value = ('digep@example.com', 'test-only', True)
        result = enviar_apos_confirmacao(self.folha)
        self.assertIn('modo de teste', result['mensagem'])
        self.assertNotEqual(self.reserve.call_args.args[0], original)
        self.assertEqual(self.reserve.call_args.args[2]['destinatario'], 'digep@example.com')

    def test_erro_no_envio_nao_desfaz_confirmacao_e_nao_expoe_snapshot(self):
        saved = {'id_folha': 1, 'id_servidor': 2, 'id_competencia': 3, 'competencia': '2026-09', 'status_ocr': 'OK', '_folha_envio': self.folha}
        with patch('backend.api.confirmar_folha', return_value=saved), patch('backend.api.enviar_apos_confirmacao', side_effect=RuntimeError('banco indisponível')):
            result = corrigir_folha(1, ConfirmacaoFolhaPayload(id_servidor=2, competencia='2026-09'))
        self.assertEqual(result['status_ocr'], 'OK')
        self.assertEqual(result['envio']['status'], 'ERRO')
        self.assertNotIn('_folha_envio', result)

    def test_vinculo_invalido_nao_envia(self):
        with patch('backend.api.confirmar_folha', side_effect=LookupError('Professor não encontrado.')), patch('backend.api.enviar_apos_confirmacao') as send:
            with self.assertRaises(HTTPException):
                corrigir_folha(1, ConfirmacaoFolhaPayload(id_servidor=2, competencia='2026-09'))
            send.assert_not_called()
