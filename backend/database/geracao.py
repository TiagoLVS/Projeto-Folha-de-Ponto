from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from backend.database import repository
from backend.database.calendario import listar_datas
from backend.models.calendario import FiltrosCalendario


class ConflitoGeracao(ValueError):
    pass


def preparar_geracao(cur, payload):
    # Serializa versões concorrentes do mesmo professor, inclusive a primeira.
    cur.execute('SELECT id_servidor, nome, matricula, departamento, carga_horaria FROM servidor WHERE id_servidor=%s FOR UPDATE', (payload.id_servidor,))
    professor = cur.fetchone()
    if not professor:
        raise LookupError('Professor não encontrado.')
    ano, mes = map(int, payload.competencia.split('-'))
    cur.execute('''INSERT INTO competencia(mes,ano) VALUES (%s,%s)
        ON CONFLICT(mes,ano) DO UPDATE SET mes=EXCLUDED.mes RETURNING id_competencia''', (mes, ano))
    competencia = cur.fetchone()['id_competencia']
    cur.execute('SELECT COALESCE(max(versao),0) AS versao FROM folha_gerada WHERE id_servidor=%s AND id_competencia=%s', (payload.id_servidor, competencia))
    versao = cur.fetchone()['versao']
    if versao and not payload.nova_versao:
        raise ConflitoGeracao('Já existe um modelo gerado. Marque Gerar nova versão para preservar o anterior e criar outro.')
    cur.execute('SELECT id_folha FROM folha_ponto WHERE id_servidor=%s AND id_competencia=%s', (payload.id_servidor, competencia))
    referencia = cur.fetchone()
    eventos = listar_datas(FiltrosCalendario(ano=ano, mes=mes), cur)
    return professor, competencia, versao + 1, referencia['id_folha'] if referencia else None, eventos


def salvar_gerada(cur, professor, competencia, versao, referencia, eventos, path, size, sha256, modelo):
    cur.execute('''INSERT INTO folha_gerada(id_servidor,id_competencia,versao,id_folha_referencia,
        caminho_arquivo,nome_arquivo,tamanho_bytes,sha256,dados_professor,modelo)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *''',
        (professor['id_servidor'], competencia, versao, referencia, str(path), path.name, size, sha256, Jsonb(professor), modelo))
    document = cur.fetchone()
    for ordem, evento in enumerate(eventos):
        cur.execute('''INSERT INTO folha_gerada_evento(id_documento,ordem,id_data_especial,data,especificacao,tipo)
            VALUES (%s,%s,%s,%s,%s,%s)''',
            (document['id_documento'], ordem, evento['id_data_especial'], evento['data'], evento['especificacao'], evento['tipo']))
    return document


def listar_geradas(competencia=None, id_servidor=None):
    sql = '''SELECT fg.*, to_char(make_date(c.ano,c.mes,1),'YYYY-MM') AS competencia
        FROM folha_gerada fg JOIN competencia c USING(id_competencia)'''
    where, params = [], []
    if competencia:
        ano, mes = map(int, competencia.split('-'))
        where.extend(['c.ano=%s', 'c.mes=%s']); params.extend([ano, mes])
    if id_servidor:
        where.append('fg.id_servidor=%s'); params.append(id_servidor)
    if where:
        sql += ' WHERE ' + ' AND '.join(where)
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql + ' ORDER BY fg.gerado_em DESC, fg.id_documento DESC', params)
        return cur.fetchall()


def buscar_gerada(id_documento):
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute('''SELECT fg.*, to_char(make_date(c.ano,c.mes,1),'YYYY-MM') AS competencia
            FROM folha_gerada fg JOIN competencia c USING(id_competencia) WHERE id_documento=%s''', (id_documento,))
        document = cur.fetchone()
        if document:
            cur.execute('SELECT data, especificacao, tipo, id_data_especial FROM folha_gerada_evento WHERE id_documento=%s ORDER BY ordem', (id_documento,))
            document['eventos'] = cur.fetchall()
        return document
