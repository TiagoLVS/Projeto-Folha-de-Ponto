# Calendário acadêmico e geração de folhas

## Usar a interface

Após atualizar o banco conforme [ALTERACOES-BANCO.md](ALTERACOES-BANCO.md), execute `bash iniciar.sh` na raiz do repositório e abra o endereço informado pelo frontend (normalmente http://localhost:5173).

**Calendário:** navegue com as setas ou selecione mês e ano. Clique em um dia para ler todos os seus eventos. O filtro de tipo vale para o calendário e a tabela; “Listar o ano inteiro” amplia a tabela. “Adicionar data”, “Editar” e “Excluir” persistem no PostgreSQL; excluir exige confirmação. Tipos aparecem por nome e cor: feriado, recesso, ponto facultativo e outro.

**Gerar folhas:** selecione competência e um ou mais professores reais do cadastro (máximo 100). Um professor usa a geração individual; vários usam lote. O resultado informa documentos gerados, falhas por professor e download ZIP. O histórico abaixo é carregado do servidor e permanece disponível após limpar o navegador. É possível baixar cada PDF ou selecionar até 100 documentos do histórico para ZIP.

Uma geração anterior exige marcar “Autorizar nova versão”. Isso produz outro documento, conservando versões antigas. Se uma requisição for interrompida, atualize o histórico antes de autorizar uma nova versão; uma nova tentativa sem essa autorização não duplica a primeira versão já confirmada.

As telas de consulta de folha e geração mostram os eventos da competência. Essa consulta mostra o **calendário atual**; cada PDF conserva os eventos do momento da sua criação. Datas especiais não representam presença, ausência nem horas trabalhadas.

## Importação XLSX

Na aba ativa da planilha, a primeira linha precisa conter uma única coluna **Data** e uma única coluna **Especificação**. A ordem é livre, espaços externos/maiúsculas no cabeçalho são normalizados e colunas extras são ignoradas. Tipo não é obrigatório nem importado.

| Data | Especificação |
|---|---|
| 01/01/2027 | Confraternização Universal |
| 15/02/2027 | Recesso acadêmico |
| 16/02/2027 | Ponto facultativo |
| 21/04/2027 | Tiradentes |

São aceitas células de data reais do Excel, sem horário, e texto estrito DD/MM/AAAA. Datas impossíveis, textos ambíguos, números sem formato de data, fórmulas e especificações vazias/não textuais são inválidos. A especificação normalizada aceita até 300 caracteres.

Limites: `.xlsx`, 15 MB por padrão (mesmo `MAX_UPLOAD_BYTES` dos uploads existentes), 5.000 linhas de dados e 64 MB de conteúdo expandido. `.xls` não é aceito. Arquivo ilegível, cabeçalho incorreto ou limites excedidos impedem a importação inteira. Linhas com erros isolados são registradas como inválidas; as demais podem ser confirmadas.

Classificação conservadora: início explícito “Feriado”, “Recesso” e “Ponto facultativo” sugere o tipo correspondente; os demais ficam OUTRO. Por exemplo, Tiradentes fica OUTRO até edição manual. Reimportar nunca substitui o tipo já escolhido.

A identidade é data + especificação normalizada conforme [regras do banco](ALTERACOES-BANCO.md). Mesmo dia com outra especificação é outro evento. Mesma identidade e mesma apresentação textual: **ignorado**. Mesma identidade com capitalização diferente: **atualizado**, somente o texto de apresentação. Repetições da mesma identidade dentro do arquivo são ignoradas; a primeira linha válida prevalece. Mudar de fato o nome ou o dia não é uma atualização confiável: cria outro evento. Para corrigir esse caso use Editar, evitando registros antigos desnecessários.

O relatório retorna total, novos, atualizados, ignorados, inválidos e linha/status/motivo. Linhas totalmente vazias não entram no total. Os contadores refletem a transação confirmada, incluindo auditoria em `importacao_calendario`. Falha no banco desfaz todos os registros daquela importação. Reimportações idênticas são permitidas e ficam auditadas, sem duplicar eventos.

## API

Rotas documentadas automaticamente pelo FastAPI em `/docs`. Os erros usam `detail` (string, ou lista de validação Pydantic). As rotas do frontend `/api/academic/...` encaminham a mesma estrutura e os parâmetros ao `BACKEND_URL`, com suporte a multipart, 204, PDF e ZIP.

| Método e rota | Entrada / resultado |
|---|---|
| GET `/datas-especiais` | Filtros opcionais `ano`, `mes` (exige ano), `tipo`, `inicio`, `fim` ISO. Combina filtros por interseção, limites inclusivos. Lista ordenada. |
| GET `/datas-especiais/{id_evento}` | Evento ou 404 |
| POST `/datas-especiais` | JSON data ISO, especificacao, tipo; retorna 201 |
| PUT `/datas-especiais/{id_evento}` | Mesmos campos; retorna 200 |
| DELETE `/datas-especiais/{id_evento}` | 204 ou 404 |
| POST `/datas-especiais/importar` | Multipart campo `arquivo`; relatório 200 |
| POST `/folhas/gerar` | JSON id_servidor, competencia AAAA-MM, nova_versao opcional false; documento 201 |
| POST `/folhas/gerar-lote` | JSON ids_servidores, competencia, nova_versao; relatório 200, inclusive sucesso parcial |
| GET `/folhas/geradas` | Filtros opcionais competencia e id_servidor; histórico com versões |
| GET `/folhas/geradas/{id_documento}` | Metadados e cópia dos eventos usados; 404 se ausente |
| GET `/folhas/geradas/{id_documento}/download` | PDF como anexo; 404 se registro/arquivo indisponível |
| POST `/folhas/geradas/download-lote` | JSON ids_documentos; ZIP, até 100 documentos e 100 MB de PDFs |

Duplicidade de evento ou tentativa de gerar novamente sem autorização: **409**. Dados inválidos: **422**. Limite de upload/ZIP: **413**; extensão de planilha inválida segue o **400** do uploader existente. Professor/documento inexistente: **404**. Um lote de geração mantém sucessos já confirmados e informa cada falha; não anuncia uma fila inexistente. Geração e importação executam de forma síncrona.

Exemplos:

```json
{"data":"2027-04-21","especificacao":"Tiradentes","tipo":"FERIADO"}
```

```json
{"id_servidor":42,"competencia":"2027-02","nova_versao":false}
```

```json
{"ids_servidores":[42,43],"competencia":"2027-02","nova_versao":true}
```

A rota `/datas-especiais/resumo` não foi adicionada: era opcional, e a interface utiliza a listagem filtrada e o relatório da importação, sem duplicar consultas equivalentes. Nenhuma rota antiga mudou seu contrato; CORS passou a aceitar DELETE.

## Modelo PDF, persistência e versões

Os PDFs existentes em `data/entrada/` são documentos demonstrativos, identificados como teste. Não foi identificado modelo institucional oficial. O novo layout é explicitamente **MODELO PROVISÓRIO DA APLICAÇÃO** (`provisorio-v1`). Utiliza PyMuPDF, já presente nas dependências.

Inclui nome, matrícula, departamento, carga horária quando cadastrada, competência, versão, todos os dias e dias da semana, finais de semana, tipos e descrições dos eventos. Campos de entrada, saída, observações gerais e assinaturas ficam em branco. A tabela quebra páginas quando necessário, repete cabeçalho e comporta múltiplos eventos e textos longos.

Para ajustar o layout, edite `backend/services/modelo_folha.py`: `TITULO`, `ALTURA_MINIMA_LINHA`, colunas e `renderizar_pdf`. Ao adotar outro modelo, altere `MODELO_ID`; o identificador é gravado em cada novo registro. Essa configuração é feita no código, não por editor visual. Regerar com autorização explícita aplica o novo modelo sem alterar PDFs anteriores.

Arquivos ficam em `data/folhas/geradas/AAAA-MM/Folha_ID_AAAA-MM_vN_UUID.pdf`, com criação exclusiva. IDs numéricos e UUID evitam colisões/caminhos derivados de nomes de usuários. O PostgreSQL armazena caminho, nome, hash, tamanho, versão, professor, competência e cópias dos dados/eventos.

Falha na transação remove o arquivo recém-criado. Uma interrupção abrupta do processo entre gravação do arquivo e commit ainda pode deixar um arquivo órfão: ele não aparece no histórico nem substitui documentos existentes. Backups precisam incluir banco e diretório de arquivos; ainda não há rotina de reconciliação automática de órfãos.

O download usa o ID do banco e confina o caminho ao diretório de geradas, inclusive após resolver links simbólicos. Não aceita um caminho enviado pelo usuário. O ZIP utiliza nomes de arquivo simples. Não foi acrescentada autenticação: os novos endpoints seguem o mesmo contexto local/administrativo da API existente.

## Integração com OCR e e-mail

Gerar não executa OCR, não marca folha como conferida e não envia e-mail. `folha_gerada` é separada de `folha_ponto`, e o envio continua consultando somente folhas recebidas. Para usar um modelo preenchido, baixe, preencha e envie o documento resultante pelo fluxo já existente. Ao confirmar esse documento recebido, o comportamento de envio automático existente continua valendo.

A geração não modifica originais recebidos. Alterar/excluir eventos conserva os PDFs e os dados históricos; novas versões usam o calendário vigente. O histórico remoto foi adicionado para **modelos gerados**. As prévias das folhas recebidas continuam com a limitação anterior de cache IndexedDB.

## Verificação

```bash
python -m unittest discover -s tests -v
cd frontend
pnpm test
pnpm exec tsc --noEmit --incremental false
pnpm lint
pnpm build
```

Configure `FOLHA_TEST_DSN` para um PostgreSQL **descartável** a fim de executar os testes de integração/migração. Sem a variável, esses testes ficam explicitamente ignorados. A CI existente já roda a descoberta de testes Python com PostgreSQL 18, testes frontend, TypeScript, lint e build.

Teste manual sugerido: importe a tabela acima, classifique Tiradentes, reimporte e confira os ignorados/tipo preservado; gere um PDF para um professor, altere o calendário, autorize nova versão e compare os dois downloads; gere um lote e baixe o ZIP. Use somente dados de teste. Gerar os modelos não dispara o envio automático.
