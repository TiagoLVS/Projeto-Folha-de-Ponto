import os
import re

import pymupdf
import pytesseract

from PIL import Image, ImageOps
from dotenv import load_dotenv
from pathlib import Path


RAIZ_PROJETO = Path(__file__).resolve().parents[2]

load_dotenv(RAIZ_PROJETO / ".env")

EXTENSOES_SUPORTADAS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
}

tesseract_cmd = os.getenv("TESSERACT_CMD")

if tesseract_cmd:
    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd


def preparar_imagem(imagem):
    imagem = ImageOps.grayscale(imagem)
    imagem = ImageOps.autocontrast(imagem)

    return imagem


def ler_pdf(caminho_pdf):
    documento = pymupdf.open(caminho_pdf)

    textos = []

    for pagina in documento:

        matriz = pymupdf.Matrix(2, 2)

        pixmap = pagina.get_pixmap(
            matrix=matriz,
            alpha=False,
        )

        imagem = Image.frombytes(
            "RGB",
            [pixmap.width, pixmap.height],
            pixmap.samples,
        )

        imagem = preparar_imagem(imagem)

        texto = pytesseract.image_to_string(
            imagem,
            lang=os.getenv("OCR_LANG", "por"),
        )

        textos.append(texto)

    documento.close()

    return "\n".join(textos)


def extrair_matricula(texto):
    padroes = [
        r"matr[ií]cula\s*[:\-]?\s*(\d{4,20})",
        r"matricula\s*[:\-]?\s*(\d{4,20})",
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
    padroes = [
        r"compet[eê]ncia\s*[:\-]?\s*(0?[1-9]|1[0-2])[/\-](20\d{2})",
        r"m[eê]s\s*/?\s*ano\s*[:\-]?\s*(0?[1-9]|1[0-2])[/\-](20\d{2})",
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


def executar_ocr(caminho_pdf):
    texto = ler_pdf(caminho_pdf)

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
