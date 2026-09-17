import os
import re
import smtplib
from datetime import datetime
from email.message import EmailMessage

import pandas as pd


EMAIL_REMETENTE = os.getenv("DIGEP_EMAIL")
SENHA_APP = os.getenv("DIGEP_SENHA_APP")

# Enquanto estivermos testando:
# todos os e-mails serão enviados para a própria conta DIGEP.
TESTE_EMAIL = True


def email_valido(email):
    if pd.isna(email):
        return False

    email = str(email).strip()

    if not email:
        return False

    padrao = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"

    return re.match(padrao, email) is not None


def preparar_email(nome, destinatario, arquivo_pdf):
    if not email_valido(destinatario):
        return (
            None,
            "ERRO",
            "E-mail do destinatário inválido"
        )

    destinatario = str(destinatario).strip()

    mensagem = EmailMessage()

    mensagem["Subject"] = "Folha de ponto - DIGEP"
    mensagem["From"] = EMAIL_REMETENTE
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

        return mensagem, "PENDENTE", ""

    except FileNotFoundError:
        return (
            None,
            "ERRO",
            "Folha de ponto não encontrada"
        )


def enviar_email(mensagem):
    try:
        with smtplib.SMTP_SSL(
            "smtp.gmail.com",
            465,
            timeout=30
        ) as servidor:

            servidor.login(
                EMAIL_REMETENTE,
                SENHA_APP
            )

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


# Verifica se as credenciais existem
if not EMAIL_REMETENTE or not SENHA_APP:
    print(
        "ERRO: DIGEP_EMAIL ou DIGEP_SENHA_APP "
        "não foram configurados."
    )

    raise SystemExit(1)


try:
    planilha = pd.read_excel(
        "servidores_acumuladores.xlsx"
    )

    print("\nPROCESSAMENTO DOS SERVIDORES")
    print("=" * 60)

    resultados = []

    quantidade_pendente = 0
    quantidade_enviado = 0
    quantidade_erro = 0

    for indice, servidor in planilha.iterrows():

        nome = servidor["nome"]
        email = servidor["email_pessoal"]

        matricula = str(
            servidor["matricula"]
        ).strip()

        arquivo_pdf = os.path.join(
            "folhas",
            f"folha_{matricula}.pdf"
        )

        print("\nServidor:", nome)
        print("Matrícula:", matricula)
        print("E-mail cadastrado:", email)
        print("Arquivo:", arquivo_pdf)

        mensagem, status, erro = preparar_email(
            nome,
            email,
            arquivo_pdf
        )

        data_envio = None

        # Só tenta enviar se o e-mail foi preparado corretamente
        if status == "PENDENTE" and mensagem is not None:

            # SEGURANÇA PARA O TESTE:
            # manda para nossa própria conta.
            if TESTE_EMAIL:
                mensagem.replace_header(
                    "To",
                    EMAIL_REMETENTE
                )

                print(
                    "Modo de teste: enviando para:",
                    EMAIL_REMETENTE
                )

            status, erro, data_envio = enviar_email(
                mensagem
            )

        print("Status:", status)

        if data_envio:
            print("Data do envio:", data_envio)

        if erro:
            print("Motivo:", erro)

        resultados.append({
            "matricula": matricula,
            "nome": nome,
            "email_destino": email,
            "arquivo": arquivo_pdf,
            "status": status,
            "data_envio": data_envio,
            "mensagem_erro": erro
        })

        if status == "PENDENTE":
            quantidade_pendente += 1

        elif status == "ENVIADO":
            quantidade_enviado += 1

        elif status == "ERRO":
            quantidade_erro += 1


    relatorio = pd.DataFrame(resultados)

    relatorio.to_excel(
        "relatorio_envios.xlsx",
        index=False
    )

    print("\n" + "=" * 60)
    print("RESUMO")
    print("=" * 60)

    print("Pendentes:", quantidade_pendente)
    print("Enviados:", quantidade_enviado)
    print("Erros:", quantidade_erro)

    print(
        "\nRelatório criado: "
        "relatorio_envios.xlsx"
    )

    print("\nPROCESSAMENTO CONCLUÍDO.")


except FileNotFoundError:

    print(
        "ERRO: arquivo servidores_acumuladores.xlsx "
        "não encontrado."
    )


