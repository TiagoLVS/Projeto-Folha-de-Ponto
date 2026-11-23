# Relatório de Testes de Aceitação do Usuário (UAT)

**Projeto:** Ponto Docente
**Ambiente:** Linux, frontend Next.js, backend FastAPI, PostgreSQL descartável e capturador SMTP local
**Data do relatório:** 22/11/2026
**Resultado geral:** validação funcional parcial; não homologado para produção.

## Escopo e base dos resultados

Este relatório consolida os resultados dos testes manuais informados para os módulos Professores, Calendário, Folhas de Ponto e E-mails. Não foram executados novos fluxos funcionais durante a consolidação. A checagem de e-mail descrita abaixo foi somente de leitura.

“Aprovado” significa que o fluxo foi exercitado manualmente e apresentou o resultado esperado no ambiente Linux informado. Itens sem evidência disponível permanecem pendentes; não são considerados aprovados por inferência.

## Resultados

### Professores — aprovado

- Cadastro manual, pesquisa e visualização de detalhes.
- Edição e exclusão.
- Persistência após atualização da página.
- Importação de planilha Excel.

Permanece pendente a validação de matrículas duplicadas.

### Calendário — parcialmente aprovado

- Cadastro, edição e exclusão de eventos.
- Navegação entre meses, filtros e visualização anual.
- Importação de planilha Excel.

Não foi apresentada evidência de importação de calendário por PDF; esse formato permanece pendente.

### Folhas de Ponto — parcialmente aprovado

- Geração individual de PDF e geração em lote.
- Download individual e download ZIP.
- Consulta do histórico e versionamento.
- Upload de folha preenchida.
- Processamento automático aprovado após uma tentativa inicial com erro.
- Identificação do professor e validação do vínculo.
- Persistência e download do documento recebido.

Permanece pendente investigar a primeira falha de leitura do PDF. A confirmação do anexo em mensagem realmente entregue por SMTP também permanece pendente; a evidência local não demonstra entrega externa.

### E-mails — parcialmente aprovado

- Conexão com SMTP local e autenticação SMTP.
- Um envio local confirmado como bem-sucedido pela interface.
- Registro de erros e filtros do histórico.
- Recusa de destinatários externos pelo capturador local.

#### Conferência somente de leitura do capturador

Foi localizada a mensagem `.eml` correspondente ao envio local de validação. Ela contém um anexo PDF com assinatura válida; o anexo coincide, por nome e SHA-256, com o PDF local esperado. Nenhuma mensagem foi enviada durante esta conferência.

O capturador é um destino local de teste: aceita apenas endereços de teste e não retransmite as mensagens. Portanto, esta verificação confirma a composição e captura local do e-mail com o PDF, mas não confirma entrega por um servidor SMTP real nem o recebimento por um destinatário externo.

Permanecem pendentes o reenvio de falhas e a entrega por SMTP real.

## Pendências para homologação

- Login visual no aplicativo Windows.
- Permissões na interface desktop.
- Conexão entre dois computadores.
- Testes do launcher Windows.
- Importação de calendário por PDF, caso não haja outra evidência de aprovação.
- Validação de matrículas duplicadas.
- Investigação da primeira falha de leitura do PDF.
- Confirmação de anexo PDF em e-mail entregue por SMTP real.
- Reenvio de falhas e entrega por SMTP real.

## Conclusão

Professores foi aprovado nos fluxos listados. Calendário, Folhas de Ponto e E-mails foram parcialmente aprovados devido às pendências específicas registradas neste documento. A validação ocorreu no Linux e não cobre login e permissões na interface desktop Windows, operação entre computadores ou entrega real de e-mails. O sistema **não deve ser considerado homologado para produção** com base nestes resultados.

## Adendo UAT — apresentação dos status de OCR (23/11/2026)

A apresentação dos status foi corrigida no frontend: `REVISAR` aparece como **Aguardando análise**, com destaque amarelo, e permanece separado de `ERRO`, que aparece como **Erro na leitura** em vermelho. `PROCESSANDO` continua como **Processando** e `OK` como **Identificada**. Filtros e contadores acompanham a mesma classificação. Os valores armazenados pelo backend não foram alterados; documentos em revisão continuam sujeitos à validação e não ficam aptos ao envio de e-mail sem confirmação válida.

A causa da primeira ocorrência relatada de “Erro na leitura” durante o processamento do PDF permanece indeterminada. Esta correção trata a apresentação equivocada de `REVISAR` como falha e não altera nem comprova a causa daquela ocorrência inicial. A validação funcional continua parcial; o sistema **não está homologado para produção**.
