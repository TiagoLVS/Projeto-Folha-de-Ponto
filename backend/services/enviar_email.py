import os
import re
import smtplib
import math
import mimetypes
import hashlib
import json
import ssl
from pathlib import Path

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

    email_remetente = os.getenv("DIGEP_EMAIL") or os.getenv("SMTP_USER")
    senha_app = os.getenv("SMTP_PASSWORD") or os.getenv("DIGEP_SENHA_APP")

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
        host = os.getenv('SMTP_HOST','smtp.gmail.com')
        port = int(os.getenv('SMTP_PORT','465'))
        security = os.getenv('SMTP_SECURITY','ssl').lower()
        if security not in ('ssl','starttls'):
            raise ValueError('SMTP_SECURITY deve ser ssl ou starttls.')
        factory = smtplib.SMTP_SSL if security=='ssl' else smtplib.SMTP
        with factory(host, port, timeout=30) as servidor:
            if security=='starttls':
                servidor.ehlo()
                servidor.starttls(context=ssl.create_default_context())
                servidor.ehlo()
            servidor.login(os.getenv('SMTP_USER') or email_remetente, senha_app)
            servidor.send_message(mensagem)

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

def validar_folha_envio(folha):
    if not folha or folha.get('status_ocr') != 'OK' or not folha.get('confirmado_em') or not folha.get('ativo', True):
        raise ValueError('A folha deve estar ativa, vinculada e confirmada com status OCR OK.')
    if not folha.get('id_servidor') or not folha.get('id_competencia'):
        raise ValueError('Folha sem vínculo de servidor e competência.')
    if not email_valido(folha.get('email')):
        raise ValueError('E-mail do servidor inválido.')
    if not Path(folha.get('caminho_arquivo','')).is_file():
        raise ValueError('Arquivo da folha não encontrado.')


def enviar_folha_do_banco(folha):
    """
    Envia uma folha persistida e registra
    o resultado no PostgreSQL.
    """

    from backend.database.repository import (
        criar_envio,
    )

    validar_folha_envio(folha)
    id_envio = criar_envio(
        folha["id_folha"],
        folha["email"]
    )

    return enviar_arquivo_registrado(id_envio,folha['nome'],folha['email'],folha['caminho_arquivo'])


def enviar_arquivo_registrado(id_envio,nome,email,caminho,competencia=None):
    """Preparação e SMTP comuns, com resultado registrado no mesmo histórico."""
    mensagem, status, erro = preparar_email(
        nome,
        email,
        caminho,
        os.getenv("DIGEP_EMAIL") or os.getenv("SMTP_USER", "")
    )

    if status == "PENDENTE" and competencia:
        # O nome físico pode ser legado (ID/UUID). O destinatário recebe um nome legível.
        from backend.services.folhas_recebidas import sanitizar_nome
        nome_anexo=f'{sanitizar_nome(nome)}-{competencia}.pdf'
        for anexo in mensagem.iter_attachments():
            anexo.set_param('filename',nome_anexo,header='Content-Disposition',replace=True)
        mensagem.replace_header('Subject',f'Folha de ponto para preenchimento - {competencia}')
        corpo=mensagem.get_body(preferencelist=('plain',))
        if corpo is not None:
            corpo.set_content(f'Olá, {nome}!\n\nSegue sua folha de ponto em branco referente a {competencia}, para preenchimento.\n\nAtenciosamente,\nDIGEP')

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

    from backend.database.repository import finalizar_envio
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


def enviar_apos_confirmacao(folha):
    """Dispara uma vez por documento/vínculo/destinatário, após o commit."""
    from backend.database.repository import (
        registrar_requisicao_idempotente,
        finalizar_requisicao_idempotente,
    )
    validar_folha_envio(folha)
    try:
        remetente, _, modo_teste = carregar_configuracao_email()
    except RuntimeError:
        return {
            "status": "NAO_CONFIGURADO",
            "mensagem": "Vínculo salvo. Configure DIGEP_EMAIL e DIGEP_SENHA_APP no backend para enviar o e-mail.",
        }
    payload = {
        "id_folha": folha["id_folha"],
        "id_servidor": folha["id_servidor"],
        "id_competencia": folha["id_competencia"],
        "arquivo": folha["caminho_arquivo"],
        "sha256": folha.get("sha256"),
        "versao": folha.get("versao", 1),
        "destinatario": remetente if modo_teste else folha["email"],
        "modo_teste": modo_teste,
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    chave = f"confirmacao:{digest}"
    registro = registrar_requisicao_idempotente(chave, digest, payload)
    if not registro:
        raise RuntimeError("Não foi possível reservar o envio automático.")
    if not registro.get("created"):
        if registro["status"] in {"CONCLUIDO", "ERRO"}:
            return registro["response_body"]
        return {
            "status": "PROCESSANDO",
            "mensagem": "Vínculo salvo. O envio anterior ainda não tem resultado confirmado. Consulte novamente sem criar outro envio.",
        }
    try:
        resultado = enviar_folha_do_banco(folha)
        enviado = resultado["status"] == "ENVIADO"
    except Exception:
        enviado = False
    resposta = {
        "status": "ENVIADO" if enviado else "ERRO",
        "mensagem": (
            "Vínculo salvo. E-mail enviado ao remetente em modo de teste."
            if enviado and modo_teste else
            "Vínculo salvo e e-mail enviado ao professor."
            if enviado else
            "Vínculo salvo, mas o envio falhou. Confira o histórico e as configurações antes de reenviar pelo botão de envio."
        ),
    }
    finalizar_requisicao_idempotente(chave, "CONCLUIDO" if enviado else "ERRO", 200, resposta)
    return resposta
