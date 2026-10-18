# Relatório dos refinamentos — 18/10/2026

Trabalho realizado nos arquivos atuais da branch main, preservando as alterações locais da integração anterior. Git status foi consultado antes da primeira edição. Não houve commit, push, migração no banco real ou envio de e-mail real.

## Erros encontrados e causas

| Problema | Causa | Correção |
|---|---|---|
| Geração e ZIP recusavam 101 documentos | Payloads e interface fixados em 100 | Limites publicados pelo backend, padrão 500 |
| Lotes grandes podiam aparentar falha | Proxy comum de 65 segundos para todas as operações | Prazos específicos de geração, ZIP e calendário/OCR |
| ZIP limitado a 100 MB | Valor fixo no serviço | Limite configurável de 250 MiB, com validação da soma e do arquivo final |
| Calendário não aceitava PDF | Leitura apenas por openpyxl | Pipeline PDF próprio, integrado à importação existente |
| Digitalizações precisavam de OCR | Calendário não reutilizava a leitura de páginas | Extração nativa primeiro e fallback Tesseract compartilhado |
| Risco de gravar leitura duvidosa | Documento visual não equivale a uma tabela confiável | Prévia PDF obrigatória, origem/página/texto e confirmação explícita |
| Carga horária livre | Input numérico, validação positiva genérica e CHECK > 0 | Select 20h/40h, validação estrita e CHECK correspondente |
| Acumulação desalinhada | Checkbox separado do campo de jornada | Select Sim/Não na mesma grade responsiva |

## Limites, memória e timeouts

Configuração central em backend/config.py, documentada no .env.example:

```env
MAX_GENERATION_BATCH=500
MAX_GENERATED_DOWNLOAD_BATCH=500
MAX_GENERATED_ZIP_BYTES=262144000
```

MAX_UPLOAD_BYTES continua configurando upload (15 MiB padrão). GET `/folhas/configuracao`, pelo proxy acadêmico, publica os limites reais para a interface. Não há um número 500 independente no componente. Os limites de contagem são positivos e configuráveis até 5.000; o teto configurável de ZIP é 1 GiB. Não há opção ilimitada.

A geração continua sequencial, retendo somente o PDF atual e metadados dos resultados anteriores. Cada erro gera uma falha individual, sem cancelar os demais. O teste de 500 solicitações confirma 497 sucessos e 3 falhas identificadas. A interface impede o 501º selecionado; Selecionar todos acima do máximo informa o limite e mantém a seleção anterior, sem truncar.

ZIP aceita 500 documentos e 250 MiB por padrão. IDs duplicados/inválidos, arquivos ausentes, caminhos fora da pasta permitida e excesso de tamanho permanecem rejeitados. Usa SpooledTemporaryFile com 8 MiB em RAM, depois disco, um arquivo por vez e resposta em blocos de 64 KiB. Nomes de membros removem diretórios/separadores de sistemas Unix e Windows.

Nos oito exemplos institucionais sintéticos medidos (28/29/30/31 dias, 20h/40h), PDFs ficaram entre 60.392 e 65.925 bytes; 500 do maior exemplo somam aproximadamente 31,4 MiB. Isso justifica 250 MiB como margem para documentos maiores, sem um limite gigantesco.

Cliente e proxy compartilham frontend/lib/academic-limits.ts: comum 65 s, geração 900 s, ZIP 180 s, importação de calendário 660 s. Os prazos permanecem finitos. Proxy externo de produção deve admitir os mesmos tempos.

## Calendário Excel, PDF e OCR

Excel XLSX preserva Data/Especificação, validação parcial, classificação, prevenção de duplicidade, contadores e auditoria. Não foi criado outro backend de calendário.

PDF exige extensão/MIME corretos, conteúdo PDF válido, limite de upload e no máximo 20 páginas. Cada página tenta texto nativo com data explícita e conteúdo suficiente. Quando necessário, renderiza com dimensão limitada e usa a infraestrutura OCR existente: TESSERACT_CMD, OCR_LANG e preparação de imagem compartilhados. Tesseract tem timeout de 30 segundos por página. PDF misto pode usar TEXTO em uma página e OCR na seguinte.

Reconhece DD/MM/AAAA com descrição na mesma linha ou na seguinte. Intervalos explícitos são expandidos inclusivamente, limitados a 366 dias. Datas impossíveis, números/datas extras ambíguos, descrições insuficientes e linhas não interpretáveis são inválidos. Não inventa ano, presença ou classificação de feriado. O limite de 5.000 entradas também protege a expansão de intervalos.

POST `/datas-especiais/importar` mantém o resultado final para Excel; para PDF retorna PREVIA, token de 15 minutos, válidos/inválidos, página, linha, texto, origem TEXTO/OCR e propostas de data/especificação. Eventos ainda não são gravados. A interface exige **Confirmar datas do PDF**. POST `/datas-especiais/importar/confirm` recebe somente token e Idempotency-Key e grava eventos/auditoria/resultado na mesma transação. Repetir não duplica a importação. Prévia sem datas válidas não pode ser confirmada pela interface. Erro de leitura não é mostrado como importação concluída.

## Professor e banco

O formulário conserva nome, matrícula, CPF, e-mail e área. Jornada usa apenas Selecione/20 horas/40 horas; acumulação usa Não/Sim, persistidos como false/true. Controles têm a mesma altura/largura, duas colunas desktop e uma no mobile. Edição carrega e altera os valores reais.

Backend aceita apenas inteiros 20/40, rejeitando outras jornadas, floats, strings e booleanos como jornada. Cadastro novo exige seleção; NULL legado é preservado no banco e pode ser corrigido. CPF continua normalizado/único e não foi removido. Importação aceita 20, 20h, 40, 40h e Sim/Não/Nao; outras jornadas ficam inválidas. Prévias antigas de professores também são revalidadas para evitar confirmar jornadas incompatíveis.

O PDF mantém CARGA HORÁRIA como 20h/40h; não acrescenta campo de acumulação nem CPF ao modelo oficial.

O schema completo declara diretamente todas as estruturas atuais, sem ALTERs de integração no final. Nova migração: [004_refinamentos.sql](../database/migrations/004_refinamentos.sql), após 003. Troca o CHECK de jornada por NULL ou IN (20,40), detecta jornadas incompatíveis e aborta listando IDs/matrículas/cargas, sem converter ou apagar dados. É transacional, reaplicável e preserva as tabelas existentes.

Nova tabela importacao_calendario_preview armazena token, arquivo/hash, registros, expiração, confirmação e resultado. Usa a idempotência já existente. iniciar.sh verifica a migração 004, sem aplicá-la automaticamente. Instruções de consulta/correção manual dos legados em [ALTERACOES-BANCO.md](ALTERACOES-BANCO.md).

## Arquivos desta etapa

As alterações locais anteriores foram preservadas; a lista abaixo se refere aos refinamentos deste pedido.

- Configuração/CI: .env.example, .github/workflows/tests.yml, backend/config.py, iniciar.sh.
- API/modelos: backend/api.py, backend/models/calendario.py, backend/models/servidor.py, backend/routes/calendario.py, backend/routes/geracao.py.
- Serviços: backend/services/geracao.py, calendario.py, calendario_pdf.py, ler_planilha.py, importacao_servidores.py; backend/ocr/reader.py; backend/database/calendario.py.
- Banco: database/folha_pontos.sql, database/migrations/004_refinamentos.sql. Migrações anteriores não foram reescritas.
- Frontend: components/ponto-app.tsx, academic-calendar.tsx, sheet-generation.tsx; lib/academic-api.ts, academic-limits.ts, backend-proxy.ts; app/api/academic/[...path]/route.ts.
- Testes: tests/test_refinamentos.py, test_calendario.py, test_ler_planilha.py, test_migracao_calendario.py; tests/fixtures/schema_anterior_integracao.sql; frontend/tests/refinements.test.mjs.
- Documentação: README.md, frontend/README.md, frontend/INTEGRACAO-FRONTEND.md, docs/ALTERACOES-BANCO.md, CALENDARIO-GERACAO.md, RELATORIO-INTEGRACAO.md e este relatório.

## Testes e resultados finais

Testes novos cobrem 1/100/101/500, rejeição de 501/repetidos, falha parcial, nova versão, ZIP com 500 arquivos/limite de bytes, PDF textual sem OCR, escaneado com fallback e OCR real, PDF misto, ambiguidades, intervalos e limites, MIME/conteúdo inválido, tamanho/páginas, prévia/confirmação/auditoria/idempotência, jornadas/acumulação no cadastro/edição/importação e migração com jornadas antigas incompatíveis. A CI instala Tesseract e idioma português antes dos testes; não baixa modelos durante os testes nem utiliza SMTP real.

| Comando | Resultado |
|---|---|
| `.venv/bin/python -m unittest discover -s tests -v` com FOLHA_TEST_DSN temporário | 94 testes aprovados, sem ignorados |
| `pnpm test` | 30 testes aprovados |
| `pnpm exec tsc --noEmit --incremental false` | Código 0 |
| `pnpm lint` | Código 0 |
| `pnpm build` | Código 0 |
| `bash -n iniciar.sh` e `git diff --check` | Código 0 |

Também passou o teste em Chromium com FastAPI/Next/PostgreSQL temporários: cadastro/edição e alinhamento desktop/mobile, geração real de 101 PDFs, download ZIP, selecionar até 500/rejeitar 501, Excel, PDF digital, PDF escaneado com Tesseract real, prévia/confirmação e erro de PDF corrompido. Sem erros JavaScript ou HTTP 5xx. As capturas do formulário foram inspecionadas visualmente. A suíte foi repetida após a interrupção da conversa para fechar os resultados finais.

## Limitações reais

- O seu banco real ainda precisa da migração 004; faça backup e confira jornadas antigas antes de aplicar. Não aplique o schema completo sobre banco existente.
- OCR depende da qualidade e do layout. A prévia exige conferência humana; linhas não reconhecidas precisam de correção no arquivo ou cadastro manual. Não há editor de cada linha dentro da prévia PDF.
- PDF de calendário tem no máximo 20 páginas e intervalos até 366 dias; não interpreta datas sem ano ou grades que dependam exclusivamente de posição visual.
- Geração permanece síncrona; não há fila. Timeout não garante cancelamento do backend. Confira o histórico antes de repetir com autorização de nova versão.
- ZIP depende de espaço temporário em disco; proxy externo pode impor limites adicionais.
- Tokens expirados permanecem no banco sem rotina automática de limpeza. O lease continua sendo coordenação entre sessões, sem autenticação.
- A verificação local de OCR real exige Tesseract e idioma português. Sem executável, esse teste é explicitamente ignorado; a CI instala os pré-requisitos para executá-lo.
