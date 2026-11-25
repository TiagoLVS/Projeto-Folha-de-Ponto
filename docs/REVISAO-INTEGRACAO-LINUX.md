# Revisão de integração Linux — Ponto Docente

Data da revisão: 21/11/2026. Esta revisão não equivale à homologação do executável Windows ou à validação entre dois computadores reais.

## Integração conferida

- `database/folha_pontos.sql` fornece a estrutura base até a versão 007. `backend/startup.py` aplica migrações pendentes somente com autorização explícita; `windows-app/app/runtime.py` inicializa o PostgreSQL privado do computador principal e valida a conexão antes de iniciar o backend.
- `database/migrations/008_autenticacao.sql` cria `usuario_sistema` e `sessao_sistema` no mesmo PostgreSQL. O backend `backend/auth.py` usa essas tabelas para usuários e sessões; `backend/api.py` monta o roteador e middleware de autenticação.
- No desktop, `frontend/lib/api-transport.ts` envia as rotas `/api/...` à mesma origem. `backend/desktop.py` adapta os caminhos ao FastAPI, sem duplicar as regras. O endpoint de autenticação do frontend e o backend usam `/api/auth/...` e `/auth/...`, respectivamente.
- O computador principal expõe o gateway HTTPS da equipe na porta 5173. `windows-app/app/host.cjs` exporta o IP privado selecionado e `windows-app/app/network.cjs` valida o endpoint de status e o fingerprint SHA-256 do certificado importado. O JSON de conexão não contém credenciais do banco.
- `frontend/lib/auth-session.ts` confirma o estado da sessão após HTTP 401; falhas de rede não são tratadas como sessão expirada. Leituras podem ser repetidas após falhas transitórias e HTTP 502/503/504; mutações não são repetidas automaticamente.

## Testes aprovados

### Executados na Etapa 5B — PostgreSQL e autenticação

- PostgreSQL 18.6 descartável iniciado em localhost, em porta diferente de 5432; schema base inicializado e migração 008 aplicada pelo inicializador.
- Persistência aprovada: registro fictício inserido e lido em outra conexão.
- `tests/test_autenticacao.py`: 4 testes aprovados, 0 reprovados. Cobriram criação do primeiro administrador restrita ao principal, login, senha inválida/bloqueio, sessão, rota protegida, cadastro administrativo, logout e expiração.
- A instância foi parada após os testes e os dados descartáveis foram preservados para investigação.

### Executados nesta revisão — sequencialmente

| Comando/arquivo | Resultado |
|---|---|
| `node --experimental-strip-types --test --test-isolation=none --test-concurrency=1 tests/auth-session.test.mjs` (em `frontend`) | 4 aprovados: 401/expiração, login/logout, falhas de rede e ausência de loop. |
| `node --experimental-strip-types --test --test-isolation=none --test-concurrency=1 tests/api-transport.test.mjs` (em `frontend`) | 3 aprovados: retry de leituras, gateway temporariamente indisponível e ausência de retry em mutações/cancelamentos. |
| `node --test --test-concurrency=1 tests/network.test.cjs` (em `windows-app`) | Processo de teste concluiu com código 0. |
| `python -m unittest discover -s tests -p test_desktop.py -k mapeamento -v` (na raiz, usando `.venv` de validação) | 1 aprovado: mapeamento de rotas permitido e rejeição de caminhos inválidos. |
| Casos `test_conta_email_requer_https_ou_loopback`, `test_preserva_corpo_query_headers_sem_proxy_intermediario` e `test_index_assets_sem_fallback_para_erros` (individualmente, fora da sandbox) | 3 aprovados: política de origem HTTPS, preservação de corpo/query/headers e resposta de assets/rotas. |
| Reteste `frontend/tests/auth-session.test.mjs` e `frontend/tests/api-transport.test.mjs` após o diagnóstico | 7 aprovados: 4 de sessão/autenticação e 3 de transporte HTTP. |

Os resultados PostgreSQL/autenticação acima foram reutilizados nesta revisão porque os arquivos de código do ZIP fonte coincidem byte a byte com os arquivos atuais; a instância PostgreSQL não foi iniciada novamente.

## Diagnóstico do timeout do TestClient

O timeout foi causado pela sandbox de execução usada nos primeiros comandos, não pelo adaptador nem pelas versões instaladas. Dentro da sandbox, até uma rota GET de uma aplicação FastAPI mínima expirou. A mesma aplicação mínima respondeu HTTP 200 fora dela. A pilha do caso bloqueado mostrava a chamada esperando no `starlette.testclient.TestClient.handle_request`/portal AnyIO; não havia acesso a PostgreSQL, SMTP ou outra dependência externa nesse fluxo.

Fora da sandbox, cada um dos três casos HTTP afetados passou isoladamente com limite de 15 segundos. O caso de mapeamento também passou. Nenhum código de produção ou teste precisou de alteração. A suíte completa de `tests/test_desktop.py` não foi executada, conforme a restrição de não rodar a suíte completa.

## Pendências

- Executar no Windows o workflow de montagem, os testes de serviços/janela e os smoke tests do pacote.
- Homologar o principal e um secundário em duas máquinas Windows reais: firewall privado, certificado, login centralizado, registros compartilhados, reinicialização, desconexão/reconexão e persistência.
- Testar backup e migração em perfil descartável com dados fictícios. Nenhum banco real foi migrado.

O projeto não está homologado para distribuição ou uso com dados reais até que essas pendências sejam concluídas.
