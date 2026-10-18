"""Leitura conservadora de datas explícitas; PDFs sempre exigem conferência da prévia."""
import re
from datetime import date, timedelta
import pymupdf
from pydantic import ValidationError
from backend.config import MAX_CALENDAR_PDF_PAGES
from backend.ocr.reader import extrair_texto_pagina
from backend.services.folhas_recebidas import validar_pdf
from backend.services.calendario import interpretar_data, sugerir_tipo, MAX_LINHAS
from backend.models.calendario import DataEspecialPayload

DATA = r'\d{2}/\d{2}/\d{4}'
ENTRADA = re.compile(rf'^({DATA})(?:\s+(?:a|até|ate|–|-)\s*({DATA}))?(?:\s*[-–—:|]\s*|\s+)?(.*)$', re.I)
CABECALHO = re.compile(r'^(?:calend[aá]rio(?: acad[eê]mico)?(?:\s+\d{4})?|data\s*(?:\||\s)\s*especifica[çc][aã]o|p[aá]gina\s+\d+(?:\s+de\s+\d+)?)$', re.I)


MESES = {nome: i for i,nome in enumerate(('JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'),1)}
MES_ANO = re.compile(r'^('+'|'.join(MESES)+r')\s*/\s*(20\d{2})$',re.I)
DATA_CURTA = r'\d{2}/\d{2}(?:/\d{4})?'
GRADE = re.compile(r'^(?:\d{1,3}|Dom|Seg|Ter|Qua|Qui|Sex|Sáb|Semana|Leg\.|S|T|Q|Qtd\.?\s*Dias|Dias\s+letivos.*|Total\s+.*|[12]º?\s*Sem|GOVERNO DO DISTRITO FEDERAL|UNIVERSIDADE DO DISTRITO FEDERAL.*|CALENDÁRIO ACADÊMICO.*)$',re.I)


def datas_contextuais(expressao, ano):
    """Completa somente ano/mês explicitamente indicados no cabeçalho/expressão."""
    tokens=re.split(r'\s+(a|até|ate|e)\s+|\s*(,)\s*',expressao,flags=re.I)
    tokens=[t.strip() for t in tokens if t and t.strip()]
    parts=tokens[::2];separadores=[t.lower() for t in tokens[1::2]]
    if not parts or any(not re.fullmatch(r'\d{2}(?:/\d{2}(?:/20\d{2})?)?',p) for p in parts):
        raise ValueError('Expressão de datas não reconhecida; revisar.')
    completas=[p.split('/') for p in parts if '/' in p]
    if not completas:
        raise ValueError('Mês não informado na expressão; revisar.')
    mes=int(completas[-1][1])
    dates=[]
    for token in parts:
        values=list(map(int,token.split('/')))
        dates.append(date(values[2] if len(values)==3 else ano,values[1] if len(values)>=2 else mes,values[0]))
    if any(sep in ('a','até','ate') for sep in separadores):
        if len(dates)!=2 or len(separadores)!=1 or separadores[0] not in ('a','até','ate'):
            raise ValueError('Intervalo de datas ambíguo; revisar.')
        first,last=dates
        if last<first or (last-first).days>365:
            raise ValueError('Intervalo invertido ou superior a 366 dias; revisar.')
        return [first+timedelta(days=i) for i in range((last-first).days+1)]
    return dates


def interpretar_calendario_mensal(linhas,pagina,origem):
    records=[];ano=None
    for numero,texto in linhas:
        header=MES_ANO.fullmatch(texto)
        if header:
            ano=int(header.group(2));continue
        if GRADE.fullmatch(texto) or not texto:continue
        # Não transforma dias da grade em eventos; estes precisam de data e descrição.
        base=dict(linha=numero,pagina=pagina,texto=texto[:2000],origem=origem)
        try:
            partes=re.split(r'\s*[-–—]\s*',texto,maxsplit=1)
            if ano is None or len(partes)!=2:
                raise ValueError('Evento sem cabeçalho de ano/data e descrição reconhecíveis; revisar.')
            expressao,descricao=partes
            if not re.search(r'[A-Za-zÀ-ÿ]{3}',descricao) or re.search(DATA_CURTA,descricao):
                raise ValueError('Descrição insuficiente ou com outra data ambígua; revisar.')
            days=datas_contextuais(expressao,ano)
            event=DataEspecialPayload(data=days[0],especificacao=descricao,tipo=sugerir_tipo(descricao))
            records.extend({**base,'evento':event.model_copy(update={'data':day})} for day in days)
        except (ValueError,ValidationError) as error:
            records.append({**base,'erro':str(error)[:500]})
        if len(records)>MAX_LINHAS:
            raise ValueError(f'Calendário excede {MAX_LINHAS} entradas; divida o documento.')
    return records


def interpretar_texto(texto, pagina, origem):
    linhas = [(i, ' '.join(t.split())) for i,t in enumerate(texto.splitlines(),1) if t.strip()]
    if any(MES_ANO.fullmatch(texto) for _,texto in linhas):
        return interpretar_calendario_mensal(linhas,pagina,origem)
    records=[];index=0
    while index<len(linhas):
        if len(records)>=MAX_LINHAS:
            raise ValueError(f'Calendário excede {MAX_LINHAS} entradas; divida o documento.')
        linha,texto=linhas[index];index+=1
        if CABECALHO.fullmatch(texto):continue
        base=dict(linha=linha,pagina=pagina,texto=texto[:2000],origem=origem)
        match=ENTRADA.fullmatch(texto)
        if not match:
            records.append({**base,'erro':'Texto sem data DD/MM/AAAA e especificação reconhecíveis; revisar.'});continue
        inicio,fim,descricao=match.groups()
        if not descricao and index<len(linhas) and not re.search(DATA,linhas[index][1]) and not CABECALHO.fullmatch(linhas[index][1]):
            descricao=linhas[index][1];base['texto']+='\n'+descricao;index+=1
        try:
            day=interpretar_data(inicio);last=interpretar_data(fim) if fim else day
            if last<day or (last-day).days>365:
                raise ValueError('Intervalo invertido ou superior a 366 dias; revisar.')
            # Uma segunda data não enquadrada como intervalo é ambígua.
            if re.search(r'\d[/\d]*\d|\b\d{1,2}/',descricao):
                raise ValueError('Outra data/número ambíguo na descrição; revisar.')
            if not re.search(r'[A-Za-zÀ-ÿ]{3}',descricao):
                raise ValueError('Especificação vazia ou insuficiente; revisar.')
            descricao=descricao.strip(' -–—:|')
            evento=DataEspecialPayload(data=day,especificacao=descricao,tipo=sugerir_tipo(descricao))
            for offset in range((last-day).days+1):
                records.append({**base,'evento':evento.model_copy(update={'data':day+timedelta(days=offset)})})
        except (ValueError,ValidationError) as error:
            records.append({**base,'erro':str(error)[:500]})
    if len(records)>MAX_LINHAS:
        raise ValueError(f'Calendário excede {MAX_LINHAS} entradas; divida o documento.')
    return records or [dict(linha=1,pagina=pagina,texto='',origem=origem,erro='Página sem texto reconhecido; revisar.')]


def ler_calendario_pdf(caminho):
    paginas=validar_pdf(caminho)
    if paginas>MAX_CALENDAR_PDF_PAGES:
        raise ValueError(f'Calendário PDF deve conter no máximo {MAX_CALENDAR_PDF_PAGES} páginas.')
    records=[]
    with pymupdf.open(caminho) as doc:
        for numero,page in enumerate(doc,1):
            try:
                texto,origem=extrair_texto_pagina(page,lambda text:len(text)>=20 and (bool(re.search(DATA,text)) or any(MES_ANO.fullmatch(line.strip()) for line in text.splitlines())))
                records.extend(interpretar_texto(texto,numero,origem))
            except (RuntimeError,OSError,pymupdf.FileDataError):
                records.append(dict(linha=1,pagina=numero,texto='',origem='OCR',erro='Falha ao ler página/OCR. Confira Tesseract, idioma e qualidade do documento.'))
            if len(records)>MAX_LINHAS:
                raise ValueError(f'Calendário excede {MAX_LINHAS} entradas; divida o documento.')
    # Numeração única do relatório, com página/linha original preservadas.
    return [{**r,'linha_origem':r['linha'],'linha':i} for i,r in enumerate(records,1)]
