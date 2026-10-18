# Folhas recebidas, arquivos e histórico remoto

## Upload e histórico

O contrato atual aceita somente PDF, MIME `application/pdf`, até 15 MB, prefixo `%PDF-` e abertura válida com PyMuPDF. PDFs vazios, protegidos por senha, corrompidos ou acima de 100 páginas são recusados. PNG/JPG não fazem parte do upload atual.

`POST /folhas/upload` recebe multipart: arquivo, id_servidor, competencia AAAA-MM, sobrescrever (false por padrão) e, na substituição, id_folha_existente. Exige Idempotency-Key; o hash inclui bytes e vínculo. A interface envia até 20 PDFs por lote, com resultado por item, sem desfazer os que já foram armazenados. Cada arquivo é uma requisição idempotente independente.

`GET /folhas` aceita id_servidor e retorna ID, servidor, competência, status OCR, nome, tamanho, datas de importação/processamento/atualização, confirmado_em, matrícula/competência lidas, mensagem, versão e último resultado de envio. O frontend monta o histórico remoto; não depende de IndexedDB. Registros legados incompletos ficam disponíveis em `GET /folhas/pendentes` e na interface para conferência/vínculo.

`GET /folhas/{id}/arquivo` serve PDF para preview/download. O caminho vem do banco, precisa estar dentro do armazenamento de recebidas e é resolvido com proteção contra traversal/links externos. Não aceita caminho do cliente. Registros inativos não são baixados por essa rota.

## Nome, duplicidade e revisões

Pasta: `data/folhas/Folhas_AAAA-MM/`. Arquivo ativo: `Nome_do_servidor-AAAA-MM.pdf`. A função central sanitiza Unicode, acentos, espaços, pontuação, separadores, pontos e nome vazio. Homônimos são desambiguados pela matrícula. Campos do navegador não viram caminho de arquivo.

A combinação ativa servidor/competência tem índice único parcial. Sem autorização ou com ID esperado desatualizado, retorna 409. Sobrescrever bloqueia o cadastro/registro na transação, move o original para `Nome_AAAA-MM_OLD_AAAAMMDD-HHMMSS.pdf` (mantendo o hífen original antes da competência), marca a revisão anterior inativa e cria outro ID em REVISAR, sem confirmação/envio herdados. O timestamp do sufixo é UTC; colisões no mesmo segundo recebem identificador adicional.

Movimentações são revertidas se a transação falha. O arquivo antigo e os logs de envio permanecem ligados à revisão anterior. `DELETE /folhas/{id}` é remoção do histórico ativo: arquiva com OLD e preserva banco/arquivo por integridade. Não é exclusão física dos registros históricos. Servidor com qualquer vínculo protegido não pode ser excluído (409).

Backups precisam incluir PostgreSQL e `data/folhas/`. Uma interrupção abrupta do sistema operacional entre mover arquivos e commit pode exigir reconciliação manual com os caminhos/revisões; não existe transação distribuída entre disco e PostgreSQL. Falhas normais da aplicação têm rollback dos movimentos e são testadas.

## OCR e PDFs multipágina

`POST /folhas/{id}/processar` identifica cada página separadamente. Texto digital é aproveitado; páginas digitalizadas usam Tesseract/por com timeout por página. A competência vem do conteúdo, incluindo REFERÊNCIA: MÊS/AAAA em português; o seletor da interface não substitui a leitura.

Uma página retorna matrícula, competência, servidor encontrado, status e mensagem. Um pacote multipágina permanece em REVISAR; páginas com o mesmo servidor/competência são marcadas como duplicadas. Os resultados persistem em `resultado_paginas`.

`GET /folhas/pacotes` lista candidatas ainda não importadas, inclusive quando o original já está arquivado. Na interface, selecione servidor/competência para cada página e use Importar página. `POST /folhas/{id}/paginas/{pagina}/importar` separa o PDF, utiliza o mesmo mecanismo de armazenamento/OLD e registra o ID importado. A candidata não é importada duas vezes silenciosamente. O original completo é preservado.

## Confirmação e envio

`PATCH /folhas/{id}` recebe id_servidor e competencia, além de sobrescrever/id_folha_existente se houver conflito. Reorganiza o caminho para o vínculo conferido, preserva a leitura OCR, grava status OK e confirmado_em e tenta enviar após o commit. Falha do envio não desfaz a confirmação. O resultado de e-mail aparece separadamente.

Um pacote multipágina deve ser separado antes de confirmar folhas individuais. A confirmação manual de uma folha de uma página é permitida após conferência do original. Gerar modelos em branco é um fluxo separado; não executa OCR, confirmação ou SMTP.

Os antigos uploads sem vínculo e endpoints de processamento por arquivo foram substituídos pelo fluxo upload persistido → processamento por ID → confirmação. O histórico antigo não é apagado e os pendentes podem ser regularizados pela interface.
