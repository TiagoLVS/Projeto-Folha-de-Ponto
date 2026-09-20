import os
import re
import smtplib
from datetime import datetime
from email.message import EmailMessage

import pandas as pd


# ============================================================
# FUNÇÕES AUXILIARES
# ============================================================

def email_valido(email):
    if pd.isna(email):
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

    if pd.isna(valor):
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
            pdf = arquivo.read()

        mensagem.add_attachment(
            pdf,
            maintype="application",
            subtype="pdf",
            filename=os.path.basename(arquivo_pdf)
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
# PROCESSAMENTO DOS SERVIDORES
# ============================================================

def processar_envios(
    caminho_planilha="servidores_acumuladores.xlsx",
    pasta_folhas="folhas",
    caminho_relatorio="relatorio_envios.xlsx"
):
    email_remetente, senha_app, modo_teste = (
        carregar_configuracao_email()
    )

    if not os.path.exists(caminho_planilha):
        raise FileNotFoundError(
            f"Planilha não encontrada: {caminho_planilha}"
        )

    planilha = pd.read_excel(
        caminho_planilha
    )

    colunas_obrigatorias = {
        "nome",
        "email_pessoal",
        "matricula"
    }

    colunas_faltantes = (
        colunas_obrigatorias
        - set(planilha.columns)
    )

    if colunas_faltantes:
        raise ValueError(
            "Colunas obrigatórias faltando: "
            + ", ".join(sorted(colunas_faltantes))
        )

    print("\nPROCESSAMENTO DOS SERVIDORES")
    print("=" * 60)

    if modo_teste:
        print(
            "MODO DE TESTE ATIVADO"
        )

        print(
            "Os e-mails serão redirecionados para:",
            email_remetente
        )

    resultados = []

    for indice, servidor in planilha.iterrows():

        nome = servidor["nome"]

        email = servidor[
            "email_pessoal"
        ]

        matricula = normalizar_matricula(
            servidor["matricula"]
        )

        arquivo_pdf = os.path.join(
            pasta_folhas,
            f"folha_{matricula}.pdf"
        )

        print("\nServidor:", nome)
        print("Matrícula:", matricula)
        print("E-mail cadastrado:", email)
        print("Arquivo:", arquivo_pdf)

        mensagem, status, erro = preparar_email(
            nome,
            email,
            arquivo_pdf,
            email_remetente
        )

        data_envio = None

        # ----------------------------------------------------
        # Só tenta enviar se a preparação estiver correta
        # ----------------------------------------------------

        if (
            status == "PENDENTE"
            and mensagem is not None
        ):

            if modo_teste:

                mensagem.replace_header(
                    "To",
                    email_remetente
                )

                print(
                    "Modo de teste: enviando para:",
                    email_remetente
                )

            status, erro, data_envio = enviar_email(
                mensagem,
                email_remetente,
                senha_app
            )

        print("Status:", status)

        if data_envio:
            print(
                "Data do envio:",
                data_envio
            )

        if erro:
            print(
                "Motivo:",
                erro
            )

        resultados.append({
            "matricula": matricula,
            "nome": nome,
            "email_destino": email,
            "arquivo": arquivo_pdf,
            "status": status,
            "data_envio": data_envio,
            "mensagem_erro": erro
        })

    # ========================================================
    # RELATÓRIO
    # ========================================================

    relatorio = pd.DataFrame(
        resultados
    )

    relatorio.to_excel(
        caminho_relatorio,
        index=False
    )

    if relatorio.empty:
        quantidade_pendente = 0
        quantidade_enviado = 0
        quantidade_erro = 0

    else:
        quantidade_pendente = (
            relatorio["status"]
            .eq("PENDENTE")
            .sum()
        )

        quantidade_enviado = (
            relatorio["status"]
            .eq("ENVIADO")
            .sum()
        )

        quantidade_erro = (
            relatorio["status"]
            .eq("ERRO")
            .sum()
        )

    print("\n" + "=" * 60)
    print("RESUMO")
    print("=" * 60)

    print(
        "Pendentes:",
        quantidade_pendente
    )

    print(
        "Enviados:",
        quantidade_enviado
    )

    print(
        "Erros:",
        quantidade_erro
    )

    print(
        "\nRelatório criado:",
        caminho_relatorio
    )

    print(
        "\nPROCESSAMENTO CONCLUÍDO."
    )

    return relatorio


# ============================================================
# EXECUÇÃO DIRETA
# ============================================================

def main():
    try:
        processar_envios()

    except Exception as erro:
        print("\nERRO NO PROCESSAMENTO")
        print("Motivo:", erro)

        raise SystemExit(1)


if __name__ == "__main__":
    main()