-- Aplicar após 001 e 002, somente no banco escolhido. Não remove dados.
BEGIN;
DO $migration$
BEGIN
    IF to_regclass('schema_migration') IS NULL OR NOT EXISTS(
        SELECT 1 FROM schema_migration WHERE versao='002_calendario'
    ) THEN RAISE EXCEPTION 'Aplique a migração 002 antes de 003'; END IF;
    IF EXISTS(SELECT 1 FROM schema_migration WHERE versao='003_integracao') THEN
        IF to_regclass('sistema_lock') IS NULL OR to_regclass('importacao_servidor_preview') IS NULL
           OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
                AND table_name='folha_ponto' AND column_name='ativo' AND data_type='boolean')
           OR to_regclass('uq_folha_ativa_servidor_competencia') IS NULL THEN
            RAISE EXCEPTION 'Migração 003 marcada, mas estrutura incompatível';
        END IF;
        RETURN;
    END IF;
    EXECUTE $ddl$
-- INTEGRAÇÃO 003: histórico remoto, revisões, importação e lease compartilhado.
ALTER TABLE folha_ponto DROP CONSTRAINT uq_folha_servidor_competencia;
ALTER TABLE folha_ponto ADD COLUMN ativo BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN versao INTEGER NOT NULL DEFAULT 1 CHECK (versao > 0),
    ADD COLUMN tamanho_arquivo BIGINT CHECK (tamanho_arquivo IS NULL OR tamanho_arquivo >= 0),
    ADD COLUMN sha256 VARCHAR(64),
    ADD COLUMN atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN confirmado_em TIMESTAMPTZ,
    ADD COLUMN resultado_paginas JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX uq_folha_ativa_servidor_competencia
    ON folha_ponto(id_servidor,id_competencia) WHERE ativo;
ALTER TABLE folha_gerada ALTER COLUMN modelo SET DEFAULT 'institucional-v1';
CREATE INDEX idx_servidor_cpf_busca ON servidor(cpf);
CREATE INDEX idx_envio_folha_recente ON envio(id_folha,id_envio DESC);
CREATE TABLE importacao_servidor_preview (
    token UUID PRIMARY KEY,
    registros JSONB NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expira_em TIMESTAMPTZ NOT NULL,
    confirmado_em TIMESTAMPTZ,
    resultado JSONB
);
CREATE INDEX idx_importacao_servidor_expiracao ON importacao_servidor_preview(expira_em);
CREATE TABLE sistema_lock (
    id INTEGER PRIMARY KEY CHECK(id=1),
    owner_token UUID,
    acquired_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);
INSERT INTO sistema_lock(id) VALUES(1);
INSERT INTO schema_migration(versao) VALUES('003_integracao');
$ddl$;
END $migration$;
COMMIT;
