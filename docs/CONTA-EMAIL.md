# Conta de e-mail salva por computador

Com `DIGEP_MODO_TESTE=false`, a abertura do sistema apresenta **Conectar conta de e-mail**, com e-mail e senha de aplicativo/SMTP. A aplicação autentica no serviço configurado, sem enviar mensagem de teste. O remetente dos próximos envios é a conta conectada neste computador, não o endereço antigo do `.env`.

**Agora não** permite continuar usando cadastros, calendário e documentos. Envios manuais, lotes e reenvios de erros ficam bloqueados até conectar. Confirmar uma folha sem conta salva o vínculo, mas retorna que o envio não está configurado. Não é uma tela de login para acesso ao sistema.

A barra mostra a conta utilizada e oferece **Desconectar e-mail**. Cada computador/perfil mantém sua própria conta, sem compartilhar credenciais com os demais.

## Credenciais e duração

- Conta e senha são salvas no PostgreSQL como um conteúdo cifrado com [Fernet](https://cryptography.io/en/latest/fernet/).
- A chave é criada automaticamente no servidor em `.secrets/email.key`, com permissão 0600. Ela não fica no banco e não é versionada. Faça backup separado desta chave: sem ela será necessário conectar as contas novamente. Todos os workers precisam usar a mesma chave.
- Alternativas de instalação: `EMAIL_CREDENTIALS_KEY_FILE` ou `EMAIL_CREDENTIALS_KEY` (chave Fernet). Não substituir a chave enquanto houver contas salvas.
- A conta continua conectada após fechar a aplicação, reiniciar o servidor ou passar oito horas, até clicar em **Desconectar e-mail**. Desconectar exclui o registro daquele cliente no banco; não apaga os logs de envio.
- O navegador guarda somente um identificador aleatório em `localStorage`, nunca a senha SMTP. Esse identificador permite usar a conta salva, portanto não deve ser compartilhado. A API devolve somente estado e endereço de e-mail.
- O isolamento é por perfil do navegador/aplicativo e endereço do sistema: outro navegador, perfil, endereço ou limpeza dos dados locais exige conectar novamente. Pessoas que usam o mesmo perfil compartilham a conta desse perfil. Não há identificação física do computador.
- O campo de senha é limpo após a tentativa de conexão ou fechamento da tela.

## Instalação central

O responsável continua configurando `SMTP_HOST`, `SMTP_PORT` e `SMTP_SECURITY` (`ssl` ou `starttls`) no servidor. Os usuários informam apenas a conta compatível com esse serviço e sua senha de aplicativo/SMTP. Não é possível fornecer um host arbitrário pela tela. A conta precisa permitir autenticação SMTP usando e-mail e senha; este fluxo não implementa OAuth.

O modo de teste mantém o comportamento anterior: não pede conta e utiliza as credenciais de teste do ambiente. Os utilitários Python executados fora da API também conservam a configuração por ambiente.

Em rede, o frontend deve estar acessível por **HTTPS**, também quando aberto pelos clientes Windows/Linux. A tela bloqueia a transmissão da senha antes de fazer a requisição se estiver aberta por HTTP em endereço de rede; a rota proxy também verifica o transporte. HTTP é permitido em loopback (`localhost`, `127.0.0.1`, `[::1]`) para uso no próprio computador. O backend continua restrito ao loopback, acessado pelo proxy do frontend.

Faça backup do banco e aplique `bash iniciar.sh --migrar` para adicionar a migração **007_conta_email.sql**. A migração não modifica os servidores nem o histórico de envios. Reinicie o servidor e atualize a página no navegador.

## API

- `GET /emails/conta`: estado do cliente atual.
- `POST /emails/conta`: `{ "email": "conta@exemplo.com", "senha": "senha-de-aplicativo" }`; autentica por TLS e salva as credenciais cifradas.
- `DELETE /emails/conta`: remove a conta salva do cliente.
- Proxy Next: `/api/email-account`, preservando `X-Email-Client-Id` (persistente) e `X-Client-Id` (reserva de edição) e sem cache.

A conexão da conta não edita dados de negócio e não mantém o lock do PostgreSQL durante a autenticação SMTP. A reserva de uso do sistema continua sendo aplicada às alterações de negócio e aos envios.

Para Gmail, senhas de app dependem de verificação em duas etapas e podem não estar disponíveis conforme a política da conta/organização. Consultar as [instruções oficiais do Google](https://support.google.com/accounts/answer/185833?hl=pt-BR). Não confundir a senha de aplicativo com a senha normal da conta.

## Falhas de conexão Gmail

O diagnóstico distingue DNS, timeout, certificado, conexão recusada e autenticação. A espera de conexão SMTP é 15 segundos por operação, e a tela aguarda até 70 segundos, permitindo que o backend devolva o erro pelo proxy. A senha de aplicativo do Gmail pode ser colada com os espaços de apresentação (quatro grupos de quatro caracteres). Não há autenticação real nem envio durante os testes automatizados.
