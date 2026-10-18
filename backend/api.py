from backend.config import MAX_UPLOAD_BYTES
import os
import re
import tempfile
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from backend.models.servidor import ServidorPayload
from backend.services import lease
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from psycopg.errors import UniqueViolation

from backend.database.repository import (
    canonicalize_batch_payload, canonicalize_professor_ids,
    finalizar_requisicao_idempotente, payload_hash_for, registrar_requisicao_idempotente,
    atualizar_servidor, criar_servidor,
    listar_folhas_para_envio, listar_servidores,
)
from backend.services.enviar_email import enviar_folha_do_banco, validar_folha_envio


EXTENSOES_DOCUMENTO = {".pdf"}
TIPOS_DOCUMENTO = {"application/pdf"}
LIMITE_UPLOAD = MAX_UPLOAD_BYTES

app = FastAPI(title="Sistema de Gestão de Folhas de Ponto", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Idempotency-Key", "X-Client-Id"],
)


def validar_upload(arquivo):
    nome = Path(arquivo.filename or "").name
    extensao = Path(nome).suffix.lower()
    if not nome or extensao not in EXTENSOES_DOCUMENTO:
        raise HTTPException(status_code=400, detail="Formato de arquivo não suportado.")
    if arquivo.content_type not in TIPOS_DOCUMENTO:
        raise HTTPException(status_code=400, detail="Tipo de conteúdo inválido.")
    return extensao


async def salvar_upload_temporario(arquivo):
    extensao = validar_upload(arquivo)
    tamanho = 0
    temporario = tempfile.NamedTemporaryFile(delete=False, suffix=extensao)
    try:
        while bloco := await arquivo.read(1024 * 1024):
            tamanho += len(bloco)
            if tamanho > LIMITE_UPLOAD:
                raise HTTPException(status_code=413, detail=f"Arquivo excede o limite de {LIMITE_UPLOAD // (1024 * 1024)} MB.")
            temporario.write(bloco)
        temporario.close()
        from backend.services.folhas_recebidas import validar_pdf
        try:
            validar_pdf(temporario.name)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        return Path(temporario.name)
    except Exception:
        temporario.close()
        Path(temporario.name).unlink(missing_ok=True)
        raise


async def salvar_planilha_temporaria(arquivo, professores=False):
    extensao = Path(arquivo.filename or "").suffix.lower()
    if extensao not in ({".xls", ".xlsx"} if professores else {".xlsx"}):
        raise HTTPException(status_code=400, detail="Envie uma planilha Excel (.xls ou .xlsx)." if professores else "Envie uma planilha Excel (.xlsx).")
    with tempfile.NamedTemporaryFile(delete=False, suffix=extensao) as temporario:
        caminho = Path(temporario.name)
    tamanho = 0
    try:
        with caminho.open("wb") as destino:
            while bloco := await arquivo.read(1024 * 1024):
                tamanho += len(bloco)
                if tamanho > LIMITE_UPLOAD:
                    raise HTTPException(status_code=413, detail=f"Arquivo excede o limite de {LIMITE_UPLOAD // (1024 * 1024)} MB.")
                destino.write(bloco)
        return caminho
    except Exception:
        caminho.unlink(missing_ok=True)
        raise


async def salvar_calendario_temporario(arquivo):
    if Path(arquivo.filename or '').suffix.lower() == '.pdf':
        return await salvar_upload_temporario(arquivo)
    if arquivo.content_type not in {'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'}:
        raise HTTPException(400, detail='Tipo de conteúdo inválido. Envie Excel (.xlsx) ou PDF.')
    return await salvar_planilha_temporaria(arquivo)


@app.get("/")
def inicio():
    return {"mensagem": "API do Sistema de Folha de Ponto funcionando"}


@app.get("/servidores")
def consultar_servidores():
    return listar_servidores()


@app.post("/servidores", status_code=201)
def cadastrar_servidor(payload: ServidorPayload):
    if payload.workload is None:
        raise HTTPException(422, detail="Selecione carga horária de 20 ou 40 horas.")
    if not payload.cpf:
        raise HTTPException(422, detail="CPF é obrigatório em cadastros novos.")
    try:
        servidor = criar_servidor(
            payload.name, payload.registration, payload.email, payload.department,
            payload.workload, payload.cpf, payload.acumula_cargo,
        )
    except UniqueViolation:
        raise HTTPException(status_code=409, detail="Matrícula ou CPF já cadastrado.")
    if servidor is None:
        raise HTTPException(status_code=409, detail="Matrícula ou CPF já cadastrado.")
    return servidor


@app.put("/servidores/{id_servidor}")
def editar_servidor(id_servidor: int, payload: ServidorPayload):
    current = next((p for p in listar_servidores() if p['id_servidor']==id_servidor), None)
    if current and current['carga_horaria'] is not None and payload.workload is None:
        raise HTTPException(422, detail="Selecione carga horária de 20 ou 40 horas.")
    if current and current['cpf'] and not payload.cpf:
        raise HTTPException(422, detail="CPF informado não pode ser removido.")
    try:
        servidor = atualizar_servidor(
            id_servidor, payload.name, payload.registration, payload.email, payload.department,
            payload.workload, payload.cpf, payload.acumula_cargo,
        )
    except UniqueViolation:
        raise HTTPException(status_code=409, detail="Matrícula ou CPF já cadastrado.")
    if servidor is None:
        raise HTTPException(status_code=404, detail="Professor não encontrado.")
    return servidor


@app.post("/folhas/enviar-lote", status_code=200)
def enviar_lote(
    payload: dict,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=255),
):
    mes_ano = payload.get("month", "")
    if not isinstance(mes_ano, str) or not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", mes_ano) or int(mes_ano[:4]) < 2000:
        raise HTTPException(status_code=422, detail="Competência inválida.")
    if not idempotency_key.strip():
        raise HTTPException(status_code=422, detail="Idempotency-Key obrigatória.")
    try:
        ids_int = canonicalize_professor_ids(payload.get("professorIds"))
    except ValueError as erro:
        raise HTTPException(status_code=422, detail=str(erro)) from erro

    payload_canonico = canonicalize_batch_payload(mes_ano, ids_int)
    payload_hash = payload_hash_for(mes_ano, ids_int)
    registro = registrar_requisicao_idempotente(idempotency_key, payload_hash, payload_canonico)
    if registro is None:
        raise HTTPException(status_code=503, detail="Não foi possível registrar o lote. Tente novamente com a mesma chave.")
    if registro["payload_hash"] != payload_hash:
        raise HTTPException(status_code=409, detail="A Idempotency-Key já foi usada com outro payload.")
    if not registro.get("created", False):
        if registro["status"] == "PROCESSANDO":
            return JSONResponse(status_code=409, content={"detail": "A requisição original ainda está em processamento. Tente novamente com a mesma chave."})
        if registro["status"] in {"CONCLUIDO", "ERRO"}:
            return JSONResponse(content=registro["response_body"], status_code=registro["response_status_code"])
        raise HTTPException(status_code=409, detail="O lote não está disponível para novo envio.")

    ano, mes = map(int, mes_ano.split("-"))
    try:
        folhas = listar_folhas_para_envio(ano, mes, ids_int)
        if len(folhas) != len(ids_int):
            raise HTTPException(status_code=422, detail="Uma ou mais folhas não foram encontradas.")
        for folha in folhas:
            try:
                validar_folha_envio(folha)
            except ValueError as error:
                raise HTTPException(422,str(error)) from error
        resultados = [enviar_folha_do_banco(folha) for folha in folhas]
        if any(item["status"] != "ENVIADO" for item in resultados):
            raise HTTPException(status_code=502, detail="Não foi possível enviar todas as folhas. Confira o histórico de envio antes de criar um novo lote.")
    except Exception as erro:
        status_codigo = erro.status_code if isinstance(erro, HTTPException) else 502
        resposta = {"detail": erro.detail if isinstance(erro, HTTPException) else "Não foi possível concluir o lote. Confira o histórico de envio antes de criar um novo lote."}
        finalizar_requisicao_idempotente(idempotency_key, "ERRO", status_codigo, resposta)
        return JSONResponse(content=resposta, status_code=status_codigo)

    resposta = {"jobId": idempotency_key, "status": "completed", "sentCount": len(resultados)}
    finalizar_requisicao_idempotente(idempotency_key, "CONCLUIDO", 200, resposta)
    return JSONResponse(content=resposta, status_code=200)


# Rotas novas mantidas em módulos separados; a importação reutiliza o limite existente.
from backend.routes.calendario import criar_router as criar_router_calendario
from backend.routes.geracao import router as router_geracao
app.include_router(criar_router_calendario(salvar_calendario_temporario))
app.include_router(router_geracao)

from backend.routes.integracao import criar_router as criar_router_integracao
app.include_router(criar_router_integracao(salvar_upload_temporario, salvar_planilha_temporaria))

class LeaseMiddleware:
    def __init__(self, app): self.app=app

    async def __call__(self, scope, receive, send):
        if scope['type']!='http' or scope['method'] in {'GET','HEAD','OPTIONS'} or scope['path'].startswith('/sistema/lock') or scope['path']=='/folhas/geradas/download-lote':
            return await self.app(scope,receive,send)
        conn=None
        try:
            client=dict(scope.get('headers',[])).get(b'x-client-id')
            conn=await run_in_threadpool(lease.iniciar_mutacao,client.decode() if client else None)
            await self.app(scope,receive,send)
        except HTTPException as error:
            await JSONResponse({'detail':error.detail},status_code=error.status_code)(scope,receive,send)
        finally:
            if conn is not None: await run_in_threadpool(lease.finalizar_mutacao,conn)

app.add_middleware(LeaseMiddleware)

from backend.routes.emails import router as router_emails
app.include_router(router_emails)
