from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, File, Form, Header, HTTPException, Path, Query, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from urllib.parse import quote
from pydantic import BaseModel, ConfigDict, Field
from psycopg.errors import ForeignKeyViolation, RestrictViolation
from backend.database import repository
from backend.services import folhas_recebidas as folhas, importacao_servidores as imports, lease
from backend.services.idempotencia import executar
from backend.services.enviar_email import enviar_apos_confirmacao

Id = Annotated[int, Path(gt=0,le=9223372036854775807)]
Month = Annotated[str, Field(pattern=r'^20\d{2}-(0[1-9]|1[0-2])$')]

class Confirmacao(BaseModel):
    model_config=ConfigDict(extra='forbid')
    id_servidor:int=Field(gt=0,strict=True,le=9223372036854775807)
    competencia:Month
    sobrescrever:bool=False
    id_folha_existente:int|None=Field(None,gt=0,strict=True)

class Token(BaseModel):
    model_config=ConfigDict(extra='forbid')
    token:UUID


def criar_router(salvar_pdf, salvar_planilha):
    router=APIRouter(tags=['Integração do sistema'])

    @router.get('/folhas')
    def listar(id_servidor:int|None=Query(None,gt=0,le=9223372036854775807)):
        return folhas.listar(id_servidor)

    @router.get('/folhas/pendentes')
    def pendentes():
        return folhas.pendentes()

    @router.get('/folhas/pacotes')
    def pacotes():
        return folhas.pacotes()

    @router.post('/folhas/{id_folha}/paginas/{pagina}/importar',status_code=201)
    def importar_pagina(id_folha:Id,pagina:int,payload:Confirmacao,chave:str=Header(...,alias='Idempotency-Key')):
        data=payload.model_dump()
        return executar(chave,'pagina',{'id':id_folha,'pagina':pagina,**data},lambda:folhas.importar_pagina(id_folha,pagina,payload.id_servidor,payload.competencia,payload.sobrescrever,payload.id_folha_existente))

    @router.post('/folhas/upload',status_code=201)
    async def upload(arquivo:UploadFile=File(...),id_servidor:int=Form(...,gt=0),competencia:str=Form(...,pattern=r'^20\d{2}-(0[1-9]|1[0-2])$'),
                     sobrescrever:bool=Form(False),id_folha_existente:int|None=Form(None,gt=0),
                     chave:str=Header(...,alias='Idempotency-Key',max_length=255)):
        path=await salvar_pdf(arquivo)
        try:
            import hashlib
            digest=hashlib.sha256(path.read_bytes()).hexdigest()
            payload=dict(id_servidor=id_servidor,competencia=competencia,sobrescrever=sobrescrever,id_folha_existente=id_folha_existente,sha256=digest)
            return await run_in_threadpool(executar,chave,'upload',payload,lambda:folhas.salvar_upload(path,id_servidor,competencia,sobrescrever,id_folha_existente))
        except ValueError as error:
            raise HTTPException(422,str(error)) from error
        finally:
            path.unlink(missing_ok=True)

    @router.get('/folhas/{id_folha}/arquivo')
    def arquivo(id_folha:Id):
        file,name=folhas.abrir_download(id_folha)
        def chunks():
            try:
                while chunk := file.read(65536):
                    yield chunk
            finally:
                file.close()
        return StreamingResponse(chunks(),media_type='application/pdf',background=BackgroundTask(file.close),
            headers={'Content-Disposition':f"inline; filename*=UTF-8''{quote(name)}",'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'})

    @router.delete('/folhas/{id_folha}',status_code=204)
    def excluir(id_folha:Id):
        folhas.remover(id_folha); return Response(status_code=204)

    @router.post('/folhas/{id_folha}/processar')
    def processar(id_folha:Id):
        return folhas.processar(id_folha)

    @router.patch('/folhas/{id_folha}')
    def confirmar(id_folha:Id,payload:Confirmacao):
        result,raw=folhas.confirmar(id_folha,payload.id_servidor,payload.competencia,payload.sobrescrever,payload.id_folha_existente)
        try:
            result['envio']=enviar_apos_confirmacao(raw)
        except Exception:
            result['envio']={'status':'ERRO','mensagem':'Vínculo salvo. Confira o histórico antes de reenviar.'}
        return result

    @router.delete('/servidores/{id_servidor}',status_code=204)
    def excluir_servidor(id_servidor:Id):
        try:
            with repository.conectar() as conn:
                result=conn.execute('DELETE FROM servidor WHERE id_servidor=%s RETURNING id_servidor',(id_servidor,)).fetchone()
                if not result: raise HTTPException(404,'Servidor não encontrado.')
        except (ForeignKeyViolation,RestrictViolation) as error:
            raise HTTPException(409,'Servidor possui folhas ou documentos relacionados e não pode ser excluído.') from error
        return Response(status_code=204)

    @router.post('/servidores/importar/preview')
    async def preview(arquivo:UploadFile=File(...)):
        path=await salvar_planilha(arquivo,professores=True)
        try:
            return await run_in_threadpool(imports.preview,path)
        except (ValueError,KeyError) as error:
            raise HTTPException(422,f'Planilha inválida: {error}') from error
        finally:
            path.unlink(missing_ok=True)

    @router.post('/servidores/importar/confirm')
    def confirm_import(payload:Token,chave:str=Header(...,alias='Idempotency-Key',max_length=255)):
        return executar(chave,'importacao',{'token':str(payload.token)},lambda:imports.confirmar(payload.token))

    @router.get('/sistema/lock')
    def lock(x_client_id:str|None=Header(None)):
        return lease.consultar(x_client_id)

    @router.post('/sistema/lock/adquirir')
    def adquirir(x_client_id:str|None=Header(None)):
        return lease.alterar(x_client_id,'adquirir')

    @router.post('/sistema/lock/renovar')
    def renovar(x_client_id:str|None=Header(None)):
        return lease.alterar(x_client_id,'renovar')

    @router.delete('/sistema/lock',status_code=204)
    def liberar(x_client_id:str|None=Header(None)):
        lease.alterar(x_client_id,'liberar');return Response(status_code=204)

    return router
