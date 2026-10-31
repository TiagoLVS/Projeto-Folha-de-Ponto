'use strict';
const fs=require('node:fs');const path=require('node:path');const {createHash}=require('node:crypto');const yazl=require('yazl');const {validateFrontend}=require('./validate-frontend.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..');const folder=path.join(root,'release/PontoDocente-win32-x64');validateFrontend(path.join(folder,'resources/frontend'));
 for(const name of ['PontoDocente.exe','resources/app.asar','resources/server/runtime.py','resources/server/backend/desktop.py','resources/runtime/python/python.exe','resources/runtime/pgsql/bin/postgres.exe','resources/runtime/tesseract/tesseract.exe','resources/runtime/tesseract/tessdata/por.traineddata']){if(!fs.statSync(path.join(folder,name)).isFile())throw new Error('Componente obrigatório ausente: '+name);}
 const output=path.join(root,'release/PontoDocente-Windows-Independente-x64.zip');const temporary=output+'.tmp';const zip=new yazl.ZipFile();
 function add(directory,relative){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);const name=path.posix.join(relative,entry.name);if(entry.isSymbolicLink())throw new Error('Link inesperado no pacote: '+file);if(entry.isDirectory())add(file,name);else zip.addFile(file,name);}}
 add(folder,'PontoDocente');zip.end();await new Promise((resolve,reject)=>{const stream=fs.createWriteStream(temporary);zip.outputStream.pipe(stream);stream.on('close',resolve);stream.on('error',reject);zip.outputStream.on('error',reject);});
 fs.renameSync(temporary,output);const hash=createHash('sha256');for await(const chunk of fs.createReadStream(output))hash.update(chunk);fs.writeFileSync(output+'.sha256',hash.digest('hex')+'  '+path.basename(output)+'\n');console.log(output);
})().catch(error=>{console.error('Falha ao gerar ZIP/SHA-256: '+error.message);process.exitCode=1;});
