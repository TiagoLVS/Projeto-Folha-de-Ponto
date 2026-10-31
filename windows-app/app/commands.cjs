'use strict';
const fs=require('node:fs');const path=require('node:path');const {spawn}=require('node:child_process');
const {track,terminate}=require('./lifecycle.cjs');
// Comandos concluem em exit. Descendentes legítimos (postgres) podem manter
// handles herdados. Arquivos de saída evitam pipes Node presos nesses handles.
function runCommand(command,args,{cwd,env,outputFile,activeCommands=new Set(),timeout=120000,label=path.basename(command)}={}){
 const fd=fs.openSync(outputFile,'w');let child;
 try{child=spawn(command,args,{cwd,env,windowsHide:true,stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}
 const record=track(child,label);record.kind='command';record.exited=false;activeCommands.add(record);
 return new Promise((resolve,reject)=>{
  let timedOut=false;
  const timer=setTimeout(async()=>{
   timedOut=true;
   const error=new Error('Comando '+label+' excedeu o timeout de '+timeout+' ms. Log: '+outputFile);
   try{await terminate(record);reject(error);}catch(shutdown){reject(new AggregateError([error,shutdown],'Timeout e falha ao encerrar comando '+label,{cause:error}));}
  },timeout);
  child.once('error',cause=>{clearTimeout(timer);activeCommands.delete(record);reject(new Error('Não foi possível executar '+label+'. Log: '+outputFile,{cause}));});
  child.once('exit',(code,signal)=>{
   record.exited=true;activeCommands.delete(record);clearTimeout(timer);
   if(timedOut)return;
   if(code!==0){reject(new Error('Comando '+label+' falhou (código '+code+', sinal '+signal+'). Log: '+outputFile));return;}
   try{resolve(fs.readFileSync(outputFile,'utf8'));}catch(error){reject(error);}
  });
 });
}
module.exports={runCommand};
