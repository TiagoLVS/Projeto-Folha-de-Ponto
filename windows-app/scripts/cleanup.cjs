'use strict';
const fs=require('node:fs');const path=require('node:path');
const RETRIES=10,RETRY_DELAY=250;
function remainingFiles(root,limit=60){
 const result=[];
 function visit(folder){
  let entries;try{entries=fs.readdirSync(folder,{withFileTypes:true});}catch(error){result.push(path.relative(root,folder)+': '+error.message);return;}
  for(const entry of entries){if(result.length>=limit)return;const file=path.join(folder,entry.name);result.push(path.relative(root,file));if(entry.isDirectory()&&!entry.isSymbolicLink())visit(file);}
 }
 if(fs.existsSync(root))visit(root);return result;
}
async function cleanup(root,{processes=()=>[],remove=fs.promises.rm}={}){
 try{
  const active=processes().filter(item=>item.active||item.streamsClosed===false);
  if(active.length)throw new Error('Processos/streams ainda ativos; remoção recusada: '+JSON.stringify(active));
  // Node aplica até 10 retries lineares somente a erros transitórios reconhecidos,
  // incluindo ENOTEMPTY/EPERM/EBUSY. Outros erros falham imediatamente.
  await remove(root,{recursive:true,force:true,maxRetries:RETRIES,retryDelay:RETRY_DELAY});
 }catch(error){
  let status;try{status=processes();}catch(diagnostic){status=[{diagnosticError:diagnostic.message}];}
  throw new Error('Falha definitiva de cleanup em '+root+'; limite: '+(RETRIES+1)+' tentativas (1 inicial + '+RETRIES+' retries; intervalo base '+RETRY_DELAY+' ms). '+
   'Processos: '+JSON.stringify(status)+'. Restantes: '+JSON.stringify(remainingFiles(root))+'. Erro original: '+error.message,{cause:error});
 }
}
module.exports={cleanup,remainingFiles};
