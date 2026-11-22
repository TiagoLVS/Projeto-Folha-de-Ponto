# Ponto Docente — ajustes realizados e pendências (22/11/2026)

> **Status:** desenvolvimento revisado e testes locais concluídos parcialmente. **Não homologado para produção.** A branch foi criada a partir de `main` para preservar a versão original. A publicação do código-fonte UAT atualizado nesta branch ainda depende da sincronização da cópia local `PontoDocente-codigo-fonte-UAT-2026-11-22.zip`.

## Objetivo da branch

Registrar e publicar separadamente os três ajustes solicitados: (1) banco de dados, (2) conexão entre computadores e (3) login, sem modificar a branch principal. A homologação da versão Windows permanece para a etapa final.

## Alterações implementadas na cópia local

### 1. PostgreSQL e migrações

- Preservada a arquitetura com PostgreSQL privado no computador principal e acesso dos secundários apenas pela API.
- Migração `008_autenticacao.sql`: tabelas `usuario_sistema` e `sessao_sistema`, no banco central.
- Reforçada a proteção de migrações de bancos existentes: validação do backup por `pg_restore --list` antes da atualização.
- Atualizada a documentação das migrações 007 e 008.

### 2. Conexão entre máquinas

- Seleção explícita de IPv4 privado da interface de rede correta para exportar a conexão.
- Mantidas comunicação HTTPS e verificação da impressão digital SHA-256 do certificado.
- Melhorada a recuperação de leituras GET/HEAD após falhas transitórias de rede e respostas HTTP 502/503/504; requisições de escrita não são reenviadas automaticamente.
- Mantida a centralização de dados no computador principal, sem PostgreSQL independente nos secundários.

### 3. Login e sessões

- Implementada interface desktop para criar o administrador inicial, entrar, cadastrar usuários e sair.
- Senhas protegidas com PBKDF2-HMAC-SHA256 e sal aleatório; sessões armazenadas por hash no PostgreSQL e enviadas por cookies seguros.
- Proteção das rotas de dados, expiração de sessão, bloqueio temporário após senhas incorretas e cadastro restrito a administradores.
- Reduzida uma diferença de tempo na verificação de usuário inexistente.
- Corrigida a experiência após expiração: `401` de rota protegida provoca revalidação de status e, somente quando confirmada a ausência de autenticação, a interface retorna ao login.

## Evidências de testes já realizadas

- PostgreSQL 18.6 descartável: inicialização do schema, migração 008, persistência entre conexões e **4 testes focados de autenticação aprovados**.
- Revisões HTTP/desktop, sessão e transporte: **11 testes locais aprovados** na revisão final; outros testes de frontend e rede também passaram em etapas anteriores.
- UAT manual no Linux:
  - **Professores:** cadastro, pesquisa, detalhes, edição, exclusão, persistência e importação Excel aprovados.
  - **Calendário:** cadastro, edição, exclusão, navegação, filtros, visualização anual e importação Excel observados com sucesso.
  - **Folhas de ponto:** geração individual/em lote, download PDF/ZIP, histórico, versionamento, upload, reconhecimento e vínculo de folha preenchida observados com sucesso (processamento automático funcionou após primeira falha).
  - **E-mails:** conexão e autenticação com capturador SMTP local aprovadas; uma mensagem capturada com anexo PDF conferido por nome e SHA-256; recusas do domínio externo e registro de erros observados.
- Os testes manuais não equivalem à homologação do executável Windows.

## Pendências identificadas

### Homologação obrigatória no Windows

- Compilar e verificar o pacote independente `PontoDocente.exe` em Windows x64.
- Confirmar o primeiro administrador somente no principal; login válido/inválido, permissões, logout, expiração e bloqueio de acesso a API/telas.
- Conectar dois computadores pela rede local, importar JSON, validar HTTPS/certificado/fingerprint e comprovar o compartilhamento de dados e a recuperação após falhas de rede.
- Testar inicialização, parada, persistência e backup/migração do PostgreSQL privado em perfis Windows descartáveis.
- Confirmar regras de firewall, porta 5173 e comportamento quando o IP do principal mudar.

### Validações funcionais adicionais

- Investigar a primeira falha de leitura da folha preenchida, embora nova tentativa tenha funcionado.
- Confirmar importação de calendário por PDF e prevenção de matrícula duplicada.
- Validar separadamente conferência manual de folha e substituição efetiva de documento.
- Validar reenvio de mensagens com erro e comportamento com um servidor SMTP real em ambiente apropriado (sem disparar para destinatários reais nesta fase).
- Revisar possível diferença de preenchimento visual em domingo da folha gerada e campos cadastrais vazios, se reproduzida.
- Registrar resultados de testes finais no documento de homologação.

## Documentação da cópia UAT

- `docs/RELATORIO-ENTREGA-TRES-AJUSTES.md`
- `docs/RELATORIO-TESTES-FUNCIONAIS.md`
- `docs/HOMOLOGACAO-FINAL.md`
- `docs/REVISAO-INTEGRACAO-LINUX.md`

**Segurança da publicação:** não adicionar `.env`, segredos/credenciais SMTP, bancos de dados, arquivos de professores reais, diretórios `.smtp-capture`, `.venv`, `node_modules`, caches ou saídas de build. Verificar o diff antes de fazer push e não mesclar na `main` sem revisão.
