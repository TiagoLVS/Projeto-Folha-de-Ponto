# Aplicativo Windows independente

## Arquitetura

O executável continua abrindo uma janela própria Electron. A versão web Next.js permanece disponível; somente a interface empacotada para Windows mudou.

Antes:

```text
Electron → servidor Next standalone → node_modules/.pnpm → FastAPI → PostgreSQL/OCR
```

As cópias do standalone falhavam no runner Windows com `EPERM`/`Access is denied` ao percorrer junctions de dependências pnpm. Trocar a ferramenta de cópia não eliminava essa árvore de links.

Agora:

```text
Computador principal
Electron → HTTPS privado → FastAPI + frontend React estático
                              ↓
                       PostgreSQL / OCR / Excel / PDF

Computador da equipe
Electron → HTTPS + certificado fixado → computador principal
```

O build desktop usa React/Vite e gera `windows-app/frontend-dist`. Next static export não atende sozinho aos proxies API existentes; o Vite permite manter o Next web sem levar seu servidor para o pacote. `windows-app/frontend/main.tsx` importa o mesmo `PontoApp`, providers, serviços, formulários, tabelas, ícones e folhas de estilo da web. Não existe uma cópia das telas de negócio. A navegação desktop usa hash para Professores, Folhas, Calendário e E-mails.

O transporte central `frontend/lib/api-transport.ts` mantém `/api` na mesma origem: na web, as API Routes Next encaminham a requisição; no desktop, `backend/desktop.py` adapta os caminhos para as rotas FastAPI existentes. Corpo multipart, queries, headers, status, arquivos, locks, identificação da conta e chaves de idempotência são preservados. As regras continuam no backend original. Recursos desconhecidos retornam 404, sem disfarçar assets ausentes como HTML.

## Runtimes e segurança

O principal inicia PostgreSQL 17 privado e Python 3.13 embeddable/FastAPI em loopback, com portas internas livres. O mesmo FastAPI serve HTML/JS/CSS locais. Apenas o gateway HTTPS na porta 5173 recebe conexões da rede privada. Electron 45 fornece Chromium; não há processo servidor Next, `server.js`, `.next` ou `node_modules` no frontend distribuído. A equipe acessa a interface do principal e não inicia outro PostgreSQL.

Tesseract 5.4 e `por.traineddata`, PyMuPDF e as dependências Excel/PDF continuam incluídos. A inicialização verifica banco, API, página inicial e disponibilidade do OCR português, mostrando progresso. Fechar o principal encerra seus serviços e preserva os dados no perfil Windows. O pacote extraído não executa npm, pnpm ou pip e não exige runtimes globais. Abrir a interface e usar o banco local não exige internet; SMTP exige acesso ao provedor.

Os componentes de imagem compartilhados usam imagens locais sem otimização de servidor. O desktop não importa Next nem Sharp e não possui endpoint `/_next/image`. Não há remoção de binários `.node` como contorno: Sharp pertence à instalação de build/web, não à aplicação estática. A versão web continua com sua configuração Next e dependências normais. O teste do serviço exige que `/_next/image` retorne 404 no desktop.

`contextIsolation: true`, `nodeIntegration: false` e sandbox permanecem ativos. React não recebe acesso ao sistema de arquivos ou processos. CSP e recursos locais dispensam CDN. O cliente mantém pinning SHA-256 do certificado exportado pelo principal; a validação TLS não é desabilitada globalmente. PostgreSQL usa senha aleatória protegida por safeStorage/DPAPI. A chave SMTP permanece no perfil protegido. O pacote não contém `.env`, banco real, PDFs ou credenciais da instalação de desenvolvimento.

Dados do principal: `%APPDATA%\\PontoDocenteUnDF\\principal`. O JSON de conexão contém somente URL e impressão digital. Não coloque o diretório PostgreSQL em pasta de rede. O principal precisa permanecer aberto para a equipe trabalhar. Backup/transferência seguem o LEIA-ME incluído.

## Tema visual

O padrão é **Sistema**: Windows claro → interface clara; Windows escuro → interface escura. Mudanças do sistema atualizam a interface aberta. O botão deslizante com sol e lua no cabeçalho alterna entre Claro e Escuro. O ícone de monitor ao lado restaura o tema Sistema. Apenas a preferência visual fica no localStorage do computador, sem gravar dados de negócio ou senhas ali. Cards, navegação, tabelas, calendário, campos, modais e alertas compartilham os tokens do tema. A tela inicial também acompanha o sistema.

## Gerar o pacote

Em uma máquina de build Windows x64, instale Node 24, pnpm 11.25.0, Python com pip e 7-Zip. Essas ferramentas são para montagem, não para usuários finais. Na raiz:

```powershell
pnpm --dir frontend install --frozen-lockfile
npm --prefix windows-app ci
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit --incremental false
pnpm --dir frontend lint
pnpm --dir frontend check:desktop
pnpm --dir frontend build:desktop
npm --prefix windows-app test
npm --prefix windows-app run build
```

`build.py` recompila a interface para evitar artefatos antigos, valida os arquivos, monta os runtimes, empacota Electron e, no Windows, executa os testes de serviços e janela antes do ZIP/SHA-256. `PYTHON` pode indicar o Python de build; uma `.venv` existente também é reconhecida pelo launcher. Runtimes são fixados por URL/SHA-256 em `windows-app/runtime-sha256.json`; hashes dos wheels ficam no pacote. A instalação do frontend com linker hoisted no workflow é apenas de build; não é mais necessária para copiar o standalone, pois essa cópia deixou de existir. O linker normal do desenvolvimento não foi alterado.

Saída:

```text
windows-app/release/PontoDocente-Windows-Independente-x64.zip
windows-app/release/PontoDocente-Windows-Independente-x64.zip.sha256
```

Dentro do ZIP, `PontoDocente/PontoDocente.exe` e `resources/{frontend,server,runtime}` precisam permanecer juntos. `--prepare-only` prepara a pasta sem afirmar que ela foi homologada; não produz uma nova entrega validada. Os scripts antigos de materialização do pnpm foram removidos por não terem mais chamadas.

## Validação e workflow

O workflow manual `.github/workflows/windows-app.yml` permanece em `windows-latest`. Executa testes/tipos/lint, build estático, montagem, validação do staging, testes de rede/configuração, smoke de serviços usando o Node do próprio Electron, smoke da janela real (quatro telas em ambos os temas), ZIP/SHA-256 e artifact. Qualquer falha interrompe a publicação.

`validate-frontend.cjs` exige `index.html`, JavaScript e recursos locais existentes e rejeita links, arquivos privados, Next e node_modules no frontend. O ZIP também verifica executável, backend, Python, PostgreSQL, Tesseract e idioma português. Não há resolução de next/react/react-dom no staging: React é compilado no bundle e Next deixou de ser uma dependência de execução desktop.

`smoke.cjs` usa perfil temporário e serviços reais para verificar inicialização, HTTPS, certificado errado, CRUD, PDF/download, persistência e reabertura. `smoke-gui.cjs` abre o executável em perfil descartável, com PATH limitado ao Windows, verifica setup, interface estática, tema automático/manual, formulário, reload e encerramento. Playwright é somente ferramenta de build e não entra no pacote. Não conecta SMTP. Os testes Python e frontend cobrem importações, calendário PDF/Excel, OCR, conta/e-mail, histórico, locks e idempotência sem acessar contas reais.

Verificação complementar do desenvolvimento:

```text
python -m unittest discover -s tests -v
pnpm --dir frontend build
```

Testes de repositório precisam de um PostgreSQL descartável configurado com `FOLHA_TEST_DSN`; nunca use o banco real para isso.

### Medições e limites da homologação

A interface anterior tinha 296.694.031 bytes (~283 MiB). A nova interface estática tem aproximadamente 673 mil bytes (~0,64 MiB), redução de cerca de 99,8% nessa parte. O ZIP anterior tinha 460.179.465 bytes (~439 MiB). Na montagem local, o ZIP estático ficou em aproximadamente 370 milhões de bytes (~353 MiB): redução de cerca de 86 MiB, ou 19,6%. Electron, Python, PostgreSQL e OCR continuam necessários e não foram removidos. Pequenas diferenças são esperadas conforme a compressão e a plataforma de build.

Nesta refatoração, testes Python, web, build desktop, smoke com serviços privados locais e inspeção visual em Electron Linux foram executados. Isso não equivale a executar o binário Windows. O workflow atualizado precisa ser rodado no GitHub antes de distribuir a nova versão. Homologar também duas máquinas reais, firewall, DPAPI, OCR Windows com documentos de teste, importações e envio SMTP autorizado. Não foi enviado e-mail real nem alterado o banco da instalação durante os testes. Testes visuais locais usam fixtures fictícias; os testes de serviços usam PostgreSQL descartável.

As licenças dos runtimes acompanham a distribuição. O projeto usa PyMuPDF (AGPL ou licença comercial); a mudança de frontend não altera essas obrigações.

## Encerramento e limpeza dos smoke tests

`host.stop()` compartilha uma única Promise entre chamadas concorrentes. Fecha o gateway HTTPS, encerra os processos filhos e aguarda seus eventos `close` (incluindo stdout/stderr), executa `pg_ctl -m fast -w stop`, confirma a saída do PID do postmaster e a remoção de `postmaster.pid`, e aguarda o fechamento do arquivo de log. Falhas de encerramento geram erro; não são convertidas em aviso de sucesso. No Windows, o encerramento dos serviços filhos usa `taskkill /PID ... /T /F` somente para a árvore iniciada pelo aplicativo, incluindo subprocessos OCR, sem solicitar privilégios administrativos. O PostgreSQL continua usando seu encerramento controlado próprio. Há limites finitos e confirmação de saída.

O smoke preserva todas as verificações funcionais e acrescenta a conferência dos PIDs/streams após cada encerramento. A limpeza de serviços e GUI usa `fs.promises.rm` com `recursive`, `force`, `maxRetries: 10` e `retryDelay: 250`, opções suportadas no Node 24. O retry linear é aplicado apenas aos erros transitórios reconhecidos pelo Node; `force` só tolera diretório já ausente. Não se remove o temporário enquanto um processo monitorado está ativo. Erro persistente falha o teste com caminho, limite de tentativas, processos/PIDs, arquivos restantes e causa original. Erros funcionais e de limpeza são preservados juntos em AggregateError.

Os testes de lifecycle verificam processos e streams reais, encerramento forçado controlado, PID ainda ativo, configuração do retry e falha persistente com diagnóstico. O caso de árvore de processos Windows roda no runner Windows; em Linux fica explicitamente marcado como não executado. O workflow mantém os testes de serviços e janela antes do ZIP/SHA-256 e artifact.
