import os
import smtplib
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from fastapi.testclient import TestClient
from backend.api import app
from backend.services import conta_email
from backend.services.enviar_email import carregar_configuracao_email,enviar_email,enviar_arquivo_registrado

class TestContaEmail(unittest.TestCase):
    def setUp(self):
        self.records={}
        storage=patch.multiple(conta_email.armazenamento,
            obter=lambda identifier:self.records.get(identifier),
            guardar=lambda identifier,data:self.records.__setitem__(identifier,data),
            desconectar=lambda identifier:self.records.pop(identifier,None))
        storage.start();self.addCleanup(storage.stop)
        self.client=TestClient(app);self.identifier=str(uuid4());self.headers={'X-Client-Id':self.identifier}
        env=patch.dict(os.environ,DIGEP_MODO_TESTE='false',SMTP_HOST='smtp.example.com',SMTP_PORT='465',SMTP_SECURITY='ssl',DIGEP_EMAIL='antigo@example.com',DIGEP_SENHA_APP='antiga',SMTP_USER='antigo@example.com')
        env.start();self.addCleanup(env.stop);self.addCleanup(conta_email.desconectar,self.identifier)
        factory=patch('smtplib.SMTP_SSL');self.smtp=factory.start();self.addCleanup(factory.stop)

    def connect(self):
        return self.client.post('/emails/conta',json={'email':'  Nova@Example.com ','senha':'segredo-de-teste'},headers=self.headers)

    def test_inicio_real_exige_conexao_e_nao_usa_conta_de_outra_sessao(self):
        self.assertEqual(self.client.get('/emails/conta',headers=self.headers).json(),dict(modo_teste=False,conectado=False,email=None))
        for path in ['/folhas/enviar-lote','/folhas/geradas/enviar-lote','/emails/reenviar-erros']:
            self.assertEqual(self.client.post(path,json={},headers=self.headers).status_code,409)
        result=self.connect();self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['email'],'nova@example.com');self.assertNotIn('segredo',result.text)
        self.smtp.return_value.__enter__.return_value.login.assert_called_once_with('nova@example.com','segredo-de-teste')
        self.smtp.return_value.__enter__.return_value.send_message.assert_not_called()
        self.assertTrue(self.client.get('/emails/conta',headers=self.headers).json()['conectado'])
        self.assertFalse(self.client.get('/emails/conta',headers={'X-Client-Id':str(uuid4())}).json()['conectado'])
        self.assertFalse(self.client.get('/emails/conta').json()['conectado'])
        self.assertEqual(self.client.delete('/emails/conta',headers=self.headers).status_code,204)
        self.assertFalse(self.client.get('/emails/conta',headers=self.headers).json()['conectado'])

    def test_falha_autenticacao_dados_invalidos_e_teste_nao_guardam_senha(self):
        self.smtp.return_value.__enter__.return_value.login.side_effect=smtplib.SMTPAuthenticationError(535,b'segredo-de-teste nao autorizado')
        result=self.connect();self.assertEqual(result.status_code,422);self.assertNotIn('segredo-de-teste',result.text)
        self.assertIsNone(conta_email.obter(self.identifier))
        result=self.client.post('/emails/conta',json={'email':'invalido','senha':'segredo-de-teste'},headers=self.headers)
        self.assertEqual(result.status_code,422);self.assertNotIn('segredo-de-teste',result.text)
        with patch.dict(os.environ,DIGEP_MODO_TESTE='true'):
            self.assertTrue(self.client.get('/emails/conta',headers=self.headers).json()['modo_teste'])
            self.assertEqual(self.connect().status_code,422)

    def test_conta_persistente_e_remetente_utilizam_conta_conectada(self):
        self.connect()
        token=conta_email.CLIENTE_HTTP.set(self.identifier)
        try:
            self.assertEqual(carregar_configuracao_email(),('nova@example.com','segredo-de-teste',False))
            with tempfile.TemporaryDirectory() as folder,patch('backend.database.repository.finalizar_envio'):
                path=Path(folder)/'teste.pdf';path.write_bytes(b'arquivo')
                result=enviar_arquivo_registrado(1,'Ana','ana@example.com',str(path))
                self.assertEqual(result['status'],'ENVIADO')
                message=self.smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
                self.assertEqual(message['From'],'nova@example.com');self.assertEqual(message['To'],'ana@example.com')
            self.assertIsNotNone(conta_email.obter())
            self.assertEqual(carregar_configuracao_email()[0],'nova@example.com')
        finally:conta_email.CLIENTE_HTTP.reset(token)

    def test_identidade_persistente_independe_da_sessao_e_isola_outros_computadores(self):
        computer=str(uuid4())
        self.headers['X-Email-Client-Id']=computer
        self.assertEqual(self.connect().status_code,200)
        reopened={'X-Client-Id':str(uuid4()),'X-Email-Client-Id':computer}
        self.assertTrue(self.client.get('/emails/conta',headers=reopened).json()['conectado'])
        self.assertFalse(self.client.get('/emails/conta',headers={'X-Email-Client-Id':str(uuid4())}).json()['conectado'])
        self.assertEqual(self.client.delete('/emails/conta',headers=reopened).status_code,204)
        self.assertFalse(self.client.get('/emails/conta',headers=self.headers).json()['conectado'])

    def test_starttls_e_senha_nao_aparecem_no_repr(self):
        self.assertNotIn('segredo',repr(conta_email.Conta('nova@example.com','segredo','smtp.example.com',587,'starttls')))
        with patch.dict(os.environ,SMTP_PORT='587',SMTP_SECURITY='starttls'),patch('smtplib.SMTP') as factory:
            self.assertEqual(self.connect().status_code,200)
            factory.return_value.__enter__.return_value.starttls.assert_called_once()
            factory.return_value.__enter__.return_value.send_message.assert_not_called()

    def test_erros_de_rede_sao_distintos_e_nao_expoem_detalhes(self):
        import socket, ssl
        for failure, expected in [(socket.gaierror('segredo-de-teste'),'localizar'),(TimeoutError('segredo-de-teste'),'demorou'),(ssl.SSLCertVerificationError('segredo-de-teste'),'certificado'),(ConnectionRefusedError('segredo-de-teste'),'recusada')]:
            with self.subTest(expected=expected):
                self.smtp.side_effect=failure
                result=self.connect()
                self.assertEqual(result.status_code,422)
                self.assertIn(expected,result.text)
                self.assertNotIn('segredo-de-teste',result.text)

    def test_senha_app_gmail_aceita_espacos_da_copia(self):
        with patch.dict(os.environ,SMTP_HOST='smtp.gmail.com'):
            result=self.client.post('/emails/conta',json={'email':'ana@gmail.com','senha':'abcd efgh ijkl mnop'},headers=self.headers)
            self.assertEqual(result.status_code,200)
            self.smtp.return_value.__enter__.return_value.login.assert_called_once_with('ana@gmail.com','abcdefghijklmnop')
