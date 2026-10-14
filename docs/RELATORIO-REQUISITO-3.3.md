# Relatório da implementação — requisito 3.3

Implementação local na branch `feat/calendario-academico`. Não houve push, merge, alteração de `main`, execução de migração no banco real ou envio real de e-mail.

## 1. Resumo geral

Calendário acadêmico persistente, importação XLSX com validação parcial e auditoria, gerenciamento na interface, consulta dos eventos por competência e geração individual/em lote de modelos PDF. O histórico de geradas, versões, metadados, cópias dos eventos e downloads PDF/ZIP usam o servidor/PostgreSQL.

A análise encontrou folhas recebidas com unicidade professor/competência e envio automático ao confirmar. A solução mantém essa estrutura e separa os modelos em branco em novas tabelas, preservando os fluxos existentes. Os PDFs de exemplo encontrados são documentos de teste, não um modelo institucional oficial.

## 2. Calendário

Concluídos: CRUD, múltiplos eventos por data, bloqueio de identidade duplicada, tipos FERIADO/RECESSO/PONTO_FACULTATIVO/OUTRO, timestamps, consultas por ano/mês/tipo/intervalo e calendário mensal com detalhe do dia, tabela, edição e confirmação de exclusão. As telas carregam dados reais, mostram carregamento/erro e atualizam após salvar.

## 3. Excel

Colunas obrigatórias Data e Especificação; somente `.xlsx`, até 15 MB por padrão. Datas reais do Excel ou texto estrito DD/MM/AAAA; validação de datas impossíveis, fórmulas, descrição vazia e limites de linhas/tamanho expandido. Erros isolados não impedem as linhas válidas.

Identidade por data e especificação normalizada, incluindo normalização Unicode e maiúsculas acentuadas. Repetições idênticas são ignoradas; atualização confiável altera somente a apresentação textual, preservando a classificação manual. Eventos desconhecidos ficam OUTRO. Cada importação confirmada tem auditoria e contadores reais, com linha e motivo dos erros. Regras completas em [Calendário e geração](CALENDARIO-GERACAO.md).

## 4. Geração de folhas

Individual ou lote de até 100 professores. Layout provisório A4 com cadastro, carga horária, competência, todos os dias, dias da semana, finais de semana e eventos. Horários e assinaturas permanecem em branco. Textos extensos e múltiplos eventos podem ocupar mais páginas.

Uma nova versão exige autorização explícita; pedidos concorrentes sem autorização não duplicam a primeira versão. Os PDFs anteriores e folhas recebidas são preservados. Cada documento guarda a cópia do cadastro/calendário utilizado. Lotes retornam sucessos e falhas por professor; há download individual e ZIP. Geração não executa OCR, não aprova frequência e não envia e-mail.

## 5. Banco de dados

Cinco tabelas adicionadas: `data_especial`, `importacao_calendario`, `folha_gerada`, `folha_gerada_evento` e `schema_migration`. Duas funções SQL e um trigger cuidam da normalização e atualização de timestamp. Novas FKs ligam modelos a professor, competência, eventual folha recebida e eventos históricos. Índices e checks protegem tipos, identidade, versões, contadores e referências.

Nenhuma coluna/restrição das tabelas anteriores foi alterada. O SQL original foi atualizado diretamente e 002 contém somente a diferença. Instalações nova e migrada foram comparadas em PostgreSQL isolado, com preservação de dados anteriores e reaplicação segura. Consulte a descrição de todas as colunas, índices, relacionamentos e comandos em [ALTERACOES-BANCO.md](ALTERACOES-BANCO.md). Requisito: PostgreSQL 17+ em UTF-8; testes em PostgreSQL 18.

## 6. Arquivos existentes modificados

- `backend/api.py`: inclusão das rotas e DELETE no CORS.
- `database/folha_pontos.sql`: schema completo atualizado.
- `frontend/app/page.tsx`: navegação e novas telas.
- `frontend/app/layout.tsx`: inclusão dos estilos novos.
- `frontend/components/document-sheet.tsx`: datas especiais da competência.
- `README.md`: instalação, script de execução, migrações e funcionalidades.
- `frontend/README.md`: telas, integração e distinção de persistência.
- `docs/FLUXO-DOCUMENTOS.md`: modelos gerados e preservação do fluxo recebido.
- `docs/API-ENVIO.md`: separação da geração em relação ao envio.

## 7. Arquivos criados

- `backend/models/calendario.py`: payloads e validação.
- `backend/database/calendario.py`: CRUD, filtros e importação transacional.
- `backend/database/geracao.py`: versões, metadados e cópias dos eventos.
- `backend/services/calendario.py`: leitura/validação de XLSX.
- `backend/services/modelo_folha.py`: layout PDF configurável no código.
- `backend/services/geracao.py`: geração, armazenamento, proteção de caminhos e ZIP.
- `backend/routes/calendario.py` e `backend/routes/geracao.py`: endpoints FastAPI.
- `database/migrations/002_atualizacao_calendario.sql`: migração incremental.
- `frontend/app/api/academic/[...path]/route.ts`: proxy restrito, JSON/multipart/binários.
- `frontend/lib/academic-api.ts`: cliente e validação das respostas.
- `frontend/components/academic-calendar.tsx`: gerenciamento do calendário.
- `frontend/components/period-events.tsx`: consulta dos eventos mensais.
- `frontend/components/sheet-generation.tsx`: geração, versões e histórico.
- `frontend/app/academic.css`: estilos compatíveis com os componentes existentes.
- `frontend/tests/academic.test.mjs`: testes da integração/proxy/downloads.
- `tests/test_calendario.py`: datas, planilhas, validação e PDF.
- `tests/test_calendario_integracao.py`: API e PostgreSQL, versões e arquivos.
- `tests/test_migracao_calendario.py`: equivalência de schemas e preservação de dados.
- `docs/ALTERACOES-BANCO.md`, `docs/CALENDARIO-GERACAO.md` e este relatório.

Não foram adicionadas dependências de produção. A CI existente já descobre os novos testes; não foi necessária outra workflow.

## 8. Endpoints

| Método | Rota |
|---|---|
| GET, POST | `/datas-especiais` |
| GET, PUT, DELETE | `/datas-especiais/{id_evento}` |
| POST | `/datas-especiais/importar` |
| POST | `/folhas/gerar` |
| POST | `/folhas/gerar-lote` |
| GET | `/folhas/geradas` |
| GET | `/folhas/geradas/{id_documento}` |
| GET | `/folhas/geradas/{id_documento}/download` |
| POST | `/folhas/geradas/download-lote` |

O detalhe do documento inclui os eventos usados, dispensando a rota opcional específica de datas. O frontend acessa essas rotas pelo prefixo `/api/academic`. Os endpoints antigos mantêm seus contratos. Inputs, filtros e rotas constam no Swagger; exemplos e códigos HTTP em [Calendário e geração](CALENDARIO-GERACAO.md).

## 9. Frontend

Navegação adiciona Calendário e Gerar folhas. Componentes existentes de botão, input e diálogo foram reutilizados. Há seleção de competência/professores, autorização explícita de versões, estados de espera, resultados parciais, listagem persistente e downloads. A confirmação de exclusão explica a preservação dos PDFs. Datas especiais também aparecem na consulta de folha recebida.

## 10. Testes e validação

- **68 testes Python aprovados**, incluindo os existentes e 17 novos testes. Execução com PostgreSQL 18 temporário em `/tmp`, removido ao término; nenhum teste de integração foi ignorado nessa execução.
- **28 testes frontend aprovados** (22 anteriores + 6 novos): filtros, CRUD, erros de validação/respostas inesperadas, upload multipart, resultados parciais, geração individual/lote, PDF/ZIP e proxy.
- **TypeScript aprovado** (`tsc --noEmit`).
- **Lint sem erros**, com os três avisos preexistentes de `<img>` nas telas antigas.
- **Build de produção aprovado**, incluindo a rota catch-all `/api/academic/:path+`.
- **PDF inspecionado visualmente**: exemplo de fevereiro com 28 dias, eventos, campos em branco e assinaturas em uma página. Testes de texto/limites de página também cobrem fevereiro bissexto e eventos longos com múltiplas páginas.
- **`git diff --check` aprovado**.

Falhas encontradas durante o desenvolvimento: normalização de acentos dependente do locale do PostgreSQL, import de componente e tipagem de resposta JSON. Foram corrigidas e revalidadas. Não há falhas restantes na bateria descrita.

Não foi executado teste de cliques em navegador real: não havia navegador/automação de navegador disponível no ambiente. Testes frontend exercitam a integração HTTP e o proxy; não substituem a homologação visual/interativa. Também não foram enviados e-mails reais nem executado OCR sobre documentos reais nesta alteração. Os testes de regressão usam serviços simulados para essas operações.

## 11. Compatibilidade

Os testes anteriores continuam aprovados: cadastro/carga horária, XLSX de professores, extratores OCR, processamento, upload, correção persistente, envio automático e idempotência de lote. Geração não altera registros dessas funcionalidades, e os testes verificam preservação do original, ausência de envios e rollback de falha ao persistir o modelo.

O histórico das folhas recebidas continua dependendo do IndexedDB, como antes; somente calendário e modelos gerados têm as novas consultas remotas. Autenticação e sincronização completa de recebidas não fazem parte desta implementação.

## 12. Instalar banco novo

Crie banco vazio em UTF-8 e aplique **somente** `database/folha_pontos.sql`, com `ON_ERROR_STOP=1` e transação, conforme [procedimento completo](ALTERACOES-BANCO.md#banco-novo). Não precisa aplicar migrações anteriores.

## 13. Atualizar banco antigo

Faça backup do banco e de `data/folhas/`. Aplique 001 se necessário (pode ser repetida), depois `database/migrations/002_atualizacao_calendario.sql`, seguindo [procedimento de atualização](ALTERACOES-BANCO.md#banco-antigo). Não execute o schema completo sobre o banco existente. A migração real ficou para execução deliberada pelo responsável, conforme solicitado.

## 14. Pendências e limites

As funcionalidades solicitadas estão implementadas no código. Restam a aplicação da migração no ambiente real e a homologação de cliques/layout no navegador. O modelo institucional definitivo não foi fornecido: o PDF provisório está identificado e preparado para substituição com outro `MODELO_ID`.

A geração é síncrona; não há fila. PDFs ficam em disco, portanto backups precisam incluir arquivos e banco. Falhas normais de persistência removem o arquivo recém-criado, mas interrupção abrupta entre gravação e commit pode deixar um arquivo órfão; não foi implementada reconciliação automática. Não há edição visual do template ou envio automático dos modelos em branco.

## 15. Executar e conferir

Com PostgreSQL atualizado e os arquivos `.env`/`frontend/.env.local` configurados:

```bash
cd "/home/tiagopa/Projeto Folha de Pontos/Projeto-Folha-de-Ponto"
bash iniciar.sh
```

Abra http://localhost:5173 e a documentação em http://localhost:8000/docs. Cadastre ou importe eventos, gere um modelo, altere o calendário e autorize uma nova versão. Confira a preservação da anterior e baixe um lote ZIP. O script não aplica migrações automaticamente. Para os comandos de testes e um roteiro detalhado, consulte [Calendário e geração](CALENDARIO-GERACAO.md#verificação).
