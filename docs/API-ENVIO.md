# Envio de folhas em lote — contrato de integração

## Fluxo

Abra “Enviar folhas do mês”, selecione os destinatários e clique uma vez em “Enviar todas (8)”. Uma única requisição solicita o lote; o backend processa os oito e-mails separadamente, cada um com a folha correta. A interface não usa `mailto:`.

O backend consulta folhas e destinatários no PostgreSQL, envia mensagens individuais por SMTP e registra cada resultado em `envio`. A resposta `queued` representa a aceitação do lote; o envio atual é processado durante a requisição.

## Requisição

`POST /api/timesheets/send`, na mesma origem. A rota do frontend encaminha a requisição para `POST /folhas/enviar-lote` no backend.

```http
Content-Type: application/json
Idempotency-Key: <UUID gerado no navegador>
```

```json
{
  "month": "2026-09",
  "professorIds": ["id-do-professor-1", "id-do-professor-2"]
}
```

Os identificadores devem corresponder aos registros reais da API. Integre a carga e o salvamento das edições do painel antes do envio: os dados locais de exemplo e suas alterações em memória NÃO são enviados para o backend.

## Resposta após aceitação atômica de todo o lote

HTTP `202`, JSON:

```json
{
  "jobId": "lote-123",
  "status": "queued",
  "acceptedCount": 2
}
```

`acceptedCount` deve corresponder ao número solicitado. “Na fila” significa aceitação para processamento, não entrega na caixa de entrada. Requisições rejeitadas devem retornar erro HTTP sem criar um lote parcial.

## Responsabilidades do backend

- Exigir sessão autorizada, validar origem/CSRF, competência e acesso a TODOS os IDs. Recusar IDs desconhecidos ou repetidos antes de enfileirar.
- Buscar e-mails e folhas nos registros autorizados; nunca confiar em destinatários ou HTML arbitrários enviados pelo navegador.
- Persistir o lote e a chave de idempotência com unicidade por organização/usuário. Mesma chave e mesmo conteúdo retornam o mesmo recibo; conteúdo diferente deve retornar `409`.
- A chave é reutilizada pelo front para a mesma competência e conjunto de IDs durante a sessão, inclusive após timeout. O servidor também deve impedir duplicações entre recarregamentos e abas, com deduplicação por destinatário, competência e versão da folha.
- Criar um snapshot das folhas ao aceitar o lote. Gerar PDF ou HTML e enviar uma mensagem separada com apenas o anexo do destinatário. Nunca colocar todas as folhas em um e-mail coletivo.
- Usar fila persistente e tentativas controladas por mensagem; registrar falhas e a confirmação do provedor sem reenviar as mensagens já aceitas. Guardar credenciais de e-mail exclusivamente no servidor.

## Erros e interface

O cliente diferencia ausência de integração (`404/405/501`), acesso negado (`401/403`), erro do serviço, resposta inválida e timeout de 20 segundos. Ao falhar, exibe “Tentar novamente” e conserva a chave do lote. O botão fica bloqueado enquanto há uma solicitação em andamento.

O envio individual na tela do professor usa o mesmo fluxo com um único ID. Acompanhamento da entrega após a fila é uma integração adicional; este front confirma somente a aceitação do lote.
