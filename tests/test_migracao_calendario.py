import os
from pathlib import Path
import unittest
from uuid import uuid4
from unittest.mock import patch
import psycopg
from backend.database import repository
from backend.models.calendario import DataEspecialPayload, GeracaoPayload
from backend.database.calendario import salvar_data
from backend.services import geracao
import tempfile

FULL = Path('database/folha_pontos.sql').read_text()
OLD = FULL.split('-- REQUISITO 3.3')[0]
MIGRATION = Path('database/migrations/002_atualizacao_calendario.sql').read_text()


@unittest.skipUnless(os.getenv('FOLHA_TEST_DSN'), 'Defina FOLHA_TEST_DSN para um banco descartável.')
class TestMigracaoCalendario(unittest.TestCase):
    def setUp(self):
        self.dsn = os.environ['FOLHA_TEST_DSN']
        self.schemas = ['migration_' + uuid4().hex, 'fresh_' + uuid4().hex]
        with psycopg.connect(self.dsn, autocommit=True) as conn:
            for schema in self.schemas:
                conn.execute(f'CREATE SCHEMA {schema}')
        self.addCleanup(self.drop)

    def drop(self):
        with psycopg.connect(self.dsn, autocommit=True) as conn:
            for schema in self.schemas:
                conn.execute(f'DROP SCHEMA {schema} CASCADE')

    def connect(self, index=0):
        return psycopg.connect(self.dsn, options=f'-c search_path={self.schemas[index]}')

    def fingerprint(self, index):
        with self.connect(index) as conn:
            columns = conn.execute("SELECT table_name,column_name,data_type,is_nullable,column_default,is_identity,generation_expression FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,ordinal_position").fetchall()
            constraints = conn.execute("SELECT c.relname,p.conname,pg_get_constraintdef(p.oid) FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() ORDER BY c.relname,p.conname").fetchall()
            indexes = conn.execute('SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() ORDER BY indexname').fetchall()
            triggers = conn.execute("SELECT trigger_name,event_object_table,action_statement FROM information_schema.triggers WHERE trigger_schema=current_schema() ORDER BY trigger_name").fetchall()
            functions = conn.execute("SELECT p.proname,pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() ORDER BY p.proname").fetchall()
        return repr((columns, constraints, indexes, triggers, functions)).replace(self.schemas[index], 'SCHEMA')

    def test_novo_e_migrado_equivalentes_dados_preservados_e_fluxo_funcional(self):
        with self.connect() as conn:
            conn.execute(OLD)
            prof = conn.execute("INSERT INTO servidor(matricula,nome,email,carga_horaria) VALUES('12345','Anterior','anterior@example.com',40) RETURNING id_servidor").fetchone()[0]
            comp = conn.execute('INSERT INTO competencia(ano,mes) VALUES(2027,2) RETURNING id_competencia').fetchone()[0]
            folha = conn.execute("INSERT INTO folha_ponto(id_servidor,id_competencia,caminho_arquivo,nome_arquivo,status_ocr) VALUES(%s,%s,'/original.pdf','original.pdf','OK') RETURNING id_folha", (prof, comp)).fetchone()[0]
            conn.execute("INSERT INTO envio(id_folha,email_destino,status_envio) VALUES(%s,'anterior@example.com','ENVIADO')", (folha,))
            conn.execute("INSERT INTO idempotency_request(idempotency_key,payload_hash,status,response_body) VALUES('antes','hash','CONCLUIDO','{\"sentCount\":1}')")
            tables = ['servidor', 'competencia', 'folha_ponto', 'envio', 'idempotency_request']
            before = {table: conn.execute(f'SELECT * FROM {table}').fetchall() for table in tables}
        with self.connect() as conn:
            conn.execute(MIGRATION)
            conn.execute(MIGRATION)
            after = {table: conn.execute(f'SELECT * FROM {table}').fetchall() for table in tables}
        self.assertEqual(before, after)
        with self.connect(1) as conn:
            conn.execute(FULL)
        self.assertEqual(self.fingerprint(0), self.fingerprint(1))
        with patch.object(repository, 'conectar', self.connect), tempfile.TemporaryDirectory() as folder, patch.object(geracao, 'PASTA_GERADAS', Path(folder)):
            saved = salvar_data(DataEspecialPayload(data='2027-02-15', especificacao='Recesso', tipo='RECESSO'))
            self.assertTrue(saved['id_data_especial'])
            doc = geracao.gerar_folha(GeracaoPayload(id_servidor=prof, competencia='2027-02'))
            self.assertEqual(doc['id_folha_referencia'], folha)
            self.assertTrue(geracao.arquivo_documento(doc['id_documento'])[0].exists())

    def test_migracao_rejeita_schema_parcial_sem_ocultar_problema(self):
        with self.connect() as conn:
            conn.execute(OLD)
            conn.execute('CREATE TABLE data_especial(id integer)')
        with self.assertRaises(psycopg.errors.DuplicateTable), self.connect() as conn:
            conn.execute(MIGRATION)
        with self.connect() as conn:
            self.assertIsNone(conn.execute("SELECT to_regclass('folha_gerada')").fetchone()[0])

    def test_migracao_rejeita_marcador_com_tabela_ausente(self):
        with self.connect() as conn:
            conn.execute(FULL)
            conn.execute('DROP TABLE importacao_calendario')
        with self.assertRaisesRegex(psycopg.errors.RaiseException, 'ausentes'), self.connect() as conn:
            conn.execute(MIGRATION)

    def test_migracao_rejeita_coluna_incompativel(self):
        with self.connect() as conn:
            conn.execute(FULL)
            conn.execute('ALTER TABLE importacao_calendario ALTER COLUMN detalhes TYPE text USING detalhes::text')
        with self.assertRaisesRegex(psycopg.errors.RaiseException, 'incompatíveis'), self.connect() as conn:
            conn.execute(MIGRATION)
