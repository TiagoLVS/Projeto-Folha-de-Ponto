-- Não modifica os cadastros de servidores nem o histórico de envios.
BEGIN;
DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migration WHERE versao='006_dados_funcionais') THEN
        RAISE EXCEPTION 'Aplique primeiro a migração 006_dados_funcionais_servidor.sql';
    END IF;
    CREATE TABLE IF NOT EXISTS conta_email_cliente (
        cliente_hash CHAR(64) PRIMARY KEY,
        credenciais_cifradas TEXT NOT NULL,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO schema_migration(versao) VALUES('007_conta_email') ON CONFLICT DO NOTHING;
END $migration$;
COMMIT;
