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
OLD = Path('tests/fixtures/schema_anterior_integracao.sql').read_text()
MIGRATION = Path('database/migrations/002_atualizacao_calendario.sql').read_text() + '\n' + Path('database/migrations/003_integracao_sistema.sql').read_text() + '\n' + Path('database/migrations/004_refinamentos.sql').read_text() + '\n' + Path('database/migrations/005_envio_modelos.sql').read_text() + '\n' + Path('database/migrations/006_dados_funcionais_servidor.sql').read_text() + '\n' + Path('database/migrations/007_conta_email.sql').read_text()


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
            columns={table:[r[0] for r in conn.execute(f'SELECT * FROM {table}').description] for table in tables}
            before = {table: conn.execute(f'SELECT * FROM {table}').fetchall() for table in tables}
        with self.connect() as conn:
            conn.execute(MIGRATION)
            conn.execute(MIGRATION)
            after = {table: conn.execute('SELECT '+','.join(columns[table])+' FROM '+table).fetchall() for table in tables}
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

    def test_003_preserva_calendario_documentos_snapshots_e_historico(self):
        with self.connect() as conn:
            conn.execute(OLD)
            conn.execute(Path('database/migrations/002_atualizacao_calendario.sql').read_text())
            person=conn.execute("INSERT INTO servidor(nome,matricula,email) VALUES('Anterior','12345','a@example.com') RETURNING id_servidor").fetchone()[0]
            comp=conn.execute('INSERT INTO competencia(ano,mes) VALUES(2027,2) RETURNING id_competencia').fetchone()[0]
        with patch.object(repository,'conectar',self.connect), tempfile.TemporaryDirectory() as folder, patch.object(geracao,'PASTA_GERADAS',Path(folder)):
            salvar_data(DataEspecialPayload(data='2027-02-15',especificacao='Recesso preservado',tipo='RECESSO'))
            path=Path(folder)/'anterior.pdf'
            original=b'%PDF-exemplo-anterior-preservado'
            path.write_bytes(original)
            with self.connect() as conn:
                generated=conn.execute("INSERT INTO folha_gerada(id_servidor,id_competencia,versao,caminho_arquivo,nome_arquivo,tamanho_bytes,sha256,dados_professor) VALUES(%s,%s,1,%s,'anterior.pdf',%s,%s,'{}') RETURNING id_documento",(person,comp,str(path),len(original),'a'*64)).fetchone()[0]
                conn.execute("INSERT INTO folha_gerada_evento(id_documento,ordem,id_data_especial,data,especificacao,tipo) SELECT %s,0,id_data_especial,data,especificacao,tipo FROM data_especial",(generated,))
            tables=['servidor','competencia','data_especial','folha_gerada','folha_gerada_evento']
            with self.connect() as conn:
                conn.execute("INSERT INTO importacao_calendario(nome_arquivo,sha256,total,novos,atualizados,ignorados,invalidos,detalhes) VALUES('antes.xlsx',%s,1,1,0,0,0,'[]')",('a'*64,))
                tables.append('importacao_calendario')
                before={table:conn.execute('SELECT * FROM '+table).fetchall() for table in tables}
            with self.connect() as conn:
                migration=Path('database/migrations/003_integracao_sistema.sql').read_text()
                conn.execute(migration);conn.execute(migration)
                after={table:conn.execute('SELECT * FROM '+table).fetchall() for table in tables}
            self.assertEqual(before,after)
            self.assertEqual(path.read_bytes(),original)

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

    def test_004_detecta_cargas_incompativeis_sem_alterar_dados(self):
        with self.connect() as conn:
            conn.execute(OLD)
            conn.execute(Path('database/migrations/002_atualizacao_calendario.sql').read_text())
            conn.execute(Path('database/migrations/003_integracao_sistema.sql').read_text())
            conn.execute("INSERT INTO servidor(nome,matricula,carga_horaria) VALUES('Legado','99999',35)")
        migration=Path('database/migrations/004_refinamentos.sql').read_text()
        with self.assertRaisesRegex(psycopg.errors.RaiseException,'99999.*35'),self.connect() as conn:
            conn.execute(migration)
        with self.connect() as conn:
            self.assertEqual(conn.execute("SELECT carga_horaria FROM servidor WHERE matricula='99999'").fetchone()[0],35)
            self.assertIsNone(conn.execute("SELECT to_regclass('importacao_calendario_preview')").fetchone()[0])
            conn.execute("UPDATE servidor SET carga_horaria=20 WHERE matricula='99999'")
        with self.connect() as conn:
            conn.execute(migration);conn.execute(migration)
            self.assertEqual(conn.execute("SELECT carga_horaria FROM servidor WHERE matricula='99999'").fetchone()[0],20)
        with self.assertRaises(psycopg.errors.CheckViolation),self.connect() as conn:
            conn.execute("UPDATE servidor SET carga_horaria=35 WHERE matricula='99999'")
