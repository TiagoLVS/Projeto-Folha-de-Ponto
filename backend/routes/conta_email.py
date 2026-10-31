from psycopg import OperationalError
from psycopg.errors import UndefinedTable
from fastapi import APIRouter, HTTPException, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator
from backend.services import conta_email

router=APIRouter(prefix='/emails/conta',tags=['Conta de e-mail'])
class Conexao(BaseModel):
    model_config=ConfigDict(extra='forbid')
    email:str=Field(min_length=3,max_length=255,pattern=r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
    senha:SecretStr=Field(min_length=1,max_length=1024)
    @field_validator('email',mode='before')
    @classmethod
    def normalizar(cls,value):
        return value.strip().lower() if isinstance(value,str) else value

@router.get('')
def estado():
    return conta_email.estado(conta_email.CLIENTE_HTTP.get())

@router.post('')
async def conectar(payload:Conexao):
    if not conta_email.cliente(conta_email.CLIENTE_HTTP.get()):raise HTTPException(422,'Abra o sistema novamente para conectar sua conta.')
    try:await run_in_threadpool(conta_email.entrar,conta_email.CLIENTE_HTTP.get(),payload.email,payload.senha.get_secret_value())
    except UndefinedTable:
        raise HTTPException(503,'A conta foi verificada, mas o sistema precisa de uma atualização do banco de dados para salvá-la. Procure o responsável.') from None
    except OperationalError:
        raise HTTPException(503,'Não foi possível acessar o banco de dados para salvar a conta. Tente novamente.') from None
    except (ValueError,RuntimeError) as error:raise HTTPException(422,str(error)) from None
    return conta_email.estado(conta_email.CLIENTE_HTTP.get())

@router.delete('',status_code=204)
def desconectar():
    conta_email.desconectar(conta_email.CLIENTE_HTTP.get())
    return Response(status_code=204)
