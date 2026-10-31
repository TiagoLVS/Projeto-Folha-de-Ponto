# Folha de Ponto — UnDF

Cadastro de servidores com CPF, importação Excel em duas etapas, recebimento de PDFs, identificação por página, conferência, calendário acadêmico, geração institucional de folhas e envio SMTP com histórico. Frontend React/Next.js e FastAPI utilizam PostgreSQL e arquivos no servidor para reconstruir o histórico em qualquer navegador.

Novos PDFs gerados usam nomes como `Ana_Silva-2026-10.pdf`: somente nome e competência. Versões e homônimos permanecem em pastas distintas; no ZIP, nomes repetidos ficam em subpastas para evitar sobrescritas. O mesmo nome é utilizado no download, no ZIP e no anexo do e-mail. Documentos antigos conservam seus nomes no armazenamento; ao enviar por e-mail, o anexo também recebe nome do servidor e competência, mesmo que o arquivo original tenha ID/UUID.

## Pré-requisitos

- Python 3.12+ e `venv`/pip.
- Node.js 22.13+ (recomendado 24) e pnpm 11.25.0.
- PostgreSQL 17+ em UTF-8 (testes com 18).
- Tesseract com idioma português para PDFs digitalizados. PDFs com texto digital utilizam primeiro esse conteúdo.
- Linux/Bash, `setsid`, `flock` e `sha256sum` para `iniciar.sh`. Em outros sistemas, use os comandos separados abaixo.

A instalação do projeto requer essas dependências. O acesso à interface é feito pelo navegador. LibreOffice não é necessário na aplicação: os PDFs são desenhados com PyMuPDF. `.xls` de servidores usa a dependência explícita `xlrd`; calendário continua `.xlsx`.

## Preparar banco e ambiente

Na pasta que contém `backend/`, `frontend/` e `iniciar.sh`, crie `.env` a partir de `.env.example` e `frontend/.env.local` a partir de `frontend/.env.local.example`, **somente se ainda não existirem**. Configure DB_HOST, DB_PORT, DB_NAME, DB_USER e DB_PASSWORD. `BACKEND_URL` do frontend aponta normalmente para `http://127.0.0.1:8000`.

Banco **novo e vazio**, usando o usuário proprietário:

```bash
psql -h localhost -U SEU_USUARIO -d SEU_BANCO -v ON_ERROR_STOP=1 --single-transaction -f database/folha_pontos.sql
```

Banco **existente**: faça backup com `pg_dump -Fc` e copie também `data/folhas/`. Aplique somente as migrações, nesta ordem:

```bash
psql -h localhost -U SEU_USUARIO -d SEU_BANCO -v ON_ERROR_STOP=1 -f database/migrations/001_idempotency_request.sql
psql -h localhost -U SEU_USUARIO -d SEU_BANCO -v ON_ERROR_STOP=1 -f database/migrations/002_atualizacao_calendario.sql
psql -h localhost -U SEU_USUARIO -d SEU_BANCO -v ON_ERROR_STOP=1 -f database/migrations/003_integracao_sistema.sql
psql -h localhost -U SEU_USUARIO -d SEU_BANCO -v ON_ERROR_STOP=1 -f database/migrations/004_refinamentos.sql
psql -h localhost -U SEU_USUARIO -d SEU_BANCO -v ON_ERROR_STOP=1 -f database/migrations/005_envio_modelos.sql
psql -h localhost -U SEU_USUARIO -d SEU_BANCO -v ON_ERROR_STOP=1 -f database/migrations/006_dados_funcionais_servidor.sql
```

O SQL completo é exclusivo para instalações novas. As migrações preservam cadastros, CPF nulo legado, folhas, envios, calendário e modelos gerados. O script de inicialização **não aplica SQL automaticamente**. Detalhes e verificação em [Alterações do banco](ALTERACOES-BANCO.md).

## Iniciar

```bash
bash iniciar.sh
```

O script cria o ambiente Python, instala dependências quando o arquivo de requisitos muda, atualiza dependências frontend quando necessário, verifica banco/migração, avisa sobre Tesseract e inicia os serviços. Falha do uvicorn é exibida; quando um serviço termina, o outro é encerrado. Ctrl+C encerra somente os grupos de processos criados pelo script.

Se o banco estiver desatualizado, o script informa quais migrações faltam. No terminal interativo, pede autorização antes de aplicá-las. Após backup, você também pode autorizar explicitamente:

```bash
bash iniciar.sh --migrar
```

Isso aplica somente as migrações pendentes, sem recriar o banco. Jornadas incompatíveis com 20h/40h interrompem a migração e precisam de correção manual. Sem confirmação ou `--migrar`, o banco não é alterado. Para apenas diagnosticar dependências e banco:

```bash
bash iniciar.sh --verificar
```

A reinicialização após Ctrl+C aceita conexões antigas em TIME_WAIT; isso não indica um servidor ativo. Portas realmente ocupadas são informadas sem encerrar processos existentes. Para escolher outras portas, execute `BACKEND_PORT=8001 FRONTEND_PORT=5174 bash iniciar.sh`; o proxy acompanha automaticamente a porta do backend. As URLs só são exibidas como prontas depois que ambos os serviços responderem.

Frontend: http://localhost:5173. Backend: http://127.0.0.1:8000. Swagger: http://127.0.0.1:8000/docs.

Para iniciar separadamente:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.api:app --port 8000
```

Em outro terminal:

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

## Uso

- **Servidores:** carga horária selecionável de **20h ou 40h**, acumulação **Sim/Não**, cadastro/edição com CPF de 11 dígitos, aceitando máscara. Cadastro novo exige CPF; legados sem CPF permanecem editáveis. CPF e matrícula são únicos. Busca aceita nome, matrícula e CPF. Exclusão de servidor com vínculos retorna 409.
- **Importar Excel:** `.xls` ou `.xlsx`, até 15 MB, com Nome, Matrícula, CPF, E-mail, Carga Horária e Acumula cargo (Sim/Não). Departamento não é obrigatório. A prévia não altera cadastros; a confirmação usa token de 15 minutos e Idempotency-Key. `20h`/`40h` viram inteiros; Sim/Não/Nao viram booleanos. Matrícula identifica atualizações e CPF de outra matrícula é conflito.
- **Folhas recebidas:** até 20 PDFs por lote na interface, com servidor/competência por arquivo e resultado individual. Somente PDF com MIME application/pdf, assinatura e conteúdo válidos, até 15 MB por arquivo. Falha de um item não cancela os demais. JPG/PNG não são aceitos no fluxo atual.
- **Duplicidade:** sem autorização, retorna 409. Substituir preserva a revisão anterior como `_OLD_AAAAMMDD-HHMMSS.pdf` e cria outra folha em revisão, sem confirmação ou envio herdado. O original ativo fica em `data/folhas/Folhas_AAAA-MM/Nome_do_servidor-AAAA-MM.pdf`.
- **Histórico:** folhas, resultados de OCR, confirmação e último envio vêm do servidor. Folhas antigas sem vínculo podem ser conferidas na seção de pendentes. Remover uma folha retira-a do histórico ativo e preserva arquivo/histórico de revisão.
- **PDF multipágina:** processar identifica cada página isoladamente. Candidatas, duplicidades e páginas ainda não importadas persistem no banco e aparecem na interface. Importe cada página com vínculo conferido; substituir exige nova autorização. O PDF completo permanece preservado.
- **Calendário:** visualização mensal, filtros, CRUD e importação `.xlsx` com Data e Especificação ou **PDF**. PDF digital usa texto; páginas escaneadas usam Tesseract automaticamente. A prévia PDF exige conferência/confirmar antes de gravar datas; relatório com página, origem e inválidos. Para trocar um calendário inteiro, selecione o ano e marque **Substituir calendário de AAAA** antes de enviar o arquivo; confira a prévia e confirme a substituição. Outros anos e PDFs existentes são preservados. O contrato único é `/datas-especiais`.
- **Gerar folhas:** botão **Gerar folhas** na área principal. Escolha competência/professores, gere individualmente ou em lote de **até 500**, autorize novas versões e consulte/baixe PDF ou ZIP do histórico. Servidores com PDF já gerado na competência saem da seleção e continuam no histórico para download; outra versão exige a opção explícita. O modelo `institucional-v1` segue o DOCX de referência e não imprime CPF. UA, cargo, padrão, função e exercício ficam vazios quando não possuem fonte no cadastro. Departamento não é usado como UA.
- **Modelos em branco por e-mail:** em Gerar folhas, use **Enviar todas por e-mail** e confirme o lote. Cada servidor recebe sua versão mais recente da competência, com progresso, histórico e reenvio de falhas, sem abrir os PDFs e sem OCR. Exige migração 005 e SMTP configurado.
- **Envios de folhas recebidas:** checkbox individual, seleção de aptos e filtro dos ainda não enviados. O backend exige vínculo, confirmação, OCR OK, arquivo presente e e-mail válido. O histórico permite filtrar nome/matrícula/CPF/status/competência e selecionar erros para reenvio idempotente.
- **Uso compartilhado:** cada sessão adquire um lease PostgreSQL, renovado periodicamente. Outro cliente mantém consultas e tem mutações bloqueadas; o lease expira se a sessão desaparecer. O UUID da sessão não é autenticação.

## SMTP

Compatibilidade Gmail: `DIGEP_EMAIL` e `DIGEP_SENHA_APP` continuam funcionando. Para servidor institucional:

```env
SMTP_HOST=smtp.exemplo.com
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_USER=conta@exemplo.com
SMTP_PASSWORD=senha_configurada_localmente
DIGEP_EMAIL=remetente@exemplo.com
DIGEP_MODO_TESTE=true
```

Use `ssl`/465 ou `starttls`/587 conforme o provedor. SMTP_USER/SMTP_PASSWORD vazios usam as credenciais antigas. `DIGEP_MODO_TESTE=true` envia **de verdade** ao remetente; não é uma simulação. Confirmar uma folha recebida tenta enviar automaticamente; gerar um modelo em branco não envia. Senhas ficam apenas no `.env`, fora do versionamento. Reinicie o backend ao alterar configuração.

## Testes e documentação

```bash
python -m unittest discover -s tests -v
cd frontend
pnpm test
pnpm exec tsc --noEmit --incremental false
pnpm lint
pnpm build
```

Para integração/migrações, configure `FOLHA_TEST_DSN` com um banco de testes. A CI instala Tesseract/português antes dos testes, sem baixar modelos durante sua execução. Os testes criam/removem schemas exclusivos; sem a variável, essa parte é explicitamente ignorada. Testes SMTP usam simulações e não enviam mensagens reais. A CI executa Python/PostgreSQL, frontend, TypeScript, lint e build.

- [Integração do frontend](../frontend/INTEGRACAO-FRONTEND.md)
- [Banco e migrações](ALTERACOES-BANCO.md)
- [Upload, versões e OCR](FLUXO-DOCUMENTOS.md)
- [Contrato de envio e histórico](API-ENVIO.md)
- [Calendário e modelo institucional](CALENDARIO-GERACAO.md)
- [Relatório desta integração](RELATORIO-INTEGRACAO.md)

## Refinamentos e limites

O backend publica os limites em GET /folhas/configuracao. Configure MAX_GENERATION_BATCH=500, MAX_GENERATED_DOWNLOAD_BATCH=500 e MAX_GENERATED_ZIP_BYTES=262144000 no .env. ZIP padrão: 500 arquivos e 250 MiB; geração sequencial tem resultados individuais, sem carregar o lote de PDFs em RAM. A interface não trunca silenciosamente seleções acima do limite. Prazos de geração/ZIP/OCR estão em [Calendário e geração](CALENDARIO-GERACAO.md).

Bancos existentes também precisam da **004_refinamentos.sql**. Ela lista jornadas antigas incompatíveis e interrompe sem converter/apagar dados. Corrija manualmente com base nos dados corretos e reaplique. Valores NULL legados são preservados; cadastros novos exigem 20h/40h. [Relatório dos refinamentos](RELATORIO-REFINAMENTOS.md).

## Dados funcionais dos servidores

A migração `006_dados_funcionais_servidor.sql` acrescenta UA, Cargo, Padrão, Função e Exercício, todos opcionais. Após backup, `bash iniciar.sh --migrar` aplica as migrações pendentes. O banco local não é modificado apenas por atualizar o código.

Esses campos ficam em **Adicionar professor / Editar professor → Dados funcionais** e alimentam o cabeçalho de novos PDFs. Departamento e Exercício são informações independentes. PDFs anteriores preservam o conteúdo e o cadastro utilizado na geração.

A importação aceita a planilha de seis colunas anterior e a nova de onze colunas. Colunas opcionais ausentes preservam os dados existentes; quando a coluna estiver presente, célula vazia limpa o campo. Os valores aparecem na prévia antes da confirmação. A matrícula continua identificando o cadastro; um CPF já associado a outra matrícula é informado como conflito, sem criar duplicata.

## Conectar e-mail no modo real

Com `DIGEP_MODO_TESTE=false`, o sistema pede a conta de envio e a senha de aplicativo/SMTP na abertura. A conexão é individual por computador/perfil, persiste até usar **Desconectar e-mail** e pode ser encerrada pela barra. O modo de teste mantém a configuração anterior. Credenciais são salvas cifradas no banco; o navegador guarda somente o identificador do cliente. Aplique a migração 007 com `bash iniciar.sh --migrar`.

O responsável configura host, porta e TLS do SMTP na instalação central. Em rede, disponibilizar o frontend por HTTPS antes de conectar contas; `localhost` continua permitido para uso local. [Detalhes e configuração](CONTA-EMAIL.md).
