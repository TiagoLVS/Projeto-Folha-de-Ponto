# Tarefa para o Codex — homologar os três ajustes

Abra o diretório raiz do projeto alterado no Codex e forneça estas instruções:

> Você está no código-fonte de um aplicativo Windows chamado Ponto Docente (Electron + FastAPI + PostgreSQL + React). O escopo é estritamente: (1) banco de dados PostgreSQL privado no PC principal, com migração 008 de autenticação e backup; (2) escolha de IPv4 privado correto ao exportar a conexão da equipe; (3) autenticação com primeiro administrador local, novos usuários e sessão/cookie centralizada. Não reescreva o sistema nem altere as regras de folha de ponto.
>
> Leia primeiro `docs/TRES-AJUSTES-COMO-VALIDAR.md` e os arquivos alterados. Execute `npm test` em `windows-app`, os testes Python com PostgreSQL descartável definido em `FOLHA_TEST_DSN`, `pnpm check:desktop` e `pnpm build:desktop`. Corrija qualquer falha de TypeScript, migração ou autenticação, sem relaxar os testes de segurança. Gere o executável e rode os smoke tests de Windows descritos em `docs/WINDOWS-EMPACOTAMENTO.md`, se o ambiente permitir. Valide a conexão de dois PCs na mesma LAN e login separado por funcionário, o backup do banco existente, o funcionamento da primeira conta e o bloqueio de API não autenticada. Nunca teste migrações em dados reais sem backup. Documente quais testes passou e quais dependem de uma segunda máquina ou da aprovação do responsável.

## Critério de aceite

1. Principal inicia PostgreSQL local; secundários conectam apenas por HTTPS ao principal.
2. Todas as máquinas veem os mesmos registros.
3. Primeiro administrador só é criado pelo computador principal; login funciona nas máquinas secundárias.
4. Requisições de dados anônimas devolvem 401; sessões expiram/revogam.
5. Banco anterior migra para 008 sem perder dados e com dump íntegro antes da migração.
6. Todos os testes aplicáveis passam, e o relatório explicita os testes ainda não realizados.
