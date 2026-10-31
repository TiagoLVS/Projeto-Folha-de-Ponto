const {spawnSync}=require('node:child_process');
const path=require('node:path');const fs=require('node:fs');
const local=path.resolve(__dirname,'../../.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const python=process.env.PYTHON||(fs.existsSync(local)?local:(process.platform==='win32'?'python':'python3'));
const result=spawnSync(python,[path.join(__dirname,'build.py'),...process.argv.slice(2)],{stdio:'inherit'});
process.exit(result.status??1);
