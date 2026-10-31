# Ponto Docente — frontend

React/TypeScript com Next.js App Router. Requer Node 22.13+ (recomendado 24), pnpm 11.25.0 e FastAPI/PostgreSQL com migração 006 aplicada.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Abra http://localhost:5173. Configure `BACKEND_URL` em `.env.local`, conforme `.env.local.example`, normalmente `http://127.0.0.1:8000`. Na raiz, `bash iniciar.sh` inicia frontend e backend após preparar banco e ambiente.

Cadastros, CPF, histórico de folhas, importações, calendário, modelos gerados, e-mails e lease utilizam endpoints reais. O histórico não depende de IndexedDB. `sessionStorage` conserva somente a identidade de sessão e as chaves de envio, não documentos ou cadastros.

Use **Gerar folhas** na tela principal para o modelo institucional, versões e PDF/ZIP. O calendário usa exclusivamente `academic-api.ts` → `/api/academic` → `/datas-especiais`. A geração continua em `/folhas/gerar` e `/folhas/geradas`. Não há backend paralelo `/calendario`.

Consulte [INTEGRACAO-FRONTEND.md](INTEGRACAO-FRONTEND.md) para contratos, [README principal](../README.md) para instalação e [fluxo de documentos](../docs/FLUXO-DOCUMENTOS.md) para revisões/pendentes/multipágina.

```bash
pnpm test
pnpm exec tsc --noEmit --incremental false
pnpm lint
pnpm build
```

Geração e ZIP usam limites publicados pelo backend (500 itens e ZIP 250 MiB por padrão), com seleção protegida e timeout específico. Calendário importa Excel/XLSX ou PDF: texto digital primeiro, OCR por página quando necessário e prévia PDF antes de confirmar. O formulário de professor mantém CPF e usa selects alinhados de 20h/40h e Sim/Não; em mobile os campos ficam empilhados. Detalhes em [Calendário e geração](../docs/CALENDARIO-GERACAO.md).

Em **Gerar folhas**, Enviar todas por e-mail envia os modelos em branco da competência sem abrir cada PDF. Há prévia, envio individual sequencial sob uma ação, progresso, retomada idempotente e histórico compartilhado. Exige SMTP e migração 005. As regras de confirmação/OCR das folhas recebidas continuam intactas.

O cadastro e a edição oferecem UA, Cargo, Padrão, Função e Exercício em Dados funcionais. A prévia da importação também apresenta essas colunas opcionais. Os seletores de carga horária semanal e acumulação usam fundo branco.

No modo real, a tela inicial oferece conexão de e-mail por computador/perfil, salva no banco com criptografia até desconectar. O campo de senha não é persistido no navegador; envios exigem a conta conectada. Para acesso pela rede, usar HTTPS. [Configuração](../docs/CONTA-EMAIL.md).

## Folhas de ponto

A navegação reúne o trabalho em **Folhas de ponto**, com abas **Folhas em branco** (gerar, baixar, consultar versões e enviar modelos) e **Folhas preenchidas** (upload, conferência, situação por professor e documentos pendentes de vínculo). A competência é compartilhada entre as abas. O atalho **Gerar folhas** da página Professores abre a aba de modelos em branco. As funções e os dados existentes são preservados.
