-- Histórico compartilhado de e-mails: recebidas e modelos gerados, sem apagar registros.
BEGIN;
DO $migration$
BEGIN
    IF to_regclass('schema_migration') IS NULL OR NOT EXISTS(SELECT 1 FROM schema_migration WHERE versao='004_refinamentos') THEN
        RAISE EXCEPTION 'Aplique 004 antes de 005';
    END IF;
    IF EXISTS(SELECT 1 FROM schema_migration WHERE versao='005_envio_modelos') THEN
        IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='envio' AND column_name='id_documento' AND data_type='bigint')
           OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='envio'::regclass AND conname='ck_envio_origem') THEN
            RAISE EXCEPTION '005 marcada, mas estrutura incompatível';
        END IF;
        RETURN;
    END IF;
    ALTER TABLE envio ALTER COLUMN id_folha DROP NOT NULL;
    ALTER TABLE envio ADD COLUMN id_documento BIGINT;
    ALTER TABLE envio ADD CONSTRAINT fk_envio_documento FOREIGN KEY(id_documento) REFERENCES folha_gerada(id_documento) ON DELETE RESTRICT;
    ALTER TABLE envio ADD CONSTRAINT ck_envio_origem CHECK(num_nonnulls(id_folha,id_documento)=1);
    CREATE INDEX idx_envio_documento_recente ON envio(id_documento,id_envio DESC);
    CREATE UNIQUE INDEX uq_envio_documento_pendente ON envio(id_documento,lower(email_destino))
        WHERE id_documento IS NOT NULL AND status_envio='PENDENTE';
    INSERT INTO schema_migration(versao) VALUES('005_envio_modelos');
END $migration$;
COMMIT;
