import os
import re
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator
from psycopg.errors import UniqueViolation

from backend.database.repository import (
    atualizar_servidor, confirmar_folha, criar_servidor,
    listar_folhas_para_envio, listar_servidores, salvar_folha,
)
from backend.services.enviar_email import enviar_folha_do_banco
from backend.services.ler_planilha import importar_planilha
from backend.services.processar_folha import armazenar_arquivo, processar_folha


EXTENSOES_DOCUMENTO = {".pdf", ".png", ".jpg", ".jpeg"}
TIPOS_DOCUMENTO = {"application/pdf", "image/png", "image/jpeg"}
LIMITE_UPLOAD = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))

app = FastAPI(title="Sistema de Gestão de Folhas de Ponto", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH"],
    allow_headers=["Content-Type", "Idempotency-Key"],
)


def validar_upload(arquivo):
    nome = Path(arquivo.filename or "").name
    extensao = Path(nome).suffix.lower()
    if not nome or extensao not in EXTENSOES_DOCUMENTO:
        raise HTTPException(status_code=400, detail="Formato de arquivo não suportado.")
    if arquivo.content_type and arquivo.content_type not in TIPOS_DOCUMENTO:
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
                raise HTTPException(status_code=413, detail="Arquivo excede o limite de 10 MB.")
            temporario.write(bloco)
        temporario.close()
        return Path(temporario.name)
    except Exception:
        temporario.close()
        Path(temporario.name).unlink(missing_ok=True)
        raise


async def salvar_planilha_temporaria(arquivo):
    if not arquivo.filename or Path(arquivo.filename).suffix.lower() not in {".xlsx", ".xls"}:
        raise HTTPException(status_code=400, detail="Envie uma planilha Excel (.xlsx ou .xls).")
    caminho = Path(tempfile.mkstemp(suffix=Path(arquivo.filename).suffix.lower())[1])
    tamanho = 0
    try:
        with caminho.open("wb") as destino:
            while bloco := await arquivo.read(1024 * 1024):
                tamanho += len(bloco)
                if tamanho > LIMITE_UPLOAD:
                    raise HTTPException(status_code=413, detail="Arquivo excede o limite de 10 MB.")
                destino.write(bloco)
        return caminho
    except Exception:
        caminho.unlink(missing_ok=True)
        raise


@app.get("/")
def inicio():
    return {"mensagem": "API do Sistema de Folha de Ponto funcionando"}


class ServidorPayload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=200)
    registration: str = Field(pattern=r"^[0-9]{4,16}$")
    email: str = Field(max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    department: str = Field(default="", max_length=200)
    workload: int | None = Field(default=None, gt=0, le=2147483647, strict=True)

    @field_validator("email")
    @classmethod
    def normalizar_email(cls, value):
        return value.lower()


class ConfirmacaoFolhaPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id_servidor: int = Field(gt=0, strict=True)
    competencia: str = Field(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")

    @field_validator("competencia")
    @classmethod
    def validar_ano(cls, value):
        if int(value[:4]) < 2000:
            raise ValueError("O ano deve ser a partir de 2000.")
        return value


@app.get("/servidores")
def consultar_servidores():
    return listar_servidores()


@app.post("/servidores", status_code=201)
def cadastrar_servidor(payload: ServidorPayload):
    try:
        servidor = criar_servidor(
            payload.name, payload.registration, payload.email, payload.department,
            payload.workload,
        )
    except UniqueViolation:
        raise HTTPException(status_code=409, detail="Essa matrícula já está cadastrada.")
    if servidor is None:
        raise HTTPException(status_code=409, detail="Essa matrícula já está cadastrada.")
    return servidor


@app.put("/servidores/{id_servidor}")
def editar_servidor(id_servidor: int, payload: ServidorPayload):
    try:
        servidor = atualizar_servidor(
            id_servidor, payload.name, payload.registration, payload.email, payload.department,
            payload.workload,
        )
    except UniqueViolation:
        raise HTTPException(status_code=409, detail="Essa matrícula já está cadastrada.")
    if servidor is None:
        raise HTTPException(status_code=404, detail="Professor não encontrado.")
    return servidor


@app.patch("/folhas/{id_folha}")
def corrigir_folha(id_folha: int, payload: ConfirmacaoFolhaPayload):
    ano, mes = map(int, payload.competencia.split("-"))
    try:
        return confirmar_folha(id_folha, payload.id_servidor, mes, ano)
    except LookupError as erro:
        raise HTTPException(status_code=404, detail=str(erro))
    except UniqueViolation:
        raise HTTPException(
            status_code=409,
            detail="Já existe uma folha para esse professor nessa competência. Nenhuma folha foi substituída.",
        )


@app.post("/folhas/processar")
async def processar_documento(arquivo: UploadFile = File(...)):
    caminho = await salvar_upload_temporario(arquivo)
    try:
        return processar_folha(caminho)
    finally:
        caminho.unlink(missing_ok=True)


@app.post("/folhas/registrar", status_code=201)
async def registrar_documento(arquivo: UploadFile = File(...)):
    """Guarda o original para conferência manual, sem depender do OCR."""
    caminho = await salvar_upload_temporario(arquivo)
    salvo = None
    try:
        salvo = armazenar_arquivo(caminho)
        id_folha = salvar_folha(
            None, None, str(salvo), Path(arquivo.filename).name,
            None, None, "REVISAR", "Aguardando conferência manual.",
        )
        return {"id_folha": id_folha, "status_ocr": "REVISAR"}
    except Exception:
        if salvo is not None:
            salvo.unlink(missing_ok=True)
        raise
    finally:
        caminho.unlink(missing_ok=True)


@app.post("/servidores/importar")
async def importar_servidores(arquivo: UploadFile = File(...)):
    caminho = await salvar_planilha_temporaria(arquivo)
    try:
        return importar_planilha(caminho)
    finally:
        caminho.unlink(missing_ok=True)


@app.post("/folhas/enviar-lote", status_code=202)
def enviar_lote(payload: dict):
    mes_ano = payload.get("month", "")
    ids = payload.get("professorIds", [])
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", mes_ano):
        raise HTTPException(status_code=422, detail="Competência inválida.")
    if not isinstance(ids, list) or not ids or len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="IDs de professores inválidos ou repetidos.")
    try:
        ids_int = [int(valor) for valor in ids]
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="IDs de professores inválidos.")
    ano, mes = (int(valor) for valor in mes_ano.split("-"))
    folhas = listar_folhas_para_envio(ano, mes, ids_int)
    if len(folhas) != len(ids_int):
        raise HTTPException(status_code=422, detail="Uma ou mais folhas não foram encontradas.")
    resultados = [enviar_folha_do_banco(folha) for folha in folhas]
    if any(item["status"] != "ENVIADO" for item in resultados):
        raise HTTPException(status_code=502, detail="Não foi possível enviar todas as folhas.")
    return {"jobId": "envio-realizado", "status": "queued", "acceptedCount": len(resultados)}
