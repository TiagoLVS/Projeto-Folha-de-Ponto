import os
import re
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.database.repository import (
    canonicalize_batch_payload,
    canonicalize_professor_ids,
    criar_servidor,
    finalizar_requisicao_idempotente,
    listar_folhas_para_envio,
    payload_hash_for,
    registrar_requisicao_idempotente,
)
from backend.services.enviar_email import enviar_folha_do_banco
from backend.services.ler_planilha import importar_planilha
from backend.services.processar_folha import processar_folha


EXTENSOES_DOCUMENTO = {".pdf", ".png", ".jpg", ".jpeg"}
TIPOS_DOCUMENTO = {"application/pdf", "image/png", "image/jpeg"}
LIMITE_UPLOAD = int(os.getenv("MAX_UPLOAD_BYTES", str(15 * 1024 * 1024)))

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
                raise HTTPException(status_code=413, detail="Arquivo excede o limite de 15 MB.")
            temporario.write(bloco)
        temporario.close()
        return Path(temporario.name)
    except Exception:
        temporario.close()
        Path(temporario.name).unlink(missing_ok=True)
        raise


async def salvar_planilha_temporaria(arquivo):
   if not arquivo.filename or Path(arquivo.filename).suffix.lower() != ".xlsx":
    raise HTTPException(
        status_code=400,
        detail="Envie uma planilha Excel (.xlsx)."
    )
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


@app.post("/folhas/enviar-lote", status_code=200)
def enviar_lote(
    payload: dict,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    mes_ano = payload.get("month", "")
    ids = payload.get("professorIds", [])
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", mes_ano):
        raise HTTPException(status_code=422, detail="Competência inválida.")

    try:
        ids_int = canonicalize_professor_ids(ids)
    except ValueError as erro:
        raise HTTPException(status_code=422, detail=str(erro)) from erro

    if not ids_int:
        raise HTTPException(status_code=422, detail="IDs de professores inválidos ou repetidos.")

    payload_canonico = canonicalize_batch_payload(mes_ano, ids_int)
    payload_hash = payload_hash_for(mes_ano, ids_int)

    if idempotency_key:
        registro = registrar_requisicao_idempotente(idempotency_key, payload_hash, payload_canonico)
        if registro is None:
            registro = {"status": "PROCESSANDO", "payload_hash": payload_hash, "created": False}

        if registro.get("payload_hash") != payload_hash:
            raise HTTPException(
                status_code=409,
                detail="A Idempotency-Key já foi usada com outro payload.",
            )

        if not registro.get("created", False) and registro.get("status") == "PROCESSANDO":
            return JSONResponse(
                status_code=409,
                content={"detail": "A requisição original ainda está em processamento."},
            )

        if registro.get("status") in {"CONCLUIDO", "ERRO"}:
            resposta = registro.get("response_body") or {}
            status_codigo = int(registro.get("response_status_code") or 200)
            return JSONResponse(content=resposta, status_code=status_codigo)

    ano, mes = (int(valor) for valor in mes_ano.split("-"))
    folhas = listar_folhas_para_envio(ano, mes, ids_int)
    if len(folhas) != len(ids_int):
        if idempotency_key:
            finalizar_requisicao_idempotente(
                idempotency_key,
                "ERRO",
                422,
                {"detail": "Uma ou mais folhas não foram encontradas."},
            )
        raise HTTPException(status_code=422, detail="Uma ou mais folhas não foram encontradas.")

    try:
        resultados = [enviar_folha_do_banco(folha) for folha in folhas]
    except Exception as erro:  # pragma: no cover - defensivo para erros de envio
        if idempotency_key:
            finalizar_requisicao_idempotente(
                idempotency_key,
                "ERRO",
                502,
                {"detail": str(erro) or "Não foi possível enviar todas as folhas."},
            )
        raise HTTPException(status_code=502, detail="Não foi possível enviar todas as folhas.") from erro

    if any(item["status"] != "ENVIADO" for item in resultados):
        resposta = {"detail": "Não foi possível enviar todas as folhas."}
        if idempotency_key:
            finalizar_requisicao_idempotente(idempotency_key, "ERRO", 502, resposta)
        raise HTTPException(status_code=502, detail="Não foi possível enviar todas as folhas.")

    resposta = {
        "jobId": idempotency_key or "envio-realizado",
        "status": "completed",
        "sentCount": len(resultados),
    }
    if idempotency_key:
        finalizar_requisicao_idempotente(idempotency_key, "CONCLUIDO", 200, resposta)
    return JSONResponse(content=resposta, status_code=200)
