# Entrega da refatoração desktop

1. **Causa anterior:** EPERM/Access denied ao percorrer junctions do pnpm no Next standalone. A nova montagem elimina a árvore problemática, em vez de ignorar dependências.
2. **Arquitetura:** Electron → HTTPS privado → FastAPI servindo React estático e API → PostgreSQL/OCR.
3. **Build escolhido:** Vite; Next e seus proxies continuam na versão web. Static export não substituiria os proxies existentes sozinho.
4. **Reuso:** PontoApp, providers, formulários, tabelas, calendário, geração/histórico, ícones, tipos, validações, serviços e CSS existentes. Não há uma segunda cópia da aplicação.
5. **Arquivos criados:** inventário completo abaixo.
6. **Arquivos alterados:** inventário completo abaixo.
7. **Arquivos removidos:** helpers de standalone e seus testes, listados abaixo; não possuem chamadas restantes.
8. **Carregamento:** BrowserWindow abre o HTTPS privado; FastAPI entrega HTML/JS/CSS locais. Não abre navegador externo e não inicia servidor Next.
9. **API:** transporte central conserva /api; adaptador desktop traduz os caminhos e reaproveita as rotas/regras FastAPI, preservando streams, headers, locks e idempotência.
10. **Principal:** inicia seu PostgreSQL privado, FastAPI e OCR, com progresso; dados persistem no perfil Windows.
11. **Equipe:** acessa o principal por HTTPS com pinning; não cria outro banco. O principal precisa permanecer aberto.
12. **Sistema:** padrão automático, com resposta a mudanças do tema do sistema.
13. **Claro:** aparência existente preservada, opção manual persistida localmente.
14. **Escuro:** tokens compartilhados para navegação, tabelas, calendário, campos, modais, botões e alertas; opção manual persistida localmente.
15. **Testes:** 135 Python, 44 frontend e 5 Windows app passaram; tsc e lint passaram. Smoke com runtimes Linux substitutos confirmou banco privado, API, HTTPS, certificado incorreto, cadastro/edição, PDF/download, histórico, estado de conta, persistência e reabertura. Electron Linux com sandbox verificou cinco telas, formulário e modais nos dois temas, preferência persistida e ausência de dependências externas. Nenhum SMTP real ou banco de produção foi utilizado.
16. **Web:** pnpm build concluiu com Next.js; API Routes preservadas.
17. **Desktop:** check:desktop e build:desktop concluíram; staging estático validado; pasta Windows foi empacotada. ZIP íntegro e SHA-256 conferidos.
18. **Tamanho:** frontend 296.694.031 → aproximadamente 673 mil bytes. ZIP 460.179.465 → 370.057.240 bytes (438,86 → 352,91 MiB): menos 85,95 MiB (~19,6%).
19. **Limites:** o binário Windows não pode ser executado neste Linux. É necessário rodar o workflow e homologar duas máquinas, firewall, DPAPI, OCR/importações Windows e SMTP autorizado. A montagem local é candidata, não comprovação de homologação Windows.
20. **Workflow:** atualizado em windows-latest, com validação, testes dos serviços e janela real antes de ZIP/SHA-256/artifact. Está preparado para nova execução, mas não foi disparado nesta sessão. Não houve commit ou push.

## Inventário dos fontes

### Criados

- `backend/desktop.py`
- `frontend/app/themes.css`
- `frontend/components/brand-image.tsx`
- `frontend/components/visual-theme.tsx`
- `frontend/lib/api-transport.ts`
- `frontend/lib/visual-theme.ts`
- `frontend/tests/desktop-theme.test.mjs`
- `frontend/tsconfig.desktop.json`
- `frontend/vite.desktop.config.ts`
- `tests/test_desktop.py`
- `windows-app/frontend/`
- `windows-app/scripts/archive.cjs`
- `windows-app/scripts/smoke-gui.cjs`
- `windows-app/tests/static-frontend.test.cjs`

### Alterados

- `.github/workflows/windows-app.yml`
- `.gitignore`
- `README.md`
- `docs/WINDOWS-EMPACOTAMENTO.md`
- `frontend/README.md`
- `frontend/app/globals.css`
- `frontend/app/layout.tsx`
- `frontend/components/email-account.tsx`
- `frontend/components/ponto-app.tsx`
- `frontend/components/system-lock.tsx`
- `frontend/components/ui/sonner.tsx`
- `frontend/lib/academic-api.ts`
- `frontend/lib/api-client.ts`
- `frontend/package.json`
- `windows-app/LEIA-ME.txt`
- `windows-app/app/host.cjs`
- `windows-app/app/main.cjs`
- `windows-app/app/runtime.py`
- `windows-app/app/setup.css`
- `windows-app/app/setup.html`
- `windows-app/app/setup.js`
- `windows-app/package-lock.json`
- `windows-app/package.json`
- `windows-app/scripts/build.cjs`
- `windows-app/scripts/build.py`
- `windows-app/scripts/package.cjs`
- `windows-app/scripts/smoke.cjs`
- `windows-app/scripts/validate-frontend.cjs`

### Removidos

- `windows-app/scripts/complete-frontend.cjs`
- `windows-app/scripts/copy-standalone.cjs`
- `windows-app/scripts/frontend-files.cjs`
- `windows-app/tests/standalone.test.cjs`

Este próprio relatório (`docs/ENTREGA-DESKTOP.md`) também foi criado. Diretórios novos no inventário incluem seus arquivos de entrada. Artefatos gerados em release/frontend-dist/cache permanecem ignorados pelo Git.
