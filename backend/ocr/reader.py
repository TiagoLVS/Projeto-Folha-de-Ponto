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


def extrair_texto_pagina(pagina, suficiente=None):
    """Texto digital primeiro; OCR compartilha idioma, executável e preparo existentes."""
    digital = pagina.get_text().strip()
    if (suficiente(digital) if suficiente else len(digital) >= 20):
        return digital, 'TEXTO'
    escala = min(2, 4000 / max(pagina.rect.width, pagina.rect.height))
    pixmap = pagina.get_pixmap(matrix=pymupdf.Matrix(escala, escala), alpha=False)
    imagem = Image.frombytes('RGB', [pixmap.width, pixmap.height], pixmap.samples)
    texto = pytesseract.image_to_string(preparar_imagem(imagem), lang=os.getenv('OCR_LANG', 'por'), timeout=30)
    return texto, 'OCR'


def ler_pdf(caminho_pdf):
    with pymupdf.open(caminho_pdf) as documento:
        return '\n'.join(extrair_texto_pagina(pagina)[0] for pagina in documento)


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

    meses = {'janeiro':1,'fevereiro':2,'março':3,'marco':3,'abril':4,'maio':5,'junho':6,
             'julho':7,'agosto':8,'setembro':9,'outubro':10,'novembro':11,'dezembro':12}
    match = re.search(r'refer[eê]ncia\s*[:\-]?\s*([a-zç]+)\s*/\s*(20\d{2})',texto,re.IGNORECASE)
    if match and match.group(1).lower() in meses:
        return meses[match.group(1).lower()],int(match.group(2))
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
