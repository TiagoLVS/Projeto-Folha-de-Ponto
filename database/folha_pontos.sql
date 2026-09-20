-- =====================================================
-- SISTEMA DE GESTÃO DE FOLHAS DE PONTO - DIGEP
-- PostgreSQL
-- =====================================================


-- =====================================================
-- 1. SERVIDOR
-- =====================================================

CREATE TABLE servidor (
    id_servidor BIGINT GENERATED ALWAYS AS IDENTITY,

    matricula VARCHAR(50) NOT NULL,
    nome VARCHAR(200) NOT NULL,
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
