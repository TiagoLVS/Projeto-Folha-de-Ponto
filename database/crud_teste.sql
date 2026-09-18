-- =====================================================
-- CRUD DE TESTE
-- ATENÇÃO: este arquivo apaga os dados das tabelas.
-- Use somente no banco de desenvolvimento.
-- =====================================================


-- =====================================================
-- LIMPEZA PARA O TESTE
-- =====================================================

TRUNCATE TABLE
    envio,
    folha_ponto,
    competencia,
    servidor
RESTART IDENTITY CASCADE;


-- =====================================================
-- CREATE
-- =====================================================

-- Criar servidor
INSERT INTO servidor (
    matricula,
    nome,
    email,
    departamento,
    carga_horaria,
    acumula_cargo
)
VALUES (
    '123456',
    'João da Silva',
    'joao.silva@exemplo.com',
    'Tecnologia da Informação',
    40,
    TRUE
);


-- Criar competência setembro/2026
INSERT INTO competencia (
    mes,
    ano
)
VALUES (
    9,
    2026
);


-- Simular resultado do OCR
INSERT INTO folha_ponto (
    id_servidor,
    id_competencia,
    caminho_arquivo,
    nome_arquivo,
    matricula_lida,
    competencia_lida,
    status_ocr,
    data_processamento_ocr
)
VALUES (
    (
        SELECT id_servidor
        FROM servidor
        WHERE matricula = '123456'
    ),

    (
        SELECT id_competencia
        FROM competencia
        WHERE mes = 9
          AND ano = 2026
    ),

    '/arquivos/folhas/joao_2026_09.pdf',
    'joao_2026_09.pdf',
    '123456',
    '2026-09',
    'OK',
    CURRENT_TIMESTAMP
);


-- Simular registro de e-mail pendente
INSERT INTO envio (
    id_folha,
    email_destino,
    status_envio
)
VALUES (
    (
        SELECT fp.id_folha
        FROM folha_ponto fp
        JOIN servidor s
            ON s.id_servidor = fp.id_servidor
        WHERE s.matricula = '123456'
    ),

    'joao.silva@exemplo.com',
    'PENDENTE'
);


-- =====================================================
-- READ
-- =====================================================

-- Ver servidores
SELECT *
FROM servidor;


-- Ver folhas e resultado do OCR
SELECT
    fp.id_folha,
    s.matricula,
    s.nome,
    c.mes,
    c.ano,
    fp.caminho_arquivo,
    fp.status_ocr,
    fp.mensagem_ocr
FROM folha_ponto fp

LEFT JOIN servidor s
    ON s.id_servidor = fp.id_servidor

LEFT JOIN competencia c
    ON c.id_competencia = fp.id_competencia;


-- Ver servidores que acumulam cargo
SELECT
    matricula,
    nome,
    email
FROM servidor
WHERE acumula_cargo = TRUE;


-- Ver envios
SELECT
    e.id_envio,
    s.nome,
    s.matricula,
    e.email_destino,
    e.status_envio,
    e.data_envio,
    e.mensagem_erro
FROM envio e

JOIN folha_ponto fp
    ON fp.id_folha = e.id_folha

JOIN servidor s
    ON s.id_servidor = fp.id_servidor;


-- =====================================================
-- UPDATE
-- =====================================================

-- Simular envio realizado com sucesso
UPDATE envio
SET
    status_envio = 'ENVIADO',
    data_envio = CURRENT_TIMESTAMP,
    mensagem_erro = NULL
WHERE id_envio = 1;


-- Conferir resultado
SELECT *
FROM envio;


-- =====================================================
-- TESTE DE ERRO DE OCR
-- =====================================================

INSERT INTO folha_ponto (
    caminho_arquivo,
    nome_arquivo,
    matricula_lida,
    competencia_lida,
    status_ocr,
    mensagem_ocr,
    data_processamento_ocr
)
VALUES (
    '/arquivos/folhas/folha_nao_identificada.pdf',
    'folha_nao_identificada.pdf',
    NULL,
    NULL,
    'REVISAR',
    'Não foi possível identificar matrícula ou competência.',
    CURRENT_TIMESTAMP
);


SELECT *
FROM folha_ponto;


-- =====================================================
-- TESTE DE ERRO DE E-MAIL
-- =====================================================

UPDATE envio
SET
    status_envio = 'ERRO',
    data_envio = NULL,
    mensagem_erro = 'Falha ao conectar com o servidor SMTP.'
WHERE id_envio = 1;


SELECT *
FROM envio;


-- =====================================================
-- DELETE
-- =====================================================
-- Deixei comentado para você não apagar os testes
-- acidentalmente.

-- DELETE FROM envio
-- WHERE id_envio = 1;

-- DELETE FROM folha_ponto
-- WHERE id_folha = 1;

-- DELETE FROM competencia
-- WHERE mes = 9
--   AND ano = 2026;

-- DELETE FROM servidor
-- WHERE matricula = '123456';