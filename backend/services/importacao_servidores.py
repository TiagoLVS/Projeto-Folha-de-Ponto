"""Prévia persistida e confirmação transacional, revalidada pelo servidor."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from fastapi import HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from backend.database import repository
from backend.services.ler_planilha import ler_planilha

CAMPOS = ('nome', 'matricula', 'cpf', 'email', 'carga_horaria', 'acumula_cargo')


def classificar(cur, value):
    if type(value.get('carga_horaria')) is not int or value['carga_horaria'] not in (20,40):
        return 'ignorado', 'Carga horária deve ser 20 ou 40 horas. Gere uma nova prévia.', False
    cur.execute('SELECT * FROM servidor WHERE matricula=%s', (value['matricula'],))
    current = cur.fetchone()
    cur.execute('SELECT matricula FROM servidor WHERE cpf=%s AND matricula<>%s', (value['cpf'], value['matricula']))
    if cur.fetchone():
        return 'ignorado', 'CPF já pertence a outra matrícula.', False
    if current is None:
        return 'novo', 'Matrícula ainda não cadastrada.', True
    if all(current[k] == value[k] for k in CAMPOS):
        return 'ignorado', 'Cadastro já possui os mesmos dados.', True
    return 'atualizado', 'Dados da matrícula serão atualizados; departamento será preservado.', True


def preview(path):
    data = ler_planilha(path)
    rows = []
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        for raw in data['validos']:
            value = {**raw, 'email': raw['email_pessoal']}
            action, reason, valid = classificar(cur, value)
            rows.append(dict(linha=raw['linha'],nome=value['nome'],matricula=value['matricula'],cpf=value['cpf'],
                email=value['email'],acao=action,motivo=reason,valido=valid,dados=value))
        for raw in data['invalidos']:
            rows.append(dict(linha=raw['linha'],nome=raw.get('nome',''),matricula=raw.get('matricula',''),cpf=raw.get('cpf',''),
                acao='ignorado',motivo='; '.join(raw['erros']),valido=False))
        rows.sort(key=lambda row: row['linha'])
        token = uuid4(); expiry = datetime.now(timezone.utc) + timedelta(minutes=15)
        cur.execute('INSERT INTO importacao_servidor_preview(token,registros,expira_em) VALUES(%s,%s,%s)', (token, Jsonb(rows), expiry))
    return dict(token=str(token), expira_em=expiry, registros=[{k:v for k,v in row.items() if k!='dados'} for row in rows])


def confirmar(token):
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        # Serializa confirmações e cadastros concorrentes que usem matrícula/CPF.
        cur.execute('LOCK TABLE servidor IN SHARE ROW EXCLUSIVE MODE')
        cur.execute('SELECT * FROM importacao_servidor_preview WHERE token=%s FOR UPDATE', (token,))
        entry = cur.fetchone()
        if not entry:
            raise HTTPException(404, 'Prévia não encontrada.')
        if entry['resultado'] is not None:
            return entry['resultado']
        if entry['expira_em'] <= datetime.now(timezone.utc):
            raise HTTPException(410, 'A prévia expirou. Envie a planilha novamente.')
        result = dict(novos=0,atualizados=0,ignorados=0,detalhes=[])
        for row in entry['registros']:
            action, reason = 'ignorado', row['motivo']
            if row['valido']:
                value = row['dados']
                action, reason, valid = classificar(cur, value)
                if valid and action in ('novo','atualizado'):
                    cur.execute('''INSERT INTO servidor(nome,matricula,cpf,email,carga_horaria,acumula_cargo)
                        VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(matricula) DO UPDATE SET nome=EXCLUDED.nome,
                        cpf=EXCLUDED.cpf,email=EXCLUDED.email,carga_horaria=EXCLUDED.carga_horaria,acumula_cargo=EXCLUDED.acumula_cargo''',
                        tuple(value[k] for k in CAMPOS))
            result[{'novo':'novos','atualizado':'atualizados','ignorado':'ignorados'}[action]] += 1
            result['detalhes'].append(dict(linha=row['linha'],acao=action,motivo=reason))
        cur.execute('UPDATE importacao_servidor_preview SET confirmado_em=clock_timestamp(),resultado=%s WHERE token=%s', (Jsonb(result), token))
    return result
