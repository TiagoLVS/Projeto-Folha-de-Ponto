import re

import pandas as pd

from backend.database.repository import importar_servidores


COLUNAS_ESPERADAS = [
    "Nome", "Matrícula", "CPF", "E-mail",
    "Carga Horária", "Acumula cargo (Sim/Não)"
]


def padronizar_nome(valor):
    if pd.isna(valor):
        return ""
    return re.sub(r"\s+", " ", str(valor).strip()).title()


def padronizar_matricula(valor):
    if pd.isna(valor):
        return ""
    return re.sub(r"\D", "", str(valor).strip())


def padronizar_cpf(valor):
    if pd.isna(valor):
        return ""
    return re.sub(r"\D", "", str(valor).strip())


def padronizar_email(valor):
    if pd.isna(valor):
        return ""
    return str(valor).strip().lower()


def padronizar_carga_horaria(valor):
    if pd.isna(valor):
        return ""
    return str(valor).strip().lower().replace("h", "").strip()


def padronizar_acumulacao(valor):
    if pd.isna(valor):
        return ""
    valor = str(valor).strip().lower()
    return {"sim": "Sim", "não": "Não", "nao": "Não"}.get(valor, valor)


def ler_planilha(caminho):
    planilha = pd.read_excel(caminho, dtype=str)
    faltantes = [coluna for coluna in COLUNAS_ESPERADAS if coluna not in planilha.columns]
    if faltantes:
        raise ValueError("Colunas obrigatórias faltando: " + ", ".join(faltantes))

    planilha["Nome"] = planilha["Nome"].apply(padronizar_nome)
    planilha["Matrícula"] = planilha["Matrícula"].apply(padronizar_matricula)
    planilha["CPF"] = planilha["CPF"].apply(padronizar_cpf)
    planilha["E-mail"] = planilha["E-mail"].apply(padronizar_email)
    planilha["Carga Horária"] = planilha["Carga Horária"].apply(padronizar_carga_horaria)
    planilha["Acumula cargo (Sim/Não)"] = planilha["Acumula cargo (Sim/Não)"].apply(padronizar_acumulacao)

    validos = []
    invalidos = []
    for indice, registro in planilha.iterrows():
        nome = registro["Nome"]
        matricula = registro["Matrícula"]
        cpf = registro["CPF"]
        email = registro["E-mail"]
        carga = registro["Carga Horária"]
        acumulacao = registro["Acumula cargo (Sim/Não)"]
        erros = []
        if not nome:
            erros.append("Nome não informado")
        elif re.search(r"\d", nome):
            erros.append("Nome possui números")
        if not matricula:
            erros.append("Matrícula não informada")
        if not cpf:
            erros.append("CPF não informado")
        elif len(cpf) != 11:
            erros.append("CPF deve possuir 11 dígitos")
        if not email or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            erros.append("E-mail possui formato inválido")
        if not carga or not carga.isdigit() or int(carga) <= 0:
            erros.append("Carga Horária deve ser numérica e maior que zero")
        if acumulacao not in ("Sim", "Não"):
            erros.append("Acumulação deve ser Sim ou Não")
        if erros:
            invalidos.append({"linha": indice + 2, "erros": erros})
        else:
            validos.append({
                "matricula": matricula,
                "nome": nome,
                "cpf": cpf,
                "email_pessoal": email,
                "carga_horaria": int(carga),
                "acumula_cargo": acumulacao == "Sim",
            })

    matriculas = [registro["matricula"] for registro in validos]
    duplicadas = {valor for valor in matriculas if matriculas.count(valor) > 1}
    validos = [registro for registro in validos if registro["matricula"] not in duplicadas]
    invalidos.extend({"linha": None, "erros": [f"Matrícula duplicada: {valor}"]} for valor in duplicadas)
    return {"lidos": len(planilha), "validos": validos, "invalidos": invalidos, "duplicados": len(duplicadas)}


def importar_planilha(caminho):
    resultado = ler_planilha(caminho)
    resultado["importados"] = importar_servidores(resultado["validos"])
    return resultado
