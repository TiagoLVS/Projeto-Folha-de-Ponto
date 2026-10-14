# Sistema de Gestão de Folhas de Ponto — UnDF

Aplicação para cadastrar professores, importar planilhas, reconhecer matrícula e competência em folhas de ponto, enviar os documentos por e-mail, gerenciar o calendário acadêmico e gerar modelos de folhas em PDF.

## Estrutura

- `backend/`: API FastAPI, acesso ao PostgreSQL, OCR e envio SMTP.
- `frontend/`: React/TypeScript, Vinext/Vite e rotas intermediárias para a API.
- `database/`: schema completo e migrações para bancos existentes.
- `data/entrada/`: exemplos de planilhas e documentos para testes manuais.
- `data/folhas/`: originais armazenados durante processamento ou conferência manual; não versionados.
- `tests/` e `frontend/tests/`: testes automatizados.
- `docs/`: contratos de documentos e envio.

## Pré-requisitos

Python 3.12+, Node.js 22.13+ (CI usa 24), pnpm na versão de `frontend/package.json`, PostgreSQL 17+ com banco UTF-8 (CI usa 18) e Tesseract com o idioma português.

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

Para um **banco já existente**, faça backup e aplique as migrações incrementais:

```bash
psql -h localhost -U folha_app -d folha_pontos -v ON_ERROR_STOP=1 -f database/migrations/001_idempotency_request.sql
psql -h localhost -U folha_app -d folha_pontos -v ON_ERROR_STOP=1 -f database/migrations/002_atualizacao_calendario.sql
```

A primeira migração adiciona idempotência; a segunda adiciona calendário, importações e histórico dos modelos gerados. Nenhuma recria professores, competências, folhas ou envios. Confira o procedimento de backup, pré-requisitos e verificação em [Alterações do banco](docs/ALTERACOES-BANCO.md). Não execute o schema completo sobre um banco já inicializado.

O limite padrão é 15 MB (`MAX_UPLOAD_BYTES=15728640`), igual ao da interface. Se mudar o limite no backend, ajuste também a validação do frontend. `CORS_ORIGINS` aceita origens separadas por vírgula; a origem local padrão é `http://localhost:5173`.

## Iniciar com o script

Depois de configurar os arquivos `.env` e instalar/atualizar o banco, na pasta onde está `iniciar.sh`:

```bash
bash iniciar.sh
```

O script inicia backend e frontend. Abra http://localhost:5173 (ou o endereço indicado no terminal). Use Ctrl+C para encerrar. Ele instala dependências se `.venv`/`node_modules` estiverem ausentes, mas **não cria nem migra o banco**. As instruções abaixo permitem iniciar os serviços separadamente.

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

Documentos PDF/JPG/PNG podem ser processados por OCR ou vinculados manualmente. A confirmação grava professor, competência e status no banco e tenta enviar o e-mail automaticamente. A tela informa separadamente o resultado do vínculo e do envio. Prévias e histórico visual ainda dependem do cache do navegador; não há sincronização completa dos documentos entre dispositivos.

Para enviar e-mails, configure `DIGEP_EMAIL` e `DIGEP_SENHA_APP`. Com `DIGEP_MODO_TESTE=true`, os e-mails são enviados **de verdade**, mas ao remetente configurado. Nenhum e-mail é enviado durante os testes automatizados.

O envio é síncrono. Cada lote exige `Idempotency-Key`; repetir a mesma chave e conteúdo recupera o resultado sem reenviar. Leia [o contrato de envio](docs/API-ENVIO.md) para os casos de timeout e envio parcial e [o fluxo de documentos](docs/FLUXO-DOCUMENTOS.md) para persistência e limitações.

## Calendário acadêmico e geração de PDFs

- **Calendário:** visualização mensal, seleção de dia, filtros por ano/mês/tipo, cadastro, edição e exclusão confirmada de datas especiais. Dados persistem no PostgreSQL.
- **Importar Excel:** `.xlsx` de até 15 MB, com colunas `Data` e `Especificação`. Aceita data do Excel ou texto DD/MM/AAAA. O relatório informa novos, atualizados, ignorados e inválidos, com os motivos por linha. Duplicidade usa data + especificação normalizada; reimportar preserva a classificação manual.
- **Gerar folhas:** escolha competência e de 1 a 100 professores. PDFs incluem cadastro, carga horária, dias, finais de semana e eventos do calendário, com horários/assinaturas em branco. O layout é provisório, identificado como tal; não foi encontrado modelo institucional oficial.
- **Versões e downloads:** nova versão exige autorização explícita. PDFs ficam em `data/folhas/geradas/`; metadados e cópias dos dados/eventos ficam no PostgreSQL. Histórico remoto, PDF individual e ZIP permitem recuperar documentos sem depender do navegador.
- A geração não executa OCR ou envio de e-mail e não substitui folhas recebidas. A tela de documentos mostra datas especiais da competência sem modificar os PDFs existentes.

Consulte [Calendário e geração](docs/CALENDARIO-GERACAO.md) para regras completas, exemplos, endpoints e testes manuais; [Alterações do banco](docs/ALTERACOES-BANCO.md) para schema e migração; e [Relatório da implementação](docs/RELATORIO-REQUISITO-3.3.md) para escopo e validação.

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

## Envio automático ao confirmar

Configure no `.env` da raiz:

```env
DIGEP_EMAIL=seuemail@gmail.com
DIGEP_SENHA_APP=sua_senha_de_app
DIGEP_MODO_TESTE=true
```

O código usa Gmail SMTP SSL na porta 465. A senha de app depende da verificação em duas etapas e da disponibilidade desse recurso na conta Google. Consulte https://support.google.com/accounts/answer/185833?hl=pt-BR. Reinicie o backend depois de alterar o `.env`.

Ao clicar **Confirmar e enviar e-mail**, o backend salva o vínculo e dispara a mensagem. `true` envia ao próprio remetente; use `false` para enviar ao professor cadastrado. Senhas ausentes não impedem salvar o vínculo: a tela avisa e permite tentar o envio após a configuração.

A mesma confirmação não reenvia automaticamente. Outro arquivo, professor, competência, destinatário efetivo ou mudança de modo de teste cria um novo envio. Falhas SMTP ficam registradas e exigem conferência antes de um reenvio manual pelo botão existente. A tabela `idempotency_request` deve existir; use a migração documentada acima. O envio é síncrono, sem fila.
