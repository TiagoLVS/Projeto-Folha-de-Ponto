import os
import re
import smtplib
import math
import mimetypes

from datetime import datetime
from email.message import EmailMessage


# ============================================================
# FUNÇÕES AUXILIARES
# ============================================================

def email_valido(email):
    if email is None or (
        isinstance(email, float)
        and math.isnan(email)
    ):
        return False

    email = str(email).strip()

    if not email:
        return False

    padrao = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"

    return re.match(padrao, email) is not None


def normalizar_matricula(valor):
    """
    Evita casos como 67890.0 quando a matrícula
    é lida pelo Excel como número.
    """

    if valor is None or (
        isinstance(valor, float)
        and math.isnan(valor)
    ):
        return ""

    valor = str(valor).strip()

    if valor.endswith(".0"):
        valor = valor[:-2]

    return valor


def carregar_configuracao_email():
    """
    Busca as configurações do Gmail nas
    variáveis de ambiente.
    """

    email_remetente = os.getenv("DIGEP_EMAIL")
    senha_app = os.getenv("DIGEP_SENHA_APP")

    modo_teste = os.getenv(
        "DIGEP_MODO_TESTE",
        "true"
    ).lower() == "true"

    if not email_remetente:
        raise RuntimeError(
            "Variável DIGEP_EMAIL não configurada."
        )

    if not senha_app:
        raise RuntimeError(
            "Variável DIGEP_SENHA_APP não configurada."
        )

    return (
        email_remetente,
        senha_app,
        modo_teste
    )


# ============================================================
# PREPARAÇÃO DO E-MAIL
# ============================================================

def preparar_email(
    nome,
    destinatario,
    arquivo_pdf,
    email_remetente
):
    if not email_valido(destinatario):
        return (
            None,
            "ERRO",
            "E-mail do destinatário inválido"
        )

    destinatario = str(destinatario).strip()

    mensagem = EmailMessage()

    mensagem["Subject"] = "Folha de ponto - DIGEP"
    mensagem["From"] = email_remetente
    mensagem["To"] = destinatario

    mensagem.set_content(
        f"Olá, {nome}!\n\n"
        "Segue em anexo sua folha de ponto.\n\n"
        "Atenciosamente,\n"
        "DIGEP"
    )

    try:
        with open(arquivo_pdf, "rb") as arquivo:
            conteudo = arquivo.read()

        tipo_mime, _ = mimetypes.guess_type(
            arquivo_pdf
        )

        if tipo_mime:
            maintype, subtype = tipo_mime.split(
                "/",
                1
            )

        else:
            maintype = "application"
            subtype = "octet-stream"

        mensagem.add_attachment(
            conteudo,
            maintype=maintype,
            subtype=subtype,
            filename=os.path.basename(
                arquivo_pdf
            )
        )

        return (
            mensagem,
            "PENDENTE",
            ""
        )

    except FileNotFoundError:
        return (
            None,
            "ERRO",
            "Folha de ponto não encontrada"
        )


# ============================================================
# ENVIO SMTP
# ============================================================

def enviar_email(
    mensagem,
    email_remetente,
    senha_app
):
    try:
        with smtplib.SMTP_SSL(
            "smtp.gmail.com",
            465,
            timeout=30
        ) as servidor:

            servidor.login(
                email_remetente,
                senha_app
            )

            servidor.send_message(
                mensagem
            )

        return (
            "ENVIADO",
            "",
            datetime.now()
        )

    except Exception as erro:
        return (
            "ERRO",
            str(erro),
            None
        )


# ============================================================
# ENVIO DA FOLHA ARMAZENADA NO BANCO
# ============================================================

def enviar_folha_do_banco(folha):
    """
    Envia uma folha persistida e registra
    o resultado no PostgreSQL.
    """

    from backend.database.repository import (
        criar_envio,
        finalizar_envio
    )

    id_envio = criar_envio(
        folha["id_folha"],
        folha["email"]
    )

    mensagem, status, erro = preparar_email(
        folha["nome"],
        folha["email"],
        folha["caminho_arquivo"],
        os.getenv("DIGEP_EMAIL", "")
    )

    if status == "PENDENTE":
        try:
            remetente, senha, modo_teste = (
                carregar_configuracao_email()
            )

            if modo_teste:
                mensagem.replace_header(
                    "To",
                    remetente
                )

            status, erro, _ = enviar_email(
                mensagem,
                remetente,
                senha
            )

        except Exception as falha:
            status = "ERRO"
            erro = str(falha)

    finalizar_envio(
        id_envio,
        status,
        erro or None
    )

    return {
        "id_envio": id_envio,
        "status": status,
        "mensagem_erro": erro
    }