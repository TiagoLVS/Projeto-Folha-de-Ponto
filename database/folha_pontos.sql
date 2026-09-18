-- =====================================================
-- SISTEMA DE GESTÃO DE FOLHAS DE PONTO - DIGEP
-- Banco de dados PostgreSQL
-- =====================================================


-- =====================================================
-- 1. SERVIDOR
-- =====================================================

CREATE TABLE servidor (
    id_servidor BIGINT GENERATED ALWAYS AS IDENTITY,

    matricula VARCHAR(50) NOT NULL,
    nome VARCHAR(200) NOT NULL,
    cpf VARCHAR(14),
    email_pessoal VARCHAR(255),
    carga_horaria INTEGER,
    acumula_cargo BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT pk_servidor
        PRIMARY KEY (id_servidor),

    CONSTRAINT uq_servidor_matricula
        UNIQUE (matricula),

    CONSTRAINT ck_servidor_carga_horaria
        CHECK (carga_horaria IS NULL OR carga_horaria > 0)
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

    CONSTRAINT uq_competencia_mes_ano
        UNIQUE (mes, ano)
);


-- =====================================================
-- 3. FOLHA DE PONTO
-- =====================================================

CREATE TABLE folha_ponto (
    id_folha BIGINT GENERATED ALWAYS AS IDENTITY,

    id_servidor BIGINT NOT NULL,
    id_competencia BIGINT NOT NULL,

    caminho_arquivo TEXT NOT NULL,
    nome_arquivo VARCHAR(255),

    data_importacao TIMESTAMP WITH TIME ZONE
        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_folha_ponto
        PRIMARY KEY (id_folha),

    CONSTRAINT fk_folha_servidor
        FOREIGN KEY (id_servidor)
        REFERENCES servidor(id_servidor)
        ON DELETE RESTRICT,

    CONSTRAINT fk_folha_competencia
        FOREIGN KEY (id_competencia)
        REFERENCES competencia(id_competencia)
        ON DELETE RESTRICT
);


-- =====================================================
-- 4. ENVIO
-- =====================================================

CREATE TABLE envio (
    id_envio BIGINT GENERATED ALWAYS AS IDENTITY,

    id_folha BIGINT NOT NULL,

    email_destino VARCHAR(255) NOT NULL,

    data_registro TIMESTAMP WITH TIME ZONE
        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    data_envio TIMESTAMP WITH TIME ZONE,

    status VARCHAR(10)
        NOT NULL DEFAULT 'PENDENTE',

    mensagem_erro TEXT,

    CONSTRAINT pk_envio
        PRIMARY KEY (id_envio),

    CONSTRAINT fk_envio_folha
        FOREIGN KEY (id_folha)
        REFERENCES folha_ponto(id_folha)
        ON DELETE RESTRICT,

    CONSTRAINT ck_envio_status
        CHECK (
            status IN (
                'PENDENTE',
                'ENVIADO',
                'ERRO'
            )
        )
);


-- =====================================================
-- ÍNDICES PARA FACILITAR AS PESQUISAS
-- =====================================================

CREATE INDEX idx_servidor_nome
    ON servidor(nome);

CREATE INDEX idx_folha_servidor
    ON folha_ponto(id_servidor);

CREATE INDEX idx_folha_competencia
    ON folha_ponto(id_competencia);

CREATE INDEX idx_envio_status
    ON envio(status);