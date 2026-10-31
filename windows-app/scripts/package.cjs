'use strict';
const {packager}=require('@electron/packager');
const fs=require('node:fs');const path=require('node:path');const yazl=require('yazl');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const [folder]=await packager({dir:path.join(root,'staging','app'),out:path.join(root,'release'),name:'PontoDocente',platform:'win32',arch:'x64',electronVersion:'45.1.0',overwrite:true,asar:true,prune:false,
  extraResource:[path.join(root,'staging','runtime'),path.join(root,'staging','server'),path.join(root,'staging','frontend')],
  win32metadata:{CompanyName:'UnDF',FileDescription:'Ponto Docente · UnDF',ProductName:'Ponto Docente'}});
 fs.copyFileSync(path.join(root,'LEIA-ME.txt'),path.join(folder,'LEIA-ME.txt'));
 fs.copyFileSync(path.join(root,'../README.md'),path.join(folder,'README.md'));
 fs.mkdirSync(path.join(folder,'docs'),{recursive:true});
 fs.copyFileSync(path.join(root,'../docs/WINDOWS-EMPACOTAMENTO.md'),path.join(folder,'docs/WINDOWS-EMPACOTAMENTO.md'));
 const output=path.join(root,'release','PontoDocente-Windows-Independente-x64.zip');
 const zip=new yazl.ZipFile();
 function add(current,relative){for(const entry of fs.readdirSync(current,{withFileTypes:true})){const full=path.join(current,entry.name);const name=path.posix.join(relative,entry.name);if(entry.isDirectory())add(full,name);else if(entry.isFile())zip.addFile(full,name);}}
 add(folder,'PontoDocente');zip.end();await new Promise((resolve,reject)=>{const stream=fs.createWriteStream(output);zip.outputStream.pipe(stream);stream.on('close',resolve);stream.on('error',reject);zip.outputStream.on('error',reject);});
 console.log(output);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
