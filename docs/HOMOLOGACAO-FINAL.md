# Homologação final do Ponto Docente no Windows

Este roteiro valida PostgreSQL, conexão entre computadores e login no pacote Windows. Faça a homologação somente com dados fictícios, em perfis de teste separados dos perfis usados no trabalho. A aprovação exige os critérios objetivos abaixo; testes estáticos ou no Linux não substituem a validação em dois computadores Windows.

## Pré-requisitos

- Dois computadores Windows 10/11 x64 na mesma rede local privada e confiável. Não use rede de convidados, VPN ou rede pública.
- O ZIP Windows mais recente, extraído por completo em uma pasta local. O executável deve permanecer junto da pasta `resources`; não execute de dentro do ZIP.
- Um perfil de Windows dedicado a teste no computador principal. O banco privado fica em `%APPDATA%\PontoDocenteUnDF\principal`; não use um perfil com dados reais.
- Acesso para permitir o aplicativo no Firewall do Windows somente para **rede privada**. A equipe acessa o gateway HTTPS na porta 5173; não abra a porta do PostgreSQL na rede.
- Registros e usuários fictícios. Não conecte conta SMTP nem envie e-mails reais durante estes testes.

O pacote inclui Electron, FastAPI, Python, PostgreSQL e OCR. A equipe não precisa instalar essas dependências. O principal deve permanecer aberto enquanto os secundários usam o sistema.

## Inicializar e verificar o computador principal

1. No computador de teste escolhido como principal, extraia o ZIP e abra `PontoDocente.exe`.
2. Selecione **Este é o computador principal** e aguarde a preparação terminar. O aplicativo prepara PostgreSQL local, FastAPI, certificado HTTPS e interface.
3. Se o Windows perguntar, permita o acesso somente na rede privada.
4. Na tela de preparação, aguarde os indicadores **PostgreSQL ✓** e **Backend ✓ · Interface ✓**. No menu **Aplicativo → Abrir pasta de suporte**, abra `principal\logs\servicos.log`; ele deve registrar `PostgreSQL TCP / autenticação / SELECT 1 OK`, sem erro de inicialização.
5. Na mesma pasta, confira `postgres.log` quando precisar investigar o servidor. Não encerre nem reinicie serviços manualmente para contornar falhas.

**Aprovação:** a tela principal abre e o log confirma conexão TCP, autenticação e `SELECT 1`. **Reprovação:** qualquer etapa falha, o app não chega à interface ou o log mostra erro de banco/backend.

## Criar administrador e usuários

1. Na primeira abertura de um perfil de teste sem contas, a interface do principal deve mostrar **Criar administrador**.
2. Crie um usuário fictício e uma senha de pelo menos 12 caracteres. Após a criação, entre com essa conta.
3. Use **Novo usuário** para cadastrar um usuário comum fictício. Se necessário, crie também um segundo administrador para testar a permissão administrativa.
4. No secundário ainda não configurado, confirme que a tela não permite criar a primeira conta: a criação inicial deve ser concluída no principal.
5. Entre no secundário depois de configurá-lo, usando a conta de teste criada no principal. O backend do principal autentica essa conta no PostgreSQL central.
6. Entre com a conta comum e confirme que **Novo usuário** não é exibido. Entre com a conta administradora e confirme que a opção aparece.

**Aprovação:** o primeiro administrador só é criado no principal, as contas são aceitas no principal e no secundário, e somente administradores podem cadastrar contas. **Reprovação:** o secundário cria a conta inicial ou uma conta comum consegue cadastrar usuários.

## Configurar o computador secundário e conferir dados compartilhados

1. No principal, use **Aplicativo → Exportar conexão da equipe**. Se houver mais de um endereço, compare os nomes/IPs exibidos com `ipconfig` e escolha o endereço da interface ligada à mesma rede local que o secundário usa.
2. Salve o JSON de conexão e entregue-o ao secundário por um canal confiável. O arquivo contém a URL HTTPS e a impressão digital do certificado; não o edite.
3. No secundário, abra o mesmo `PontoDocente.exe`, escolha **Conectar ao computador principal** e selecione o JSON. A conexão deve passar pela verificação HTTPS antes de abrir a interface.
4. Depois de entrar com um usuário de teste, crie um registro fictício na área de professores. No outro computador, atualize/abra a mesma listagem e confirme que o registro aparece.
5. Feche e reabra a aplicação do secundário. A instalação salva deve reutilizar a conexão configurada.

**Aprovação:** os dois computadores veem o mesmo registro e o secundário não inicia um PostgreSQL próprio. **Reprovação:** o JSON é rejeitado, o certificado não confere, a interface não abre ou os dados divergem entre máquinas.

## Login, logout e expiração de sessão

1. Faça login com a conta de teste no principal e no secundário. Confirme que a área de dados abre em ambos.
2. Com a conta administradora, cadastre um usuário comum e confirme que esse usuário consegue entrar. Um usuário/senha incorretos devem ser rejeitados; após cinco senhas incorretas para a conta, novas tentativas devem informar bloqueio temporário por 15 minutos.
3. No secundário, clique em **Sair**. A tela de login deve reaparecer. Confirme que o principal continua autenticado; o logout revoga a sessão daquele cookie, não a sessão independente do outro computador.
4. Para validar expiração sem alterar banco, mantenha uma sessão fictícia aberta por 12 horas. Depois, sem recarregar toda a janela primeiro, acione uma leitura protegida normal da interface, como abrir/atualizar a listagem de professores.
5. Após o servidor rejeitar a sessão, a interface deve voltar à tela de login e mostrar **Sua sessão expirou. Entre novamente.** Dados já gravados devem continuar no servidor e reaparecer depois de novo login.
6. Se a rede estiver indisponível durante a revalidação de sessão, a interface não deve afirmar que a sessão expirou. Restaure a rede e tente novamente.

**Aprovação:** login e logout funcionam; a sessão expirada é rejeitada e a interface volta ao login com a mensagem; novo login recupera os registros salvos. **Reprovação:** rota protegida abre sem sessão, logout não revoga a sessão, HTTP 401 não retorna à tela de login, a mensagem atribui expiração a uma falha de rede ou algum registro salvo desaparece.

## Reconexão após falha de rede

1. Com ambos os computadores conectados e autenticados, interrompa por alguns segundos a rede do secundário ou desconecte-o do Wi-Fi. Não desligue o PostgreSQL e não altere o Firewall do principal.
2. Tente abrir/atualizar uma listagem no secundário. A interface pode informar falha enquanto a rede está fora.
3. Restaure a mesma conexão de rede e repita a leitura. O transporte tenta novamente leituras após falhas transitórias e respostas 502, 503 ou 504. Uma indisponibilidade prolongada pode exigir que o usuário repita a ação ou recarregue/reabra a aplicação.
4. Confirme que uma gravação não é repetida automaticamente: verifique que não surgiu duplicata após reconectar. Não use o teste de falha para interromper uma gravação em andamento com dados reais.
5. Feche e abra o principal; depois, reabra o secundário. O principal deve preservar os dados e o secundário deve validar novamente o arquivo de conexão salvo.

**Aprovação:** a falha é apresentada sem apagar dados; leituras voltam após restaurar a rede e repetir a ação; não há duplicatas. **Reprovação:** leitura permanece indisponível após a rede voltar e nova tentativa, ocorre repetição automática de gravação ou dados confirmados desaparecem.

Se o IP do principal mudar, exporte um JSON novo no principal e importe-o novamente no secundário. Se o principal estiver fechado, o acesso da equipe fica indisponível até que ele seja aberto.

## Persistência, backup e migrações com dados de teste

### Persistência e cópia de segurança

1. No perfil descartável do principal, crie registros fictícios e confirme que são vistos pelo secundário.
2. Feche o aplicativo principal antes do backup. Pelo Explorador de Arquivos, copie a pasta inteira `%APPDATA%\PontoDocenteUnDF\principal` para uma pasta de teste separada.
3. Confirme que a cópia preservou `data`, `postgres`, `secrets`, `certificado`, `backups` e `banco.bin`. Não copie a pasta PostgreSQL enquanto o aplicativo estiver aberto nem coloque-a em pasta de rede.
4. Para testar uma restauração de verdade, use somente um ambiente descartável e a transferência técnica documentada com `pg_dump`/`pg_restore`; restaure em uma instância de teste separada e confirme pela interface que os registros fictícios reaparecem. O aplicativo não oferece um botão de restauração. Não restaure sobre o perfil de trabalho.

**Aprovação:** o backup fechado contém os itens indicados e a restauração isolada devolve os registros fictícios. **Reprovação:** o backup está incompleto, foi feito com o principal em execução ou a restauração só funciona sobrepondo dados de trabalho.

### Migração

1. Para uma instalação nova, use um perfil Windows descartável: a inicialização prepara o schema base e aplica as migrações pendentes, incluindo `008_autenticacao`. Em `principal\logs\servicos.log`, procure `Migração aplicada: 008_autenticacao` e a conclusão da inicialização.
2. Para testar atualização de banco existente, use somente um perfil de teste originado por uma versão anterior e com dados fictícios. Feche cópias não utilizadas e abra a versão nova nesse perfil descartável.
3. Antes de aplicar migrações em banco existente, o runtime cria um arquivo `.dump` em `%APPDATA%\PontoDocenteUnDF\principal\backups`, valida o arquivo com a ferramenta `pg_restore --list` incluída e só então aplica as migrações pendentes.
4. Confira em `servicos.log` `Backup pré-migração salvo em: ...` e `Migração aplicada: ...`; confirme que o `.dump` existe, tem tamanho maior que zero e que os registros fictícios continuam visíveis após reiniciar.
5. Se não houver uma cópia de teste da versão anterior, não simule a atualização alterando o banco de trabalho. Marque a migração de banco existente como pendente até obter um perfil/fixture descartável apropriado.

**Aprovação:** a migração só prossegue depois do backup validado, registra a versão aplicada e preserva os dados fictícios. **Reprovação:** a migração ocorre sem arquivo de backup validado, falha sem informar o erro ou perde registros. A instalação nova não gera backup pré-migração, pois ainda não existe banco anterior.

## Registro de resultados

Preencha cada linha com **Aprovado** ou **Reprovado**, a data, a versão do pacote e a observação/log relevante. Se um cenário não pôde ser executado (por exemplo, não há fixture anterior para migração), registre **Pendente**; não o marque como aprovado.

| Verificação | Resultado | Evidência/observação |
|---|---|---|
| Inicialização do principal e PostgreSQL (`SELECT 1`) |  |  |
| Criação do administrador apenas no principal |  |  |
| Cadastro de usuário e restrição de administrador |  |  |
| Exportação/importação da conexão e validação HTTPS |  |  |
| Acesso aos mesmos registros nos dois computadores |  |  |
| Login, logout e bloqueio após tentativas inválidas |  |  |
| Expiração de 12 horas e retorno à tela de login |  |  |
| Falha/restauração de rede e nova leitura |  |  |
| Persistência após fechar e reabrir o principal |  |  |
| Cópia e restauração isolada do backup |  |  |
| Backup e migração da versão anterior em perfil descartável |  |  |

Não use dados reais nem considere o projeto homologado enquanto houver itens pendentes ou reprovados.
