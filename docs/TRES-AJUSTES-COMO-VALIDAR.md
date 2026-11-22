# Ponto Docente — três ajustes (banco, rede e login)

> **Escopo:** aplicar somente as três melhorias solicitadas pelo colega, sem reescrever o restante do projeto. O ZIP fonte não é um executável Windows. **Não houve homologação real em dois computadores Windows nem migração de uma base de produção.**

## 1. Banco de dados: PostgreSQL único no computador principal

- A arquitetura original mantém o PostgreSQL privado apenas no **principal**. O backend FastAPI e a interface são acessados pelas máquinas da equipe; o arquivo `conexao-equipe.json` não contém credenciais do PostgreSQL.
- O bootstrap do banco está em `windows-app/app/runtime.py`: detecta/cria o banco privado, verifica versões, exige um dump íntegro do banco **existente** antes de aplicar migrações pendentes, aplica cada migração em uma transação e registra versão.
- A migração `008_autenticacao.sql` cria `usuario_sistema` e `sessao_sistema` (tokens armazenados como hash SHA-256). Os arquivos de dados anteriores não são apagados pelo upgrade.
- **Antes de instalar uma versão modificada:** fechar o aplicativo principal, salvar backup completo de `%APPDATA%\PontoDocenteUnDF\principal` e, se houver dados legados, testar a restauração em outra instalação. O backup automático de migração fica na pasta `principal\backups`.
- Se houver um banco **existente** sem `schema_migration`, a atualização é interrompida e deve ser revisada por quem mantém a base; não foi adicionada migração destrutiva.

## 2. Rede: exportar endereço correto

1. Computador principal e equipe na mesma rede local confiável. Apenas o principal inicia PostgreSQL e FastAPI. Firewall Windows deve permitir a porta de entrada TCP 5173 para **rede privada**, não para redes públicas.
2. No **principal**, abrir **Aplicativo → Exportar conexão da equipe**. Se houver várias interfaces (Wi-Fi, cabo, VPN, virtual), o app mostrará os IPs locais privados ativos. Selecionar o IP que as outras máquinas conseguem alcançar. Confirmar com `ipconfig` no principal, se necessário.
3. No **secundário**, abrir aplicativo → **Conectar ao computador principal** → importar JSON. A resposta do principal em `/_ponto/status` e o certificado TLS com fingerprint são validados antes de abrir a interface.
4. Confirmar cadastro em uma máquina e consulta da **mesma linha** na outra. Testar fechamento e reabertura da aplicação principal.
5. Se IP mudar, reiniciar o principal e exportar novo JSON; preferir reserva DHCP para manter IP estável. Não abrir a porta no roteador para a internet.

### Problemas frequentes de conexão

- Principal desligado ou aplicativo fechado → equipe não consegue alcançar a API.
- Adaptador Wi-Fi e Ethernet em redes diferentes → escolher endereço da rede correta no exportador.
- Firewall bloqueando TCP 5173 → permitir o aplicativo/porta somente no perfil privado.
- Rede de convidados ou isolamento AP → dispositivos podem não enxergar uns aos outros.
- JSON antigo depois da mudança de IP ou certificado → exportar e importar novamente.

## 3. Login

- O modo Windows ativa `PONTO_AUTH_REQUIRED=true` e `PONTO_DESKTOP_MODE=1` ao iniciar FastAPI. O modo de desenvolvimento web não foi alterado automaticamente.
- Na primeira execução, **somente a janela aberta no computador principal** consegue criar a conta administradora. Usuário: 3–50 caracteres (`a-z`, dígitos, ponto, `_` ou `-`). Senha: pelo menos 12 caracteres.
- Depois, o administrador entra e pode usar **Novo usuário** para criar contas da equipe; cada funcionário entra com seu próprio usuário/senha em qualquer computador autorizado.
- Senhas: PBKDF2-HMAC-SHA256 com sal único e 600.000 iterações. Sessões: cookie `HttpOnly`, `Secure`, `SameSite=Strict`, validade de 12 horas; token aleatório e somente seu hash no PostgreSQL. Após cinco falhas, a conta fica bloqueada por 15 minutos.
- A API FastAPI exige sessão em todas as rotas de dados no modo Windows, inclusive quando a chamada não parte da interface. O endpoint de teste da rede não expõe os registros.
- O botão **Sair** revoga a sessão; contas não são criadas automaticamente nos secundários. A criação de usuários é restrita aos administradores.

## Validação técnica / Codex

```bash
# na raiz do código-fonte
python -m unittest discover -s tests -v     # requer dependências Python e banco de testes descartável (FOLHA_TEST_DSN)
cd windows-app && npm test                   # testes Node.js do launcher, certificados e rede
cd ../frontend && pnpm install --frozen-lockfile
pnpm check:desktop
pnpm build:desktop
```

**Windows:** seguir `docs/WINDOWS-EMPACOTAMENTO.md` para empacotar e homologar. Fazer validação de ponta a ponta **em duas máquinas**, incluindo: (1) banco novo com criação de administrador; (2) banco antigo com backup + migração 008; (3) login da equipe e proteção de API antes de login; (4) cadastro visível nas duas; (5) sessão expirada; (6) login após reiniciar principal; (7) falha de conexão e recuperação. **Não usar dados reais até os testes em Windows terminarem.**

## Arquivos principais alterados

- `windows-app/app/host.cjs`: endereços IPv4 privados, marcação confiável da conexão local, configuração do backend.
- `windows-app/app/main.cjs`: escolha do adaptador/IP ao exportar JSON.
- `windows-app/app/runtime.py`: backup do PostgreSQL e migrações seguras.
- `backend/startup.py`, `database/migrations/008_autenticacao.sql`: migração versionada.
- `backend/auth.py`, `backend/api.py`, `backend/desktop.py`: autenticação, rotas e proteção de API.
- `frontend/components/desktop-auth.tsx`, `windows-app/frontend/main.tsx`: criação inicial do administrador, login, gestão de contas e sair.
- `tests/test_autenticacao.py`, `windows-app/tests/network.test.cjs`: testes de regressão.
