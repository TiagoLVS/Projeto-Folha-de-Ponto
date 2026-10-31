# Montagem técnica do aplicativo Windows

O aplicativo tem dois modos: principal (PostgreSQL privado + FastAPI + Next standalone + gateway HTTPS) e equipe (acesso HTTPS ao principal, sem outro banco). Electron mantém a interface existente. Não é necessário um servidor previamente instalado no computador principal.

## Montar

No ambiente de desenvolvimento, instalar dependências do frontend conforme `package.json`, dependências Python e 7-Zip. Na pasta `windows-app`:

```text
npm ci
npm run build
npm test
```

`PYTHON` pode apontar para um Python de desenvolvimento com pip. O script usa o ambiente `.venv` do projeto, se existir. O build baixa wheels Windows x64/CPython 3.13; não executa binários Windows no host. O módulo principal `build.py` usa `pnpm build` e o frontend standalone de produção. A instalação do pacote extraído não executa pip/npm nem acessa sites de download.

Runtimes fixados por URL e SHA-256 em `runtime-sha256.json`. Esses hashes registram os artefatos obtidos por HTTPS, não substituem uma assinatura do fornecedor. Atualizações dos runtimes exigem revisar URLs/hashes e homologar novamente. Electron é obtido pelo Packager, com verificação do mecanismo de download do Electron. Os wheels ficam registrados com seus hashes no pacote.

Inclui PostgreSQL 17, Python 3.13 embeddable, Tesseract 5.4 e idioma português, Electron 45 e dependências Python fixadas. O backend do pacote usa uvicorn sem extras Unix. A montagem copia uma lista explícita de fontes e rejeita `.env`, chaves e configuração local. PDFs, banco real e credenciais não são incluídos.

Fontes: [Python](https://www.python.org/downloads/release/python-3139/), [PostgreSQL/EDB](https://www.postgresql.org/download/windows/), [OCR UB Mannheim](https://github.com/UB-Mannheim/tesseract/releases/tag/v5.4.0.20240606), [Tessdata](https://github.com/tesseract-ocr/tessdata_fast), [Electron](https://www.electronjs.org/docs/latest/tutorial/security). As licenças dos componentes precisam acompanhar a distribuição; PyMuPDF usa AGPL ou licença comercial.

## Armazenamento e segurança

`PONTO_DATA_DIR` permite gravar os PDFs fora dos arquivos do programa. Sem a variável, o desenvolvimento mantém `data/` no projeto. O pacote usa o perfil Windows para dados, logs, certificados e segredos, sem alterar o `.env` da instalação de desenvolvimento.

PostgreSQL e FastAPI escutam somente em loopback, em portas internas escolhidas na inicialização. O frontend Node standalone usa o Node incluído no Electron (`ELECTRON_RUN_AS_NODE`). Apenas o gateway HTTPS porta 5173 escuta na rede; solicitações de endereços públicos são rejeitadas. Não há serviço instalado no Windows nem inicialização automática ao ligar o computador: abrir/fechar o principal inicia/encerra os serviços.

O certificado é criado localmente por cryptography. O arquivo de conexão contém somente URL e impressão digital SHA-256. O cliente confere o certificado exato, sem desativar a verificação para outros destinos. O fluxo de senha de e-mail continua exigindo HTTPS em rede. Nenhum cliente recebe senha de PostgreSQL ou chave SMTP.

A senha do banco privado é gerada aleatoriamente e protegida com safeStorage/DPAPI; é passada aos processos por ambiente. A chave de cifragem SMTP fica em `principal/secrets`. O perfil Windows deve ser protegido. Não é um produto para exposição pública na internet: os usuários da rede privada acessam o sistema sem login, conforme o requisito existente.

## Homologação Windows obrigatória

1. Extração em pasta com espaços e usuário com acentos, sem Python/Node/PostgreSQL no PATH.
2. Primeira abertura e reabertura do principal, persistência de cadastros/PDFs/contas.
3. Conexão de dois computadores com JSON exportado; certificado incorreto deve falhar.
4. Geração PDF, upload multipágina, OCR português, calendário, Excel e limites.
5. Conexão Gmail com senha de aplicativo e envio somente a destinatários fictícios autorizados.
6. Encerramento do principal sem processos órfãos, preservando serviços que não pertencem ao aplicativo.
7. Backup, atualização, migração com dump prévio e recuperação de falha.
8. Firewall privado e mensagens quando a porta 5173 estiver ocupada ou principal indisponível.

A validação feita no host de montagem não substitui esses testes Windows. Não foi usado Wine nem executado um binário Windows aqui.

O workflow manual `windows-app.yml` monta o pacote em Windows e executa `scripts/smoke.cjs` com dados temporários, verificando cadastro, geração de PDF, persistência, HTTPS e reinicialização. O workflow não foi disparado nesta sessão. A interface gráfica, DPAPI e OCR real permanecem na homologação manual.
