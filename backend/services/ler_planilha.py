from pathlib import Path
from collections import Counter
import re

import pandas as pd

from backend.database.repository import importar_servidores


COLUNAS_ESPERADAS = [
    "Nome", "Matrícula", "CPF", "E-mail",
    "Carga Horária", "Acumula cargo (Sim/Não)"
]
COLUNAS_FUNCIONAIS = {'UA':'ua', 'Cargo':'cargo', 'Padrão':'padrao', 'Função':'funcao', 'Exercício':'exercicio'}


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
    value = str(valor).strip().lower()
    return value[:-1] if re.fullmatch(r'(20|40)h', value) else value


def padronizar_acumulacao(valor):
    if pd.isna(valor):
        return ""
    valor = str(valor).strip().lower()
    return {"sim": "Sim", "não": "Não", "nao": "Não"}.get(valor, valor)


def ler_planilha(caminho):
    try:
        if Path(caminho).suffix.lower()=='.xlsx':
            from zipfile import ZipFile
            with ZipFile(caminho) as bookzip:
                if sum(i.file_size for i in bookzip.infolist())>64*1024*1024:
                    raise ValueError('Planilha expandida excede 64 MB.')
        planilha = pd.read_excel(caminho,dtype=str,nrows=5001,engine='xlrd' if Path(caminho).suffix.lower()=='.xls' else 'openpyxl')
    except Exception as error:
        raise ValueError('Arquivo Excel inválido, corrompido ou grande demais.') from error
    if len(planilha)>5000:
        raise ValueError('A planilha deve conter no máximo 5000 linhas.')
    # Números com máscaras explícitas de zeros mantêm a representação exibida.
    if Path(caminho).suffix.lower() == '.xlsx':
        from openpyxl import load_workbook
        book = load_workbook(caminho, read_only=True, data_only=True)
        try:
            cells = book.active.iter_rows(); headers = [c.value for c in next(cells, ())]
            for index, row in enumerate(cells):
                if index >= len(planilha): break
                for field in ('CPF','Matrícula'):
                    if field in headers and index < len(planilha):
                        cell = row[headers.index(field)]
                        if cell.data_type == 'n' and isinstance(cell.value, (int,float)) and re.fullmatch(r'0+', cell.number_format):
                            planilha.at[index,field] = str(int(cell.value)).zfill(len(cell.number_format))
        finally:
            book.close()
    if Path(caminho).suffix.lower()=='.xls':
        import xlrd
        book=xlrd.open_workbook(caminho,formatting_info=True)
        try:
            sheet=book.sheet_by_index(0)
            headers=[sheet.cell_value(0,i) for i in range(sheet.ncols)]
            for index in range(1,min(sheet.nrows,len(planilha)+1)):
                for field in ('CPF','Matrícula'):
                    if field in headers:
                        cell=sheet.cell(index,headers.index(field))
                        mask=book.format_map[book.xf_list[cell.xf_index].format_key].format_str
                        if cell.ctype==xlrd.XL_CELL_NUMBER and re.fullmatch(r'0+',mask):
                            planilha.at[index-1,field]=str(int(cell.value)).zfill(len(mask))
        finally:
            book.release_resources()
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
        funcionais = {}
        for coluna, campo in COLUNAS_FUNCIONAIS.items():
            if coluna not in planilha.columns:
                continue
            valor = registro[coluna]
            texto = '' if pd.isna(valor) else str(valor).strip()
            limite = 300 if campo == 'exercicio' else 200
            if len(texto) > limite:
                erros.append(f'{coluna} deve conter no máximo {limite} caracteres')
            funcionais[campo] = texto or None
        if not nome:
            erros.append("Nome não informado")
        elif re.search(r"\d", nome):
            erros.append("Nome possui números")
        if not re.fullmatch(r"[0-9]{4,16}", matricula):
            erros.append("Matrícula deve possuir de 4 a 16 dígitos")
        if not cpf:
            erros.append("CPF não informado")
        elif len(cpf) != 11:
            erros.append("CPF deve possuir 11 dígitos")
        if not email or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            erros.append("E-mail possui formato inválido")
        if carga not in ("20", "40"):
            erros.append("Carga Horária deve ser 20, 20h, 40 ou 40h")
        if acumulacao not in ("Sim", "Não"):
            erros.append("Acumulação deve ser Sim ou Não")
        if erros:
            invalidos.append({"linha": indice + 2, "erros": erros, "nome": nome, "matricula": matricula, "cpf": cpf})
        else:
            validos.append({
                **funcionais,
                "linha": indice + 2,
                "matricula": matricula,
                "nome": nome,
                "cpf": cpf,
                "email_pessoal": email,
                "carga_horaria": int(carga),
                "acumula_cargo": acumulacao == "Sim",
            })

    repetidas = {key for key,count in Counter(r['matricula'] for r in validos).items() if count>1}
    cpfs = {key for key,count in Counter(r['cpf'] for r in validos).items() if count>1}
    aprovados = []
    for row in validos:
        errors = []
        if row['matricula'] in repetidas: errors.append(f"Matrícula duplicada: {row['matricula']}")
        if row['cpf'] in cpfs: errors.append('CPF duplicado na planilha')
        if errors:
            invalidos.append({**row,'erros':errors})
        else:
            aprovados.append(row)
    return {'lidos':len(planilha),'validos':aprovados,'invalidos':invalidos,'duplicados':len(repetidas)}



def importar_planilha(caminho):
    resultado = ler_planilha(caminho)
    resultado["importados"] = importar_servidores(resultado["validos"])
    return resultado
