from uuid import UUID
from fastapi import HTTPException
from psycopg.rows import dict_row
from backend.database import repository


def cliente(value):
    try:
        return UUID(value) if value else None
    except (ValueError,TypeError):
        raise HTTPException(422, 'X-Client-Id deve ser um UUID válido.')


def consultar(value):
    owner = cliente(value)
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute('''SELECT owner_token,expires_at,owner_token IS NOT NULL AND expires_at>clock_timestamp() AS ativo FROM sistema_lock WHERE id=1''')
        row = cur.fetchone()
    return dict(locked=bool(row['ativo'] and row['owner_token'] != owner), holder=bool(row['ativo'] and row['owner_token']==owner), expires_at=row['expires_at'])


def alterar(value, action):
    owner = cliente(value)
    if owner is None:
        raise HTTPException(422, 'X-Client-Id obrigatório.')
    with repository.conectar() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute('SELECT *,expires_at>clock_timestamp() AS ativo FROM sistema_lock WHERE id=1 FOR UPDATE')
        row = cur.fetchone()
        if row['ativo'] and row['owner_token'] != owner:
            raise HTTPException(423, 'Sistema em uso por outro usuário.')
        if action=='renovar' and (not row['ativo'] or row['owner_token'] != owner):
            raise HTTPException(409, 'O lease expirou. Adquira novamente.')
        if action=='liberar':
            if row['owner_token'] != owner:
                return
            cur.execute('UPDATE sistema_lock SET owner_token=NULL,acquired_at=NULL,expires_at=NULL WHERE id=1')
        else:
            cur.execute("""UPDATE sistema_lock SET owner_token=%s,acquired_at=CASE WHEN owner_token=%s THEN acquired_at ELSE clock_timestamp() END,
                expires_at=clock_timestamp()+interval '45 seconds' WHERE id=1""", (owner, owner))
    return consultar(value)


def iniciar_mutacao(value):
    """Mantém a linha bloqueada até concluir a mutação; lease não muda de dono no meio."""
    owner = cliente(value)
    conn = repository.conectar()
    try:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute('SELECT *,expires_at>clock_timestamp() AS ativo FROM sistema_lock WHERE id=1 FOR UPDATE')
            row = cur.fetchone()
            if row['ativo'] and row['owner_token'] != owner:
                raise HTTPException(423, 'Sistema em uso por outro usuário.')
            if row['ativo']:
                cur.execute("UPDATE sistema_lock SET expires_at=clock_timestamp()+interval '45 seconds' WHERE id=1")
        return conn
    except BaseException:
        conn.rollback(); conn.close(); raise


def finalizar_mutacao(conn):
    try:
        conn.commit()
    finally:
        conn.close()
