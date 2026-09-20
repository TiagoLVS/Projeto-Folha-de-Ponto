import shutil
from pathlib import Path
from uuid import uuid4

from backend.database.repository import (
    buscar_servidor_por_matricula,
    obter_competencia,
    salvar_folha,
)

from backend.ocr.reader import (
    executar_ocr,
    EXTENSOES_SUPORTADAS,
)


RAIZ_PROJETO = Path(__file__).resolve().parents[2]

PASTA_FOLHAS = RAIZ_PROJETO / "data" / "folhas"


def armazenar_arquivo(caminho_original):
    """
    Copia PDF, PNG, JPG ou JPEG para data/folhas,
    preservando a extensão original.
    """

    caminho_original = Path(caminho_original)

    extensao = caminho_original.suffix.lower()

    if extensao not in EXTENSOES_SUPORTADAS:
        raise ValueError(
            f"Formato não suportado: {extensao}"
        )

    PASTA_FOLHAS.mkdir(
        parents=True,
        exist_ok=True,
    )

    identificador = uuid4().hex[:8]

    novo_nome = (
        f"{caminho_original.stem}_"
        f"{identificador}"
        f"{extensao}"
    )

    destino = PASTA_FOLHAS / novo_nome

    shutil.copy2(
        caminho_original,
        destino,
    )

    return destino


def processar_folha(caminho_arquivo):

    caminho_arquivo = Path(caminho_arquivo)

    if not caminho_arquivo.exists():
        raise FileNotFoundError(
            f"Arquivo não encontrado: {caminho_arquivo}"
        )

    arquivo_salvo = armazenar_arquivo(
        caminho_arquivo
    )

    try:

        resultado = executar_ocr(
            arquivo_salvo
        )

        matricula = resultado["matricula"]
        mes = resultado["mes"]
        ano = resultado["ano"]

        servidor = None

        id_servidor = None
        id_competencia = None

        problemas = []

        # -----------------------------------------
        # Procura servidor
        # -----------------------------------------

        if matricula:

            servidor = buscar_servidor_por_matricula(
                matricula
            )

            if servidor:

                id_servidor = servidor[
                    "id_servidor"
                ]

            else:

                problemas.append(
                    "Matrícula não encontrada no banco."
                )

        else:

            problemas.append(
                "Matrícula não identificada pelo OCR."
            )

        # -----------------------------------------
        # Competência
        # -----------------------------------------

        if mes and ano:

            id_competencia = obter_competencia(
                mes,
                ano,
            )

        else:

            problemas.append(
                "Competência não identificada pelo OCR."
            )

        # -----------------------------------------
        # Status
        # -----------------------------------------

        if (
            id_servidor is not None
            and id_competencia is not None
        ):

            status = "OK"
            mensagem = None

        else:

            status = "REVISAR"
            mensagem = " ".join(problemas)

        # -----------------------------------------
        # Banco
        # -----------------------------------------

        id_folha = salvar_folha(
            id_servidor=id_servidor,
            id_competencia=id_competencia,
            caminho_arquivo=str(arquivo_salvo),
            nome_arquivo=arquivo_salvo.name,
            matricula_lida=matricula,
            competencia_lida=resultado[
                "competencia"
            ],
            status_ocr=status,
            mensagem_ocr=mensagem,
        )

        return {
            "id_folha": id_folha,
            "status_ocr": status,
            "matricula": matricula,
            "competencia": resultado[
                "competencia"
            ],
            "servidor": servidor,
            "arquivo": str(arquivo_salvo),
            "mensagem": mensagem,
            "texto_ocr": resultado["texto"],
        }

    except Exception as erro:

        id_folha = salvar_folha(
            id_servidor=None,
            id_competencia=None,
            caminho_arquivo=str(arquivo_salvo),
            nome_arquivo=arquivo_salvo.name,
            matricula_lida=None,
            competencia_lida=None,
            status_ocr="ERRO",
            mensagem_ocr=str(erro),
        )

        return {
            "id_folha": id_folha,
            "status_ocr": "ERRO",
            "mensagem": str(erro),
        }