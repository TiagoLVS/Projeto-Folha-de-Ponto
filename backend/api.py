from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path

from backend.services.processar_folha import processar_folha


app = FastAPI(
    title="Sistema de Gestão de Folhas de Ponto",
    version="1.0.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def inicio():
    return {
        "mensagem": "API do Sistema de Folha de Ponto funcionando"
    }


@app.post("/folhas/processar")
async def processar_documento(
    arquivo: UploadFile = File(...)
):
    arquivo_temporario = Path("/tmp") / arquivo.filename

    conteudo = await arquivo.read()

    arquivo_temporario.write_bytes(conteudo)

    resultado = processar_folha(
        arquivo_temporario
    )

    return resultado
