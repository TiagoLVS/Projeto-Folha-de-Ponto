'use strict';
const fs=require('node:fs');const path=require('node:path');
function validateFrontend(folder){
 const root=path.resolve(folder);const index=path.join(root,'index.html');
 if(!fs.existsSync(index))throw new Error('index.html ausente no frontend estático. Execute build:desktop.');
 let bytes=0,files=0;
 function visit(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const full=path.join(directory,entry.name);
  if(entry.isSymbolicLink())throw new Error('Link inesperado no frontend estático: '+full);
  if(entry.name==='node_modules'||entry.name==='.next'||entry.name==='server.js'||entry.name.toLowerCase().startsWith('.env')||['.git','.secrets','email.key','banco.bin'].includes(entry.name))throw new Error('Arquivo de runtime ou privado no frontend estático: '+full);
  if(entry.isDirectory())visit(full);else{files++;bytes+=fs.statSync(full).size;}
 }}visit(root);
 const html=fs.readFileSync(index,'utf8');const references=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match=>match[1]);
 if(!references.some(file=>file.endsWith('.js')))throw new Error('Bundle JavaScript não referenciado pelo index.html.');
 for(const reference of references){
  if(/^(?:https?:)?\/\//.test(reference))throw new Error('Recurso externo obrigatório não permitido: '+reference);
  const file=path.resolve(root,reference.replace(/^\//,''));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))throw new Error('Asset do frontend ausente: '+reference);
 }
 console.log(`[frontend estático] ${files} arquivos · ${(bytes/1024/1024).toFixed(2)} MiB · sem Next/node_modules/CDN.`);
 return {files,bytes};
}
if(require.main===module){try{validateFrontend(process.argv[2]||path.resolve(__dirname,'../frontend-dist'));}catch(error){console.error('[validate-frontend] '+error.message);process.exitCode=1;}}
module.exports={validateFrontend};
