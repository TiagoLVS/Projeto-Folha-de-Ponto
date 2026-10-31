# Ponto Docente · UnDF — Windows

Aplicativo para cadastrar professores, gerar folhas de ponto, conferir documentos recebidos e enviar as folhas por e-mail, preservando o visual do sistema.

## Abrir o aplicativo

1. Extraia a pasta completa do arquivo `PontoDocente-Windows-Independente-x64.zip`.
2. Abra **PontoDocente.exe**. Não execute diretamente de dentro do ZIP.
3. Na primeira abertura, escolha o tipo de instalação.

O pacote inclui Electron, PostgreSQL privado, FastAPI, Python, OCR e uma interface React estática. Não inclui servidor Next nem `node_modules` do frontend. Os usuários não precisam instalar Python, Node.js ou PostgreSQL, nem abrir um terminal.

**Situação do pacote:** gerado fora do Windows. Ainda precisa ser homologado em Windows 10/11 x64 antes de uso em produção, incluindo inicialização, reinicialização, OCR, compartilhamento e envio de e-mail. O executável não possui assinatura digital de editor.

## Computador principal

Escolha **Este é o computador principal** em apenas uma máquina. O aplicativo prepara um banco novo e inicia os serviços automaticamente.

- Mantenha o aplicativo aberto e o computador ligado durante o uso da equipe.
- Permita acesso na **rede privada** quando o Firewall do Windows solicitar.
- No menu **Aplicativo → Exportar conexão da equipe**, salve o arquivo JSON e entregue-o às outras máquinas.
- Fechar o aplicativo principal encerra os serviços e interrompe o acesso da equipe, preservando os dados.

O banco e os PDFs existentes em outra instalação não são copiados automaticamente. Para transferi-los, o responsável precisa restaurar um backup e ajustar os caminhos dos documentos. Não distribua o banco antigo dentro do ZIP.

## Demais computadores

Abra o mesmo executável, escolha **Conectar ao computador principal** e selecione o arquivo JSON fornecido pelo responsável. A conexão fica salva para as próximas aberturas.

Todos acessam os mesmos cadastros, PDFs e histórico. O banco não é duplicado nos computadores da equipe. A comunicação usa HTTPS, com certificado verificado pelo aplicativo a partir do arquivo de conexão. Se o endereço da máquina principal mudar, exporte e importe a conexão novamente.

Não há login de acesso ao sistema. O compartilhamento é destinado à rede local privada e confiável da equipe. O controle de edição existente continua evitando alterações concorrentes.

## Conectar Gmail

Na tela **Conectar conta de e-mail**, informe o endereço completo e uma **senha de aplicativo**. A senha normal da conta não é utilizada por esta integração SMTP.

A conta Google precisa ter verificação em duas etapas. Consulte as [instruções oficiais para senhas de aplicativo](https://support.google.com/accounts/answer/185833?hl=pt-BR). Restrições da organização podem impedir essa opção.

- Cada computador/perfil mantém sua própria conta conectada até **Desconectar e-mail**.
- A senha é armazenada cifrada no banco do computador principal.
- Conectar verifica a conta, mas não envia mensagem.
- Este pacote inicia em modo real: os envios vão aos endereços cadastrados.
- Falhas de internet, tempo de espera, certificado e autenticação têm mensagens distintas.

Salvar a conta não dispensa conexão com a internet nem autorização do Gmail. A instalação Windows usa `smtp.gmail.com`, porta `465`, SSL.

## Aparência

Em **Configurações → Tema**, o padrão **Sistema** acompanha o tema claro/escuro do Windows, inclusive se ele mudar com o aplicativo aberto. Você também pode escolher **Claro** ou **Escuro**. A preferência fica somente neste computador/perfil.

## Folhas de ponto

- **Folhas em branco:** gerar PDFs, consultar versões, baixar e enviar por e-mail.
- **Folhas preenchidas:** adicionar PDFs, conferir o vínculo e acompanhar pendências.
- **Professores:** cadastrar, editar, excluir ou importar planilhas.
- **Calendário:** cadastrar datas ou importar o calendário acadêmico.
- **E-mails:** consultar destinatários, resultados e reenvios.

## Dados, backup e atualização

Os dados do principal ficam em `%APPDATA%\PontoDocenteUnDF\principal`. Não coloque a subpasta `postgres` em uma pasta de rede.

Para backup completo, feche o aplicativo principal e copie a pasta `principal` inteira. Preserve `data`, `postgres`, `secrets`, `certificado`, `backups` e `banco.bin`. A proteção de `banco.bin` depende do usuário do Windows; para migrar para outro usuário/computador, use uma transferência técnica por `pg_dump`/`pg_restore` e revise os caminhos dos PDFs.

Atualize somente a pasta extraída do programa. As migrações do banco privado são precedidas por um dump na pasta `backups`. Não substitua ou apague os dados do perfil do Windows durante uma atualização.

## Suporte

Use **Aplicativo → Abrir pasta de suporte**. Os registros do principal ficam em `principal\logs`. Informe a mensagem apresentada; não envie senhas nem arquivos privados.

O pacote para entrega fica em `windows-app/release/`, acompanhado de um arquivo SHA-256. [Documentação de montagem e testes](docs/WINDOWS-EMPACOTAMENTO.md).
