import os
import re
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backend.database.repository import criar_servidor, listar_folhas_para_envio
from backend.services.enviar_email import enviar_folha_do_banco
from backend.services.ler_planilha import importar_planilha
from backend.services.processar_folha import processar_folha


EXTENSOES_DOCUMENTO = {".pdf", ".png", ".jpg", ".jpeg"}
TIPOS_DOCUMENTO = {"application/pdf", "image/png", "image/jpeg"}
LIMITE_UPLOAD = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))

app = FastAPI(title="Sistema de Gestão de Folhas de Ponto", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
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


@app.post("/servidores", status_code=201)
def cadastrar_servidor(payload: dict):
    nome = str(payload.get("name", "")).strip()
    matricula = str(payload.get("registration", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    departamento = str(payload.get("department", "")).strip()
    if not nome or not re.fullmatch(r"\d{4,16}", matricula):
        raise HTTPException(status_code=422, detail="Nome e matrícula válidos são obrigatórios.")
    if not re.fullmatch(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=422, detail="E-mail inválido.")
    servidor = criar_servidor(nome, matricula, email, departamento)
    if servidor is None:
        raise HTTPException(status_code=409, detail="Essa matrícula já está cadastrada.")
    return servidor


@app.post("/folhas/processar")
async def processar_documento(arquivo: UploadFile = File(...)):
    caminho = await salvar_upload_temporario(arquivo)
    try:
        return processar_folha(caminho)
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
