"""Diagnóstico de inicialização; SQL somente com --migrar explícito."""
import argparse
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = [('002_calendario', '002_atualizacao_calendario.sql'),
              ('003_integracao', '003_integracao_sistema.sql'),
              ('004_refinamentos', '004_refinamentos.sql'),
              ('005_envio_modelos', '005_envio_modelos.sql'),
              ('006_dados_funcionais', '006_dados_funcionais_servidor.sql'),
              ('007_conta_email', '007_conta_email.sql')]


def verificar_portas():
    ports = [int(os.getenv('BACKEND_PORT', '8000')), int(os.getenv('FRONTEND_PORT', '5173'))]
    if any(not 1 <= port <= 65535 for port in ports) or ports[0] == ports[1]:
        raise ValueError('BACKEND_PORT e FRONTEND_PORT devem ser portas distintas entre 1 e 65535.')
    for label, host, port in [('Backend', '127.0.0.1', ports[0]), ('Frontend', '0.0.0.0', ports[1])]:
        with socket.socket() as sock:
            # Next/uvicorn reutilizam portas após encerrar conexões. TIME_WAIT não
            # significa que há um servidor ouvindo; um listener ativo ainda impede bind.
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host, port))
            except OSError as error:
                raise ValueError(f'{label}: porta {port} ocupada ou indisponível. Encerre o serviço que a utiliza ou configure {label.upper()}_PORT com outra porta.') from error


def verificar_banco(migrar=False):
    import psycopg
    from dotenv import load_dotenv
    load_dotenv(ROOT / '.env')
    if not os.getenv('DB_NAME') or not os.getenv('DB_USER'):
        raise ValueError('Configure DB_NAME e DB_USER no .env da raiz, conforme .env.example.')
    try:
        conn = psycopg.connect(host=os.getenv('DB_HOST', 'localhost'), port=os.getenv('DB_PORT', '5432'),
                               dbname=os.getenv('DB_NAME'), user=os.getenv('DB_USER'), password=os.getenv('DB_PASSWORD'),
                               connect_timeout=5, autocommit=True)
    except psycopg.OperationalError as error:
        raise ValueError('Não foi possível conectar ao PostgreSQL. Confira serviço, DB_HOST, DB_PORT, DB_NAME, DB_USER e DB_PASSWORD no .env. Nenhuma migração foi aplicada.') from error
    with conn:
        if conn.execute("SELECT to_regclass('servidor')").fetchone()[0] is None:
            raise ValueError('Banco sem tabelas do projeto. Para uma instalação nova, aplique database/folha_pontos.sql em um banco vazio. O inicializador não recria o banco.')
        marker = conn.execute("SELECT to_regclass('schema_migration')").fetchone()[0]
        versions = {row[0] for row in conn.execute('SELECT versao FROM schema_migration')} if marker else set()
        pending = [(version, name) for version, name in MIGRATIONS if version not in versions]
        if not pending:
            print('PostgreSQL conectado. Migrações atualizadas até 007.')
            return 0
        print('Migrações pendentes: ' + ', '.join(name for _, name in pending), file=sys.stderr)
        if not migrar:
            print('Nenhuma alteração foi feita. Após backup, execute: bash iniciar.sh --migrar', file=sys.stderr)
            return 3
        print('Aplicando apenas migrações pendentes, com autorização de --migrar.')
        if conn.execute("SELECT to_regclass('idempotency_request')").fetchone()[0] is None:
            conn.execute((ROOT / 'database/migrations/001_idempotency_request.sql').read_text())
        for _, name in pending:
            try:
                conn.execute((ROOT / 'database/migrations' / name).read_text())
            except psycopg.Error as error:
                # O erro primário da migração identifica registros incompatíveis sem expor credenciais.
                raise ValueError(f'Migração {name} não aplicada: {error.diag.message_primary}. Confira docs/ALTERACOES-BANCO.md.') from error
            print('Aplicada: ' + name)
    return 0


def verificar_ocr():
    executable = os.getenv('TESSERACT_CMD') or 'tesseract'
    if not shutil.which(executable):
        print('AVISO: Tesseract não encontrado. Instale-o com o idioma português para ler digitalizações.', file=sys.stderr)
        return
    try:
        result = subprocess.run([executable, '--list-langs'], capture_output=True, text=True, timeout=5)
        needed = set(os.getenv('OCR_LANG', 'por').split('+'))
        if result.returncode or not needed.issubset(set(result.stdout.splitlines())):
            print('AVISO: confira os idiomas de OCR_LANG no Tesseract. PDFs digitais continuam disponíveis.', file=sys.stderr)
    except (OSError, subprocess.TimeoutExpired):
        print('AVISO: não foi possível verificar Tesseract; confira TESSERACT_CMD.', file=sys.stderr)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--migrar', action='store_true')
    parser.add_argument('--portas', action='store_true')
    args = parser.parse_args(argv)
    try:
        if args.portas:
            verificar_portas()
            return 0
        status = verificar_banco(args.migrar)
        if status == 0:
            verificar_ocr()
        return status
    except (ValueError, ImportError) as error:
        print(f'ERRO: {error}', file=sys.stderr)
        return 1
    except Exception as error:
        print(f'ERRO ao verificar banco ({type(error).__name__}). Confira .env, permissões e schema. Nenhuma credencial foi exibida.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
