# Gerenciamento de documentos

## Cadastros

Os professores são carregados do PostgreSQL ao abrir a aplicação, por `GET /api/servers` → `GET /servidores`. Não há professores demonstrativos. Falhas de carregamento mostram uma opção de tentar novamente, sem substituir os documentos locais por uma lista vazia.

O cadastro usa `POST /servidores`; a edição usa `PUT /servidores/{id_servidor}`. Ambos recebem `name`, `registration`, `email`, `department` e `workload` (carga horária opcional, em horas, como inteiro positivo; vazio é `null`). O campo `workload` é salvo na coluna existente `servidor.carga_horaria`. A interface aplica os dados retornados somente após o servidor salvar. Matrículas duplicadas retornam HTTP 409; cadastro inexistente, HTTP 404; dados inválidos, HTTP 422.

IndexedDB conserva somente documentos por ID de professor. O cache antigo é migrado apenas quando ID e matrícula correspondem ao cadastro real; não sobrescreve nome, matrícula ou contato recebidos do servidor. O registro antigo permanece no armazenamento para recuperação, se necessária.

## Documentos e OCR

A inclusão inicial de PDF/JPG/PNG (até 15 MB) guarda uma prévia local. `Enviada` ainda representa essa inclusão no navegador.

`POST /api/timesheets/process` encaminha multipart com o campo `arquivo` para `POST /folhas/processar`. O backend guarda o original em `data/folhas`, executa o OCR e retorna `id_folha`, `status_ocr`, `matricula`, `competencia`, `servidor` e `mensagem`. O frontend conserva `id_folha` como `backendId`, inclusive nos estados `REVISAR` e `ERRO`, permitindo corrigir o mesmo registro.

Na conferência manual sem processamento prévio, `POST /api/timesheets/register` → `POST /folhas/registrar` guarda o arquivo e cria uma folha `REVISAR`, sem executar OCR. Se a confirmação posterior falhar, o ID é mantido para nova tentativa.

## Confirmação e correção

`PATCH /api/timesheets/{id_folha}` encaminha a correção para `PATCH /folhas/{id_folha}`:

```json
{"id_servidor": 42, "competencia": "2026-09"}
```

Em uma transação, o backend verifica folha e professor, obtém/cria a competência e atualiza `id_servidor`, `id_competencia` e `status_ocr = OK`, limpando `mensagem_ocr`. Os campos da leitura original (`matricula_lida`, `competencia_lida`) e o arquivo são preservados.

Uma folha já vinculada ao mesmo professor/competência impede a correção com HTTP 409, sem sobrescrever documentos. IDs inexistentes retornam 404; competência inválida ou anterior a 2000 retorna 422. Repetir a mesma confirmação é permitido.

A interface só move o documento para o professor/competência escolhidos após o PATCH ser confirmado. Vínculos confirmados podem ser corrigidos pelo botão **Corrigir vínculo**. Confirmações antigas feitas apenas no navegador precisam ser confirmadas novamente para serem salvas no banco.

O envio de e-mail consulta `folha_ponto`, `servidor` e `competencia` no PostgreSQL e, portanto, passa a usar o vínculo corrigido.

## Limites atuais

As prévias e o histórico exibido ainda dependem do cache de documentos deste navegador. Ainda não há listagem/download remoto para reconstruir esse histórico em outro dispositivo. Limpar o cache não apaga os arquivos e vínculos já salvos no servidor, mas eles deixam de aparecer na interface local. **Remover cópia local** também não exclui o registro do banco. Conserve os originais.

Autenticação, exclusão remota e sincronização do histórico entre dispositivos continuam fora deste fluxo. O OCR conserva o comportamento existente de atualizar a folha quando reconhece uma combinação professor/competência já registrada.

## Testes

Frontend (Node 22.13+):

```bash
cd frontend
pnpm test
pnpm exec tsc --noEmit --incremental false
```

Backend, na raiz do projeto, com as dependências de `backend/requirements.txt` instaladas:

```bash
python -m unittest discover -s tests -v
```

Para executar também a integração real, defina `FOLHA_TEST_DSN` com uma conexão PostgreSQL de testes. Cada teste cria e remove um schema exclusivo; não usa as tabelas da aplicação. Sem essa variável, os testes de integração são explicitamente ignorados.

A integração cobre cadastro, listagem, edição, duplicidade, correção de OCR, leitura dos vínculos usados pelo envio, conflitos, validação e armazenamento manual do original. Não envia e-mails. A confirmação usa o schema existente. Para a idempotência de envio, aplique `database/migrations/001_idempotency_request.sql` em bancos anteriores.
