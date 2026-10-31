'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const {once}=require('node:events');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {track,terminate,alive,closeLog,waitPidExit}=require('../app/lifecycle.cjs');const {cleanup}=require('../scripts/cleanup.cjs');
function temp(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ponto-lifecycle-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:50}));return folder;}
test('encerramento espera close do processo, stdout/stderr e arquivo de log',async t=>{
 const folder=temp(t);const logs=fs.createWriteStream(path.join(folder,'servicos.log'));
 const child=spawn(process.execPath,['-e',"console.log('iniciado');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','pipe']});
 const record=track(child,'fixture');t.after(()=>{if(!record.closed)child.kill('SIGKILL');});
 child.stdout.pipe(logs,{end:false});child.stderr.pipe(logs,{end:false});await once(child.stdout,'data');
 assert.equal(alive(child.pid),true);await terminate(record);await closeLog(logs);
 assert.equal(record.closed,true);assert.equal(child.stdout.destroyed,true);assert.equal(child.stderr.destroyed,true);assert.equal(logs.closed,true);assert.equal(alive(child.pid),false);
 assert.match(fs.readFileSync(path.join(folder,'servicos.log'),'utf8'),/iniciado/);await cleanup(folder,{processes:()=>[{pid:child.pid,active:alive(child.pid),streamsClosed:record.closed}]});assert.equal(fs.existsSync(folder),false);
});
test('processo que ignora SIGTERM é encerrado com limite e confirmação', {skip:process.platform==='win32'},async t=>{
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('pronto');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','pipe']});
 const record=track(child,'fixture resistente');t.after(()=>{if(!record.closed)child.kill('SIGKILL');});await once(child.stdout,'data');
 await terminate(record,{graceMs:50,forceMs:2000});assert.equal(record.closed,true);assert.equal(alive(child.pid),false);
});
test('espera de PID falha quando o processo continua vivo',async()=>{await assert.rejects(waitPidExit(process.pid,0),/ainda ativo/);});
test('cleanup usa retry Windows e remove somente depois dos processos fecharem',async t=>{
 const folder=temp(t);let options;await cleanup(folder,{remove:async(root,config)=>{options=config;await fs.promises.rm(root,config);}});
 assert.deepEqual(options,{recursive:true,force:true,maxRetries:10,retryDelay:250});assert.equal(fs.existsSync(folder),false);
});
test('cleanup bloqueado falha com caminho, limite, PID, arquivos e erro original',async t=>{
 const folder=temp(t);fs.writeFileSync(path.join(folder,'bloqueado.log'),'fixture');const original=Object.assign(new Error('ENOTEMPTY: fixture'),{code:'ENOTEMPTY'});
 await assert.rejects(cleanup(folder,{processes:()=>[{pid:123,active:false}],remove:async()=>{throw original;}}),error=>{
  assert.equal(error.cause,original);for(const text of [folder,'11 tentativas','123','bloqueado.log','ENOTEMPTY'])assert.ok(error.message.includes(text));return true;
 });
});
test('cleanup não apaga diretório nem transforma processo órfão em sucesso',async t=>{
 const folder=temp(t);let removed=false;await assert.rejects(cleanup(folder,{processes:()=>[{pid:process.pid,command:'python',active:true,streamsClosed:false}],remove:async()=>{removed=true;}}),/remoção recusada/);
 assert.equal(removed,false);assert.equal(fs.existsSync(folder),true);
});
test('Windows encerra também descendentes do processo de serviço', {skip:process.platform!=='win32'},async t=>{
 const source="const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000)";
 const child=spawn(process.execPath,['-e',source],{stdio:['ignore','pipe','pipe']});const record=track(child,'serviço com auxiliar');let descendant;
 t.after(()=>{if(!record.closed)child.kill('SIGKILL');if(descendant&&alive(descendant))process.kill(descendant,'SIGKILL');});
 descendant=Number((await once(child.stdout,'data'))[0].toString().trim());assert.ok(Number.isSafeInteger(descendant)&&descendant>0);assert.equal(alive(descendant),true);
 await terminate(record);await waitPidExit(descendant);assert.equal(alive(child.pid),false);assert.equal(alive(descendant),false);assert.equal(record.closed,true);
});
