# Ponto Docente — UnDF

Frontend em Next.js App Router, React, TypeScript, Tailwind CSS e os componentes Shadcn já presentes em `components/ui/`.

## Executar

Requer Node.js 22.13+ e pnpm conforme `package.json`.

```bash
cd frontend
npx pnpm@11.25.0 install --frozen-lockfile
```

Copie `.env.local.example` para `.env.local` e configure `BACKEND_URL`. No Git Bash:

```bash
cp .env.local.example .env.local
npx pnpm@11.25.0 dev
```

Acesse http://localhost:5173. Para produção, use `pnpm build` e `pnpm start`.
Os scripts `dev:hosting` e `build:hosting` conservam o caminho Vinext/Vite do projeto original. O fluxo padrão utiliza Next.js diretamente.

## Entrega e compatibilidade

Este pacote contém **somente frontend**. Substitua a pasta `frontend/` do trabalho pelos arquivos deste pacote. Preserve seu `.env.local` e reinstale as dependências. Não copie `node_modules` de outra máquina.

Os quatro CSS globais e os componentes base em `components/ui/` foram preservados integralmente. Os módulos usam as classes existentes `floating-nav`, `workspace`, `table-card`, `send-dialog`, `edit-sheet`, `upload-dropzone`, `identified-panel` e os tokens globais. Não há arquivo de CSS novo.

**O backend recebido ainda não oferece todas as APIs necessárias.** Cadastro/edição de servidores e envio em lote mantêm os endpoints atuais. Histórico remoto, download, exclusões, upload com substituição segura, OCR por ID, importação em duas etapas sem CPF, calendário, logs de e-mail e lock precisam dos contratos descritos em [INTEGRACAO-FRONTEND.md](INTEGRACAO-FRONTEND.md). Recursos sem integração apresentam erro real; não gravam dados fictícios no navegador.

A importação antiga `/servidores/importar` exige CPF e já grava no banco. Ela não é chamada por esta interface, pois não permite pré-visualização sem efeitos colaterais. Não é possível remover a obrigatoriedade de CPF no backend alterando apenas o frontend.

O schema PostgreSQL recebido permite somente `OK`, `REVISAR` e `ERRO` em `status_ocr`. Por isso a aptidão usa **`OK`**, com vínculo confirmado e destinatário cadastrado. O espaço literal `' '` do pedido é incompatível com esse schema. Se o backend passar a usar outro valor, configure `NEXT_PUBLIC_VALIDATED_OCR_STATUS` e recompile. O valor nunca é convertido com `trim()`.

Sem confirmação da disponibilidade de rede, alterações ficam bloqueadas. Um endpoint de lock ausente gera o aviso de disponibilidade, não uma alegação de que outro usuário está usando o sistema. O alerta de outro usuário aparece somente com `locked: true` ou HTTP 423. Consulte o contrato de lock antes de integrar o pacote ao backend.

## Arquivos completos por melhoria

Todos os caminhos abaixo são relativos à raiz do trabalho e todos os arquivos estão completos no ZIP.

| Tópico | Interface | Clientes em `frontend/lib/` e rotas |
| --- | --- | --- |
| 1. PDFs múltiplos e sobrescrita | `frontend/components/timesheet-upload.tsx`, `frontend/components/confirmation-dialog.tsx`, `frontend/components/document-sheet.tsx` | `frontend/lib/timesheet-api.ts`, `frontend/app/api/timesheets/upload/route.ts` |
| 2. Excel sem CPF | `frontend/components/server-import-dialog.tsx` | `frontend/lib/server-import-api.ts`, `frontend/app/api/servers/import/preview/route.ts`, `frontend/app/api/servers/import/confirm/route.ts` |
| 3. Servidores e histórico remoto | `frontend/components/ponto-app.tsx`, `frontend/components/document-sheet.tsx` | `frontend/lib/professor-api.ts`, `frontend/lib/timesheet-api.ts`, `frontend/app/api/servers/[id]/route.ts`, `frontend/app/api/timesheets/route.ts`, `frontend/app/api/timesheets/[id]/route.ts`, `frontend/app/api/timesheets/[id]/file/route.ts` |
| 4. Calendário acadêmico | `frontend/app/calendario/page.tsx`, `frontend/components/academic-calendar.tsx` | `frontend/lib/calendar-api.ts`, `frontend/app/api/calendar/route.ts`, `frontend/app/api/calendar/[id]/route.ts` |
| 5. Seleção e histórico de e-mails | `frontend/components/ponto-app.tsx`, `frontend/app/emails/page.tsx`, `frontend/components/email-history.tsx` | `frontend/lib/send-sheets.ts`, `frontend/lib/email-api.ts`, `frontend/app/api/timesheets/send/route.ts`, `frontend/app/api/emails/route.ts`, `frontend/app/api/emails/retry/route.ts` |
| 6. Lock global | `frontend/app/layout.tsx`, `frontend/components/system-lock.tsx` | `frontend/lib/network-lock.ts`, `frontend/lib/api-client.ts`, `frontend/lib/backend-proxy.ts`, `frontend/app/api/system/lock/route.ts` |

`frontend/app/page.tsx` compõe `PontoApp`. `frontend/lib/ponto.ts` contém os tipos compartilhados. O histórico usa consultas remotas sem cache HTTP e não lê IndexedDB. O módulo antigo `document-storage.ts` foi removido; seu uso não é necessário. Documentos antigos guardados somente em IndexedDB não são migrados automaticamente nem apagados; recupere seus originais antes de limpar o navegador.

## Comportamento

- Upload seleciona até 20 PDFs por lote, com limite de 15 MB por arquivo. Extensão, MIME declarado e assinatura `%PDF-` são verificados. Cada linha permite escolher servidor e competência; combinações repetidas no mesmo lote são rejeitadas. Falhas parciais são mostradas por arquivo e os sucessos não são reenviados.
- Antes de sobrescrever, a tela consulta o histórico remoto e abre AlertDialog. Um conflito HTTP 409 posterior também exige confirmação. Não há exclusão antecipada do arquivo antigo.
- Importação mostra novos, atualizados e ignorados. O token de prévia e a chave de idempotência são mantidos para confirmação; a prévia expirada deve ser refeita. CPF não aparece em formulário, tabela ou filtro.
- Exclusão de servidor/folha só atualiza a tela após o DELETE remoto. Falhas preservam o registro exibido.
- Checkbox seleciona apenas servidores aptos na competência. O envio relê folhas e servidores antes do POST. “Aptos ainda não enviados” exclui e-mails `ENVIADO`/`PROCESSANDO`, e não inclui folhas ausentes ou sem validação.
- Histórico de e-mails filtra por nome, matrícula, status e competência; reenvio de erros é confirmado e usa IDs específicos dos logs filtrados. O backend revalida a aptidão e evita duplicatas.
- Lock é consultado a cada 10 segundos e ao voltar à aba. A lib compartilhada bloqueia mutações quando a rede está indisponível/bloqueada. Isso complementa, mas não substitui, a exclusão mútua e a autenticação do backend.

## Verificação

```bash
npx pnpm@11.25.0 test
npx pnpm@11.25.0 exec tsc --noEmit --incremental false
npx pnpm@11.25.0 lint
npx pnpm@11.25.0 build
```

Há dois testes essenciais com transporte simulado: histórico remoto + envio validado, e rejeição de folha/arquivo inválido + conflito/lock. Eles não enviam e-mails reais. Os contratos novos não foram testados contra PostgreSQL, pois seus endpoints não existem no backend fornecido.
