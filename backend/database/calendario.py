from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from backend.database import repository


def listar_datas(filtros, cursor=None):
    inicio, fim = filtros.limites()
    conditions, values = [], []
    if inicio:
        conditions.append('data >= %s'); values.append(inicio)
    if fim:
        conditions.append('data <= %s'); values.append(fim)
    if filtros.tipo:
        conditions.append('tipo = %s'); values.append(filtros.tipo.value)
    sql = 'SELECT * FROM data_especial' + (' WHERE ' + ' AND '.join(conditions) if conditions else '') + ' ORDER BY data, especificacao, id_data_especial'
    if cursor is not None:
        cursor.execute(sql, values)
        return cursor.fetchall()
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, values)
        return cur.fetchall()


def buscar_data(id_evento):
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute('SELECT * FROM data_especial WHERE id_data_especial = %s', (id_evento,))
        return cur.fetchone()


def salvar_data(payload, id_evento=None):
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        params = (payload.data, payload.especificacao, payload.tipo.value)
        if id_evento is None:
            cur.execute('INSERT INTO data_especial(data, especificacao, tipo) VALUES (%s,%s,%s) RETURNING *', params)
        else:
            cur.execute('UPDATE data_especial SET data=%s, especificacao=%s, tipo=%s WHERE id_data_especial=%s RETURNING *', (*params, id_evento))
        return cur.fetchone()


def excluir_data(id_evento):
    with repository.conectar() as conn, conn.cursor() as cur:
        cur.execute('DELETE FROM data_especial WHERE id_data_especial=%s RETURNING id_data_especial', (id_evento,))
        return cur.fetchone() is not None


def importar_datas(linhas, nome_arquivo, sha256):
    resumo = dict(total=len(linhas), novos=0, atualizados=0, ignorados=0, invalidos=0, detalhes=[])
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        vistos = set()
        for linha in linhas:
            if 'erro' in linha:
                resumo['invalidos'] += 1
                resumo['detalhes'].append(dict(linha=linha['linha'], status='INVALIDO', motivo=linha['erro']))
                continue
            event = linha['evento']
            cur.execute('SELECT normalizar_especificacao(%s) AS chave', (event.especificacao,))
            key = (event.data, cur.fetchone()['chave'])
            if key in vistos:
                resumo['ignorados'] += 1
                resumo['detalhes'].append(dict(linha=linha['linha'], status='IGNORADO', motivo='Duplicado na planilha.'))
                continue
            vistos.add(key)
            cur.execute('''INSERT INTO data_especial(data, especificacao, tipo) VALUES (%s,%s,%s)
                ON CONFLICT (data, especificacao_normalizada) DO NOTHING RETURNING id_data_especial''',
                (event.data, event.especificacao, event.tipo.value))
            created = cur.fetchone()
            if created:
                resumo['novos'] += 1
                status, motivo = 'NOVO', 'Evento cadastrado.'
            else:
                # Apenas a apresentação do texto pode ser atualizada. A classificação
                # manual já existente nunca é substituída por uma sugestão da planilha.
                cur.execute('''UPDATE data_especial SET especificacao=%s
                    WHERE data=%s AND especificacao_normalizada=normalizar_especificacao(%s)
                    AND especificacao IS DISTINCT FROM %s RETURNING id_data_especial''',
                    (event.especificacao, event.data, event.especificacao, event.especificacao))
                if cur.fetchone():
                    resumo['atualizados'] += 1
                    status, motivo = 'ATUALIZADO', 'Apresentação da especificação atualizada; tipo preservado.'
                else:
                    resumo['ignorados'] += 1
                    status, motivo = 'IGNORADO', 'Evento já cadastrado; tipo preservado.'
            resumo['detalhes'].append(dict(linha=linha['linha'], status=status, motivo=motivo))
        cur.execute('''INSERT INTO importacao_calendario
            (nome_arquivo,sha256,total,novos,atualizados,ignorados,invalidos,detalhes)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id_importacao''',
            (nome_arquivo[:255], sha256, resumo['total'], resumo['novos'], resumo['atualizados'], resumo['ignorados'], resumo['invalidos'], Jsonb(resumo['detalhes'])))
        resumo['id_importacao'] = cur.fetchone()['id_importacao']
    return resumo
