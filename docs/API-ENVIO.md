# Envio síncrono de folhas

`POST /api/timesheets/send` encaminha o lote para `POST /folhas/enviar-lote`. O backend consulta as folhas no PostgreSQL, envia cada mensagem por SMTP e registra o resultado em `envio`. Não existe fila nem processamento em segundo plano implementado.

## Contrato

O header `Idempotency-Key` é obrigatório (1 a 255 caracteres). O corpo contém IDs reais de professores, sem duplicatas:

```json
{"month":"2026-09","professorIds":["1","2"]}
```

Sucesso: HTTP 200, após todas as mensagens serem aceitas pelo serviço de e-mail:

```json
{"jobId":"chave-do-lote","status":"completed","sentCount":2}
```

`jobId` identifica a requisição; não representa um job em fila. A resposta não comprova entrega na caixa de entrada do destinatário.

## Idempotência

A tabela `idempotency_request` reserva a chave antes do envio. Uma restrição única garante que apenas uma requisição com essa chave inicia o lote, inclusive entre processos concorrentes.

- Mesma chave e conteúdo: retorna a resposta e o código HTTP armazenados, sem reenviar.
- Mesmos IDs em ordem diferente: são o mesmo conteúdo.
- Mesma chave e conteúdo diferente: HTTP 409.
- Lote ainda em processamento: HTTP 409; consultar novamente com a mesma chave.
- Chave ausente, IDs/competência inválidos: HTTP 422 antes de reservar o lote.
- Falha durante o lote: guarda o erro; repetir a chave não reenvia os e-mails que já podem ter sido enviados.

O frontend conserva a chave durante a tentativa e, quando sessionStorage está disponível, após recarregar a mesma aba. O timeout de 20 segundos cancela a espera do navegador, mas não significa que o backend deixou de enviar. “Tentar novamente” reutiliza a chave.

Envios SMTP não são uma transação com o PostgreSQL. Um lote pode ter sucesso parcial. Se o processo cair depois de enviar e antes de salvar o resultado, a chave pode permanecer `PROCESSANDO`; é preciso conferir o histórico antes de decidir qualquer reenvio. O sistema não retoma automaticamente lotes interrompidos nem impede duplicação feita com **outra chave** (por exemplo, em outra aba).

Bancos anteriores precisam de `database/migrations/001_idempotency_request.sql`. O schema completo já contém a tabela para novas instalações.

## Anexos e configuração

O tipo MIME é determinado pela extensão: PDF → `application/pdf`, JPG/JPEG → `image/jpeg`, PNG → `image/png`. As credenciais ficam no backend; `BACKEND_URL` fica no ambiente do servidor do frontend.

O modo de teste de e-mail redireciona mensagens ao remetente; ele ainda envia mensagens reais. Os testes automatizados simulam SMTP.

## Disparo na confirmação

`PATCH /folhas/{id}` agora confirma o vínculo e dispara o e-mail depois do commit. A resposta mantém os campos de confirmação e acrescenta `envio: {status, mensagem}`. Status possíveis: `ENVIADO`, `NAO_CONFIGURADO`, `PROCESSANDO` e `ERRO`. Um problema no envio não desfaz o vínculo nem muda o sucesso da confirmação para erro HTTP.

O arquivo e destinatário são capturados na transação da confirmação. A chave automática depende da folha, arquivo, professor, competência, destinatário efetivo e modo de teste. Repetir a confirmação recupera o resultado persistido, sem outro SMTP. Mudar o vínculo, documento ou destino permite novo envio. O modo de teste envia ao remetente. Configuração ausente não reserva uma chave: pode-se configurar e tentar novamente. Erros SMTP ou resultado incerto não geram reenvio automático; confira o histórico antes de um envio manual. Envios pelo botão de lote continuam independentes e podem reenviar uma folha já enviada automaticamente.
