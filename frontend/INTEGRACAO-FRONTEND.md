# Contratos de integração do frontend

## Escopo

Nenhum arquivo do backend ou SQL foi modificado. As rotas Next em `app/api/` são proxies HTTP para FastAPI; não acessam PostgreSQL diretamente. `BACKEND_URL` permanece no servidor Next e não é exposta ao navegador.

O proxy conserva `Authorization`, cookies, `Idempotency-Key` e `If-Match`; mantém status HTTP, inclusive 204, 409 e 423, e respostas binárias. Todos os GET usam `no-store`. Cabeçalhos de autenticação só têm efeito se o backend os verificar.

## Mapeamento exato

| Método | Rota do frontend | Endpoint FastAPI | Situação no ZIP recebido |
| --- | --- | --- | --- |
| GET/POST | `/api/servers` | `/servidores` | Existente |
| PUT | `/api/servers/:id` | `/servidores/:id` | Existente |
| DELETE | `/api/servers/:id` | `/servidores/:id` | Necessário |
| POST | `/api/servers/import/preview` | `/servidores/importar/preview` | Necessário |
| POST | `/api/servers/import/confirm` | `/servidores/importar/confirm` | Necessário |
| GET | `/api/timesheets` | `/folhas` | Necessário |
| POST | `/api/timesheets/upload` | `/folhas/upload` | Necessário |
| GET | `/api/timesheets/:id/file` | `/folhas/:id/arquivo` | Necessário |
| DELETE | `/api/timesheets/:id` | `/folhas/:id` | Necessário |
| POST | `/api/timesheets/:id/process` | `/folhas/:id/processar` | Necessário |
| PATCH | `/api/timesheets/:id` | `/folhas/:id` | Existente; resposta precisa incluir metadados remotos; sobrescrita precisa ser suportada |
| POST | `/api/timesheets/send` | `/folhas/enviar-lote` | Existente; deve revalidar aptidão na transação do envio |
| GET/POST | `/api/calendar` | `/calendario` | Necessário |
| PUT/DELETE | `/api/calendar/:id` | `/calendario/:id` | Necessário |
| GET | `/api/emails` | `/emails/historico` | Necessário |
| POST | `/api/emails/retry` | `/emails/reenviar-erros` | Necessário |
| GET | `/api/system/lock` | `/sistema/lock` | Necessário |

Os endpoints antigos de `/folhas/registrar` e `/folhas/processar` foram preservados como proxies PDF, mas a nova interface não os usa: registrar ignora os campos de vínculo e o OCR antigo pode sobrescrever um professor/mês antes de uma confirmação. Chamá-los como se já suportassem a nova regra criaria registros órfãos ou substituiria arquivos sem autorização.

## Formato de uma folha remota

`GET /folhas` retorna um array completo, sem depender de arquivos do navegador. O filtro opcional `id_servidor` limita a consulta. Se o backend adotar paginação, o cliente deve buscar todas as páginas antes de montar o histórico.

```json
{
  "id_folha": 77,
  "id_servidor": 42,
  "competencia": "2026-10",
  "status_ocr": "OK",
  "nome_arquivo": "folha_outubro.pdf",
  "tamanho_arquivo": 123456,
  "atualizado_em": "2026-10-12T18:00:00Z",
  "confirmado_em": "2026-10-12T18:00:00Z",
  "matricula": "12345",
  "servidor": { "nome": "Ana Silva" },
  "mensagem": null,
  "envio": { "status": "ENVIADO", "mensagem": "Envio confirmado." }
}
```

Campos de identificação, mensagem e envio são opcionais. `confirmado_em` é nulo até a conferência; não se deve inferir confirmação humana a partir da leitura automática. As datas devem ser ISO 8601, com fuso. Só uma folha ativa por servidor/competência é permitida.

`GET /folhas/:id/arquivo` retorna o PDF original, com `Content-Type: application/pdf` e nome seguro em `Content-Disposition`. Deve verificar autorização e impedir caminhos arbitrários. `DELETE /folhas/:id` retorna 204 somente após a remoção do arquivo e registro ser concluída; em falha não deve declarar sucesso.

### Upload e sobrescrita

`POST /folhas/upload`: multipart com `arquivo`, `id_servidor`, `competencia`, `sobrescrever` (`true`/`false`) e, somente na substituição, `id_folha_existente`. Recebe `Idempotency-Key` e retorna o registro remoto completo com 201/200.

Sem `sobrescrever=true`, uma duplicidade retorna 409, sem alterar o original. Na sobrescrita, o backend deve conferir atomicamente se o ID ainda corresponde à folha ativa daquele servidor/mês. Uma substituição deve gerar nova identidade de folha, ou utilizar uma versão equivalente no contrato, para que o ID esperado detecte outra substituição concorrente. Se o registro mudou, retorna 409 e exige nova confirmação.

A substituição deve guardar o novo arquivo com segurança, atualizar o vínculo em uma transação, invalidar validação/envio anterior (`REVISAR`, `confirmado_em=null`), e remover o antigo apenas após a persistência. Uma falha não pode apagar o original nem reutilizar confirmação anterior. O frontend nunca emula essa operação com DELETE seguido de POST.

PDF estrito também é aplicado nas rotas Next; o backend deve conferir conteúdo, tamanho e extensão novamente. A assinatura `%PDF-` é uma checagem de formato, não uma inspeção de segurança do conteúdo.

### OCR e validação

`POST /folhas/:id/processar`: processa o arquivo existente por ID e retorna metadados completos. Não cria outro registro nem substitui automaticamente outra competência. O resultado da leitura alimenta a conferência; não confirma o vínculo por conta própria.

`PATCH /folhas/:id` recebe o payload atual:

```json
{ "id_servidor": 42, "competencia": "2026-10" }
```

Para substituir outro vínculo após AlertDialog, recebe também `sobrescrever: true` e `id_folha_existente`. Retorna a folha remota completa, com `status_ocr: "OK"` e `confirmado_em`. O backend atual rejeita esses campos adicionais com 422; a tela preserva o documento e informa o erro. O envio automático já existente após PATCH é informado na confirmação; a opção em lote continua restrita à seleção explícita.

## Importação sem CPF

Não chamar `/servidores/importar` para obter prévia: essa operação antiga já grava e exige CPF.

`POST /servidores/importar/preview`: multipart `arquivo` `.xlsx`, até 15 MB. Deve analisar, validar e comparar a matrícula com PostgreSQL **sem gravar cadastros**. Colunas: Nome, Matrícula, E-mail; opcionalmente Departamento e Carga Horária. CPF não é exigido nem retornado. Preserve a matrícula como texto, incluindo zeros iniciais.

```json
{
  "token": "token-opaco-de-previa",
  "expira_em": "2026-10-12T18:30:00Z",
  "registros": [
    { "linha": 2, "nome": "Ana Silva", "matricula": "12345", "email": "ana@example.com", "acao": "novo" },
    { "linha": 3, "nome": "Bruno Lima", "matricula": "54321", "email": "bruno@example.com", "acao": "atualizado", "motivo": "E-mail alterado" },
    { "linha": 4, "nome": "Carlos", "matricula": "", "acao": "ignorado", "motivo": "Matrícula ausente" }
  ]
}
```

Cada linha deve ser única. Registros iguais, inválidos ou duplicados na planilha são ignorados com motivo. `POST /servidores/importar/confirm` recebe `{ "token": "..." }` e `Idempotency-Key`; retorna `{ "novos": 1, "atualizados": 1, "ignorados": 1 }`. O token é vinculado ao usuário, expira e precisa conservar os registros aprovados. Se houver mudança concorrente entre prévia e confirmação, devolver 409 e solicitar nova prévia. Não confiar em contagens ou decisões enviadas pelo cliente.

`DELETE /servidores/:id` retorna 204 após excluir. Com vínculos protegidos, deve retornar 409 com mensagem explicativa; não apagar documentos associados por cascata sem uma política explícita.

## Calendário acadêmico

`GET /calendario`: array de objetos `{ id, titulo, tipo, inicio, fim }`.
`POST /calendario` e `PUT /calendario/:id`: corpo sem `id`, resposta com o objeto salvo. Tipos: `FERIADO`, `RECESSO`, `PONTO_FACULTATIVO`. Datas `YYYY-MM-DD`, intervalo inclusivo, fim ≥ início. `DELETE /calendario/:id`: 204.

## E-mails

`POST /folhas/enviar-lote` conserva `{ "month": "2026-10", "professorIds": ["42"] }`, `Idempotency-Key` e recibo `{ "jobId": "...", "status": "completed", "sentCount": 1 }`. O frontend só declara sucesso com o recibo completo. Timeout mantém a chave para consultar o mesmo lote. Sucesso libera a chave de sessão para um novo envio deliberado.

O backend precisa verificar folha vinculada e `status_ocr=OK` novamente ao enviar; a checagem do frontend não protege chamadas diretas à API. Aceitação pelo serviço de e-mail não garante entrega na caixa do destinatário.

`GET /emails/historico` aceita filtros opcionais `nome`, `matricula`, `status`, `competencia` e retorna array de:

```json
{
  "id": 100,
  "id_folha": 77,
  "nome": "Ana Silva",
  "matricula": "12345",
  "competencia": "2026-10",
  "status": "ERRO",
  "criado_em": "2026-10-12T18:00:00Z",
  "mensagem": "Falha de conexão."
}
```

Status de envio: `ENVIADO`, `ERRO`, `PROCESSANDO`, `NAO_CONFIGURADO`.
`POST /emails/reenviar-erros`: `{ "log_ids": [100] }`, com `Idempotency-Key`; retorna `{ "reenviados": 1, "ignorados": 0 }`. Revalidar aptidão, existência da folha e status do último envio; deduplicar por folha e evitar reenviar um sucesso mais recente por causa de um log antigo de erro. O backend deve registrar o resultado de cada tentativa.

## Concorrência e lock

`GET /sistema/lock`: `{ "locked": false }` ou `{ "locked": true }`, relativo ao usuário autenticado. Não expor dados pessoais do proprietário do lock. Mutações devem retornar 423 quando o usuário não tiver o acesso exclusivo; a leitura pode permanecer disponível.

A decisão deve ser atômica no backend e proteger cadastro/edição/exclusão, importação, upload, validação, processamento, calendário e envio. Lock de memória ou booleano no navegador não sincroniza máquinas. Se houver lease, o backend deve cuidar de expiração e recuperação; este frontend apenas consulta o estado, não cria um lock distribuído.

404/405/501 no endpoint significa recurso ausente. Falha de verificação bloqueia mutações e mostra indisponibilidade; apenas `locked: true` ou 423 mostra “Sistema em uso por outro usuário”.
