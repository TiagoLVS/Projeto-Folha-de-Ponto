'use strict';
const {packager}=require('@electron/packager');
const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const [folder]=await packager({dir:path.join(root,'staging','app'),out:path.join(root,'release'),name:'PontoDocente',platform:'win32',arch:'x64',electronVersion:'45.1.0',overwrite:true,asar:true,prune:false,
  extraResource:[path.join(root,'staging','runtime'),path.join(root,'staging','server'),path.join(root,'staging','frontend')],
  win32metadata:{CompanyName:'UnDF',FileDescription:'Ponto Docente · UnDF',ProductName:'Ponto Docente'}});
 fs.copyFileSync(path.join(root,'LEIA-ME.txt'),path.join(folder,'LEIA-ME.txt'));
 fs.copyFileSync(path.join(root,'../README.md'),path.join(folder,'README.md'));
 fs.mkdirSync(path.join(folder,'docs'),{recursive:true});
 fs.copyFileSync(path.join(root,'../docs/WINDOWS-EMPACOTAMENTO.md'),path.join(folder,'docs/WINDOWS-EMPACOTAMENTO.md'));
 console.log('Pasta Windows preparada: '+folder);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
