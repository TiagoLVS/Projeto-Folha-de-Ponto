-- Requer 003. Não corrige nem apaga dados legados automaticamente.
BEGIN;
DO $migration$
DECLARE pendentes TEXT;
BEGIN
    IF to_regclass('schema_migration') IS NULL OR NOT EXISTS(SELECT 1 FROM schema_migration WHERE versao='003_integracao') THEN
        RAISE EXCEPTION 'Aplique 003 antes de 004';
    END IF;
    SELECT string_agg(format('id=%s matrícula=%s carga=%s',id_servidor,matricula,carga_horaria), '; ' ORDER BY id_servidor)
        INTO pendentes FROM servidor WHERE carga_horaria IS NOT NULL AND carga_horaria NOT IN (20,40);
    IF pendentes IS NOT NULL THEN
        RAISE EXCEPTION 'Cargas horárias incompatíveis. Confira e corrija manualmente antes de migrar: %', pendentes;
    END IF;
    IF EXISTS(SELECT 1 FROM schema_migration WHERE versao='004_refinamentos') THEN
        IF to_regclass('importacao_calendario_preview') IS NULL OR NOT EXISTS(
            SELECT 1 FROM pg_constraint WHERE conrelid='servidor'::regclass AND conname='ck_servidor_carga_horaria'
            AND pg_get_constraintdef(oid) LIKE '%ARRAY[20, 40]%'
        ) THEN RAISE EXCEPTION '004 marcada, mas estrutura incompatível'; END IF;
        RETURN;
    END IF;
    ALTER TABLE servidor DROP CONSTRAINT ck_servidor_carga_horaria;
    ALTER TABLE servidor ADD CONSTRAINT ck_servidor_carga_horaria CHECK(carga_horaria IS NULL OR carga_horaria IN (20,40));
    CREATE TABLE importacao_calendario_preview (
        token UUID PRIMARY KEY,
        nome_arquivo VARCHAR(255) NOT NULL,
        sha256 CHAR(64) NOT NULL,
        registros JSONB NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expira_em TIMESTAMPTZ NOT NULL,
        confirmado_em TIMESTAMPTZ,
        resultado JSONB
    );
    CREATE INDEX idx_calendario_preview_expiracao ON importacao_calendario_preview(expira_em);
    INSERT INTO schema_migration(versao) VALUES('004_refinamentos');
END $migration$;
COMMIT;
