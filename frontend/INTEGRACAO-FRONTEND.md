# Integração frontend ↔ FastAPI

Todas as telas utilizam o servidor. `PontoApp` carrega `/api/servers` e `/api/timesheets` e monta o histórico por professor/competência com `attachRemoteSheets`. Registros antigos incompletos são apresentados em Pendentes; PDFs multipágina têm candidatas persistentes. Não há fonte de dados demonstrativa ou IndexedDB no fluxo atual.

## Contratos

| Frontend | FastAPI |
|---|---|
| GET/POST `/api/servers` | GET/POST `/servidores` |
| PUT/DELETE `/api/servers/{id}` | PUT/DELETE `/servidores/{id}` |
| POST `/api/servers/import/preview` | POST `/servidores/importar/preview` |
| POST `/api/servers/import/confirm` | POST `/servidores/importar/confirm` |
| GET `/api/timesheets?id_servidor=...` | GET `/folhas?id_servidor=...` |
| POST `/api/timesheets/upload` | POST `/folhas/upload` |
| GET `/api/timesheets/{id}/file` | GET `/folhas/{id}/arquivo` |
| DELETE/PATCH `/api/timesheets/{id}` | DELETE/PATCH `/folhas/{id}` |
| POST `/api/timesheets/{id}/process` | POST `/folhas/{id}/processar` |
| GET `/api/timesheets/pending` | GET `/folhas/pendentes` |
| GET `/api/timesheets/packages` | GET `/folhas/pacotes` |
| POST `/api/timesheets/{id}/pages/{page}/import` | POST `/folhas/{id}/paginas/{page}/importar` |
| POST `/api/timesheets/send` | POST `/folhas/enviar-lote` |
| `/api/academic/datas-especiais...` | `/datas-especiais...` |
| `/api/academic/folhas/gerar...` e `/geradas...` | `/folhas/gerar...` e `/folhas/geradas...` |
| GET `/api/emails` | GET `/emails/historico` |
| POST `/api/emails/retry` | POST `/emails/reenviar-erros` |
| GET/DELETE `/api/system/lock` | GET/DELETE `/sistema/lock` |
| POST `/api/system/lock/acquire` | POST `/sistema/lock/adquirir` |
| POST `/api/system/lock/renew` | POST `/sistema/lock/renovar` |

`backend-proxy.ts` preserva JSON, multipart, arquivos, status 204, Idempotency-Key e X-Client-Id. `api-client.ts` utiliza o identificador de sessão e bloqueia mutações quando outro cliente possui o lease. A família acadêmica utiliza o mesmo proxy e o mesmo identificador. Os antigos contratos `registerDocument`, `/api/calendar` e o cache de documentos foram removidos após a consolidação.

## Tipos e validação

`Professor` inclui CPF normalizado/nulo legado e acumulação de cargo. Novo cadastro exige CPF; o formulário permite máscara. Busca inclui CPF e nome sem acentos. A importação exibe CPF, ação e motivo. Confirmar envia somente token e chave idempotente; o servidor revalida os dados.

`RemoteSheet` inclui ID, vínculo, competência, status OCR, tamanho, datas, confirmação, leitura, mensagem e último envio. A prévia/download usa o ID; nenhum caminho de disco é enviado pelo navegador. OCR altera a mesma folha e informa candidatas por página. Confirmação só é reconhecida com vínculo solicitado, status OK e timestamp do servidor.

`TimesheetUpload` aceita até 20 PDFs, valida cada item e permite continuar com os demais. O conflito exige confirmação; outro conflito concorrente exige nova consulta/autorização. A nova revisão recebe outro ID. A contagem de envio é formada pelos mesmos IDs enviados e revalidada remotamente antes do POST; o backend também verifica aptidão.

## Lease e erros

`SystemLock` consulta o lease, adquire/renova e tenta liberar no pagehide. Sessões usam UUID em sessionStorage; o PostgreSQL decide o holder. Lease expira após 45 segundos e é renovado a cada 10 segundos; mutações em andamento mantêm o controle até terminar. GETs continuam disponíveis. 423 indica outro holder, 409 conflito, 422 dados inválidos, 410 prévia expirada. Lease não substitui autenticação.

Testes Node exercitam os clientes/proxy e seus erros. TypeScript/lint/build verificam componentes e rotas. A homologação no navegador usa PostgreSQL temporário, sem credenciais SMTP reais.

## Refinamentos de geração, calendário e cadastro

GET `/api/academic/folhas/configuracao` retorna os limites efetivos do backend. A tela de geração consulta essa configuração, impede seleção acima do máximo e não recorta o botão Selecionar todos. Os padrões são 500 para geração/download e 250 MiB para ZIP. `academic-limits.ts` centraliza os prazos de cliente/proxy: comum 65 s, geração 900 s, ZIP 180 s e calendário 660 s.

A importação de calendário aceita `.xlsx` e `.pdf`, validando extensão, MIME e tamanho. Excel mantém gravação/relatório atuais. PDF retorna ImportReport com status PREVIA, token, válidos e detalhes com página/texto/origem/datas. A confirmação usa POST `/api/academic/datas-especiais/importar/confirm`, somente token e Idempotency-Key; resultados e falhas ficam visíveis. Rejeitar/descartar uma prévia não importa datas. OCR é executado exclusivamente no backend e reaproveita Tesseract existente.

Cadastro/edição envia workload como inteiro 20/40 e acumula_cargo como booleano, conservando CPF. Selects de jornada/acumulação ficam em duas colunas no desktop e uma no mobile. API e CHECK no PostgreSQL também rejeitam outras jornadas. Legados sem jornada podem ser listados e corrigidos; o formulário solicita uma seleção válida ao salvar.

### Substituição anual do calendário

`importCalendar` aceita a opção replaceYear, enviando modo=substituir e ano em multipart. A prévia informa modo, ano, existentes_a_remover, pode_confirmar e motivo_bloqueio. O componente solicita confirmação explícita antes de enviar o token ao endpoint de confirmação existente. O resultado mostra removidos. Excel sem essa opção mantém importação imediata; PDF normal mantém a prévia anterior. O backend bloqueia substituição com erro, arquivo vazio ou datas fora do ano e detecta mudança do calendário desde a prévia. A transação preserva outros anos e snapshots/PDFs; não há migração nova.

### E-mail dos modelos em branco

GeneratedEmailBatch usa o proxy acadêmico: GET /folhas/geradas/para-envio e POST /folhas/geradas/enviar-lote. Uma ação inicia chamadas sequenciais com um ID por chamada, chave estável e renovação do lease, progresso agregado e retomada. Prévia e validações vêm do servidor; só versões mais recentes e elegíveis são enviadas. O histórico aceita id_folha NULL quando id_documento está informado e mostra origem GERADA/RECEBIDA e destinatário. O reenvio de erros utiliza o endpoint já existente. Não é necessário executar OCR para os modelos. A regra de confirmação de recebidas não foi removida.
