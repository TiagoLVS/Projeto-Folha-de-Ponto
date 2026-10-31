-- Adiciona os dados funcionais sem alterar cadastros ou documentos anteriores.
BEGIN;
DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migration WHERE versao='005_envio_modelos') THEN
        RAISE EXCEPTION 'Aplique primeiro a migração 005_envio_modelos.sql';
    END IF;
    ALTER TABLE servidor ADD COLUMN IF NOT EXISTS ua VARCHAR(200);
    ALTER TABLE servidor ADD COLUMN IF NOT EXISTS cargo VARCHAR(200);
    ALTER TABLE servidor ADD COLUMN IF NOT EXISTS padrao VARCHAR(200);
    ALTER TABLE servidor ADD COLUMN IF NOT EXISTS funcao VARCHAR(200);
    ALTER TABLE servidor ADD COLUMN IF NOT EXISTS exercicio VARCHAR(300);
    INSERT INTO schema_migration(versao) VALUES('006_dados_funcionais') ON CONFLICT DO NOTHING;
END $migration$;
COMMIT;
