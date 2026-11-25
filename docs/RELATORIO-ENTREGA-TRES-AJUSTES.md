# Relatório técnico de entrega — três ajustes do Ponto Docente

**Projeto:** Ponto Docente — aplicação de gestão de folhas de ponto
**Stack:** React, TypeScript, Electron, Python, FastAPI e PostgreSQL
**Escopo deste relatório:** banco de dados, comunicação entre computadores e autenticação
**Status:** implementação revisada e validação Linux concluída nos limites descritos abaixo. O sistema ainda não foi homologado em computadores Windows.

## 1. Resumo do projeto

O Ponto Docente mantém cadastros e documentos de folhas de ponto em um backend FastAPI ligado a PostgreSQL. A interface React atende ao aplicativo Electron. No modo de equipe, um computador principal hospeda o backend e o banco privado; os computadores secundários acessam a interface e os mesmos dados pela rede local.

## 2. Objetivo dos ajustes

1. **PostgreSQL:** manter um banco central no computador principal, com inicialização e migrações versionadas e preservação dos dados existentes.
2. **Conexão entre computadores:** permitir que secundários encontrem e validem o principal sem expor credenciais do banco nem remover a validação HTTPS.
3. **Login:** proteger as rotas de dados, restringir a criação inicial da conta ao principal e centralizar usuários e sessões no PostgreSQL.

## 3. Arquitetura identificada

```text
Computador principal
Electron → PostgreSQL privado (loopback)
         → FastAPI → interface React estática
         → gateway HTTPS na rede local

Computador secundário
Electron → HTTPS do principal com certificado fixado
         → FastAPI do principal → PostgreSQL central
```

O banco não é iniciado nos secundários. A conexão exportada contém a URL HTTPS e a impressão digital do certificado, não usuário ou senha do PostgreSQL. O backend expõe as mesmas rotas de negócio à interface web e à interface desktop por adaptadores de caminho.

## 4. Banco de dados PostgreSQL

### Implementado

- `database/folha_pontos.sql` define a estrutura base até a versão 007. Bancos existentes avançam pelas migrações versionadas, em ordem.
- `database/migrations/008_autenticacao.sql` adiciona `usuario_sistema` e `sessao_sistema` ao banco existente. A migração registra a versão no controle `schema_migration`.
- `backend/startup.py` diagnostica a instalação e só aplica migrações quando recebe autorização explícita. O runtime Windows (`windows-app/app/runtime.py`) prepara o PostgreSQL privado do principal, verifica a conexão e cria backup validado antes de migrar um banco existente.
- O caminho de atualização não recria tabelas nem apaga registros de negócio.

### Efetivamente testado

Em uma instância descartável PostgreSQL 18.6, em porta local diferente de 5432, foram inicializados o schema base e a migração 008. Foram confirmadas as tabelas de autenticação e a persistência de um registro fictício, lido novamente por outra conexão. A instância foi encerrada ao final; nenhum banco real foi utilizado.

## 5. Comunicação entre computadores

### Implementado

- O principal escolhe um endereço IPv4 privado ativo e exporta a conexão da equipe.
- O secundário importa o JSON e consulta `/_ponto/status`; o aplicativo verifica o certificado pelo fingerprint SHA-256 antes de abrir a interface.
- O gateway HTTPS atende a rede local na porta 5173. PostgreSQL permanece acessível somente pelo principal e em loopback.
- O transporte frontend repete somente leituras após erros transitórios ou respostas 502, 503 e 504. Escritas não são reenviadas automaticamente.

### Efetivamente testado

Os testes unitários de rede do Electron concluíram com código zero. Os testes do transporte verificaram os retries de leitura, a indisponibilidade temporária e a ausência de repetição de mutações. O adaptador desktop passou testes isolados de mapeamento, origem segura, preservação do corpo/query/headers e serviço de arquivos estáticos.

Esses testes não substituem uma conexão real entre dois computadores Windows; essa validação permanece pendente.

## 6. Login e sessões

### Implementado

- No modo Windows, as rotas de dados exigem sessão. A primeira conta administradora só pode ser criada no computador principal; administradores autorizados podem cadastrar usuários.
- Senhas são protegidas por PBKDF2-HMAC-SHA256 com salt individual. Após cinco tentativas inválidas, a conta é bloqueada temporariamente.
- O backend gera tokens aleatórios, armazena somente o hash do token no PostgreSQL e transmite a sessão por cookie `HttpOnly`, `Secure` e `SameSite=Strict`, com validade de 12 horas.
- Logout remove a sessão do servidor. Sessões expiradas são rejeitadas pelo backend.
- Quando uma rota protegida retorna HTTP 401, o frontend consulta o estado da sessão e retorna à tela de login se a sessão estiver inválida. Falhas de rede durante essa verificação não são tratadas como expiração.

### Efetivamente testado

Os quatro testes de integração de autenticação passaram contra PostgreSQL descartável. Cobriram bootstrap restrito ao principal, login válido e inválido, bloqueio após tentativas, criação e uso de sessão, acesso protegido, cadastro administrativo, logout e rejeição de sessão expirada. Quatro testes unitários de sessão no frontend também passaram, incluindo o retorno ao login e o tratamento distinto de falhas de rede.

## 7. Problemas identificados e correções

- **Leituras durante indisponibilidade transitória:** o transporte foi ajustado para tentar novamente leituras em falhas de rede e respostas 502/503/504, sem repetir mutações.
- **Estado visual após expiração:** foi corrigido o fluxo para revalidar o estado no backend após HTTP 401 de rota protegida, apresentar a tela de login e informar a expiração. A interface preserva o estado autenticado quando a falha é apenas de conexão.
- **Migração de autenticação:** as tabelas de usuários e sessões foram integradas à sequência versionada pela migração 008.
- **Timeout do TestClient no Linux:** a execução dentro da sandbox expirava até com uma rota FastAPI mínima. Fora da sandbox, a rota mínima respondeu HTTP 200 e os casos HTTP do adaptador passaram individualmente. A causa foi a restrição do ambiente de execução isolado; não houve necessidade de alterar código ou instalar dependências.

## 8. Testes e evidências

| Área | Resultado comprovado | Limite da evidência |
|---|---|---|
| PostgreSQL e migração 008 | Schema inicializado, migração aplicada e tabelas de autenticação verificadas em PostgreSQL 18.6 descartável. | Não foi migrada uma base de produção ou Windows existente. |
| Persistência | Registro fictício gravado e lido em conexão separada. | Não substitui backup/restauração Windows. |
| Autenticação backend | 4 testes aprovados, sem falhas. | Execução local Linux com banco descartável. |
| Sessão frontend | 4 testes aprovados; 401, logout, falha de rede e ausência de loop verificados. | Não substitui uso interativo do pacote Windows. |
| Transporte HTTP frontend | 3 testes aprovados; retry somente em leituras e tratamento de erros transitórios. | Testes unitários, sem rede física entre computadores. |
| Rede/certificado Electron | Teste Node existente terminou com código zero; fingerprint e configuração foram exercitados pelo teste de rede. | Não equivale a duas máquinas Windows na mesma LAN. |
| Adaptador HTTP desktop | Testes isolados de mapeamento e três caminhos HTTP aprovados fora da sandbox. | A suíte completa não foi executada. |
| Timeout TestClient | Reproduzido apenas na sandbox; FastAPI mínimo e casos do adaptador passaram fora dela. | Diagnóstico do executor Linux, não homologação de Windows. |

Os testes foram executados em processos sequenciais. Não foram usados dados reais. Os resultados completos desta revisão estão em `docs/REVISAO-INTEGRACAO-LINUX.md`.

## 9. Arquivos principais envolvidos

**Banco e inicialização:**

- `database/folha_pontos.sql`
- `database/migrations/001_idempotency_request.sql` a `database/migrations/008_autenticacao.sql`
- `backend/startup.py`
- `windows-app/app/runtime.py`

**Backend e autenticação:**

- `backend/auth.py`
- `backend/api.py`
- `backend/desktop.py`

**Frontend, sessões e transporte:**

- `frontend/lib/api-transport.ts`
- `frontend/lib/auth-session.ts`
- `frontend/components/desktop-auth.tsx`
- `windows-app/frontend/main.tsx`

**Conexão desktop/rede:**

- `windows-app/app/host.cjs`
- `windows-app/app/network.cjs`
- `windows-app/app/main.cjs`

**Testes e documentação:**

- `tests/test_autenticacao.py`
- `tests/test_desktop.py`
- `frontend/tests/auth-session.test.mjs`
- `frontend/tests/api-transport.test.mjs`
- `windows-app/tests/network.test.cjs`
- `docs/ALTERACOES-BANCO.md`
- `docs/TRES-AJUSTES-COMO-VALIDAR.md`
- `docs/HOMOLOGACAO-FINAL.md`
- `docs/WINDOWS-EMPACOTAMENTO.md`
- `docs/REVISAO-INTEGRACAO-LINUX.md`

## 10. Limitações e pendências

- Não houve homologação em dois computadores Windows reais.
- Não foram validados em Windows o firewall, DPAPI, o certificado e a seleção de interface em diferentes adaptadores.
- Permanecem pendentes os testes Windows de inicialização/reinicialização, login pela rede, compartilhamento dos mesmos registros, desconexão/reconexão, backup e migração em perfil descartável.
- Não foi executada compilação Windows nesta fase Linux. Os testes descritos não certificam o pacote executável nem seu comportamento com dados reais.

## 11. Próxima etapa — homologação em computadores Windows

Em uma máquina Windows x64 de build, seguir `docs/WINDOWS-EMPACOTAMENTO.md` para instalar as ferramentas de montagem, executar os testes e gerar o pacote. Depois, com dados e contas fictícios, seguir `docs/HOMOLOGACAO-FINAL.md` em dois computadores Windows na mesma rede privada: configurar o principal, criar o administrador, cadastrar usuário, exportar/importar a conexão, confirmar registros compartilhados e testar login, logout, expiração, falha/reconexão, backup e migrações.

**Conclusão:** os três ajustes estão implementados e possuem validação Linux nos limites registrados. O projeto não deve ser considerado completamente homologado até a montagem e a homologação Windows descritas acima.
