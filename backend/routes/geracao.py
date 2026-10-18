from backend.config import configuracao_publica
from typing import Annotated
from fastapi import APIRouter, Header, HTTPException, Path, Query
from fastapi.responses import FileResponse, StreamingResponse
from starlette.background import BackgroundTask
from backend.database.geracao import listar_geradas, buscar_gerada, ConflitoGeracao
from backend.models.calendario import GeracaoPayload, GeracaoLotePayload, DownloadLotePayload, EnvioGeradasPayload
from backend.services.geracao import gerar_folha, gerar_lote, apresentar, arquivo_documento, criar_zip

router = APIRouter(prefix='/folhas', tags=['Geração de modelos de folha'])
Identificador = Annotated[int, Path(gt=0, le=9223372036854775807)]


@router.get('/configuracao')
def configuracao():
    return configuracao_publica()


@router.post('/gerar', status_code=201)
def gerar(payload: GeracaoPayload):
    try:
        return gerar_folha(payload)
    except LookupError as error:
        raise HTTPException(404, detail=str(error)) from error
    except ConflitoGeracao as error:
        raise HTTPException(409, detail=str(error)) from error


@router.post('/gerar-lote')
def gerar_varias(payload: GeracaoLotePayload):
    return gerar_lote(payload)


@router.get('/geradas')
def listar(competencia: str | None = Query(None, pattern=r'^20\d{2}-(0[1-9]|1[0-2])$'), id_servidor: int | None = Query(None, gt=0, le=9223372036854775807)):
    return [apresentar(document) for document in listar_geradas(competencia, id_servidor)]


@router.post('/geradas/download-lote')
def baixar_lote(payload: DownloadLotePayload):
    try:
        file = criar_zip(payload.ids_documentos)
    except LookupError as error:
        raise HTTPException(404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(413, detail=str(error)) from error

    def chunks():
        try:
            while chunk := file.read(65536):
                yield chunk
        finally:
            file.close()
    return StreamingResponse(chunks(), media_type='application/zip', headers={'Content-Disposition': 'attachment; filename="folhas-geradas.zip"'}, background=BackgroundTask(file.close))


@router.get('/geradas/para-envio')
def previa_envio(competencia: str = Query(...,pattern=r'^20\d{2}-(0[1-9]|1[0-2])$')):
    from backend.services.envio_geradas import previa
    return previa(competencia)


@router.post('/geradas/enviar-lote')
def enviar_modelos(payload:EnvioGeradasPayload,chave:str=Header(...,alias='Idempotency-Key',min_length=1,max_length=255)):
    from backend.services.envio_geradas import enviar_lote
    from backend.services.idempotencia import executar
    ids=sorted(payload.ids_documentos)
    dados={'ids_documentos':ids,'competencia':payload.competencia}
    if payload.reenviar:dados['reenviar']=True
    return executar(chave,'modelos-email',dados,lambda:enviar_lote(ids,payload.competencia,payload.reenviar))


@router.get('/geradas/{id_documento}')
def consultar(id_documento: Identificador):
    document = buscar_gerada(id_documento)
    if not document:
        raise HTTPException(404, detail='Documento gerado não encontrado.')
    return apresentar(document)


@router.get('/geradas/{id_documento}/download')
def baixar(id_documento: Identificador):
    try:
        path, name = arquivo_documento(id_documento)
    except LookupError as error:
        raise HTTPException(404, detail=str(error)) from error
    return FileResponse(path, media_type='application/pdf', filename=name)
