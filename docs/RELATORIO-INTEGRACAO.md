# Relatório da integração — Folha de Ponto UnDF

> Registro da entrega anterior. Os limites de 500, calendário PDF/OCR, regra 20h/40h e migração 004 estão em [RELATORIO-REFINAMENTOS.md](RELATORIO-REFINAMENTOS.md).

Entrega local na branch atual `main`, sem commit/push e sem descartar alterações. O estado inicial foi conferido com `git status`. Nenhuma migração foi aplicada ao banco do usuário; nenhuma mensagem de e-mail real foi enviada. Os testes utilizaram PostgreSQL 18 descartável e arquivos temporários.

## 1. Causas corrigidas

- Testes frontend importavam `registerDocument`, removido do contrato atual, e verificavam um fluxo antigo de persistência local.
- Proxies chamavam rotas inexistentes: recebimento por ID, importação em duas etapas, histórico de e-mail e lock. O calendário tinha dois clientes e um deles chamava `/calendario`, ausente no FastAPI.
- As folhas recebidas não tinham um fluxo completo de upload, histórico remoto, revisão preservada e conferência. O upsert antigo podia reutilizar uma folha sem autorização de substituição.
- A geração já existia, mas o componente não estava acessível na aplicação principal; seu PDF era provisório.
- CPF existia no banco, mas não atravessava cadastro, importação, tipos, busca e filtros. A importação precisava conservar zeros e tratar conflitos por matrícula/CPF.
- Histórico/reenvio e lease precisavam de contratos persistentes; SMTP precisava de configuração por ambiente e validação de aptidão no servidor.
- Inicialização e documentação precisavam corresponder à integração resultante.

## 2. Arquivos alterados

A relação abaixo inclui arquivos criados, modificados e removidos nesta integração. Os arquivos AGENTS.md/CLAUDE.md do frontend são gerados pelo próprio Next.js ao iniciar o servidor. As referências DOCX/XLSX fornecidas não foram alteradas.

```text
 M .env.example
 M README.md
 M backend/api.py
 M backend/database/geracao.py
 M backend/database/repository.py
 M backend/ocr/reader.py
 M backend/requirements.txt
 M backend/services/enviar_email.py
 M backend/services/ler_planilha.py
 M backend/services/modelo_folha.py
 M database/folha_pontos.sql
 M docs/ALTERACOES-BANCO.md
 M docs/API-ENVIO.md
 M docs/CALENDARIO-GERACAO.md
 M docs/FLUXO-DOCUMENTOS.md
 M docs/RELATORIO-REQUISITO-3.3.md
 M frontend/INTEGRACAO-FRONTEND.md
 M frontend/README.md
 M frontend/app/api/academic/[...path]/route.ts
 D frontend/app/api/calendar/[id]/route.ts
 D frontend/app/api/calendar/route.ts
 M frontend/app/api/system/lock/route.ts
 D frontend/app/api/timesheets/process/route.ts
 D frontend/app/api/timesheets/register/route.ts
 M frontend/app/layout.tsx
 M frontend/components/academic-calendar.tsx
 M frontend/components/document-sheet.tsx
 M frontend/components/email-history.tsx
 M frontend/components/ponto-app.tsx
 M frontend/components/server-import-dialog.tsx
 M frontend/components/sheet-generation.tsx
 M frontend/components/system-lock.tsx
 M frontend/components/timesheet-upload.tsx
 M frontend/lib/academic-api.ts
 M frontend/lib/api-client.ts
 M frontend/lib/backend-proxy.ts
 D frontend/lib/calendar-api.ts
 D frontend/lib/document-storage.ts
 M frontend/lib/email-api.ts
 M frontend/lib/ponto.ts
 M frontend/lib/professor-api.ts
 M frontend/lib/send-sheets.ts
 M frontend/lib/server-import-api.ts
 M frontend/lib/timesheet-api.ts
 M frontend/next-env.d.ts
 M frontend/tests/persistence.test.mjs
 M iniciar.sh
 M tests/test_calendario.py
 M tests/test_calendario_integracao.py
 M tests/test_enviar_email.py
 M tests/test_envio_automatico.py
 M tests/test_idempotencia_enviar_lote.py
 M tests/test_migracao_calendario.py
 M tests/test_persistencia.py
 M tests/test_uploads.py
?? backend/assets/
?? backend/models/servidor.py
?? backend/routes/emails.py
?? backend/routes/integracao.py
?? backend/services/folhas_recebidas.py
?? backend/services/idempotencia.py
?? backend/services/importacao_servidores.py
?? backend/services/lease.py
?? database/migrations/003_integracao_sistema.sql
?? docs/RELATORIO-INTEGRACAO.md
?? frontend/AGENTS.md
?? frontend/CLAUDE.md
?? frontend/app/api/system/lock/acquire/
?? frontend/app/api/system/lock/renew/
?? frontend/app/api/timesheets/[id]/pages/
?? frontend/app/api/timesheets/packages/
?? frontend/app/api/timesheets/pending/
?? frontend/components/multipage-candidates.tsx
?? frontend/components/pending-timesheets.tsx
?? frontend/lib/client-session.ts
?? frontend/lib/system-lease.ts
?? frontend/tests/integration.test.mjs
?? tests/fixtures/
?? tests/test_integracao_sistema.py
```

## 3. Endpoints e contratos

| Método / rota FastAPI | Resultado |
|---|---|
| GET /servidores | Cadastro remoto com CPF e acumulação |
| POST /servidores | Novo cadastro; CPF obrigatório |
| PUT /servidores/{id} | Edição persistida; preserva CPF NULL legado até correção |
| DELETE /servidores/{id} | 204, 404 ou 409 por vínculo protegido |
| POST /servidores/importar/preview | Validação XLS/XLSX, classificação por linha, token de 15 minutos |
| POST /servidores/importar/confirm | Somente token; chave idempotente e contadores efetivos |
| GET /folhas?id_servidor=… | Histórico ativo completo, com último envio |
| POST /folhas/upload | PDF validado, vínculo/competência, chave idempotente e conflito 409 |
| GET /folhas/{id}/arquivo | Download/preview por ID, caminho restrito ao armazenamento |
| DELETE /folhas/{id} | Arquiva a recebida sem apagar logs ou referências |
| POST /folhas/{id}/processar | Identificação isolada por página, resultados e duplicidades |
| PATCH /folhas/{id} | Confirma/corrige vínculo, persiste conferência e tenta envio automático |
| GET /folhas/pendentes | Recebidas legadas sem vínculo/competência |
| GET /folhas/pacotes | PDFs com páginas candidatas ainda não importadas |
| POST /folhas/{id}/paginas/{pagina}/importar | Extrai/importa página com autorização explícita de conflito |
| GET/POST /datas-especiais | Consulta e cadastro no calendário existente |
| PUT/DELETE /datas-especiais/{id} | Edição/exclusão persistida |
| POST /datas-especiais/importar | XLSX, relatório parcial e auditoria |
| POST /folhas/gerar e /folhas/gerar-lote | Geração existente integrada à interface |
| GET /folhas/geradas | Histórico de modelos e versões |
| GET /folhas/geradas/{id}/download | PDF gerado |
| POST /folhas/geradas/download-lote | ZIP dos modelos selecionados; operação de leitura |
| POST /folhas/enviar-lote | Envio síncrono idempotente, somente aptos |
| GET /emails/historico | Nome, matrícula, CPF, competência e status |
| POST /emails/reenviar-erros | IDs de logs ERRO, idempotência e revalidação |
| GET /sistema/lock | Estado compartilhado, considerando o cliente |
| POST /sistema/lock/adquirir e /renovar | Aquisição/renovação atômica |
| DELETE /sistema/lock | Liberação pelo holder |

As rotas Next encaminham os contratos reais e `X-Client-Id`/`Idempotency-Key`. O calendário usa exclusivamente `/api/academic` → `/datas-especiais`. Os antigos proxies de registro/processamento por arquivo, cliente `/calendario` e armazenamento IndexedDB sem uso foram retirados; não foi reintroduzido `registerDocument` para satisfazer testes antigos. Bibliotecas do processamento CLI preexistente foram preservadas.

## 4. Banco, arquivos e concorrência

O schema completo atende instalação nova. A migração 003 sucede 001/002, detecta reaplicação e é transacional. Preserva cadastros, recebidas, envios, calendário, importações e modelos/snapshots anteriores.

Adiciona atividade, revisão, tamanho/hash, atualização, confirmação e resultados por página em folha_ponto. Substitui a unicidade absoluta pelo índice único de folha **ativa** por servidor/competência. Adiciona importacao_servidor_preview e sistema_lock, índices de consulta e default institucional-v1 para novos modelos, mantendo os identificadores antigos.

Os PDFs ficam em `data/folhas/Folhas_AAAA-MM/Nome_do_servidor-AAAA-MM.pdf`. Nomes são sanitizados centralmente; o nome enviado pelo navegador não determina o caminho. Homônimos têm desambiguação por matrícula. Substituir exige o ID da revisão atual; o arquivo antigo recebe `_OLD_AAAAMMDD-HHMMSS`, e a nova linha não herda conferência/envio. Transações, locks e um registro reversível de movimentos restauram o original em falhas tratadas. Downloads abrem o arquivo sob lock de leitura, conservando a revisão correta mesmo durante substituição posterior.

CPF NULL legado não foi convertido em NOT NULL. Folhas antigas não são automaticamente declaradas conferidas. A migração SQL não reorganiza arquivos físicos existentes; a regularização ocorre ao conferir/substituir. Para aplicar no seu banco, veja [ALTERACOES-BANCO.md](ALTERACOES-BANCO.md).

## 5. Conteúdo da migração criada

Arquivo executável: [003_integracao_sistema.sql](../database/migrations/003_integracao_sistema.sql).

```sql
-- Aplicar após 001 e 002, somente no banco escolhido. Não remove dados.
BEGIN;
DO $migration$
BEGIN
    IF to_regclass('schema_migration') IS NULL OR NOT EXISTS(
        SELECT 1 FROM schema_migration WHERE versao='002_calendario'
    ) THEN RAISE EXCEPTION 'Aplique a migração 002 antes de 003'; END IF;
    IF EXISTS(SELECT 1 FROM schema_migration WHERE versao='003_integracao') THEN
        IF to_regclass('sistema_lock') IS NULL OR to_regclass('importacao_servidor_preview') IS NULL
           OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
                AND table_name='folha_ponto' AND column_name='ativo' AND data_type='boolean')
           OR to_regclass('uq_folha_ativa_servidor_competencia') IS NULL THEN
            RAISE EXCEPTION 'Migração 003 marcada, mas estrutura incompatível';
        END IF;
        RETURN;
    END IF;
    EXECUTE $ddl$
-- INTEGRAÇÃO 003: histórico remoto, revisões, importação e lease compartilhado.
ALTER TABLE folha_ponto DROP CONSTRAINT uq_folha_servidor_competencia;
ALTER TABLE folha_ponto ADD COLUMN ativo BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN versao INTEGER NOT NULL DEFAULT 1 CHECK (versao > 0),
    ADD COLUMN tamanho_arquivo BIGINT CHECK (tamanho_arquivo IS NULL OR tamanho_arquivo >= 0),
    ADD COLUMN sha256 VARCHAR(64),
    ADD COLUMN atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN confirmado_em TIMESTAMPTZ,
    ADD COLUMN resultado_paginas JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX uq_folha_ativa_servidor_competencia
    ON folha_ponto(id_servidor,id_competencia) WHERE ativo;
ALTER TABLE folha_gerada ALTER COLUMN modelo SET DEFAULT 'institucional-v1';
CREATE INDEX idx_servidor_cpf_busca ON servidor(cpf);
CREATE INDEX idx_envio_folha_recente ON envio(id_folha,id_envio DESC);
CREATE TABLE importacao_servidor_preview (
    token UUID PRIMARY KEY,
    registros JSONB NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expira_em TIMESTAMPTZ NOT NULL,
    confirmado_em TIMESTAMPTZ,
    resultado JSONB
);
CREATE INDEX idx_importacao_servidor_expiracao ON importacao_servidor_preview(expira_em);
CREATE TABLE sistema_lock (
    id INTEGER PRIMARY KEY CHECK(id=1),
    owner_token UUID,
    acquired_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);
INSERT INTO sistema_lock(id) VALUES(1);
INSERT INTO schema_migration(versao) VALUES('003_integracao');
$ddl$;
END $migration$;
COMMIT;
```

## 6. Frontend integrado

Cadastro/edição, CPF, acumulação, busca por nome/matrícula/CPF e exclusão protegida usam o servidor. Importação exibe CPF, ação e motivos antes da confirmação. Upload aceita até 20 PDFs, 15 MB cada, com vínculo e resultado individual; uma falha não cancela os demais. Conflitos exigem autorização explícita. Candidatas multipágina e pendências legadas ficam acessíveis.

O histórico vem do PostgreSQL/arquivos e foi recuperado em outra sessão do navegador. A interface inclui calendário persistente com filtros, CRUD/importação e **Gerar folhas**, com seleção individual/lote, novas versões, histórico, PDF e ZIP. A seleção de envio mantém checkboxes, aptos/ainda não enviados e contagens coerentes; histórico de e-mail oferece CPF e seleção de erros.

Cada sessão usa UUID, adquire/renova/libera lease persistente. Outro holder bloqueia mutações, preservando consulta/download. Expiração recupera sessões abandonadas. O proxy encaminha esse identificador ao FastAPI, que também verifica o lock.

## 7. Modelo institucional e referências

O DOCX `Modelo de folha de ponto - Exemplo.docx`, localizado em Downloads após sua última resposta, foi inspecionado e convertido temporariamente para comparação visual. O logotipo foi copiado do DOCX para assets do backend; os dados do professor de exemplo não foram copiados. As duas planilhas de professores também foram conferidas.

`institucional-v1` reproduz cabeçalho emoldurado, logo, universidade/CNPJ, registro/referência em português, identificação, dois turnos com assinatura/entrada/saída, observações, datas e duas assinaturas/carimbos. Nome, matrícula e carga horária vêm do cadastro. UA, cargo, padrão, função e exercício ficam presentes e vazios; departamento não é convertido em UA. CPF não aparece no PDF.

Há uma linha por dia, SÁBADO/DOMINGO e `--` nos horários. Datas especiais são incorporadas sem inventar presença. Meses de 28, 29, 30 e 31 dias cabem em uma página A4 no layout normal. Textos de eventos excepcionalmente extensos são preservados em anexo referenciado para não cortar conteúdo. A leitura de PDF digital aproveita o texto existente e reconhece REFERÊNCIA por mês em português; digitalizações mantêm Tesseract por página.

## 8. CPF, planilhas e e-mail

CPF aceita máscara, é normalizado para 11 dígitos e continua único. Novos cadastros/importações exigem CPF; legados podem completá-lo posteriormente. Matrícula identifica atualizações; CPF já ligado a outra matrícula é conflito. Leitura XLS/XLSX conserva zeros textuais e máscaras numéricas, normaliza 20h/40h e Sim/Não/Nao. `.xls` tem dependência explícita xlrd e fixture binária real. Calendário permanece XLSX.

Envio exige folha ativa, OCR OK, conferência, vínculo, arquivo existente e endereço válido. Confirmar salva primeiro e tenta SMTP depois; falha de e-mail não desfaz a conferência. Repetição da confirmação é idempotente para a mesma revisão/vínculo/destinatário. Histórico/reenvio consulta logs reais, ignora sucesso posterior e não conta falha como sucesso. SMTP aceita SSL/STARTTLS e preserva DIGEP_EMAIL/DIGEP_SENHA_APP; novas configurações estão em .env.example. Os textos informam processamento síncrono.

## 9. Testes e verificações

Backend cobre cadastro/CPF/legados, conflitos, XLS/XLSX, prévia/token/confirmação, PDF inválido/limites, upload independente, concorrência, OLD/rollback, histórico/download/exclusão, páginas/duplicidade/importação, aptidão/envio idempotente/SMTP/histórico/reenvio, lease concorrente, calendário, geração individual/lote/versão/ZIP e modelo institucional. Migrações são reaplicadas; schema novo e migrado são comparados por colunas/defaults/constraints/índices/funções/triggers. Há preservação explícita de calendário, PDFs, snapshots e registros de importação anteriores à 003.

Frontend testa os contratos atuais: CRUD remoto, CPF/busca, importação/token, validação independente de arquivos, conflito, confirmação e resultado de envio, calendário/importação, geração e downloads PDF/ZIP, seleção/envio, histórico/reenvio e lease.

| Comando | Resultado final |
|---|---|
| `.venv/bin/python -m unittest discover -s tests -v` | 79 testes aprovados; PostgreSQL 18 temporário, sem testes ignorados |
| `pnpm test` | 25 testes aprovados |
| `pnpm exec tsc --noEmit --incremental false` | Código 0 |
| `pnpm lint` | Código 0 |
| `pnpm build` | Código 0, build de produção Next.js concluído |
| `bash -n iniciar.sh` | Código 0 |
| `git diff --check` | Código 0 |

A suíte Python foi executada com FOLHA_TEST_DSN apontando exclusivamente para cluster descartável. Sem essa variável, testes de banco são explicitamente ignorados. A CI já existente em `.github/workflows/tests.yml` continua executando esses comandos com PostgreSQL 18.

Também foi executado teste real em Chromium com FastAPI, Next.js e PostgreSQL temporários: duas sessões/lease, cadastro/edição/exclusão, busca por CPF, importação prévia/confirmação, calendário/importação, geração/download PDF, upload, leitura do documento, confirmação, histórico de e-mail, liberação do lease e recuperação da folha confirmada em outra sessão. Terminou sem erros JavaScript ou HTTP 5xx. A referência DOCX e o PDF gerado foram comparados visualmente.

## 10. Inicialização e documentação

`bash iniciar.sh` cria/atualiza dependências por hash, verifica PostgreSQL/migração, avisa sobre Tesseract, expõe erros do uvicorn e encerra apenas os grupos de processos que iniciou. Não aplica SQL. README, documentação frontend, banco, recebimento, SMTP e calendário foram atualizados. Não há promessa de distribuição portátil: PostgreSQL/Python/Node e Tesseract para digitalizações continuam pré-requisitos.

## 11. Limitações reais e preparação do ambiente

- A migração 003 ainda precisa ser aplicada **por você no banco escolhido**, após backup e 001/002. A instalação real e o SMTP institucional dependem das suas configurações locais; não foram alterados/testados com credenciais reais.
- O script iniciar.sh recebeu verificação de sintaxe; o teste de navegador iniciou os serviços separadamente em portas temporárias. Não foi executado contra o seu banco real.
- O sistema continua sem autenticação. UUID/lease coordena sessões e não representa controle de acesso.
- SMTP é síncrono. Timeout ou queda após aceitação pelo provedor pode deixar entrega ambígua; idempotência não transforma SMTP em entrega exatamente uma vez. Consulte o histórico antes de reenvio manual.
- Transações SQL e movimentos de arquivos possuem compensação para exceções tratadas, mas não constituem uma transação distribuída resistente a queda abrupta do sistema operacional. Backups do banco e arquivos devem permanecer consistentes.
- Arquivos JPG/PNG legados são preservados; precisam ser reenviados como PDF para o fluxo oficial atual. A migração não converte arquivos nem inventa confirmação anterior.
- Eventos excepcionalmente extensos usam anexo; campos institucionais sem fonte confiável ficam vazios. Não há limpeza automática de tokens de importação expirados.
- OCR depende da qualidade da digitalização e pode exigir conferência manual. O teste de navegador usou PDF com texto digital; testes de leitura/identificação e processamento exercitam resultados/falhas sem depender de precisão de OCR real em documentos pessoais.
