"""Conta SMTP por instalação cliente; somente conteúdo cifrado chega ao banco."""
import hashlib
import json
import os
from pathlib import Path
import tempfile

from cryptography.fernet import Fernet, InvalidToken
from backend.database import repository

ROOT = Path(__file__).resolve().parents[2]


def cifra():
    key = os.getenv('EMAIL_CREDENTIALS_KEY')
    if not key:
        path = Path(os.getenv('EMAIL_CREDENTIALS_KEY_FILE', str(ROOT / '.secrets/email.key')))
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not path.exists():
            # Publicar apenas a chave completa, sem sobrescrever a de outro worker.
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(Fernet.generate_key())
                handle.flush()
                os.fsync(handle.fileno())
            try:
                try:os.link(temporary, path)
                except FileExistsError:pass
            finally:temporary.unlink()
        key = path.read_bytes().strip()
    try:return Fernet(key)
    except (ValueError, TypeError):
        raise RuntimeError('A chave de proteção das contas de e-mail precisa ser conferida pelo responsável.') from None


def identificador(cliente):
    return hashlib.sha256(cliente.encode()).hexdigest()


def guardar(cliente, dados):
    identity = identificador(cliente)
    encrypted = cifra().encrypt(json.dumps({'cliente': identity, **dados}).encode()).decode()
    with repository.conectar() as conn:
        conn.execute('''INSERT INTO conta_email_cliente(cliente_hash, credenciais_cifradas)
            VALUES (%s,%s) ON CONFLICT(cliente_hash) DO UPDATE SET
            credenciais_cifradas=EXCLUDED.credenciais_cifradas, atualizado_em=CURRENT_TIMESTAMP''', (identity, encrypted))


def obter(cliente):
    identity = identificador(cliente)
    with repository.conectar() as conn:
        row = conn.execute('SELECT credenciais_cifradas FROM conta_email_cliente WHERE cliente_hash=%s', (identity,)).fetchone()
    if not row:return None
    try:
        data = json.loads(cifra().decrypt(row[0].encode()))
        if data.pop('cliente') != identity:raise ValueError
        return data
    except (InvalidToken, ValueError, KeyError, TypeError):
        # Uma chave perdida não deve bloquear cadastros nem vazar detalhes criptográficos.
        return None


def desconectar(cliente):
    with repository.conectar() as conn:
        conn.execute('DELETE FROM conta_email_cliente WHERE cliente_hash=%s', (identificador(cliente),))
