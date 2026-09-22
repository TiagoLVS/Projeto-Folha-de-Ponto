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

O backend FastAPI precisa estar disponível em http://127.0.0.1:8000. Para outro endereço, configure `BACKEND_URL` no ambiente do frontend. Na raiz do projeto, com o ambiente Python ativado:

```bash
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.api:app --reload --port 8000
```

Configure o `.env` da raiz com os dados do PostgreSQL, conforme `.env.example`. O banco deve conter as tabelas de `database/folha_pontos.sql`.

## Persistência e documentos

Professores são listados, cadastrados e editados no PostgreSQL. A confirmação/correção de professor e competência de uma folha também é salva no backend. Prévias e histórico local de documentos permanecem no IndexedDB; não há sincronização desse histórico entre dispositivos.

Consulte [o fluxo de documentos](../docs/FLUXO-DOCUMENTOS.md) para os contratos dos endpoints, limites e comandos de teste, e [a integração de envio](../docs/API-ENVIO.md) para o envio de e-mail.
