from backend.paths import DATA
from backend.config import MAX_GENERATED_ZIP_BYTES
from backend.models.calendario import DownloadLotePayload
import hashlib
import logging
from pathlib import Path
from tempfile import SpooledTemporaryFile
from uuid import uuid4
from zipfile import ZipFile, ZIP_DEFLATED

from psycopg.rows import dict_row
from backend.database import repository
from backend.database.geracao import preparar_geracao, salvar_gerada, buscar_gerada, ConflitoGeracao
from backend.models.calendario import GeracaoPayload
from backend.services.modelo_folha import renderizar_pdf, MODELO_ID
from backend.services.folhas_recebidas import sanitizar_nome

PASTA_GERADAS = DATA / 'folhas' / 'geradas'
logger = logging.getLogger(__name__)


def nome_pdf_gerado(professor, competencia):
    nome = sanitizar_nome(professor['nome'])
    return f'{nome}-{competencia}.pdf'


def apresentar(documento):
    return {**{k: v for k, v in documento.items() if k != 'caminho_arquivo'},
            'download_url': f"/folhas/geradas/{documento['id_documento']}/download"}


def gerar_folha(payload):
    path, created = None, False
    try:
        with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
            professor, comp, versao, referencia, eventos = preparar_geracao(cur, payload)
            content = renderizar_pdf(professor, payload.competencia, eventos, versao)
            folder = PASTA_GERADAS / payload.competencia
            folder.mkdir(parents=True, exist_ok=True)
            # A pasta única preserva versões e homônimos sem sufixos no PDF.
            folder = folder / uuid4().hex
            folder.mkdir()
            path = folder / nome_pdf_gerado(professor, payload.competencia)
            with path.open('xb') as file:
                created = True
                file.write(content)
            document = salvar_gerada(cur, professor, comp, versao, referencia, eventos, path, len(content), hashlib.sha256(content).hexdigest(), MODELO_ID)
            document['competencia'] = payload.competencia
        return apresentar(document)
    except Exception:
        if created:
            path.unlink(missing_ok=True)
        raise


def gerar_lote(payload):
    gerados, falhas = [], []
    for professor in payload.ids_servidores:
        try:
            gerados.append(gerar_folha(GeracaoPayload(id_servidor=professor, competencia=payload.competencia, nova_versao=payload.nova_versao)))
        except (LookupError, ConflitoGeracao) as error:
            falhas.append(dict(id_servidor=professor, motivo=str(error)))
        except Exception:
            logger.exception('Falha ao gerar documento para servidor %s', professor)
            falhas.append(dict(id_servidor=professor, motivo='Não foi possível gerar ou salvar o PDF. Tente novamente.'))
    return dict(total=len(payload.ids_servidores), gerados=len(gerados), nao_gerados=len(falhas), documentos=gerados, falhas=falhas)


def arquivo_documento(id_documento):
    document = buscar_gerada(id_documento)
    if not document:
        raise LookupError('Documento gerado não encontrado.')
    return validar_arquivo_documento(document)


def validar_arquivo_documento(document):
    path = Path(document['caminho_arquivo']).resolve()
    if not path.is_relative_to(PASTA_GERADAS.resolve()) or path.suffix.lower() != '.pdf' or not path.is_file():
        raise LookupError('Arquivo não disponível no armazenamento de documentos gerados.')
    return path, document['nome_arquivo']


def criar_zip(ids):
    ids = DownloadLotePayload(ids_documentos=ids).ids_documentos
    files = [arquivo_documento(id_documento) for id_documento in ids]
    if sum(path.stat().st_size for path, _ in files) > MAX_GENERATED_ZIP_BYTES:
        raise ValueError(f'Selecione menos documentos: o ZIP aceita até {MAX_GENERATED_ZIP_BYTES // (1024 * 1024)} MB de PDFs.')
    result = SpooledTemporaryFile(max_size=8 * 1024 * 1024)
    try:
        with ZipFile(result, 'w', compression=ZIP_DEFLATED) as archive:
            names = [Path(name.replace('\\', '/')).name for _, name in files]
            for index, ((path, _), name) in enumerate(zip(files, names), 1):
                # Homônimos e versões selecionadas juntos ficam em pastas separadas.
                archive.write(path, arcname=f'documento_{index}/{name}' if names.count(name) > 1 else name)
        if result.tell() > MAX_GENERATED_ZIP_BYTES:
            raise ValueError('ZIP final excede o limite configurado. Selecione menos documentos.')
        result.seek(0)
        return result
    except Exception:
        result.close()
        raise
