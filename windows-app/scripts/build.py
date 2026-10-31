"""Monta o pacote Windows a partir de runtimes pré-compilados e fontes permitidas."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
ROOT=Path(__file__).resolve().parents[2]
APP=ROOT/'windows-app';CACHE=APP/'.cache';STAGE=APP/'staging'
URLS={
 'python.zip':'https://www.python.org/ftp/python/3.13.9/python-3.13.9-embed-amd64.zip',
 'postgres.zip':'https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip',
 'tesseract.exe':'https://github.com/UB-Mannheim/tesseract/releases/download/v5.4.0.20240606/tesseract-ocr-w64-setup-5.4.0.20240606.exe',
 'por.traineddata':'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/por.traineddata',
}

def run(args,cwd=ROOT,env=None):
 # No Windows, resolva também os launchers .cmd instalados pelo npm.
 command=shutil.which(args[0]) or args[0]
 subprocess.run([command,*args[1:]],cwd=cwd,check=True,env=env)
def download(name,url):
 path=CACHE/name
 if not path.exists():
  temporary=path.with_suffix('.download');urllib.request.urlretrieve(url,temporary);temporary.replace(path)
 digest=hashlib.sha256(path.read_bytes()).hexdigest()
 expected=json.loads((APP/'runtime-sha256.json').read_text()).get(name)
 if not expected or digest!=expected:raise RuntimeError('Checksum inválido ou ausente: '+name)
 return path

def extract(archive,target):
 with zipfile.ZipFile(archive) as z:
  for item in z.infolist():
   if not (target/item.filename).resolve().is_relative_to(target.resolve()):raise ValueError('Caminho inválido no arquivo compactado.')
  z.extractall(target)

def main():
 CACHE.mkdir(exist_ok=True)
 for name,url in URLS.items():download(name,url)
 if STAGE.exists():shutil.rmtree(STAGE)
 runtime=STAGE/'runtime';runtime.mkdir(parents=True)
 py=runtime/'python';extract(CACHE/'python.zip',py)
 wheels=CACHE/'wheels';wheels.mkdir(exist_ok=True)
 run([sys.executable,'-m','pip','download','--dest',str(wheels),'--platform','win_amd64','--python-version','3.13','--implementation','cp','--abi','cp313','--only-binary=:all:','-r',str(APP/'requirements.txt')])
 # Wheels têm ABI Windows; não executar nem importar no host de empacotamento.
 site=py/'Lib/site-packages';site.mkdir(parents=True)
 wheel_hashes={}
 for wheel in sorted(wheels.glob('*.whl')):
  extract(wheel,site);wheel_hashes[wheel.name]=hashlib.sha256(wheel.read_bytes()).hexdigest()
 (py/'python313._pth').write_text('python313.zip\n.\nLib/site-packages\n../../server\nimport site\n')
 with zipfile.ZipFile(CACHE/'postgres.zip') as z:
  for item in z.infolist():
   if item.filename.startswith(('pgsql/bin/','pgsql/lib/','pgsql/share/')) or item.filename=='pgsql/doc/src/sgml/html/legalnotice.html':
    if not (runtime/item.filename).resolve().is_relative_to(runtime.resolve()):raise ValueError('Arquivo PostgreSQL inválido.')
    z.extract(item,runtime)
 tesseract=runtime/'tesseract';tesseract.mkdir()
 seven=shutil.which('7z') or shutil.which('7za') or (r'C:\Program Files\7-Zip\7z.exe' if os.name=='nt' else '')
 if not seven:raise RuntimeError('Instale 7-Zip para extrair o OCR durante a montagem do pacote.')
 run([seven,'x','-y',f'-o{tesseract}',str(CACHE/'tesseract.exe')])
 for candidate in tesseract.rglob('$PLUGINSDIR'):shutil.rmtree(candidate)
 shutil.copy2(CACHE/'por.traineddata',tesseract/'tessdata/por.traineddata')
 if not (tesseract/'tesseract.exe').is_file():raise RuntimeError('Executável OCR não encontrado no pacote.')
 server=STAGE/'server';server.mkdir()
 shutil.copytree(ROOT/'backend',server/'backend',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
 shutil.copytree(ROOT/'database',server/'database')
 shutil.copy2(APP/'app/runtime.py',server/'runtime.py')
 shutil.copytree(APP/'app',STAGE/'app',ignore=shutil.ignore_patterns('runtime.py','__pycache__','*.pyc'))
 shutil.copy2(ROOT/'frontend/public/undf-logo.png',STAGE/'app/logo.png')
 # Recompila sempre: um frontend-dist antigo não pode entrar na entrega.
 run(['pnpm','build:desktop'],ROOT/'frontend')
 run(['node','scripts/validate-frontend.cjs',str(APP/'frontend-dist')],APP)
 shutil.copytree(APP/'frontend-dist',STAGE/'frontend')
 forbidden={'.env','.env.local','.env.production','.env.development','email.key','banco.bin'}
 for file in STAGE.rglob('*'):
  if file.is_file() and (file.name.lower().startswith('.env') or file.name.lower() in forbidden):raise RuntimeError('Arquivo privado detectado no pacote: '+file.name)
 (STAGE/'runtime/dependencias-python-sha256.json').write_text(json.dumps(wheel_hashes,indent=2))
 run(['node','scripts/validate-frontend.cjs',str(STAGE/'frontend')],APP)
 run(['node','scripts/package.cjs'],APP)
 if '--prepare-only' in sys.argv:
  print('Aplicativo preparado. Execute smoke tests e archive.cjs para gerar a entrega.')
  return
 if sys.platform != 'win32':
  raise RuntimeError('A pasta Windows foi preparada, mas os smoke tests precisam de Windows. Use windows-latest; o ZIP final não foi publicado.')
 executable=APP/'release/PontoDocente-win32-x64/PontoDocente.exe'
 run([str(executable),str(APP/'scripts/smoke.cjs')],APP,env={**os.environ,'ELECTRON_RUN_AS_NODE':'1'})
 run(['node','scripts/smoke-gui.cjs'],APP)
 run(['node','scripts/archive.cjs'],APP)
 print('Pacote gerado após validar serviços e janela Electron. Homologar o uso com a equipe antes de produção.')
if __name__=='__main__':
 try:
  main()
 except subprocess.CalledProcessError as error:
  print(f'ERRO de empacotamento: etapa {Path(str(error.cmd[0])).name} falhou (código {error.returncode}). Confira a mensagem da etapa acima. ZIP/SHA-256 não foram concluídos.',file=sys.stderr)
  raise SystemExit(1) from None
 except (OSError, RuntimeError, ValueError, shutil.Error) as error:
  message=str(error)
  if isinstance(error,shutil.Error):
   entries=error.args[0]
   if isinstance(entries,list) and entries:
    source,target,reason=entries[0]
    message=f'{source} -> {target}: {reason} ({len(entries)} falha(s) de cópia)'
  print(f'ERRO de empacotamento: {message}',file=sys.stderr)
  raise SystemExit(1) from None
