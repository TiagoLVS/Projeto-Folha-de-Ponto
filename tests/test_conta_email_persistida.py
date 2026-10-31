"""Persistência real em banco descartável, sem autenticação ou envio SMTP."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
import psycopg
from backend.database import conta_email as storage, repository
from backend.services import conta_email

@unittest.skipUnless(os.getenv('FOLHA_TEST_DSN'),'Configure banco descartável.')
class TestContaPersistida(unittest.TestCase):
    def setUp(self):
        self.dsn=os.environ['FOLHA_TEST_DSN'];self.schema='email_'+uuid4().hex
        with psycopg.connect(self.dsn,autocommit=True) as conn:conn.execute(f'CREATE SCHEMA {self.schema}')
        self.addCleanup(self.drop)
        context=patch.object(repository,'conectar',self.connect);context.start();self.addCleanup(context.stop)
        with self.connect() as conn:conn.execute(Path('database/folha_pontos.sql').read_text())
        folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup)
        self.key=Path(folder.name)/'secrets/email.key'
        context=patch.dict(os.environ,EMAIL_CREDENTIALS_KEY_FILE=str(self.key),EMAIL_CREDENTIALS_KEY='');context.start();self.addCleanup(context.stop)
        self.client=str(uuid4())

    def connect(self):return psycopg.connect(self.dsn,options=f'-c search_path={self.schema}')
    def drop(self):
        with psycopg.connect(self.dsn,autocommit=True) as conn:conn.execute(f'DROP SCHEMA {self.schema} CASCADE')

    def test_persistencia_criptografia_isolamento_reabertura_e_logout(self):
        conta=conta_email.Conta('ana@example.com','senha-ficticia-secreta','smtp.example.com',465,'ssl')
        conta_email.guardar(self.client,conta)
        original_key=self.key.read_bytes()
        self.assertEqual(self.key.stat().st_mode & 0o777,0o600)
        with self.connect() as conn:
            row=conn.execute('SELECT cliente_hash,credenciais_cifradas FROM conta_email_cliente').fetchone()
        self.assertNotIn(self.client,str(row));self.assertNotIn(conta.senha,str(row));self.assertNotIn(conta.email,str(row))
        # Consulta nova não depende de cache, relógio, sessão HTTP ou worker anterior.
        self.assertEqual(conta_email.obter(self.client).senha,conta.senha)
        self.assertEqual(storage.obter(self.client)['email'],conta.email)
        self.assertEqual(self.key.read_bytes(),original_key)
        self.assertIsNone(conta_email.obter(str(uuid4())))
        conta_email.desconectar(self.client)
        self.assertIsNone(conta_email.obter(self.client))
        with self.connect() as conn:self.assertEqual(conn.execute('SELECT count(*) FROM conta_email_cliente').fetchone()[0],0)

    def test_credenciais_corrompidas_nao_sao_aceitas_e_migracao_repetivel(self):
        data=dict(email='ana@example.com',senha='segredo',host='smtp.example.com',porta=465,seguranca='ssl')
        storage.guardar(self.client,data)
        with self.connect() as conn:conn.execute("UPDATE conta_email_cliente SET credenciais_cifradas='adulterado'")
        self.assertIsNone(storage.obter(self.client))
        storage.guardar(self.client,data)
        self.assertEqual(storage.obter(self.client),data)
        with self.connect() as conn:
            for _ in range(2):conn.execute(Path('database/migrations/007_conta_email.sql').read_text())
            self.assertEqual(conn.execute('SELECT count(*) FROM conta_email_cliente').fetchone()[0],1)
