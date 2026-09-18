import pandas as pd
import re

ARQUIVO = "Planilha de professores - exemplo.xlsx"

COLUNAS_ESPERADAS = [
    "Nome", "Matrícula", "CPF", "E-mail",
    "Carga Horária", "Acumula cargo (Sim/Não)"
]

def padronizar_nome(valor):
    if pd.isna(valor):
        return ""
    valor = re.sub(r"\s+", " ", str(valor).strip())
    return valor.title()

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
    if valor == "sim":
        return "Sim"
    if valor in ("não", "nao"):
        return "Não"
    return valor

try:
    planilha = pd.read_excel(ARQUIVO, dtype=str)
except FileNotFoundError:
    print(f"ERRO: arquivo não encontrado: {ARQUIVO}")
    raise SystemExit(1)

print("=" * 60)
print("SISTEMA DE CADASTRO DE PROFESSORES")
print("=" * 60)
print(f"\nQuantidade de registros lidos: {len(planilha)}")

print("\nCOLUNAS ENCONTRADAS:")
for coluna in planilha.columns:
    print(f"- {coluna}")

colunas_faltantes = [
    coluna for coluna in COLUNAS_ESPERADAS
    if coluna not in planilha.columns
]

if colunas_faltantes:
    print("\nERRO: colunas obrigatórias faltando:")
    for coluna in colunas_faltantes:
        print(f"- {coluna}")
    raise SystemExit(1)

print("\nTodas as colunas obrigatórias foram encontradas.")

planilha["Nome"] = planilha["Nome"].apply(padronizar_nome)
planilha["Matrícula"] = planilha["Matrícula"].apply(padronizar_matricula)
planilha["CPF"] = planilha["CPF"].apply(padronizar_cpf)
planilha["E-mail"] = planilha["E-mail"].apply(padronizar_email)
planilha["Carga Horária"] = planilha["Carga Horária"].apply(padronizar_carga_horaria)
planilha["Acumula cargo (Sim/Não)"] = planilha["Acumula cargo (Sim/Não)"].apply(padronizar_acumulacao)

registros_validos = []
registros_invalidos = []

for indice, registro in planilha.iterrows():
    erros = []

    nome = registro["Nome"]
    matricula = registro["Matrícula"]
    cpf = registro["CPF"]
    email = registro["E-mail"]
    carga = registro["Carga Horária"]
    acumulacao = registro["Acumula cargo (Sim/Não)"]

    if not nome:
        erros.append("Nome não informado")
    elif re.search(r"\d", nome):
        erros.append("Nome possui números")

    if not matricula:
        erros.append("Matrícula não informada")
    elif not matricula.isdigit():
        erros.append("Matrícula deve conter somente números")

    if not cpf:
        erros.append("CPF não informado")
    elif not cpf.isdigit():
        erros.append("CPF deve conter somente números")
    elif len(cpf) != 11:
        erros.append("CPF deve possuir 11 dígitos")

    if not email:
        erros.append("E-mail não informado")
    elif not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        erros.append("E-mail possui formato inválido")

    if not carga:
        erros.append("Carga Horária não informada")
    elif not carga.isdigit():
        erros.append("Carga Horária deve ser numérica")
    elif int(carga) <= 0:
        erros.append("Carga Horária deve ser maior que zero")

    if not acumulacao:
        erros.append("Campo de acumulação não informado")
    elif acumulacao not in ("Sim", "Não"):
        erros.append("Acumulação deve ser Sim ou Não")

    if erros:
        registros_invalidos.append({
            "linha": indice + 2,
            "erros": erros
        })
    else:
        registros_validos.append(registro)

dados_validos = pd.DataFrame(registros_validos, columns=planilha.columns)

if dados_validos.empty:
    duplicados = pd.DataFrame(columns=planilha.columns)
else:
    duplicados = dados_validos[
        dados_validos["Matrícula"].duplicated(keep=False)
    ].copy()

if dados_validos.empty:
    dados_para_importacao = pd.DataFrame(columns=planilha.columns)
else:
    dados_para_importacao = dados_validos[
        ~dados_validos["Matrícula"].duplicated(keep=False)
    ].copy()

dados_banco = pd.DataFrame()

if not dados_para_importacao.empty:
    dados_banco["matricula"] = dados_para_importacao["Matrícula"]
    dados_banco["nome"] = dados_para_importacao["Nome"]
    dados_banco["cpf"] = dados_para_importacao["CPF"]
    dados_banco["email_pessoal"] = dados_para_importacao["E-mail"]
    dados_banco["carga_horaria"] = dados_para_importacao["Carga Horária"].astype(int)
    dados_banco["acumula_cargo"] = dados_para_importacao[
        "Acumula cargo (Sim/Não)"
    ].map({"Sim": True, "Não": False})

if dados_banco.empty:
    servidores_acumuladores = pd.DataFrame(columns=dados_banco.columns)
else:
    servidores_acumuladores = dados_banco[
        dados_banco["acumula_cargo"] == True
    ].copy()

print("\n" + "=" * 60)
print("REGISTROS INVÁLIDOS")
print("=" * 60)

if not registros_invalidos:
    print("Nenhum registro inválido.")
else:
    for item in registros_invalidos:
        print(f"\nLinha {item['linha']}:")
        for erro in item["erros"]:
            print(f"  - {erro}")

print("\n" + "=" * 60)
print("REGISTROS DUPLICADOS")
print("=" * 60)

if duplicados.empty:
    print("Nenhum registro duplicado.")
else:
    print(duplicados.to_string(index=False))

print("\n" + "=" * 60)
print("DADOS PARA O BANCO")
print("=" * 60)

if dados_banco.empty:
    print("Nenhum registro disponível para importação.")
else:
    print(dados_banco.to_string(index=False))

print("\n" + "=" * 60)
print("SERVIDORES QUE ACUMULAM CARGO")
print("=" * 60)

if servidores_acumuladores.empty:
    print("Nenhum servidor acumulador.")
else:
    print(servidores_acumuladores.to_string(index=False))

dados_banco.to_excel("servidores_para_banco.xlsx", index=False)
servidores_acumuladores.to_excel("servidores_acumuladores.xlsx", index=False)

relatorio_erros = pd.DataFrame([
    {"linha": item["linha"], "erros": " | ".join(item["erros"])}
    for item in registros_invalidos
])
relatorio_erros.to_excel("relatorio_erros.xlsx", index=False)

print("\n" + "=" * 60)
print("RESUMO FINAL")
print("=" * 60)
print(f"Registros lidos: {len(planilha)}")
print(f"Registros inválidos: {len(registros_invalidos)}")
print(f"Registros válidos: {len(dados_validos)}")
print(f"Registros duplicados: {len(duplicados)}")
print(f"Registros para importação: {len(dados_banco)}")
print(f"Servidores acumuladores: {len(servidores_acumuladores)}")
print("\nPROCESSAMENTO CONCLUÍDO.")
