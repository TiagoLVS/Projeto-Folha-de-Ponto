# Gerenciamento de documentos

A aplicação foi adaptada para documentos por professor e competência, preservando o layout e cadastro existentes. Não há mais modelo de dias, horários, cálculo de jornada ou exportação de folha artificial em HTML. O download entrega o original.

## Funcionalidades
- Upload com arrastar e soltar, PDF/JPG/PNG, limite de 15 MB; validação de tipo, extensão e tamanho no cliente.
- Prévia, tela cheia quando suportada, download, substituição confirmada e remoção confirmada.
- Estados Sem folha, Enviada, Processando, Identificada e Erro na leitura.
- Conferência dos campos retornados, seleção de professor e correção da competência antes de vincular.
- Vínculo manual explicitamente identificado, sem fabricar resultados de OCR.
- Histórico dos 12 meses, inclusive competências sem documento.
- Visão administrativa global com competência, status e busca; usa o mesmo estado da ficha.
- Proteção contra documento duplicado no destino: o usuário abre o existente para decidir a substituição.

## Persistência atual
Professores e documentos são armazenados em IndexedDB neste navegador/origem. `Enviada` representa a inclusão local. Não há arquivo central, autenticação ou sincronização entre dispositivos implementados. Limpar os dados do navegador remove os documentos. Conserve os originais. Falhas de armazenamento geram aviso e não devem ser ignoradas.

Os oito professores iniciais são exemplos e começam sem documentos. Cadastros existentes no navegador são mantidos após recarregar. O upload usa Data URL para permitir persistência e prévia; isso ocupa mais espaço que blobs. Em produção, substitua pelo armazenamento remoto e URLs autorizadas.

## Integração de leitura
`lib/timesheet-api.ts` é a fronteira de integração, sem OCR no navegador.

Contrato atual: `POST /api/timesheets/process`, multipart com `file` (original) e `id` (UUID), header `Idempotency-Key` com o mesmo UUID. Resposta síncrona HTTP 200:

```json
{"identifiedData":{"professorName":"João da Silva","registration":"123456","competence":"2026-09"}}
```

Campos ausentes aparecem como não identificados; matrícula só sugere um professor se corresponder exatamente a um cadastro. Nenhum nome provoca vínculo automático. A competência pode ser corrigida. O usuário sempre confirma. HTTP 404/405/501 informa serviço não conectado; falha de rede, timeout de 60 segundos e resposta inválida resultam em erro, com nova tentativa e opção manual. Ao sair da tela, a requisição é cancelada; recarregar durante processamento permite tentar novamente.

O backend deverá autenticar/autorizar requisições, validar o conteúdo real do arquivo, guardar o original, alinhar o documento e enviar ao OCR apenas recortes dos campos impressos. Ignorar manuscrito é responsabilidade desse processamento; o front não garante que o backend o faça.

Para produção, substitua o adaptador local por API de professores/documentos e implemente upload, listagem, confirmação, substituição e exclusão no servidor. O vínculo e a unicidade professor+competência precisam ser transacionais no servidor. Para processamento assíncrono, adicione consulta do job no adaptador. Nenhum endpoint de backend foi criado neste projeto.

O envio usa `/api/timesheets/send`; o backend consulta os vínculos entre `folha_ponto`, `servidor` e `competencia` no PostgreSQL e registra cada tentativa em `envio`.

## Verificação realizada
- TypeScript dos componentes, páginas e bibliotecas: sem erros.
- ESLint dos arquivos alterados: sem erros; avisos sobre uso de img (prévia do original e logo).
- Bundle cliente produzido com Vite.
- Adaptador de leitura: resposta válida e serviço indisponível verificados com fetch controlado, sem OCR real.

O build completo de infraestrutura não foi verificado: as dependências Cloudflare/Drizzle não estão disponíveis no ambiente de revisão. A inspeção interativa não foi concluída porque não há Chromium instalado. Nenhuma dependência foi adicionada ao projeto.
