-- Requer PostgreSQL 17+ em UTF-8, o schema anterior e a migração 001. Execute somente no banco escolhido.
BEGIN;
DO $migration$
BEGIN
    IF to_regclass('idempotency_request') IS NULL THEN
        RAISE EXCEPTION 'Aplique primeiro 001_idempotency_request.sql';
    END IF;
    IF to_regclass('schema_migration') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM schema_migration WHERE versao = '002_calendario') THEN
            IF to_regclass('data_especial') IS NULL OR to_regclass('folha_gerada') IS NULL
               OR to_regclass('folha_gerada_evento') IS NULL OR to_regclass('importacao_calendario') IS NULL THEN
                RAISE EXCEPTION 'Migração marcada como aplicada, mas tabelas estão ausentes. Revise o schema.';
            END IF;
            -- A reaplicação só é aceita quando os campos essenciais mantêm os tipos.
            IF EXISTS (
                SELECT 1 FROM (VALUES
                    ('data_especial','data','date'),
                    ('data_especial','especificacao','character varying(300)'),
                    ('data_especial','especificacao_normalizada','text'),
                    ('data_especial','tipo','character varying(20)'),
                    ('folha_gerada','id_servidor','bigint'),
                    ('folha_gerada','id_competencia','bigint'),
                    ('folha_gerada','versao','integer'),
                    ('folha_gerada','dados_professor','jsonb'),
                    ('folha_gerada_evento','id_documento','bigint'),
                    ('folha_gerada_evento','id_data_especial','bigint'),
                    ('folha_gerada_evento','data','date'),
                    ('importacao_calendario','detalhes','jsonb')
                ) AS esperado(tabela,coluna,tipo)
                LEFT JOIN pg_attribute a ON a.attrelid=to_regclass(esperado.tabela)
                    AND a.attname=esperado.coluna AND NOT a.attisdropped
                WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod) <> esperado.tipo
            ) THEN
                RAISE EXCEPTION 'Migração marcada como aplicada, mas colunas estão incompatíveis. Revise o schema.';
            END IF;
            RETURN;
        END IF;
        RAISE EXCEPTION 'schema_migration preexistente incompatível: revise antes de aplicar 002';
    END IF;
    EXECUTE $ddl$

-- REQUISITO 3.3 — CALENDÁRIO E MODELOS GERADOS
CREATE FUNCTION normalizar_especificacao(text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT lower(normalize(btrim(regexp_replace($1 COLLATE pg_catalog."pg_c_utf8", '[[:space:]]+', ' ', 'g')), NFC) COLLATE pg_catalog."pg_c_utf8") $$;

CREATE TABLE data_especial (
    id_data_especial BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    data DATE NOT NULL,
    especificacao VARCHAR(300) NOT NULL,
    especificacao_normalizada TEXT GENERATED ALWAYS AS (normalizar_especificacao(especificacao)) STORED,
    tipo VARCHAR(20) NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_data_especial_texto CHECK (length(normalizar_especificacao(especificacao)) > 0),
    CONSTRAINT ck_data_especial_tipo CHECK (tipo IN ('FERIADO','RECESSO','PONTO_FACULTATIVO','OUTRO')),
    CONSTRAINT uq_data_especial_identidade UNIQUE (data, especificacao_normalizada)
);
CREATE INDEX idx_data_especial_tipo_data ON data_especial(tipo, data);
CREATE FUNCTION atualizar_data_especial_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER trg_data_especial_atualizacao BEFORE UPDATE ON data_especial
FOR EACH ROW EXECUTE FUNCTION atualizar_data_especial_timestamp();

CREATE TABLE importacao_calendario (
    id_importacao BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome_arquivo VARCHAR(255) NOT NULL,
    sha256 CHAR(64) NOT NULL,
    total INTEGER NOT NULL CHECK (total >= 0),
    novos INTEGER NOT NULL CHECK (novos >= 0),
    atualizados INTEGER NOT NULL CHECK (atualizados >= 0),
    ignorados INTEGER NOT NULL CHECK (ignorados >= 0),
    invalidos INTEGER NOT NULL CHECK (invalidos >= 0),
    detalhes JSONB NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_importacao_contadores CHECK (total = novos + atualizados + ignorados + invalidos)
);

-- Modelos em branco são separados das folhas recebidas/preenchidas.
-- A unicidade de folha_ponto e seus fluxos OCR/e-mail permanecem intactos.
CREATE TABLE folha_gerada (
    id_documento BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_servidor BIGINT NOT NULL REFERENCES servidor(id_servidor) ON DELETE RESTRICT,
    id_competencia BIGINT NOT NULL REFERENCES competencia(id_competencia) ON DELETE RESTRICT,
    id_folha_referencia BIGINT REFERENCES folha_ponto(id_folha) ON DELETE SET NULL,
    versao INTEGER NOT NULL CHECK (versao > 0),
    origem VARCHAR(10) NOT NULL DEFAULT 'GERADA' CHECK (origem = 'GERADA'),
    situacao VARCHAR(25) NOT NULL DEFAULT 'MODELO_EM_BRANCO' CHECK (situacao = 'MODELO_EM_BRANCO'),
    modelo VARCHAR(50) NOT NULL DEFAULT 'provisorio-v1',
    caminho_arquivo TEXT NOT NULL UNIQUE,
    nome_arquivo VARCHAR(255) NOT NULL,
    tamanho_bytes BIGINT NOT NULL CHECK (tamanho_bytes > 0),
    sha256 CHAR(64) NOT NULL,
    dados_professor JSONB NOT NULL,
    gerado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_folha_gerada_versao UNIQUE (id_servidor, id_competencia, versao)
);
CREATE INDEX idx_folha_gerada_competencia ON folha_gerada(id_competencia, id_servidor);
CREATE INDEX idx_folha_gerada_referencia ON folha_gerada(id_folha_referencia);

-- Snapshot preservado mesmo após editar/excluir o evento do calendário.
CREATE TABLE folha_gerada_evento (
    id_documento BIGINT NOT NULL REFERENCES folha_gerada(id_documento) ON DELETE CASCADE,
    ordem INTEGER NOT NULL CHECK (ordem >= 0),
    id_data_especial BIGINT REFERENCES data_especial(id_data_especial) ON DELETE SET NULL,
    data DATE NOT NULL,
    especificacao VARCHAR(300) NOT NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('FERIADO','RECESSO','PONTO_FACULTATIVO','OUTRO')),
    PRIMARY KEY (id_documento, ordem)
);
CREATE INDEX idx_folha_gerada_evento_origem ON folha_gerada_evento(id_data_especial);

CREATE TABLE schema_migration (
    versao VARCHAR(50) PRIMARY KEY,
    aplicada_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO schema_migration(versao) VALUES ('002_calendario');
$ddl$;
END $migration$;
COMMIT;
