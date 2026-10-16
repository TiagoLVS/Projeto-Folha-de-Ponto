-- Para bancos existentes. Não recria as tabelas de professores/folhas.
BEGIN;
CREATE TABLE IF NOT EXISTS idempotency_request (
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
COMMIT;
