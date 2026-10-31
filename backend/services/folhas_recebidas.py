"""Armazenamento transacional de folhas recebidas e revisões preservadas."""
from backend.paths import DATA
import hashlib
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pymupdf
from fastapi import HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from backend.database import repository
from backend.ocr.reader import executar_ocr

PASTA_FOLHAS = DATA / 'folhas'


def sanitizar_nome(nome):
    value = unicodedata.normalize('NFKD', str(nome)).encode('ascii', 'ignore').decode()
    value = re.sub(r'[^A-Za-z0-9 _-]', '', value)
    value = re.sub(r'\s+', '_', value.strip())
    value = re.sub(r'_+', '_', value).strip('_-')[:120]
    return value or 'Servidor'


def validar_pdf(caminho):
    path = Path(caminho)
    with path.open('rb') as file:
        if file.read(5) != b'%PDF-':
            raise ValueError('O conteúdo não é um PDF válido.')
    try:
        with pymupdf.open(path) as doc:
            if not doc.is_pdf or doc.needs_pass or not 1 <= len(doc) <= 100:
                raise ValueError('PDF protegido, vazio ou com mais de 100 páginas.')
            for page in doc:
                page.get_text()
            return len(doc)
    except (pymupdf.FileDataError, pymupdf.EmptyFileError, RuntimeError) as error:
        raise ValueError('PDF inválido ou corrompido.') from error


def caminho_seguro(value):
    path = Path(value).resolve()
    root = PASTA_FOLHAS.resolve()
    if not path.is_relative_to(root) or path.is_relative_to(root / 'geradas') or path.suffix.lower() != '.pdf':
        raise HTTPException(404, 'Arquivo fora do armazenamento de folhas recebidas.')
    if not path.is_file():
        raise HTTPException(404, 'Arquivo da folha não encontrado.')
    return path


def abrir_download(identifier):
    # O descritor continua apontando para a revisão correta após um rename OLD.
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute('SELECT caminho_arquivo,nome_arquivo FROM folha_ponto WHERE id_folha=%s AND ativo FOR SHARE', (identifier,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, 'Folha não encontrada.')
        try:
            file = caminho_seguro(row['caminho_arquivo']).open('rb')
        except FileNotFoundError as error:
            raise HTTPException(404, 'Arquivo da folha não encontrado.') from error
        return file, row['nome_arquivo']


class Arquivos:
    """Desfaz movimentações se a transação de banco não concluir."""
    def __init__(self):
        self.movimentos = []
        self.criados = []

    def mover(self, source, target):
        if not target.resolve().is_relative_to(PASTA_FOLHAS.resolve()): raise HTTPException(409, 'Destino fora do armazenamento permitido.')
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            raise HTTPException(409, 'Já existe um arquivo neste destino. Nenhum original foi substituído.')
        source.rename(target)
        self.movimentos.append((source, target))

    def gravar(self, target, content):
        if not target.resolve().is_relative_to(PASTA_FOLHAS.resolve()): raise HTTPException(409, 'Destino fora do armazenamento permitido.')
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as file:
            self.criados.append(target)
            file.write(content)

    def desfazer(self):
        for path in reversed(self.criados):
            path.unlink(missing_ok=True)
        for source, target in reversed(self.movimentos):
            if target.exists():
                target.rename(source)


def bloquear_servidores(cur, ids):
    for identifier in sorted({i for i in ids if i is not None}):
        cur.execute('SELECT * FROM servidor WHERE id_servidor=%s FOR UPDATE', (identifier,))
        if not cur.fetchone():
            raise HTTPException(404, 'Servidor não encontrado.')


def competencia(cur, period):
    ano, mes = map(int, period.split('-'))
    cur.execute('''INSERT INTO competencia(ano,mes) VALUES(%s,%s)
        ON CONFLICT(mes,ano) DO UPDATE SET mes=EXCLUDED.mes RETURNING id_competencia''', (ano, mes))
    return cur.fetchone()['id_competencia']


def arquivar(cur, row, files):
    old = caminho_seguro(row['caminho_arquivo'])
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    target = old.with_name(f'{old.stem}_OLD_{stamp}.pdf')
    if target.exists():
        target = old.with_name(f'{old.stem}_OLD_{stamp}_{uuid4().hex[:8]}.pdf')
    files.mover(old, target)
    cur.execute('UPDATE folha_ponto SET ativo=FALSE,caminho_arquivo=%s,atualizado_em=clock_timestamp() WHERE id_folha=%s', (str(target), row['id_folha']))


def destino(cur, person, period, current=None):
    folder = PASTA_FOLHAS / f'Folhas_{period}'
    name = f'{sanitizar_nome(person["nome"])}-{period}.pdf'
    path = folder / name
    # Homônimos têm desambiguação pela matrícula, sem depender do navegador.
    cur.execute('SELECT id_folha FROM folha_ponto WHERE ativo AND caminho_arquivo=%s', (str(path),))
    owner = cur.fetchone()
    if owner and owner['id_folha'] != current:
        path = folder / f'{sanitizar_nome(person["nome"])}_{sanitizar_nome(person["matricula"])}-{period}.pdf'
    return path


def _consulta(cur, identifier=None, person=None, somente_ativas=True):
    sql = '''SELECT fp.*, s.nome,s.matricula,s.email,s.cpf,
        to_char(make_date(c.ano,c.mes,1),'YYYY-MM') AS competencia,
        ultimo.status_envio,ultimo.mensagem_erro
        FROM folha_ponto fp LEFT JOIN servidor s USING(id_servidor)
        LEFT JOIN competencia c USING(id_competencia)
        LEFT JOIN LATERAL(SELECT status_envio,mensagem_erro FROM envio e
            WHERE e.id_folha=fp.id_folha ORDER BY id_envio DESC LIMIT 1) ultimo ON TRUE WHERE TRUE'''
    params = []
    if somente_ativas:
        sql += ' AND fp.ativo'
    if identifier is not None:
        sql += ' AND fp.id_folha=%s'; params.append(identifier)
    if person is not None:
        sql += ' AND fp.id_servidor=%s'; params.append(person)
    cur.execute(sql + ' ORDER BY fp.data_importacao DESC,fp.id_folha DESC', params)
    return cur.fetchall()


def apresentar(row):
    size = row['tamanho_arquivo']
    if size is None:
        try:
            size = caminho_seguro(row['caminho_arquivo']).stat().st_size
        except HTTPException:
            size = 0
    envio = None
    if row['status_envio']:
        status = 'PROCESSANDO' if row['status_envio'] == 'PENDENTE' else row['status_envio']
        envio = {'status': status, 'mensagem': row['mensagem_erro'] or ('E-mail enviado.' if status == 'ENVIADO' else 'Envio pendente.')}
    return dict(id_folha=row['id_folha'], id_servidor=row['id_servidor'], competencia=row['competencia'],
                status_ocr=row['status_ocr'], nome_arquivo=row['nome_arquivo'], tamanho_arquivo=size,
                atualizado_em=row['atualizado_em'], confirmado_em=row['confirmado_em'],
                data_importacao=row['data_importacao'], data_processamento_ocr=row['data_processamento_ocr'],
                mensagem=row['mensagem_ocr'], matricula=row['matricula_lida'], competencia_lida=row['competencia_lida'],
                servidor={'nome': row['nome']}, versao=row['versao'], envio=envio, paginas=row['resultado_paginas'])


def listar(person=None):
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        return [apresentar(row) for row in _consulta(cur, person=person)]


def obter(identifier):
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        rows = _consulta(cur, identifier)
        if not rows:
            raise HTTPException(404, 'Folha não encontrada.')
        return rows[0]


def salvar_upload(path, person_id, period, overwrite=False, expected=None):
    validar_pdf(path)
    content = Path(path).read_bytes()
    files = Arquivos()
    try:
        with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
            bloquear_servidores(cur, [person_id])
            cur.execute('SELECT * FROM servidor WHERE id_servidor=%s', (person_id,)); person = cur.fetchone()
            comp = competencia(cur, period)
            cur.execute('SELECT * FROM folha_ponto WHERE ativo AND id_servidor=%s AND id_competencia=%s FOR UPDATE', (person_id, comp))
            old = cur.fetchone()
            if old and (not overwrite or expected != old['id_folha']):
                raise HTTPException(409, 'Já existe uma folha ativa. Confirme a substituição da versão atual.')
            if not old and expected is not None:
                raise HTTPException(409, 'A folha anterior mudou. Atualize o histórico antes de substituir.')
            version = old['versao'] + 1 if old else 1
            if old:
                arquivar(cur, old, files)
            target = destino(cur, person, period)
            files.gravar(target, content)
            cur.execute('''INSERT INTO folha_ponto(id_servidor,id_competencia,caminho_arquivo,nome_arquivo,
                tamanho_arquivo,sha256,versao,status_ocr,mensagem_ocr)
                VALUES(%s,%s,%s,%s,%s,%s,%s,'REVISAR','Aguardando processamento ou conferência manual.') RETURNING id_folha''',
                (person_id, comp, str(target), target.name, len(content), hashlib.sha256(content).hexdigest(), version))
            identifier = cur.fetchone()['id_folha']
            result = apresentar(_consulta(cur, identifier)[0])
        return result
    except BaseException:
        files.desfazer()
        raise


def remover(identifier):
    row = obter(identifier)
    files = Arquivos()
    try:
        with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
            bloquear_servidores(cur, [row['id_servidor']])
            cur.execute('SELECT * FROM folha_ponto WHERE id_folha=%s AND ativo FOR UPDATE', (identifier,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, 'Folha não encontrada.')
            arquivar(cur, row, files)
    except BaseException:
        files.desfazer(); raise


def confirmar(identifier, person_id, period, overwrite=False, expected=None):
    initial = obter(identifier)
    if len(initial['resultado_paginas'])>1:
        raise HTTPException(422, 'Separe as páginas candidatas antes de confirmar uma folha individual.')
    files = Arquivos()
    try:
        with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
            bloquear_servidores(cur, [person_id, initial['id_servidor']])
            cur.execute('SELECT * FROM folha_ponto WHERE id_folha=%s AND ativo FOR UPDATE', (identifier,)); row = cur.fetchone()
            if not row or row['id_servidor'] != initial['id_servidor']:
                raise HTTPException(409, 'A folha mudou. Recarregue antes de confirmar.')
            source = caminho_seguro(row['caminho_arquivo'])
            comp = competencia(cur, period)
            cur.execute('SELECT * FROM folha_ponto WHERE ativo AND id_servidor=%s AND id_competencia=%s AND id_folha<>%s FOR UPDATE', (person_id, comp, identifier))
            old = cur.fetchone()
            if old and (not overwrite or expected != old['id_folha']):
                raise HTTPException(409, 'Já existe uma folha nesse vínculo. Confirme a substituição atual.')
            if not old and expected is not None:
                raise HTTPException(409, 'O vínculo mudou. Recarregue o histórico.')
            if old:
                arquivar(cur, old, files)
            cur.execute('SELECT * FROM servidor WHERE id_servidor=%s', (person_id,)); person = cur.fetchone()
            target = destino(cur, person, period, identifier)
            if source != target.resolve():
                files.mover(source, target)
            cur.execute('''UPDATE folha_ponto SET id_servidor=%s,id_competencia=%s,caminho_arquivo=%s,
                nome_arquivo=%s,status_ocr='OK',mensagem_ocr=NULL,confirmado_em=clock_timestamp(),
                atualizado_em=clock_timestamp() WHERE id_folha=%s''', (person_id, comp, str(target), target.name, identifier))
            raw = _consulta(cur, identifier)[0]
            result = apresentar(raw)
        return result, {**raw, 'email': person['email'], 'nome': person['nome']}
    except BaseException:
        files.desfazer(); raise


def processar(identifier):
    initial = obter(identifier)
    if any(p.get('importado_id') for p in initial['resultado_paginas']):
        raise HTTPException(409, 'Este PDF já possui páginas importadas. Consulte as candidatas pendentes.')
    path = caminho_seguro(initial['caminho_arquivo'])
    results, seen = [], set()
    # Cada página é identificada isoladamente, sem concatenar texto de servidores.
    with pymupdf.open(path) as original:
        for index in range(len(original)):
            page_doc = pymupdf.open()
            try:
                page_doc.insert_pdf(original, from_page=index, to_page=index)
                import tempfile
                with tempfile.TemporaryDirectory() as folder:
                    single = Path(folder) / 'pagina.pdf'; page_doc.save(single)
                    try:
                        result = executar_ocr(single)
                        person = repository.buscar_servidor_por_matricula(result.get('matricula')) if result.get('matricula') else None
                        pair = (person['id_servidor'], result.get('competencia')) if person and result.get('competencia') else None
                        duplicate = bool(pair and pair in seen)
                        if pair:
                            seen.add(pair)
                        results.append(dict(pagina=index+1,matricula=result.get('matricula'),competencia=result.get('competencia'),
                            servidor=person,status_ocr='REVISAR' if duplicate or not pair else 'OK',duplicidade=duplicate,
                            mensagem='Duplicidade de servidor e competência dentro do PDF.' if duplicate else None))
                    except Exception:
                        results.append(dict(pagina=index+1,matricula=None,competencia=None,servidor=None,status_ocr='ERRO',duplicidade=False,mensagem='Falha de leitura desta página. Confira o original e o Tesseract.'))
            finally:
                page_doc.close()
    # Multipágina permanece em revisão até separar/importar as candidatas. Nenhum vínculo é escolhido arbitrariamente.
    first = results[0]
    status = first['status_ocr'] if len(results) == 1 else 'REVISAR'
    message = first['mensagem'] if len(results) == 1 else 'PDF multipágina: confira as candidatas por página antes de vincular.'
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        bloquear_servidores(cur, [initial['id_servidor']])
        cur.execute('''UPDATE folha_ponto SET status_ocr=%s,matricula_lida=%s,competencia_lida=%s,
            mensagem_ocr=%s,resultado_paginas=%s,confirmado_em=NULL,data_processamento_ocr=clock_timestamp(),atualizado_em=clock_timestamp()
            WHERE id_folha=%s AND ativo AND caminho_arquivo=%s RETURNING id_folha''',
            (status, first['matricula'] if len(results)==1 else None, first['competencia'] if len(results)==1 else None, message, Jsonb(results), identifier, initial['caminho_arquivo']))
        if not cur.fetchone():
            raise HTTPException(409, 'A folha foi substituída durante a leitura. Atualize o histórico.')
        response = apresentar(_consulta(cur, identifier)[0]); response['paginas'] = results
    return response


def pacotes():
    with repository.conectar() as conn,conn.cursor(row_factory=dict_row) as cur:
        rows=_consulta(cur,somente_ativas=False)
        return [apresentar(row) for row in rows if len(row['resultado_paginas'])>1
                and any(not page.get('importado_id') for page in row['resultado_paginas'])]


def importar_pagina(identifier,pagina,person,period,overwrite=False,expected=None):
    import tempfile
    with repository.conectar() as conn,conn.cursor(row_factory=dict_row) as cur:
        rows=_consulta(cur,identifier,somente_ativas=False)
        if not rows: raise HTTPException(404,'PDF de origem não encontrado.')
        row=rows[0]
        if pagina<1 or pagina>len(row['resultado_paginas']):
            raise HTTPException(422,'Página candidata não encontrada. Processe o PDF primeiro.')
        if row['resultado_paginas'][pagina-1].get('importado_id'):
            raise HTTPException(409,'Essa página já foi importada. Atualize o histórico.')
    with tempfile.TemporaryDirectory() as folder,pymupdf.open(caminho_seguro(row['caminho_arquivo'])) as source,pymupdf.open() as single:
        single.insert_pdf(source,from_page=pagina-1,to_page=pagina-1)
        path=Path(folder)/'pagina.pdf';single.save(path)
        result=salvar_upload(path,person,period,overwrite,expected)
    with repository.conectar() as conn:
        conn.execute("UPDATE folha_ponto SET resultado_paginas=jsonb_set(resultado_paginas,ARRAY[%s::text,'importado_id'],to_jsonb(%s::bigint)) WHERE id_folha=%s",(pagina-1,result['id_folha'],identifier))
    return result


def pendentes():
    with repository.conectar() as conn,conn.cursor(row_factory=dict_row) as cur:
        return [apresentar(row) for row in _consulta(cur) if row['id_servidor'] is None or row['competencia'] is None]
