from uuid import UUID
from pydantic import BaseModel, ConfigDict
from backend.services.idempotencia import executar
from typing import Annotated, Literal
from fastapi import APIRouter, File, Form, Header, HTTPException, Path, Query, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from psycopg.errors import UniqueViolation
from backend.database import calendario as db
from backend.models.calendario import DataEspecialPayload, FiltrosCalendario
from backend.services.calendario import importar_calendario, confirmar_pdf

Identificador = Annotated[int, Path(gt=0, le=9223372036854775807)]


class ConfirmarPDF(BaseModel):
    model_config=ConfigDict(extra='forbid')
    token:UUID


def criar_router(salvar_planilha):
    router = APIRouter(prefix='/datas-especiais', tags=['Calendário acadêmico'])

    @router.get('')
    def listar(filtros: Annotated[FiltrosCalendario, Query()]):
        return db.listar_datas(filtros)

    @router.post('/importar')
    async def importar(arquivo: UploadFile = File(...), modo: Literal['mesclar','substituir'] = Form('mesclar'), ano: int | None = Form(None,ge=2000,le=2099)):
        path = await salvar_planilha(arquivo)
        try:
            return await run_in_threadpool(importar_calendario, path, arquivo.filename or 'calendario.xlsx', modo, ano)
        except ValueError as error:
            raise HTTPException(422, detail=str(error)) from error
        finally:
            path.unlink(missing_ok=True)

    @router.post('/importar/confirm')
    def confirmar(payload:ConfirmarPDF,chave:str=Header(...,alias='Idempotency-Key',min_length=1,max_length=255)):
        return executar(chave,'calendario-pdf',{'token':str(payload.token)},lambda:confirmar_pdf(payload.token))

    @router.get('/{id_evento}')
    def consultar(id_evento: Identificador):
        event = db.buscar_data(id_evento)
        if not event:
            raise HTTPException(404, detail='Data especial não encontrada.')
        return event

    @router.post('', status_code=201)
    def criar(payload: DataEspecialPayload):
        try:
            return db.salvar_data(payload)
        except UniqueViolation as error:
            raise HTTPException(409, detail='Essa data e especificação já estão cadastradas.') from error

    @router.put('/{id_evento}')
    def editar(id_evento: Identificador, payload: DataEspecialPayload):
        try:
            event = db.salvar_data(payload, id_evento)
        except UniqueViolation as error:
            raise HTTPException(409, detail='Essa data e especificação já estão cadastradas.') from error
        if not event:
            raise HTTPException(404, detail='Data especial não encontrada.')
        return event

    @router.delete('/{id_evento}', status_code=204)
    def excluir(id_evento: Identificador):
        if not db.excluir_data(id_evento):
            raise HTTPException(404, detail='Data especial não encontrada.')
        return Response(status_code=204)

    return router
