"""Limites operacionais publicados ao frontend; configuração carregada na inicialização."""
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / '.env')


def positivo(nome, padrao, teto):
    valor = int(os.getenv(nome, str(padrao)))
    if not 1 <= valor <= teto:
        raise ValueError(f'{nome} deve estar entre 1 e {teto}.')
    return valor


MAX_GENERATION_BATCH = positivo('MAX_GENERATION_BATCH', 500, 5000)
MAX_GENERATED_DOWNLOAD_BATCH = positivo('MAX_GENERATED_DOWNLOAD_BATCH', 500, 5000)
MAX_GENERATED_ZIP_BYTES = positivo('MAX_GENERATED_ZIP_BYTES', 250 * 1024 * 1024, 1024 * 1024 * 1024)
MAX_UPLOAD_BYTES = positivo('MAX_UPLOAD_BYTES', 15 * 1024 * 1024, 100 * 1024 * 1024)
MAX_CALENDAR_PDF_PAGES = 20


def configuracao_publica():
    return dict(max_generation_batch=MAX_GENERATION_BATCH,
                max_generated_download_batch=MAX_GENERATED_DOWNLOAD_BATCH,
                max_generated_zip_bytes=MAX_GENERATED_ZIP_BYTES,
                max_upload_bytes=MAX_UPLOAD_BYTES)
