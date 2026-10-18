"""Inicialização: diagnóstico/migrações somente em banco descartável."""
import errno
import contextlib
import getpass
import io
import os
from pathlib import Path
import socket
import subprocess
import unittest
from unittest.mock import patch
from uuid import uuid4
import psycopg
from psycopg.conninfo import conninfo_to_dict
from backend import startup

ROOT=Path(__file__).resolve().parents[1]


class TestStartup(unittest.TestCase):
    def test_ajuda_e_opcao_invalida_nao_iniciam_servicos(self):
        result=subprocess.run(['bash',str(ROOT/'iniciar.sh'),'--help'],capture_output=True,text=True,cwd='/tmp')
        self.assertEqual(result.returncode,0);self.assertIn('--migrar',result.stdout)
        result=subprocess.run(['bash',str(ROOT/'iniciar.sh'),'--inexistente'],capture_output=True,text=True,cwd='/tmp')
        self.assertEqual(result.returncode,2);self.assertIn('desconhecida',result.stderr)

    def test_portas_invalidas_iguais_sao_rejeitadas(self):
        for backend,frontend in [('0','15179'),('18123','18123'),('abc','15179')]:
            with patch.dict(os.environ,BACKEND_PORT=backend,FRONTEND_PORT=frontend):
                with self.assertRaises(ValueError):startup.verificar_portas()


class TestStartupPortas(unittest.TestCase):
    def porta_livre(self, outra):
        while True:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            if port!=outra:return str(port)

    def test_reiniciar_com_conexoes_time_wait(self):
        with socket.socket() as server:
            server.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            server.bind(('127.0.0.1',0));port=server.getsockname()[1];server.listen()
            with socket.create_connection(('127.0.0.1',port)) as client:
                connection,_=server.accept()
                # O servidor fecha primeiro, deixando a porta local em TIME_WAIT.
                connection.shutdown(socket.SHUT_WR);connection.close()
                self.assertEqual(client.recv(1),b'')
        with socket.socket() as old_probe:
            with self.assertRaises(OSError) as error:
                old_probe.bind(('0.0.0.0',port))
            self.assertEqual(error.exception.errno,errno.EADDRINUSE)
        with patch.dict(os.environ,BACKEND_PORT=self.porta_livre(port),FRONTEND_PORT=str(port)):
            startup.verificar_portas()

    def test_listener_ativo_continua_protegido(self):
        with socket.socket() as server:
            server.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            server.bind(('127.0.0.1',0));port=server.getsockname()[1];server.listen()
            with patch.dict(os.environ,BACKEND_PORT=self.porta_livre(port),FRONTEND_PORT=str(port)):
                with self.assertRaisesRegex(ValueError,f'Frontend: porta {port} ocupada'):
                    startup.verificar_portas()
            # O diagnóstico nunca encerra o serviço que ocupava a porta.
            with socket.create_connection(('127.0.0.1',port)) as client:
                connection,_=server.accept();connection.close()


@unittest.skipUnless(os.getenv('FOLHA_TEST_DSN'),'Configure banco descartável para integração de inicialização.')
class TestStartupBanco(unittest.TestCase):
    def setUp(self):
        self.dsn=os.environ['FOLHA_TEST_DSN'];self.schema='startup_'+uuid4().hex
        with psycopg.connect(self.dsn,autocommit=True) as conn:conn.execute(f'CREATE SCHEMA {self.schema}')
        self.addCleanup(self.drop)
        with self.connect() as conn:
            conn.execute((ROOT/'tests/fixtures/schema_anterior_integracao.sql').read_text())
            for name in ('002_atualizacao_calendario.sql','003_integracao_sistema.sql'):
                conn.execute((ROOT/'database/migrations'/name).read_text())
            conn.execute("INSERT INTO servidor(nome,matricula,carga_horaria) VALUES('Ficticio','12345',40)")
        params=conninfo_to_dict(self.dsn)
        env=dict(DB_HOST=params.get('host','localhost'),DB_PORT=params.get('port','5432'),DB_NAME=params.get('dbname','postgres'),DB_USER=params.get('user',getpass.getuser()),DB_PASSWORD=params.get('password',''),PGOPTIONS=f'-c search_path={self.schema}')
        patcher=patch.dict(os.environ,env);patcher.start();self.addCleanup(patcher.stop)

    def connect(self):return psycopg.connect(self.dsn,options=f'-c search_path={self.schema}')
    def drop(self):
        with psycopg.connect(self.dsn,autocommit=True) as conn:conn.execute(f'DROP SCHEMA {self.schema} CASCADE')

    def test_diagnostico_nao_migra_autorizacao_aplica_so_pendentes(self):
        with contextlib.redirect_stderr(io.StringIO()) as error:
            self.assertEqual(startup.verificar_banco(),3)
        self.assertIn('004_refinamentos.sql',error.getvalue())
        with self.connect() as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM schema_migration WHERE versao='004_refinamentos'").fetchone()[0],0)
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(startup.verificar_banco(True),0)
            self.assertEqual(startup.verificar_banco(True),0)
        with self.connect() as conn:self.assertEqual(conn.execute('SELECT nome,carga_horaria FROM servidor').fetchone(),('Ficticio',40))

    def test_carga_incompativel_nao_e_convertida(self):
        with self.connect() as conn:conn.execute('UPDATE servidor SET carga_horaria=35')
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaisesRegex(ValueError,'35'):startup.verificar_banco(True)
        with self.connect() as conn:
            self.assertEqual(conn.execute('SELECT carga_horaria FROM servidor').fetchone()[0],35)
            self.assertIsNone(conn.execute("SELECT to_regclass('importacao_calendario_preview')").fetchone()[0])

    def test_porta_ocupada_tem_diagnostico(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            with patch.dict(os.environ,BACKEND_PORT=str(port),FRONTEND_PORT=str(port+1 if port<65535 else port-1)):
                with self.assertRaisesRegex(ValueError,'ocupada'):startup.verificar_portas()
