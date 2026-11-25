"""Integração de autenticação com PostgreSQL descartável (FOLHA_TEST_DSN)."""
import os
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import psycopg
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend import auth

ROOT = Path(__file__).resolve().parents[1]


class TestPasswordHasher(unittest.TestCase):
    def test_senha_hash_e_verificacao(self):
        hashed = auth.password_hash('Senha!Uma-Bastante-Longa')
        self.assertTrue(hashed.startswith('pbkdf2_sha256$'))
        self.assertNotIn('Senha!', hashed)
        self.assertTrue(auth.password_matches('Senha!Uma-Bastante-Longa', hashed))
        self.assertFalse(auth.password_matches('senha errada', hashed))
        self.assertFalse(auth.password_matches('senha', 'hash-invalido'))
        self.assertNotEqual(hashed, auth.password_hash('Senha!Uma-Bastante-Longa'))


@unittest.skipUnless(os.getenv('FOLHA_TEST_DSN'), 'Exige PostgreSQL de testes descartável.')
class TestAuthenticationIntegration(unittest.TestCase):
    def setUp(self):
        self.schema = 'login_' + uuid4().hex
        self.dsn = os.environ['FOLHA_TEST_DSN']
        with psycopg.connect(self.dsn, autocommit=True) as conn:
            conn.execute(f'CREATE SCHEMA {self.schema}')
        self.addCleanup(self.drop)
        with self.connect() as conn:
            conn.execute('CREATE TABLE schema_migration(versao varchar(50) primary key,aplicada_em timestamptz DEFAULT now())')
            conn.execute((ROOT/'database/migrations/008_autenticacao.sql').read_text(encoding='utf-8'))
        self.patch_env = patch.dict(os.environ, {'PONTO_AUTH_REQUIRED': 'true', 'PONTO_DESKTOP_MODE': '1'})
        self.patch_env.start(); self.addCleanup(self.patch_env.stop)
        self.patch_connection = patch.object(auth, 'conectar', self.connect)
        self.patch_connection.start(); self.addCleanup(self.patch_connection.stop)
        app = FastAPI()
        app.include_router(auth.router)
        @app.get('/protected')
        def protected():
            return {'ok': True}
        @app.post('/protected')
        def mutate():
            return {'saved': True}
        app.add_middleware(auth.AuthMiddleware)
        self.client = TestClient(app, base_url='https://testserver')
        self.addCleanup(self.client.close)

    def connect(self):
        return psycopg.connect(self.dsn, options=f'-c search_path={self.schema}')

    def drop(self):
        with psycopg.connect(self.dsn, autocommit=True) as conn:
            conn.execute(f'DROP SCHEMA {self.schema} CASCADE')

    def bootstrap(self):
        response = self.client.post('/auth/bootstrap', json={'username': 'responsavel', 'password': 'Senha-Segura!123'},
                                    headers={'x-ponto-local': '1'})
        self.assertEqual(response.status_code, 201, response.text)

    def test_primeira_conta_apenas_no_principal_e_login_protege_api(self):
        self.assertEqual(self.client.get('/protected').status_code, 401)
        self.assertFalse(self.client.get('/auth/status').json()['initialized'])
        credentials = {'username': 'responsavel', 'password': 'Senha-Segura!123'}
        self.assertEqual(self.client.post('/auth/bootstrap', json=credentials).status_code, 403)
        self.bootstrap()
        self.assertEqual(self.client.post('/auth/bootstrap', json=credentials, headers={'x-ponto-local':'1'}).status_code, 409)
        response = self.client.post('/auth/login', json=credentials)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn('httponly', response.headers['set-cookie'].lower())
        self.assertIn('secure', response.headers['set-cookie'].lower())
        self.assertTrue(self.client.get('/auth/status').json()['authenticated'])
        self.assertEqual(self.client.get('/protected').status_code, 200)
        self.assertEqual(self.client.post('/protected', headers={'origin':'https://outro-site.com'}).status_code, 403)
        self.assertEqual(self.client.post('/protected', headers={'origin':'https://testserver'}).status_code, 200)
        self.assertEqual(self.client.post('/auth/logout').status_code, 200)
        self.assertEqual(self.client.get('/protected').status_code, 401)

    def test_administrador_cria_conta_normal_e_sessao_expira(self):
        self.bootstrap()
        self.assertEqual(self.client.post('/auth/login', json={'username':'responsavel', 'password':'Senha-Segura!123'}).status_code, 200)
        self.assertEqual(self.client.post('/auth/users', json={'username':'professor', 'password':'NovaSenha!1234'}).status_code, 201)
        self.client.post('/auth/logout')
        self.assertEqual(self.client.post('/auth/login', json={'username':'professor','password':'NovaSenha!1234'}).status_code, 200)
        self.assertEqual(self.client.post('/auth/users',json={'username':'outro','password':'SenhaSegura!3456'}).status_code, 403)
        with self.connect() as conn:
            conn.execute("UPDATE sessao_sistema SET expira_em = now()-interval '1 second'")
        self.assertEqual(self.client.get('/protected').status_code, 401)

    def test_bloqueia_apos_cinco_senhas_erradas(self):
        self.bootstrap()
        for _ in range(5):
            self.assertEqual(self.client.post('/auth/login', json={'username':'responsavel','password':'errada'}).status_code, 401)
        self.assertEqual(self.client.post('/auth/login', json={'username':'responsavel','password':'Senha-Segura!123'}).status_code, 429)
