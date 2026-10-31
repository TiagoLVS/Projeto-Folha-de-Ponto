'use strict';
const {spawn}=require('node:child_process');const path=require('node:path');
const {setTimeout: delay}=require('node:timers/promises');
function alive(pid){
 if(!Number.isSafeInteger(pid)||pid<=0)return false;
 try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}
}
function within(promise,ms,label){
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Tempo esgotado: '+label)),ms);})]).finally(()=>clearTimeout(timer));
}
function track(child,command){
 const record={child,command,pid:child.pid,closed:false};
 record.completion=new Promise(resolve=>child.once('close',(code,signal)=>{record.closed=true;resolve({code,signal});}));
 // 'close', ao contrário de 'exit', só ocorre após fechar stdout/stderr.
 return record;
}
async function windowsTree(record){
 // No Windows, SIGTERM do Node termina somente o pai. /T inclui OCR/auxiliares
 // iniciados pelo Python, sem afetar processos de outros aplicativos.
 const command=path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe');
 const killer=spawn(command,['/PID',String(record.pid),'/T','/F'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='';killer.stdout.on('data',data=>output+=data);killer.stderr.on('data',data=>output+=data);
 const done=new Promise((resolve,reject)=>{killer.once('error',reject);killer.once('close',code=>{if(code===0)resolve();else reject(new Error('Falha ao encerrar árvore PID '+record.pid+': '+output));});});
 try{await within(done,10000,'encerrar árvore de processos Windows PID '+record.pid);}
 catch(error){if(killer.exitCode===null){killer.kill();await within(new Promise(resolve=>killer.once('close',resolve)),5000,'fechar taskkill');}throw error;}
}
async function terminate(record,{graceMs=15000,forceMs=5000}={}){
 if(record.closed)return;
 if(record.child.exitCode===null&&record.child.signalCode===null){
  if(process.platform==='win32')await windowsTree(record);else record.child.kill('SIGTERM');
 }
 try{await within(record.completion,graceMs,'encerrar '+record.command+' PID '+record.pid);}
 catch(error){
  if(record.closed)throw error;
  record.child.kill('SIGKILL');
  await within(record.completion,forceMs,'encerrar à força '+record.command+' PID '+record.pid);
 }
 if(alive(record.pid))throw new Error('Processo ainda ativo: '+record.command+' PID '+record.pid);
}
async function waitPidExit(pid,timeout=10000){
 const end=Date.now()+timeout;
 while(alive(pid)){
  if(Date.now()>=end)throw new Error('Processo ainda ativo após encerramento: PID '+pid);
  // O postmaster é iniciado por pg_ctl, não é um ChildProcess deste Node.
  await delay(50);
 }
}
async function closeLog(stream){
 if(stream.closed)return;
 const done=new Promise((resolve,reject)=>{stream.once('close',resolve);stream.once('error',reject);});
 stream.end();await within(done,10000,'fechar arquivo de log');
}
module.exports={alive,within,track,terminate,waitPidExit,closeLog};
