# Relatório de Testes de Aceitação do Usuário (UAT)

**Projeto:** Ponto Docente  
**Ambiente:** Linux, frontend Next.js, backend FastAPI, PostgreSQL descartável e capturador SMTP local  
**Data do relatório:** 24/11/2026 (adendos UAT até esta data)  
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

O reenvio manual de uma falha foi aprovado no Teste 17 (adendo abaixo). A entrega por SMTP real continua pendente: o capturador local confirma apenas a composição e a captura, não a entrega fora do ambiente de teste.

## Pendências para homologação

- Login visual no aplicativo Windows.
- Permissões na interface desktop.
- Conexão entre dois computadores.
- Testes do launcher Windows.
- Importação de calendário por PDF, caso não haja outra evidência de aprovação.
- Validação de matrículas duplicadas.
- Investigação da primeira falha de leitura do PDF.
- Confirmação de anexo PDF em e-mail entregue por SMTP real.
- Entrega por SMTP real, fora do capturador local.

## Conclusão

Professores foi aprovado nos fluxos listados. Calendário, Folhas de Ponto e E-mails foram parcialmente aprovados devido às pendências específicas registradas neste documento. A validação ocorreu no Linux e não cobre login e permissões na interface desktop Windows, operação entre computadores ou entrega real de e-mails. O sistema **não deve ser considerado homologado para produção** com base nestes resultados.

## Adendo UAT — apresentação dos status de OCR (23/11/2026)

A apresentação dos status foi corrigida no frontend: `REVISAR` aparece como **Aguardando análise**, com destaque amarelo, e permanece separado de `ERRO`, que aparece como **Erro na leitura** em vermelho. `PROCESSANDO` continua como **Processando** e `OK` como **Identificada**. Filtros e contadores acompanham a mesma classificação. Os valores armazenados pelo backend não foram alterados; documentos em revisão continuam sujeitos à validação e não ficam aptos ao envio de e-mail sem confirmação válida.

A causa da primeira ocorrência relatada de “Erro na leitura” durante o processamento do PDF permanece indeterminada. Esta correção trata a apresentação equivocada de `REVISAR` como falha e não altera nem comprova a causa daquela ocorrência inicial. A validação funcional continua parcial; o sistema **não está homologado para produção**.

## Adendo UAT — Teste 17: reenvio de e-mails com erro (24/11/2026)

**Resultado: APROVADO no ambiente Linux de homologação**, limitado ao reenvio para o capturador SMTP local com dados sintéticos.

- O histórico de `folha_reenvio_uat` contém a tentativa original **ID 1 / ERRO** e a nova tentativa **ID 2 / ENVIADO**, ambas vinculadas ao documento sintético **ID 1**.
- A captura local passou de duas para três mensagens. A nova mensagem foi destinada a `capture@ponto.test` e continha um anexo PDF.
- O SHA-256 do PDF capturado coincidiu com o PDF associado ao documento no banco. O backend respondeu HTTP 200 e não foi encontrado erro relacionado ao reenvio nos logs disponíveis.
- O botão **Reenviar erros (0)** foi observado após a operação, coerente com não haver mais tentativa elegível.

**Limitações:** o SMTP foi um capturador local sem relay; não houve entrega a servidor SMTP externo. `folha_test` não foi comparado antes e depois. A tentativa foi executada pelo backend configurado para `folha_reenvio_uat`, mas este relatório não afirma uma comparação independente do conteúdo de `folha_test`. O teste usou apenas professor, documento e endereços sintéticos. Portanto, o resultado aprova o fluxo local de reenvio, não a entrega real nem a homologação de produção.

## Revisão de pendências Linux (24/11/2026)

Esta revisão distingue as evidências automatizadas das verificações manuais; a existência de teste ou implementação não prova a experiência visual em navegador.

| Área | Evidência e situação | Próxima verificação |
|---|---|---|
| Aviso de formato da matrícula no Firefox | A pendência foi reportada, mas não há reprodução, captura ou registro de resolução no relatório nem nos testes encontrados. Continua **não resolvida/não verificada**. | Reproduzir e documentar em Firefox no Linux com dado sintético. |
| Estado OCR “Aguardando análise” | Testes frontend cobrem rótulo, filtro, separação de `REVISAR`/`ERRO` e inelegibilidade para envio. O adendo anterior registra a correção visual, mas não identifica uma sessão manual com evidência. **Automação aprovada; confirmação visual manual pendente.** | Conferir no navegador uma folha sintética `REVISAR`, incluindo cor, contador, filtro e distinção de `ERRO`. |
| Aviso de desenvolvimento do frontend | Durante uma sessão de desenvolvimento em `/emails`, o Next registrou falha de hidratação: o HTML cliente continha `.translate-tooltip-mtz.translator-hidden`, ausente no HTML inicial. Isso sugere alteração do DOM por extensão de tradução, mas a causa não foi isolada. Não há indicação de falha funcional da rota; `/emails` respondeu HTTP 200. | Repetir em perfil limpo/sem extensões e registrar console e terminal. Se persistir, investigar antes de aprovar a apresentação visual. |
| Relatórios UAT | O histórico deste documento preserva os adendos de 22, 23 e 24/11 e corrige o estado anterior que listava o reenvio como pendente. Relatórios técnicos mais antigos refletem escopos e datas próprios; não são evidência nova para os fluxos manuais atuais. | Ao consolidar novos resultados, incluir data, ambiente, evidência e limitações sem apagar conclusões históricas. |

## Plano restante de homologação funcional

| Funcionalidade | Situação atual | Evidência disponível | Pendência | Teste manual | Ambiente |
|---|---|---|---|---|---|
| Professores: cadastro, busca, edição, exclusão e importação XLSX | Aprovado conforme registro manual anterior | Relatório UAT; testes automatizados para validações e importação | Revalidar matrícula duplicada na interface, se ainda for critério de aceite | Sim, para a regra visual/fluxo | Linux |
| Calendário: CRUD e importação Excel | Parcialmente aprovado | Relatório UAT; testes automatizados | Importação de calendário PDF sem evidência manual | Sim | Linux |
| Folhas: geração, download, ZIP e histórico | Parcialmente aprovado | Relatório UAT e testes automatizados; PDFs sintéticos | Investigar a falha inicial de OCR; confirmação em tela do estado `REVISAR` | Sim | Linux |
| Folhas: OCR e apresentação “Aguardando análise” | Automação aprovada; visual pendente | `frontend/tests/timesheet-status.test.mjs`; adendo de 23/11 | Conferir fluxo e cores em navegador | Sim | Linux |
| Matrícula no Firefox | Pendente | Relato sem reprodução anexada | Reproduzir o aviso e avaliar se há defeito | Sim | Linux |
| E-mails: envio local inicial e reenvio de falha | Aprovado no capturador local | Teste 17, histórico IDs 1/2, captura `.eml`, PDF e SHA-256 | SMTP externo não validado | Já exercitado manualmente; não repetir sem novo cenário autorizado | Linux |
| Logs/console do frontend em desenvolvimento | Pendente de diagnóstico | Aviso de hidratação observado em `/emails`, aparentemente com nó `translator-hidden` | Repetir sem extensões e confirmar se persiste | Sim | Linux |
| Login/contas, permissões desktop e launcher | Não coberto por esta UAT funcional Linux | Testes automatizados e relatórios técnicos separados | Validar pacote e comportamento integrado no Windows | Sim | Windows |
| Conexão entre principal e secundário, firewall, HTTPS e dados compartilhados | Não aprovado manualmente em dois computadores | Testes unitários/integração Linux documentados | Jornada ponta a ponta em rede privada | Sim, duas máquinas | Windows |
| Backup/restauração e migração do perfil desktop | Pendente | Roteiro em `docs/HOMOLOGACAO-FINAL.md`; testes em fixtures | Executar em perfil descartável com dados fictícios | Sim | Windows |

Para fechar a homologação funcional Linux, faltam reproduzir/avaliar o aviso de matrícula no Firefox, verificar visualmente `REVISAR` e confirmar se o erro de hidratação persiste em perfil limpo. Também continuam pendentes a duplicidade de matrícula na interface, a importação de calendário PDF e a investigação da falha inicial de OCR, conforme o escopo de aceite. O aviso de hidratação só é um bloqueio do produto se persistir sem extensões. Entrega SMTP real não bloqueia a validação Linux com capturador, mas impede afirmar entrega externa/produção. A homologação de launcher, firewall, certificado desktop, login integrado no pacote e comunicação entre computadores depende de Windows; a validação de rede requer duas máquinas.

**Conclusão atualizada:** o Teste 17 está aprovado para reenvio local capturado. Permanecem pendências funcionais Linux e testes obrigatórios do pacote Windows. O sistema **não está homologado para produção**.
