"""Autenticação do desktop: contas e sessões centralizadas no PostgreSQL principal."""
import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.requests import Request as StarletteRequest

from backend.database.connection import conectar

COOKIE = 'ponto_docente_sessao'
DURATION_SECONDS = 12 * 60 * 60
ROUNDS = 600_000
USERNAME_PATTERN = re.compile(r'^[a-z0-9._-]{3,50}$')
router = APIRouter(prefix='/auth', tags=['Autenticação'])


def enabled():
    return os.getenv('PONTO_AUTH_REQUIRED', '').strip().lower() == 'true'


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, ROUNDS)
    return f'pbkdf2_sha256${ROUNDS}${salt.hex()}${derived.hex()}'


def password_matches(password: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt_hex, digest_hex = stored.split('$')
        if algorithm != 'pbkdf2_sha256' or int(rounds) != ROUNDS:
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt_hex), ROUNDS)
        return hmac.compare_digest(actual, bytes.fromhex(digest_hex))
    except (ValueError, TypeError):
        return False


# Mantém o custo de verificação de nomes inexistentes próximo ao de contas existentes.
DUMMY_PASSWORD_HASH = password_hash('senha-ficticia-para-tempo-de-login')


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def current_user(token: str | None):
    if not token or len(token) > 256:
        return None
    with conectar() as conn:
        row = conn.execute('''
            SELECT u.id_usuario, u.usuario, u.administrador
            FROM sessao_sistema s JOIN usuario_sistema u USING (id_usuario)
            WHERE s.token_hash = %s AND s.expira_em > now()
        ''', (token_digest(token),)).fetchone()
    return dict(id=row[0], username=row[1], admin=row[2]) if row else None


def require_same_origin(request: Request):
    """Rejeita chamadas de páginas externas às rotas de autenticação."""
    origin = request.headers.get('origin')
    if not origin:
        return
    from urllib.parse import urlsplit
    parsed = urlsplit(origin)
    if parsed.scheme != 'https' or parsed.netloc != request.headers.get('host', ''):
        raise HTTPException(403, 'Origem não autorizada.')


def local_gateway(request: Request) -> bool:
    # Este header é definido EXCLUSIVAMENTE pelo proxy Node na porta TLS.
    # O proxy remove qualquer valor enviado pelo cliente antes de inseri-lo.
    return request.headers.get('x-ponto-local') == '1' and os.getenv('PONTO_DESKTOP_MODE') == '1'


def normalize_username(name: str) -> str:
    username = name.strip().lower()
    if not USERNAME_PATTERN.fullmatch(username):
        raise HTTPException(422, 'Usuário deve conter 3 a 50 letras, números, pontos, _ ou -.')
    return username


def validate_password(password: str):
    if not 12 <= len(password) <= 256:
        raise HTTPException(422, 'Escolha uma senha de 12 a 256 caracteres.')


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


class UserInput(Credentials):
    admin: bool = False


@router.get('/status')
def status(request: Request):
    if not enabled():
        return {'required': False, 'initialized': True, 'authenticated': True, 'local': True}
    with conectar() as conn:
        initialized = bool(conn.execute('SELECT EXISTS (SELECT 1 FROM usuario_sistema)').fetchone()[0])
    user = current_user(request.cookies.get(COOKIE))
    return {'required': True, 'initialized': initialized, 'authenticated': user is not None,
            'username': user['username'] if user else None, 'admin': user['admin'] if user else False,
            'local': local_gateway(request)}


@router.post('/bootstrap', status_code=201)
def bootstrap(data: Credentials, request: Request):
    require_same_origin(request)
    if not enabled() or not local_gateway(request):
        raise HTTPException(403, 'O primeiro usuário deve ser criado no computador principal.')
    username = normalize_username(data.username)
    validate_password(data.password)
    password = password_hash(data.password)
    with conectar() as conn:
        conn.execute('SELECT pg_advisory_xact_lock(84008421)')
        if conn.execute('SELECT EXISTS (SELECT 1 FROM usuario_sistema)').fetchone()[0]:
            raise HTTPException(409, 'A conta inicial já foi criada.')
        conn.execute('INSERT INTO usuario_sistema(usuario, senha_hash, administrador) VALUES (%s,%s,TRUE)',
                     (username, password))
    return {'message': 'Administrador criado. Entre com seu usuário e senha.'}


def authenticate(username: str, password: str):
    with conectar() as conn:
        row = conn.execute('''SELECT id_usuario, senha_hash, administrador, tentativas_falhas,
                              bloqueado_ate FROM usuario_sistema WHERE usuario = %s FOR UPDATE''',
                           (username,)).fetchone()
        if row is None:
            # Não devolva sinal específico para nomes inexistentes nem faça um KDF extra.
            password_matches(password, DUMMY_PASSWORD_HASH)
            return None
        user_id, stored, admin, failures, locked_until = row
        if locked_until and locked_until > datetime.now(timezone.utc):
            raise HTTPException(429, 'Conta temporariamente bloqueada. Tente novamente mais tarde.')
        if not password_matches(password, stored):
            failures += 1
            if failures >= 5:
                conn.execute("UPDATE usuario_sistema SET tentativas_falhas=0, bloqueado_ate=now()+interval '15 minutes' WHERE id_usuario=%s", (user_id,))
            else:
                conn.execute('UPDATE usuario_sistema SET tentativas_falhas=%s, bloqueado_ate=NULL WHERE id_usuario=%s',
                             (failures, user_id))
            return None
        conn.execute('UPDATE usuario_sistema SET tentativas_falhas=0,bloqueado_ate=NULL,ultimo_login=now() WHERE id_usuario=%s', (user_id,))
        token = secrets.token_urlsafe(48)
        conn.execute('DELETE FROM sessao_sistema WHERE expira_em <= now()')
        conn.execute("INSERT INTO sessao_sistema(token_hash,id_usuario,expira_em) VALUES (%s,%s,now()+interval '12 hours')",
                     (token_digest(token), user_id))
    return token, {'username': username, 'admin': admin}


@router.post('/login')
def login(data: Credentials, request: Request):
    require_same_origin(request)
    if not enabled():
        raise HTTPException(404, 'Autenticação indisponível neste modo.')
    username = normalize_username(data.username)
    authenticated = authenticate(username, data.password)
    if not authenticated:
        raise HTTPException(401, 'Usuário ou senha inválidos.')
    token, user = authenticated
    response = JSONResponse(user)
    response.set_cookie(COOKIE, token, max_age=DURATION_SECONDS, httponly=True,
                        secure=True, samesite='strict', path='/')
    return response


@router.post('/logout')
def logout(request: Request):
    require_same_origin(request)
    token = request.cookies.get(COOKIE)
    if token:
        with conectar() as conn:
            conn.execute('DELETE FROM sessao_sistema WHERE token_hash=%s', (token_digest(token),))
    response = JSONResponse({'message': 'Sessão encerrada.'})
    response.delete_cookie(COOKIE, path='/', secure=True, httponly=True, samesite='strict')
    return response


@router.post('/users', status_code=201)
def create_user(data: UserInput, request: Request):
    require_same_origin(request)
    if not enabled():
        raise HTTPException(404, 'Autenticação indisponível neste modo.')
    actor = current_user(request.cookies.get(COOKIE))
    if not actor or not actor['admin']:
        raise HTTPException(403, 'Somente administradores podem criar usuários.')
    username = normalize_username(data.username)
    validate_password(data.password)
    from psycopg.errors import UniqueViolation
    try:
        with conectar() as conn:
            conn.execute('INSERT INTO usuario_sistema(usuario,senha_hash,administrador) VALUES (%s,%s,%s)',
                         (username, password_hash(data.password), data.admin))
    except UniqueViolation:
        raise HTTPException(409, 'Nome de usuário já existe.') from None
    return {'username': username, 'admin': data.admin}


class AuthMiddleware:
    """Bloqueia TODAS as rotas de dados, inclusive chamadas diretas à API FastAPI."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not enabled():
            return await self.app(scope, receive, send)
        path, method = scope['path'], scope['method']
        if method == 'OPTIONS' or path.startswith('/auth/') or path in {'/', '/_ponto/health'}:
            return await self.app(scope, receive, send)
        request = StarletteRequest(scope)
        user = await run_in_threadpool(current_user, request.cookies.get(COOKIE))
        if user is None:
            return await JSONResponse({'detail': 'Faça login para acessar o sistema.'}, status_code=401)(scope, receive, send)
        origin = request.headers.get('origin')
        if method not in {'GET', 'HEAD'} and origin:
            from urllib.parse import urlsplit
            try:
                host = urlsplit(origin).netloc
                expected = request.headers.get('host', '')
                if host != expected or urlsplit(origin).scheme != 'https':
                    raise ValueError('Origem diferente')
            except ValueError:
                return await JSONResponse({'detail': 'Origem não autorizada.'}, status_code=403)(scope, receive, send)
        scope['ponto_user'] = user
        return await self.app(scope, receive, send)
