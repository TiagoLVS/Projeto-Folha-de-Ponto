import hashlib
import re
import unicodedata
from datetime import date, datetime, time
from pathlib import Path
from zipfile import ZipFile, BadZipFile
from xml.etree.ElementTree import ParseError

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from pydantic import ValidationError
from backend.database.calendario import importar_datas
from backend.models.calendario import DataEspecialPayload, TipoData

MAX_LINHAS = 5000


def interpretar_data(value):
    if isinstance(value, datetime):
        if value.time() != time():
            raise ValueError('A célula deve conter somente uma data, sem horário.')
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and re.fullmatch(r'\d{2}/\d{2}/\d{4}', value.strip()):
        try:
            return datetime.strptime(value.strip(), '%d/%m/%Y').date()
        except ValueError:
            pass
    raise ValueError('Data inválida: use uma célula de data do Excel ou DD/MM/AAAA.')


def sugerir_tipo(text):
    simple = ''.join(c for c in unicodedata.normalize('NFD', text.lower()) if not unicodedata.combining(c))
    for pattern, tipo in ((r'^ponto facultativo\b', TipoData.PONTO_FACULTATIVO), (r'^recesso\b', TipoData.RECESSO), (r'^feriado\b', TipoData.FERIADO)):
        if re.search(pattern, simple):
            return tipo
    return TipoData.OUTRO


def ler_calendario(caminho):
    try:
        with ZipFile(caminho) as archive:
            if sum(info.file_size for info in archive.infolist()) > 64 * 1024 * 1024:
                raise ValueError('Planilha expandida muito grande (limite de 64 MB).')
        workbook = load_workbook(caminho, read_only=True, data_only=False)
    except (BadZipFile, OSError, KeyError, InvalidFileException, ParseError) as error:
        raise ValueError('Arquivo Excel inválido ou corrompido.') from error
    try:
        sheet = workbook.active
        if sheet is None:
            raise ValueError('A planilha não possui uma aba ativa.')
        rows = sheet.iter_rows()
        header = next(rows, ())
        names = [' '.join(str(cell.value or '').split()).lower() for cell in header]
        for name in ('data', 'especificação'):
            if names.count(name) != 1:
                raise ValueError('A primeira linha deve conter uma única coluna Data e uma única coluna Especificação.')
        data_idx, text_idx = names.index('data'), names.index('especificação')
        records = []
        for index, row in enumerate(rows, 2):
            if index > MAX_LINHAS + 1:
                raise ValueError(f'A planilha deve conter no máximo {MAX_LINHAS} linhas de dados.')
            values = [cell.value for cell in row]
            if all(value is None or value == '' for value in values):
                continue
            try:
                raw_date, raw_text = row[data_idx], row[text_idx]
                if raw_date.data_type == 'f' or raw_text.data_type == 'f':
                    raise ValueError('Fórmulas não são aceitas. Cole os valores da data e especificação.')
                day = interpretar_data(raw_date.value)
                if not isinstance(raw_text.value, str) or not raw_text.value.strip():
                    raise ValueError('Especificação não preenchida ou não textual.')
                event = DataEspecialPayload(data=day, especificacao=raw_text.value, tipo=sugerir_tipo(raw_text.value.strip()))
                records.append(dict(linha=index, evento=event))
            except (ValueError, ValidationError) as error:
                message = error.errors()[0]['msg'] if isinstance(error, ValidationError) else str(error)
                records.append(dict(linha=index, erro=message))
        return records
    except (ParseError, BadZipFile, KeyError) as error:
        raise ValueError('Arquivo Excel inválido ou corrompido.') from error
    finally:
        workbook.close()


def importar_calendario(caminho, nome_arquivo, modo='mesclar', ano=None):
    if modo not in ('mesclar','substituir'):
        raise ValueError('Modo de importação inválido.')
    if modo=='substituir' and (type(ano) is not int or not 2000<=ano<=2099):
        raise ValueError('Informe o ano do calendário a substituir.')
    if Path(caminho).suffix.lower()=='.pdf':
        from backend.services.calendario_pdf import ler_calendario_pdf
        records=ler_calendario_pdf(caminho)
        return preparar_previa(caminho,nome_arquivo,records,ano if modo=='substituir' else None)
    records=ler_calendario(caminho)
    if modo=='substituir':
        return preparar_previa(caminho,nome_arquivo,records,ano)
    digest=hashlib.sha256(Path(caminho).read_bytes()).hexdigest()
    return importar_datas(records,nome_arquivo,digest)


def estado_ano(cur,ano):
    import json
    cur.execute("""SELECT jsonb_build_array(id_data_especial,data,especificacao,tipo,atualizado_em) AS valor
        FROM data_especial WHERE data>=make_date(%s,1,1) AND data<make_date(%s+1,1,1)
        ORDER BY id_data_especial""",(ano,ano))
    rows=[r['valor'] for r in cur.fetchall()]
    return rows,hashlib.sha256(json.dumps(rows,ensure_ascii=False).encode()).hexdigest()


def preparar_previa(caminho,nome_arquivo,records,ano=None):
    """Prévia compartilhada: PDF normal ou substituição anual por Excel/PDF."""
    from uuid import uuid4
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
    from backend.database import repository
    if ano is not None:
        checked=[]
        for row in records:
            if 'evento' in row and row['evento'].data.year!=ano:
                checked.append({**{k:v for k,v in row.items() if k!='evento'},'erro':f'Data {row["evento"].data:%d/%m/%Y} fora do ano {ano}. Revise o arquivo.'})
            else:checked.append(row)
        records=checked
    token=uuid4()
    serialized=[{**r,'evento':r['evento'].model_dump(mode='json')} if 'evento' in r else r for r in records]
    digest=hashlib.sha256(Path(caminho).read_bytes()).hexdigest()
    existentes=0
    with repository.conectar() as conn,conn.cursor(row_factory=dict_row) as cur:
        stored=serialized
        if ano is not None:
            anteriores,assinatura=estado_ano(cur,ano)
            existentes=len(anteriores)
            stored={'modo':'substituir','ano':ano,'estado_anterior':assinatura,'registros':serialized}
        cur.execute("INSERT INTO importacao_calendario_preview(token,nome_arquivo,sha256,registros,expira_em) VALUES(%s,%s,%s,%s,clock_timestamp()+interval '15 minutes') RETURNING expira_em",(token,nome_arquivo[:255],digest,Jsonb(stored)))
        expires=cur.fetchone()['expira_em']
    invalidos=sum('erro' in r for r in records)
    validos=sum('evento' in r for r in records)
    bloqueio='Corrija as linhas inválidas antes de substituir o calendário.' if invalidos else 'O arquivo precisa conter pelo menos uma data válida.' if not validos else ''
    return dict(status='PREVIA',token=str(token),expira_em=expires,total=len(records),novos=0,atualizados=0,ignorados=0,
                invalidos=invalidos,validos=validos,modo='substituir' if ano is not None else 'mesclar',ano=ano,
                existentes_a_remover=existentes,pode_confirmar=not bloqueio if ano is not None else bool(validos),
                motivo_bloqueio=bloqueio if ano is not None else '',
                detalhes=[{k:v for k,v in r.items() if k!='evento'} | dict(status='INVALIDO' if 'erro' in r else 'REVISAR',motivo=r.get('erro','Confira a data e a especificação antes de confirmar.'),
                    data=r['evento'].data.isoformat() if 'evento' in r else None,especificacao=r['evento'].especificacao if 'evento' in r else None) for r in records])


def confirmar_pdf(token):
    """Confirma token de PDF ou substituição anual, preservando prévias antigas."""
    from fastapi import HTTPException
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
    from backend.database import repository
    with repository.conectar() as conn,conn.cursor(row_factory=dict_row) as cur:
        cur.execute('SELECT *,expira_em>clock_timestamp() AS valido FROM importacao_calendario_preview WHERE token=%s FOR UPDATE',(token,))
        row=cur.fetchone()
        if not row:raise HTTPException(404,'Prévia não encontrada.')
        if row['resultado'] is not None:return row['resultado']
        if not row['valido']:raise HTTPException(410,'Prévia expirada. Importe o arquivo novamente.')
        stored=row['registros']
        substituir=isinstance(stored,dict) and stored.get('modo')=='substituir'
        raw=stored['registros'] if substituir else stored
        records=[{**r,'evento':DataEspecialPayload.model_validate(r['evento'])} if 'evento' in r else r for r in raw]
        if substituir:
            ano=stored['ano']
            if not records or any('evento' not in r or r['evento'].data.year!=ano for r in records):
                raise HTTPException(422,'Substituição exige arquivo válido, sem linhas inválidas e com datas somente do ano escolhido.')
            cur.execute('LOCK TABLE data_especial IN SHARE ROW EXCLUSIVE MODE')
            anteriores,assinatura=estado_ano(cur,ano)
            if assinatura!=stored['estado_anterior']:
                raise HTTPException(409,'O calendário mudou desde a prévia. Importe o arquivo novamente para conferir a substituição.')
            cur.execute('DELETE FROM data_especial WHERE data>=make_date(%s,1,1) AND data<make_date(%s+1,1,1)',(ano,ano))
        result=importar_datas(records,row['nome_arquivo'],row['sha256'],cursor=cur)
        if substituir:
            result.update(modo='substituir',ano=ano,removidos=len(anteriores))
            # Auditoria guarda as datas antigas; os PDFs/snapshots existentes não são regenerados.
            result['detalhes'][0]['substituicao']={'ano':ano,'eventos_anteriores':anteriores}
            cur.execute('UPDATE importacao_calendario SET detalhes=%s WHERE id_importacao=%s',(Jsonb(result['detalhes']),result['id_importacao']))
        cur.execute('UPDATE importacao_calendario_preview SET resultado=%s,confirmado_em=clock_timestamp() WHERE token=%s',(Jsonb(result),token))
        return result
