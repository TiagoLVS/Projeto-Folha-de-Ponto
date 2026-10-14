# Ponto Docente — UnDF

Frontend React + TypeScript com Vinext/Vite e estrutura App Router compatível com Next.js.

## Executar localmente

Requer Node.js 22.13+ e pnpm, na versão especificada em `package.json`.

```bash
cd frontend
npx pnpm@11.25.0 install --frozen-lockfile
npx pnpm@11.25.0 dev
```

Abra o endereço indicado no terminal (normalmente http://localhost:5173).

O backend FastAPI precisa estar disponível em http://127.0.0.1:8000. Copie `.env.local.example` para `.env.local` se ainda não existir. Para outro endereço, ajuste `BACKEND_URL` nesse arquivo. Na raiz do projeto, com o ambiente Python ativado:

```bash
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.api:app --reload --port 8000
```

Configure o `.env` da raiz com os dados do PostgreSQL, conforme `.env.example`. O banco deve conter as tabelas de `database/folha_pontos.sql`.

## Persistência e documentos

Professores são listados, cadastrados e editados no PostgreSQL. A confirmação/correção de professor e competência de uma folha também é salva no backend. Prévias e histórico local das folhas recebidas permanecem no IndexedDB; não há sincronização desse histórico entre dispositivos. O calendário e o novo histórico dos modelos gerados são carregados do PostgreSQL e independem desse cache.

Consulte [o fluxo de documentos](../docs/FLUXO-DOCUMENTOS.md) para os contratos dos endpoints, limites e comandos de teste, e [a integração de envio](../docs/API-ENVIO.md) para o envio de e-mail.

O envio é síncrono e informa quantas mensagens foram enviadas. O limite de documento é 15 MB. Para verificar: `pnpm test`, `pnpm exec tsc --noEmit --incremental false`, `pnpm lint` e `pnpm build`.

## Calendário e modelos gerados

A navegação possui **Calendário** (CRUD, filtros, visualização mensal e importação `.xlsx`) e **Gerar folhas** (seleção individual/lote, versões, histórico remoto e PDF/ZIP). `academic-api.ts` usa as rotas `/api/academic/...`; o proxy encaminha JSON, multipart e binários ao backend configurado em `BACKEND_URL`.

Bancos existentes precisam da migração `002_atualizacao_calendario.sql`. Leia [Calendário e geração](../docs/CALENDARIO-GERACAO.md) e [Alterações do banco](../docs/ALTERACOES-BANCO.md). O novo layout é provisório e mantém horários/assinaturas em branco. Gerar não envia e-mail.

Na raiz do repositório, `bash iniciar.sh` inicia os dois serviços após preparar o banco e os arquivos de ambiente.
