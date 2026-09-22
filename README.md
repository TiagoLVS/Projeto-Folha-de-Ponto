# Sistema de Gestão de Folhas de Ponto — UnDF

Aplicação para cadastrar professores, importar planilhas, reconhecer matrícula e competência em folhas de ponto e enviar os documentos por e-mail.

## Estrutura

- `backend/`: API FastAPI, acesso ao PostgreSQL, OCR e envio SMTP.
- `frontend/`: React/TypeScript, Vinext/Vite e rotas intermediárias para a API.
- `database/`: schema completo e migrações para bancos existentes.
- `data/entrada/`: exemplos de planilhas e documentos para testes manuais.
- `data/folhas/`: originais armazenados durante processamento ou conferência manual; não versionados.
- `tests/` e `frontend/tests/`: testes automatizados.
- `docs/`: contratos de documentos e envio.

## Pré-requisitos

Python 3.12+, Node.js 22.13+ (CI usa 24), pnpm na versão de `frontend/package.json`, PostgreSQL e Tesseract com o idioma português.

No Ubuntu/Debian, instale as ferramentas necessárias:

```bash
sudo apt install python3-venv postgresql postgresql-client tesseract-ocr tesseract-ocr-por
```

Node.js e pnpm devem estar disponíveis no terminal. Confira o idioma do OCR com `tesseract --list-langs`: a lista deve incluir `por`.

## Banco e variáveis de ambiente

Execute os comandos a seguir na raiz deste repositório, onde estão `backend/` e `frontend/`.

Crie um usuário e um banco para a aplicação (exemplo local; escolha uma senha ao ser solicitado):

```bash
sudo -u postgres createuser --pwprompt folha_app
sudo -u postgres createdb --owner=folha_app folha_pontos
```

Copie os exemplos **somente se seus arquivos de configuração ainda não existirem**, para preservar suas credenciais:

```bash
cp .env.example .env
cp frontend/.env.local.example frontend/.env.local
```

Edite `.env` com `DB_NAME=folha_pontos`, `DB_USER=folha_app`, `DB_PASSWORD` e os demais dados de conexão. `TESSERACT_CMD` pode ficar vazio quando o executável estiver no PATH. `OCR_LANG=por` seleciona português. O frontend usa `BACKEND_URL=http://127.0.0.1:8000`.

Para um **banco novo e vazio**, crie as tabelas:

```bash
psql -h localhost -U folha_app -d folha_pontos -v ON_ERROR_STOP=1 -f database/folha_pontos.sql
```

Para um **banco já existente**, aplique somente a migração de idempotência:

```bash
psql -h localhost -U folha_app -d folha_pontos -v ON_ERROR_STOP=1 -f database/migrations/001_idempotency_request.sql
```

A migração adiciona `idempotency_request` sem recriar professores, competências, folhas ou envios. Não execute o schema completo sobre um banco já inicializado.

O limite padrão é 15 MB (`MAX_UPLOAD_BYTES=15728640`), igual ao da interface. Se mudar o limite no backend, ajuste também a validação do frontend. `CORS_ORIGINS` aceita origens separadas por vírgula; a origem local padrão é `http://localhost:5173`.

## Iniciar o backend

No primeiro terminal:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.api:app --reload --port 8000
```

Se você já usa um ambiente virtual, pode ativá-lo e reutilizá-lo. No Windows, a ativação é `.venv\Scripts\Activate.ps1` no PowerShell. A documentação da API fica em http://localhost:8000/docs.

## Iniciar o frontend

No segundo terminal:

```bash
cd frontend
npx pnpm@11.25.0 install --frozen-lockfile
npx pnpm@11.25.0 dev
```

Abra http://localhost:5173 ou o endereço mostrado no terminal. Mantenha ambos os serviços em execução.

## Uso e envio de e-mail

Professores são carregados do PostgreSQL e podem ser cadastrados/editados, inclusive com carga horária. A importação aceita apenas `.xlsx`, com as colunas dos exemplos em `data/entrada/`; o endpoint está disponível em `/docs`.

Documentos PDF/JPG/PNG podem ser processados por OCR ou vinculados manualmente. A confirmação grava professor, competência e status no banco. Prévias e histórico visual ainda dependem do cache do navegador; não há sincronização completa dos documentos entre dispositivos.

Para enviar e-mails, configure `DIGEP_EMAIL` e `DIGEP_SENHA_APP`. Com `DIGEP_MODO_TESTE=true`, os e-mails são enviados **de verdade**, mas ao remetente configurado. Nenhum e-mail é enviado durante os testes automatizados.

O envio é síncrono. Cada lote exige `Idempotency-Key`; repetir a mesma chave e conteúdo recupera o resultado sem reenviar. Leia [o contrato de envio](docs/API-ENVIO.md) para os casos de timeout e envio parcial e [o fluxo de documentos](docs/FLUXO-DOCUMENTOS.md) para persistência e limitações.

## Verificação

```bash
python -m unittest discover -s tests -v
cd frontend
pnpm test
pnpm exec tsc --noEmit --incremental false
pnpm lint
pnpm build
```

Os testes reais de banco precisam de `FOLHA_TEST_DSN`, por exemplo `host=localhost dbname=folha_test user=folha_test password=...`. Use um banco de testes: cada caso cria e remove um schema exclusivo. Sem essa variável, esses testes são ignorados explicitamente.

O GitHub Actions executa os testes Python com PostgreSQL, testes do frontend, TypeScript, lint e build em pushes e pull requests. O OCR nos testes é simulado ou testa o extrator textual; não avalia a precisão do Tesseract em documentos reais.

Relatórios gerados (`relatorio_erros.xlsx`), caches e credenciais ficam fora do versionamento. Os arquivos de `data/entrada/` foram mantidos como exemplos; não coloque documentos reais de professores nessa pasta versionada.
