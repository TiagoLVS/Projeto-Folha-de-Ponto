-- =====================================================
-- SISTEMA DE GESTÃO DE FOLHAS DE PONTO - DIGEP
-- PostgreSQL 17+; banco em UTF-8 (normalização Unicode determinística).
-- =====================================================


-- =====================================================
-- 1. SERVIDOR
-- =====================================================

CREATE TABLE servidor (
    id_servidor BIGINT GENERATED ALWAYS AS IDENTITY,

    matricula VARCHAR(50) NOT NULL,
    nome VARCHAR(200) NOT NULL,
    cpf VARCHAR(11),
    email VARCHAR(255),
    departamento VARCHAR(200),
    carga_horaria INTEGER,
    acumula_cargo BOOLEAN NOT NULL DEFAULT FALSE,

    data_cadastro TIMESTAMP WITH TIME ZONE
        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_servidor
        PRIMARY KEY (id_servidor),

    CONSTRAINT uq_servidor_matricula
        UNIQUE (matricula),

    CONSTRAINT uq_servidor_cpf
        UNIQUE (cpf),

    CONSTRAINT ck_servidor_cpf
        CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$'),

    CONSTRAINT ck_servidor_carga_horaria
        CHECK (
            carga_horaria IS NULL
            OR carga_horaria > 0
        )
);


-- =====================================================
-- 2. COMPETÊNCIA
-- =====================================================

CREATE TABLE competencia (
    id_competencia BIGINT GENERATED ALWAYS AS IDENTITY,

    mes INTEGER NOT NULL,
    ano INTEGER NOT NULL,

    CONSTRAINT pk_competencia
        PRIMARY KEY (id_competencia),

    CONSTRAINT ck_competencia_mes
        CHECK (mes BETWEEN 1 AND 12),

    CONSTRAINT ck_competencia_ano
        CHECK (ano >= 2000),

    CONSTRAINT uq_competencia_mes_ano
        UNIQUE (mes, ano)
);


-- =====================================================
-- 3. FOLHA DE PONTO / RESULTADO DO OCR
-- =====================================================

CREATE TABLE folha_ponto (
    id_folha BIGINT GENERATED ALWAYS AS IDENTITY,

    -- Podem ficar NULL enquanto o OCR ainda não
    -- conseguiu identificar/confirmação não foi feita.
    id_servidor BIGINT,
    id_competencia BIGINT,

    caminho_arquivo TEXT NOT NULL,
    nome_arquivo VARCHAR(255) NOT NULL,

    -- Resultado bruto identificado pelo OCR.
    matricula_lida VARCHAR(50),
    competencia_lida VARCHAR(7),

    -- OK      = reconhecido corretamente
    -- REVISAR = precisa de confirmação humana
    -- ERRO    = OCR não conseguiu processar
    status_ocr VARCHAR(10)
        NOT NULL DEFAULT 'REVISAR',

    mensagem_ocr TEXT,

    data_importacao TIMESTAMP WITH TIME ZONE
        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    data_processamento_ocr TIMESTAMP WITH TIME ZONE,

    CONSTRAINT pk_folha_ponto
        PRIMARY KEY (id_folha),

    CONSTRAINT fk_folha_servidor
        FOREIGN KEY (id_servidor)
        REFERENCES servidor(id_servidor)
        ON DELETE RESTRICT,

    CONSTRAINT fk_folha_competencia
        FOREIGN KEY (id_competencia)
        REFERENCES competencia(id_competencia)
        ON DELETE RESTRICT,

    CONSTRAINT uq_folha_servidor_competencia
        UNIQUE (id_servidor, id_competencia),

    CONSTRAINT ck_folha_status_ocr
        CHECK (
            status_ocr IN (
                'OK',
                'REVISAR',
                'ERRO'
            )
        )
);


-- =====================================================
-- 4. ENVIO DE E-MAIL
-- =====================================================

CREATE TABLE envio (
    id_envio BIGINT GENERATED ALWAYS AS IDENTITY,

    id_folha BIGINT NOT NULL,

    email_destino VARCHAR(255) NOT NULL,

    -- PENDENTE = ainda não enviado
    -- ENVIADO  = enviado corretamente
    -- ERRO     = tentativa falhou
    status_envio VARCHAR(10)
        NOT NULL DEFAULT 'PENDENTE',

    data_registro TIMESTAMP WITH TIME ZONE
        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    data_envio TIMESTAMP WITH TIME ZONE,

    mensagem_erro TEXT,

    CONSTRAINT pk_envio
        PRIMARY KEY (id_envio),

    CONSTRAINT fk_envio_folha
        FOREIGN KEY (id_folha)
        REFERENCES folha_ponto(id_folha)
        ON DELETE RESTRICT,

    CONSTRAINT ck_envio_status
        CHECK (
            status_envio IN (
                'PENDENTE',
                'ENVIADO',
                'ERRO'
            )
        )
);


-- =====================================================
-- 5. IDEMPOTÊNCIA DE ENVIO EM LOTE
-- =====================================================

CREATE TABLE idempotency_request (
    idempotency_key VARCHAR(255) NOT NULL,

    payload_hash VARCHAR(64) NOT NULL,
    request_body JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL,
    response_status_code INTEGER,
    response_body JSONB,

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_idempotency_request
        PRIMARY KEY (idempotency_key),

    CONSTRAINT ck_idempotency_status
        CHECK (
            status IN (
                'PROCESSANDO',
                'CONCLUIDO',
                'ERRO'
            )
        )
);


-- =====================================================
-- ÍNDICES
-- =====================================================

CREATE INDEX idx_servidor_nome
    ON servidor(nome);

CREATE INDEX idx_servidor_email
    ON servidor(email);

CREATE INDEX idx_folha_servidor
    ON folha_ponto(id_servidor);

CREATE INDEX idx_folha_competencia
    ON folha_ponto(id_competencia);

CREATE INDEX idx_folha_status_ocr
    ON folha_ponto(status_ocr);

CREATE INDEX idx_envio_folha
    ON envio(id_folha);

CREATE INDEX idx_envio_status
    ON envio(status_envio);

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
