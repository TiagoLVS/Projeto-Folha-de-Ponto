"""Entrada do runtime Windows: operações somente no banco privado do aplicativo."""
import argparse
import os
from pathlib import Path
import sys


def verificar_postgres():
    """Confirma TCP, autenticação e consulta no postmaster iniciado pelo launcher."""
    import psycopg
    with psycopg.connect(host=os.environ['DB_HOST'], port=os.environ['DB_PORT'],
                         dbname='postgres', user=os.environ['DB_USER'],
                         password=os.environ['DB_PASSWORD'], connect_timeout=5,
                         options='-c statement_timeout=5000') as conn:
        if conn.execute('SELECT 1').fetchone() != (1,):
            raise RuntimeError('PostgreSQL não confirmou SELECT 1.')
    print('PostgreSQL TCP / autenticação / SELECT 1 OK', flush=True)


def preparar_banco():
    """Cria banco privado e aplica migrações versionadas após backup confiável."""
    import datetime
    import subprocess
    import psycopg
    from backend.startup import MIGRATIONS, ROOT

    config = dict(host=os.environ['DB_HOST'], port=os.environ['DB_PORT'],
                  dbname='postgres', user=os.environ['DB_USER'], password=os.environ['DB_PASSWORD'],
                  connect_timeout=10)
    with psycopg.connect(**config, autocommit=True) as conn:
        if not conn.execute("SELECT 1 FROM pg_database WHERE datname='ponto_docente'").fetchone():
            conn.execute('CREATE DATABASE ponto_docente')
    config['dbname'] = 'ponto_docente'
    with psycopg.connect(**config, autocommit=True) as conn:
        fresh = conn.execute("SELECT to_regclass('servidor')").fetchone()[0] is None
        if fresh:
            conn.execute((ROOT / 'database/folha_pontos.sql').read_text(encoding='utf-8'))
        if conn.execute("SELECT to_regclass('schema_migration')").fetchone()[0] is None:
            raise RuntimeError('Banco existente sem controle de versões. Faça backup e solicite revisão antes de atualizar.')
        versions = {row[0] for row in conn.execute('SELECT versao FROM schema_migration')}
        pending = [(version, name) for version, name in MIGRATIONS if version not in versions]
        if not pending:
            print('Banco de dados atualizado.', flush=True)
            return
        if not fresh:
            # Nunca migra um banco existente sem dump íntegro.
            backup = Path(os.environ['PONTO_DATA_DIR']).parent / 'backups'
            backup.mkdir(parents=True, exist_ok=True)
            filename = backup / (datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.dump')
            env = {**os.environ, 'PGPASSWORD': config['password']}
            try:
                subprocess.run([os.environ['PONTO_PG_DUMP'], '-h', config['host'], '-p', config['port'],
                                '-U', config['user'], '-d', 'ponto_docente', '-Fc', '-f', str(filename)],
                               env=env, check=True, timeout=180)
                if not filename.is_file() or filename.stat().st_size == 0:
                    raise RuntimeError('Backup vazio: migrações canceladas.')
                # pg_dump com código zero e arquivo não vazio não garantem que o
                # archive custom possa ser lido. Valide sua tabela de conteúdo.
                subprocess.run([os.environ['PONTO_PG_RESTORE'], '--list', str(filename)],
                               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30)
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, RuntimeError):
                filename.unlink(missing_ok=True)
                raise RuntimeError('O backup obrigatório falhou. O banco não foi atualizado.') from None
            print('Backup pré-migração salvo em: ' + str(filename), flush=True)
        for version, name in pending:
            # Uma instrução SQL de migração por transação; interrupção não grava versão falsa.
            try:
                with conn.transaction():
                    conn.execute((ROOT / 'database/migrations' / name).read_text(encoding='utf-8'))
            except psycopg.Error as exc:
                raise RuntimeError(f'Falha na migração {version}. Banco preservado; confira o backup.') from exc
            print('Migração aplicada: ' + version, flush=True)


def certificado(folder,names):
    import datetime,ipaddress
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes,serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    target=Path(folder);target.mkdir(parents=True,exist_ok=True)
    if (target/'cert.pem').exists() and (target/'key.pem').exists():return
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    subject=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Ponto Docente UnDF')])
    alternatives=[]
    for value in names:
        try:alternatives.append(x509.IPAddress(ipaddress.ip_address(value)))
        except ValueError:alternatives.append(x509.DNSName(value))
    now=datetime.datetime.now(datetime.timezone.utc)
    cert=(x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=5))
        .not_valid_after(now+datetime.timedelta(days=3650)).add_extension(x509.SubjectAlternativeName(alternatives),critical=False)
        .sign(key,hashes.SHA256()))
    (target/'key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    (target/'cert.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['postgres-check','database','certificate','serve'])
    parser.add_argument('arguments',nargs='*');args=parser.parse_args()
    if args.action=='postgres-check':verificar_postgres()
    elif args.action=='database':preparar_banco()
    elif args.action=='certificate':certificado(args.arguments[0],args.arguments[1:])
    else:
        import uvicorn
        from backend.api import app
        from backend.desktop import DesktopFrontend
        application=DesktopFrontend(app,os.environ['PONTO_STATIC_FRONTEND'])
        uvicorn.run(application,host='127.0.0.1',port=int(os.environ['BACKEND_PORT']),log_level='warning',http='h11')
