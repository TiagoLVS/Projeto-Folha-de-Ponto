> **Fluxo atualizado:** consulte [FLUXO-DOCUMENTOS.md](./FLUXO-DOCUMENTOS.md) para as funcionalidades de documentos, persistência local, integração e limitações.

# Ponto Docente — UnDF

Front-end React + TypeScript com identidade UnDF, implementado a partir do projeto Figma. O projeto usa Vinext/Vite e a estrutura App Router compatível com Next.js.

## Executar localmente

Requer Node.js 22.13+ e pnpm (versão especificada em package.json).

```bash
cd ponto-docente
Ls
npx pnpm@11.25.0 install --frozen-lockfile
npx pnpm@11.25.0 dev

```

Abra o endereço local informado pelo terminal. O código-fonte não depende de uma conta Figma para funcionar.

## Arquivos principais

- `app/page.tsx`: painel, perfil, edição, busca, filtros, modal de e-mail e loading.
- `app/globals.css`: estilos de base e controles.
- `app/glass.css`: visual translúcido inspirado no iPhone, navegação flutuante, responsividade e animação de entrada.
- `lib/ponto.ts`: tipos, dados demonstrativos, validação dos horários e cálculo em minutos.
- `app/desktop-glass.css` e `app/clean-desktop.css`: desktop, botões padronizados e acabamento de vidro discreto.
- `lib/export-sheet.ts`: folha HTML imprimível e download.
- `lib/send-sheets.ts`: cliente de envio em lote, timeout e validação da confirmação.
- `API-ENVIO.md`: contrato para conectar o serviço de envio real.
- `public/undf-logo.png`: logo original enviada pelo usuário.

## Loading

A animação é CSS e monta recortes da própria imagem da logo com profundidade, foco gradual e encaixe suave. Mantém as cores originais e encerra com uma transição para o painel. Inclui botão para pular e suporte a `prefers-reduced-motion`.

## Funcionalidades

- Busca por nome (ignorando acentos) ou matrícula, com filtros combinados.
- Seleção de competência e identificação de folhas não preenchidas.
- Cadastro editável com validação e bloqueio de matrícula duplicada.
- Histórico individual por ano e competência.
- Edição dos registros diários, validação de datas e horários, soma de horas e minutos.
- Salvamento de rascunho, conclusão de folha e atualização do resumo.
- Download de folhas HTML (abra no navegador e imprima/salve como PDF).
- Um botão “Enviar todas” para solicitar o lote completo, incluindo a opção de somente pendentes.
- Bloqueio de cliques repetidos, mensagem de erro e confirmação de lote aceito pela API.

## Limites desta entrega de front-end

Os registros são demonstrativos e ficam somente na memória da sessão: recarregar a página reinicia os dados. Não há banco de dados ou autenticação implementados no aplicativo.

O front chama `POST /api/timesheets/send` uma vez para todos os destinatários selecionados. Essa rota encaminha o lote ao backend, que busca folhas e destinatários no PostgreSQL, gera um anexo por professor e registra cada tentativa na tabela `envio`. As credenciais de e-mail ficam somente no backend.
