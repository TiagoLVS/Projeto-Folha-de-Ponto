import os
import re
from pathlib import Path

import fitz
import pytesseract

from PIL import Image, ImageOps
from dotenv import load_dotenv


RAIZ_PROJETO = Path(__file__).resolve().parents[2]

load_dotenv(RAIZ_PROJETO / ".env")


# Se TESSERACT_CMD estiver definido no .env, usa ele.
# No Linux normalmente não é necessário, pois o executável
# fica em /usr/bin/tesseract.
tesseract_cmd = os.getenv("TESSERACT_CMD")

if tesseract_cmd:
    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd


EXTENSOES_SUPORTADAS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
}


def preparar_imagem(imagem):
    """
    Prepara a imagem antes de enviar ao Tesseract.
    """

    imagem = ImageOps.exif_transpose(imagem)

    imagem = imagem.convert("L")

    imagem = ImageOps.autocontrast(imagem)

    return imagem


def executar_tesseract(imagem):
    """
    Executa OCR em uma imagem.
    """

    imagem = preparar_imagem(imagem)

    texto = pytesseract.image_to_string(
        imagem,
        lang=os.getenv("OCR_LANG", "por"),
    )

    return texto


def ler_imagem(caminho):
    """
    Lê PNG, JPG ou JPEG.
    """

    with Image.open(caminho) as imagem:
        return executar_tesseract(imagem)


def ler_pdf(caminho):
    """
    Converte cada página do PDF em imagem
    e executa OCR.
    """

    documento = fitz.open(caminho)

    textos = []

    try:
        for pagina in documento:

            # Aumenta a resolução antes do OCR.
            matriz = fitz.Matrix(2, 2)

            pixmap = pagina.get_pixmap(
                matrix=matriz,
                alpha=False,
            )

            imagem = Image.frombytes(
                "RGB",
                [pixmap.width, pixmap.height],
                pixmap.samples,
            )

            texto = executar_tesseract(imagem)

            textos.append(texto)

    finally:
        documento.close()

    return "\n".join(textos)


def ler_documento(caminho):
    """
    Decide automaticamente como ler o arquivo.
    """

    caminho = Path(caminho)

    extensao = caminho.suffix.lower()

    if extensao not in EXTENSOES_SUPORTADAS:
        raise ValueError(
            f"Formato não suportado: {extensao}. "
            "Use PDF, PNG, JPG ou JPEG."
        )

    if extensao == ".pdf":
        return ler_pdf(caminho)

    return ler_imagem(caminho)


def extrair_matricula(texto):
    """
    Procura a matrícula no texto reconhecido.
    """

    padroes = [
        r"matr[ií]cula\s*[:\-]?\s*(\d{4,20})",
        r"registro\s*[:\-]?\s*(\d{4,20})",
    ]

    for padrao in padroes:

        resultado = re.search(
            padrao,
            texto,
            flags=re.IGNORECASE,
        )

        if resultado:
            return resultado.group(1)

    return None


def extrair_competencia(texto):
    """
    Procura mês e ano da competência.

    Exemplos aceitos:
    Competência: 10/2024
    Competência: 10-2024
    """

    padroes = [
        r"compet[eê]ncia\s*[:\-]?\s*"
        r"(0?[1-9]|1[0-2])[/\-](20\d{2})",

        r"m[eê]s\s*/?\s*ano\s*[:\-]?\s*"
        r"(0?[1-9]|1[0-2])[/\-](20\d{2})",
    ]

    for padrao in padroes:

        resultado = re.search(
            padrao,
            texto,
            flags=re.IGNORECASE,
        )

        if resultado:

            mes = int(resultado.group(1))
            ano = int(resultado.group(2))

            return mes, ano

    return None, None


def executar_ocr(caminho):
    """
    Executa todo o processo de reconhecimento.
    """

    texto = ler_documento(caminho)

    matricula = extrair_matricula(texto)

    mes, ano = extrair_competencia(texto)

    competencia = None

    if mes and ano:
        competencia = f"{ano}-{mes:02d}"

    return {
        "matricula": matricula,
        "mes": mes,
        "ano": ano,
        "competencia": competencia,
        "texto": texto,
    }