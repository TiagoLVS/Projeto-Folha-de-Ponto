# Envio SMTP e histórico

## Folhas recebidas: aptidão e confirmação

Para folhas recebidas/preenchidas, o backend só permite enviar folha ativa, vinculada a servidor/competência, confirmada e com `status_ocr = 'OK'`, arquivo presente e e-mail válido. `listar_folhas_para_envio` aplica status/atividade/confirmação no SQL; o serviço revalida arquivo e endereço antes do SMTP. Uma seleção com folha ausente/inapta retorna 422 antes de iniciar o lote.

Confirmar uma folha recebida por PATCH tenta enviar depois de salvar o vínculo. O envio automático tem chave baseada em documento, hash/versão, vínculo, destinatário e modo de teste. Repetir a mesma confirmação recupera o resultado anterior. Ausência de configuração retorna NAO_CONFIGURADO sem desfazer a confirmação. Falhas SMTP são registradas. Geração de modelos não envia.

## Configuração

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURITY=ssl
SMTP_USER=
SMTP_PASSWORD=
DIGEP_EMAIL=remetente@exemplo.com
DIGEP_SENHA_APP=senha_de_app_local
DIGEP_MODO_TESTE=true
```

SMTP_USER vazio usa DIGEP_EMAIL; SMTP_PASSWORD vazio usa DIGEP_SENHA_APP. O remetente usa DIGEP_EMAIL ou, na ausência, SMTP_USER. Suporta SSL e STARTTLS com contexto TLS padrão; para STARTTLS configure a porta do provedor, normalmente 587. Gmail permanece compatível. O servidor institucional pode ser configurado sem editar código. Credenciais não são versionadas.

Modo de teste **envia de verdade ao remetente**, em vez do professor. Os testes automatizados simulam SMTP e nunca enviam e-mails reais.

## Lote e seleção

`POST /folhas/enviar-lote` recebe `{"month":"2026-10","professorIds":["1","2"]}` e exige `Idempotency-Key`. IDs distintos, professor individual, seleção múltipla e todos aptos são suportados pela interface. O filtro de ainda não enviados exclui ENVIADO/PROCESSANDO. A quantidade exibida corresponde à seleção efetivamente enviada.

O processamento é síncrono. Sucesso: `{"jobId":"chave","status":"completed","sentCount":2}`. Mesma chave/payload recupera resultado; chave com outro payload retorna 409. Requisição em andamento também retorna 409. O timeout de 20 segundos do frontend não cancela um SMTP já iniciado: consulte novamente com a mesma chave. Após falha parcial, confira o histórico antes de criar outro lote; o mesmo lote não reenvia os sucessos automaticamente.

SMTP não oferece garantia universal de entrega exatamente uma vez: se o provedor aceitar a mensagem e a conexão cair antes da confirmação, o resultado é ambíguo. A idempotência impede repetição automática da requisição; reenvio manual exige conferência.

## Histórico e reenvio

`GET /emails/historico` aceita nome, matricula, cpf, status e competencia. Relaciona envio, folha, servidor e competência, retornando id, id_folha, nome, matrícula, CPF, competência, status, criado_em e mensagem. PENDENTE do banco é apresentado como PROCESSANDO. Logs de revisões arquivadas continuam no histórico.

`POST /emails/reenviar-erros` recebe `{"log_ids":[1,2]}` e exige Idempotency-Key. Só processa logs ERRO, deduplica por folha, ignora sucesso/PENDENTE posterior, folha removida/sem arquivo/inapta e registra outra tentativa. Retorna reenviados, ignorados, falhas e detalhes; falha de um reenvio não é contada como sucesso. A interface tem filtros por CPF e checkboxes para escolher erros.

A consulta e a revalidação acontecem no servidor. Mutações HTTP compartilham o lease PostgreSQL e chaves persistentes; duas sessões não executam reenvios concorrentes sobre a aplicação.

## Modelos em branco: enviar todos sem abrir PDFs

Na tela **Gerar folhas**, selecione a competência e use **Enviar todas por e-mail**, ou selecione documentos no histórico e use **Enviar selecionadas por e-mail**. A prévia lista destinatários e a versão mais recente de cada servidor naquele mês. Confirme Enviar N folhas; a interface acompanha o progresso, resultados individuais e falhas. Não é necessário abrir PDF, executar OCR ou confirmar vínculo de folha recebida. Gerar sozinho continua sem enviar automaticamente.

GET `/folhas/geradas/para-envio?competencia=AAAA-MM` consulta arquivos, e-mails e envios anteriores. Configuração SMTP ausente é informada antes de enviar. Modo de teste mostra o destinatário real (remetente); ele envia mensagens de verdade, conforme a configuração já existente.

POST `/folhas/geradas/enviar-lote` recebe ids_documentos, competencia e Idempotency-Key. Só envia versões mais recentes, do mês solicitado, com arquivo na pasta permitida e e-mail válido. Os limites reutilizam MAX_GENERATION_BATCH. Documentos antigos/ausentes/inaptos falham individualmente. ENVIADO ou PENDENTE para o mesmo documento/destinatário impede repetir o envio, inclusive com outra chave. Reenvio de falha é registrado como nova tentativa.

Uma confirmação do usuário inicia requisições sequenciais de um documento por vez, com chave estável por item e prazo de 900 s em cliente/proxy. Não abre outra conexão SMTP enquanto a anterior é processada. Progresso e resultados são exibidos; **Continuar envio** reutiliza as chaves do lote após interrupção de conexão. Não há fila de processamento. A idempotência não garante entrega exatamente uma vez em toda falha possível do provedor SMTP; PENDENTE evita repetição automática em resultado ambíguo.

A migração **005_envio_modelos.sql** permite registrar recebidas e geradas na mesma tabela envio: cada registro tem exatamente um id_folha ou id_documento. O histórico mostra tipo de documento/destinatário e o reenvio de erros contempla modelos em branco. Não mistura modelos em branco com frequência confirmada: gerar/enviar modelo não cria folha_ponto nem altera status OCR.
# Reenvio explícito de modelos em branco

No diálogo de envio em Gerar folhas, marque **Incluir folhas já enviadas (enviar novamente)** para autorizar outro envio. `POST /folhas/geradas/enviar-lote` aceita `reenviar: true`; por padrão, continua ignorando documentos já enviados. Uma nova confirmação usa nova chave de idempotência, enquanto Continuar envio conserva a chave e não repete mensagens concluídas. Envios PENDENTE continuam bloqueados mesmo com autorização de reenvio. Cada reenvio cria um novo registro no histórico, sem migração adicional.

## Conta por computador no modo real

Antes de enviar, conectar uma conta por `POST /emails/conta`, com e-mail e senha de aplicativo/SMTP. GET consulta o estado e DELETE desconecta. O remetente é o usuário conectado neste cliente. O servidor mantém as credenciais cifradas no banco até desconectar. `X-Email-Client-Id` identifica o cliente persistente, separado da sessão de edição. Sem conexão, endpoints de envio retornam 409 antes de reservar idempotência ou tentar SMTP. No modo de teste, a conexão não é exigida. [Fluxo completo](CONTA-EMAIL.md).
