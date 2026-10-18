# Calendário acadêmico e modelos institucionais

## Um contrato de calendário

A interface usa `academic-api.ts` → `/api/academic` → `/datas-especiais`, com CRUD, filtros, importação e auditoria no PostgreSQL. Não há backend paralelo `/calendario`.

Excel `.xlsx` continua com colunas **Data** e **Especificação**, datas Excel ou DD/MM/AAAA. Mantém validação por linha, prevenção de duplicidade, novos/atualizados/ignorados/inválidos e auditoria. Limites: MAX_UPLOAD_BYTES (15 MB padrão), 5.000 linhas, 64 MB expandido. `.xls` é suportado apenas na importação de professores.

A identidade é data + especificação normalizada; vários eventos distintos podem compartilhar uma data. Reimportação idêntica é ignorada e alteração somente de apresentação preserva a classificação manual. Tipos: FERIADO, RECESSO, PONTO_FACULTATIVO, OUTRO; `sugerir_tipo` não infere feriado apenas pelo dia.

## PDF digital e escaneado

O mesmo seletor aceita **.xlsx ou .pdf**. PDF exige MIME application/pdf, assinatura e conteúdo válidos, sem senha, no máximo 20 páginas e MAX_UPLOAD_BYTES. A extensão não permite tratar PDF como Excel.

Cada página tenta primeiro extração nativa PyMuPDF. Texto com uma data explícita e conteúdo suficiente é interpretado sem OCR. Páginas vazias/insuficientes usam renderização limitada e Tesseract, compartilhando TESSERACT_CMD, OCR_LANG (por padrão) e preparação de imagem de `backend/ocr/reader.py`. O OCR tem timeout de 30 segundos por página. PDF misto pode usar texto numa página e OCR em outra.

Formatos reconhecidos:

```text
01/01/2027 - Feriado - Ano novo
15/02/2027
Recesso acadêmico
21/04/2027 Tiradentes
20/12/2027 a 31/12/2027 - Recesso
```

Intervalos explícitos e válidos são expandidos dia a dia, incluindo início/fim, até 366 dias. O ano pode vir de um cabeçalho mensal explícito, como JANEIRO/2026. Sem um ano escrito na data ou nesse cabeçalho, a entrada continua inválida. Não são inferidos feriado ou datas ausentes. Datas impossíveis, descrições insuficientes, datas extras ambíguas e linhas desconhecidas são inválidas/revisão. Cabeçalhos simples reconhecidos são ignorados; layouts complexos podem exigir ajuste manual.

**PDF sempre exige conferência antes de gravar eventos**, inclusive digital. POST `/datas-especiais/importar` retorna status PREVIA, token de 15 minutos, válidos/inválidos e detalhes com página, linha original, texto, origem TEXTO/OCR e datas/descrições propostas. A interface apresenta a prévia e o botão **Confirmar datas do PDF**. Nenhuma data é gravada nessa etapa. POST `/datas-especiais/importar/confirm` recebe somente token e Idempotency-Key; confirma registros válidos e registra a auditoria na mesma transação. Repetições não duplicam eventos/auditoria. Descartar não importa eventos. Tokens expirados exigem nova leitura.

Excel mantém o comportamento de importação imediata e relatório final. PDF sem entradas confiáveis deixa a confirmação indisponível; erro de leitura não aparece como importação bem-sucedida. A correção de linhas inválidas é feita no documento e por nova importação, ou no cadastro manual de datas.

### Calendário acadêmico da UnDF

O formato mensal do Calendário Acadêmico 2026 da UnDF é suportado. O leitor usa o ano dos cabeçalhos MÊS/AAAA, interpreta DD/MM, intervalos como `05/01 a 03/02` e `02 a 31/03`, e listas como `14, 16 e 18/02` ou `02/04 e 04/04`. Ignora números/dias da grade, nomes dos dias da semana e totais letivos. Descrições com ano/semestre (2026.1 e 2026.2) são preservadas. Entradas ambíguas continuam exigindo revisão. A classificação depende do texto, sem inventar que uma data é feriado por conhecimento externo.

O PDF original foi validado por leitura: 316 registros após expandir intervalos/listas, correspondendo a 279 eventos por data/especificação, com 37 repetições ignoradas ao confirmar. A referência original não foi modificada; sua extração textual pública é uma fixture de regressão. A prévia e a confirmação permanecem no fluxo existente; nenhum evento foi inserido no banco do usuário durante essa verificação.

## Geração e ZIP

Use **Gerar folhas** na tela principal. Selecione competência e até **500 professores por lote**, por padrão, com autorização explícita para novas versões. O relatório separa total, gerados, não gerados, documentos e motivo por falha. O lote continua sequencial: só o PDF atual é renderizado na memória; o relatório acumula metadados. Uma falha não cancela os demais.

Por padrão, a lista mostra somente servidores **sem PDF gerado na competência selecionada**. Após gerar, os sucessos saem da lista; falhas continuam disponíveis. Reabrir a tela ou recarregar mantém o filtro usando o histórico remoto. Em outra competência, a lista é recalculada. Os PDFs permanecem no histórico e podem ser baixados. A opção explícita Gerar nova versão de folhas existentes permite selecionar novamente quando necessário.

`Selecionar todos` considera apenas os servidores exibidos e recusa uma lista acima do máximo, informa a quantidade e mantém a seleção anterior. Não recorta silenciosamente. A seleção individual impede o próximo item acima do limite com mensagem. Download também limita a seleção e informa seu máximo.

Configuração no `.env` do backend, com reinicialização:

```env
MAX_GENERATION_BATCH=500
MAX_GENERATED_DOWNLOAD_BATCH=500
MAX_GENERATED_ZIP_BYTES=262144000
```

O backend é a fonte dos limites: GET `/folhas/configuracao` publica os máximos e MAX_UPLOAD_BYTES para a interface, via proxy existente. Geração/download aceitam configuração entre 1 e 5.000 itens, permanecendo limitados. ZIP aceita até **250 MB (250 MiB)** por padrão tanto na soma dos PDFs como no arquivo final; o teto de configuração é 1 GiB. Diminuir o máximo de ZIP não altera o limite da geração; selecione sublotes para baixar.

Os oito exemplos sintéticos comuns medidos (28/29/30/31 dias, 20h/40h, sem anexos extensos) ficaram entre **60.392 e 65.925 bytes**, média 62.649 bytes. 500 desses exemplos no maior tamanho somam 32.962.500 bytes (aproximadamente 31,4 MiB); 250 MiB oferece margem sem tornar o download ilimitado. PDFs com anexos especiais podem ser maiores.

ZIP usa `SpooledTemporaryFile`: até 8 MiB de buffer, depois disco, adicionando um arquivo por vez via ZipFile.write. A resposta é transmitida em blocos de 64 KiB e fecha o temporário. Mantém restrição à pasta permitida, arquivos existentes, IDs positivos distintos e tamanho máximo. O lote não carrega todos os PDFs em RAM. Reserve espaço temporário em disco.

Timeouts compartilhados por cliente/proxy em `frontend/lib/academic-limits.ts`: comuns **65 s**, geração **900 s (15 min)**, ZIP **180 s (3 min)**, leitura de calendário **660 s (11 min)**. Mantêm prazos finitos e admitem até 20 páginas × 30 s de OCR. Infraestruturas com proxy externo precisam permitir esses prazos; não existe fila de geração. Um timeout não cancela necessariamente trabalho já iniciado no backend: consulte o histórico antes de autorizar outra versão.

Rotas preservadas: POST `/folhas/gerar`, POST `/folhas/gerar-lote`, GET `/folhas/geradas`, GET `/folhas/geradas/{id}`, GET `/folhas/geradas/{id}/download`, POST `/folhas/geradas/download-lote`.

## Modelo institucional

`institucional-v1` segue o DOCX de referência. Cabeçalho com logo, Universidade do Distrito Federal Prof Jorge Amaury Maia Nunes — UnDF, CNPJ 43.061.297/0001-08, Registro de Frequência e Referência MÊS/AAAA. Identificação: UA, matrícula, nome, cargo, padrão, função, carga horária e exercício. Dados sem fonte confiável ficam vazios; departamento não vira UA. CPF e acumulação não são acrescentados ao modelo oficial.

Carga horária aparece como **20h ou 40h**, conforme cadastro. Legados NULL ficam em branco. Dois turnos têm assinatura/entrada/saída, todos os dias, SÁBADO/DOMINGO e `--`, eventos e observações, datas e assinaturas/carimbos. Meses comuns de 28/29/30/31 dias cabem em A4; eventos extensos preservam texto em anexo referenciado. Versões e snapshots são mantidos; gerar não confirma frequência nem envia e-mail.

## Substituir um calendário por outro

Na importação, selecione o ano e marque **Substituir calendário de AAAA** antes de escolher o novo Excel/PDF. O modo padrão continua adicionando/mesclando eventos. No modo de substituição, ambos os formatos passam primeiro por prévia, com ano, quantidade existente e datas propostas. O botão de substituição abre uma confirmação explícita de exclusão.

A confirmação apaga somente as datas do ano escolhido e importa as novas na mesma transação. Outros anos, recebidas e PDFs gerados não são apagados. Os PDFs e snapshots antigos permanecem como foram gerados; para refletir o calendário novo em um PDF já existente, use **Gerar nova versão de folhas existentes**.

Arquivos vazios, linhas inválidas e datas fora do ano escolhido bloqueiam a substituição. Se o calendário desse ano mudar depois da prévia, a confirmação retorna 409 e exige nova importação/conferência. Se a gravação falhar, a exclusão é revertida. Repetir um token confirmado retorna o resultado anterior e não exclui eventos adicionados posteriormente.

Contrato existente: POST `/datas-especiais/importar` recebe multipart `arquivo`, `modo=substituir` e `ano=AAAA`; a confirmação permanece POST `/datas-especiais/importar/confirm` com somente token e Idempotency-Key. Sem modo, a mesclagem anterior é preservada. A prévia de substituição usa um envelope no JSONB já existente, compatível com prévias PDF antigas; não exige migração nova. O resultado informa `removidos`, e a auditoria guarda o estado anterior do ano no primeiro detalhe da importação.

## Enviar modelos aos servidores

Depois de gerar, clique **Enviar todas por e-mail** na mesma tela, confira os destinatários e confirme o lote. Pode também marcar documentos no histórico e enviar as selecionadas. O envio usa a versão mais recente de cada servidor no mês, exibe progresso e registra resultados em E-mails. Modelos em branco não exigem validação OCR. Gerar continua sem disparar mensagens automaticamente. Documentação e modo de teste em [API-ENVIO.md](API-ENVIO.md); requer migração 005.
