'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {EventEmitter}=require('node:events');
const {runCommand}=require('../app/commands.cjs');const {alive}=require('../app/lifecycle.cjs');
function fixture(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ponto-command-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:50}));return {outputFile:path.join(folder,'command.log'),activeCommands:new Set()};}
test('comando exit 0 resolve e deixa de ser monitorado como ativo',async t=>{
 const options=fixture(t);const output=await runCommand(process.execPath,['-e',"console.log('resultado')"],options);
 assert.match(output,/resultado/);assert.equal(options.activeCommands.size,0);
});
test('comando com exit diferente de zero rejeita com etapa e código',async t=>{
 const options={...fixture(t),label:'migração'};await assert.rejects(runCommand(process.execPath,['-e','process.exit(7)'],options),/migração.*código 7/);assert.equal(options.activeCommands.size,0);
});
test('comando realmente travado falha por timeout e encerra seu processo',async t=>{
 const options={...fixture(t),timeout:200,label:'fixture travada'};
 const pending=runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],options);
 const pid=[...options.activeCommands][0].pid;
 await assert.rejects(pending,/fixture travada.*timeout/);assert.equal(alive(pid),false);assert.equal(options.activeCommands.size,0);
});
test('launcher exit 0 resolve antes de close, mesmo com handles herdados abertos',async t=>{
 const child=new EventEmitter();Object.assign(child,{pid:12345,exitCode:null,signalCode:null});
 let spawned=false;
 const options={...fixture(t),spawnImpl(command,args,spawnOptions){
  spawned=true;assert.equal(command,'launcher.exe');assert.deepEqual(args,['start']);
  fs.writeSync(spawnOptions.stdio[1],'resultado do launcher\n');return child;
 }};
 const pending=runCommand('launcher.exe',['start'],options);
 const record=[...options.activeCommands][0];
 try{
  assert.equal(spawned,true);assert.equal(record.pid,12345);
  child.exitCode=0;child.emit('exit',0,null);
  // Uma microtask basta para uma Promise resolvida por exit. Não há espera
  // por tempo real nem dependência de processos órfãos do runner.
  const unsettled=Symbol('pendente');
  const output=await Promise.race([pending,Promise.resolve(unsettled)]);
  assert.notEqual(output,unsettled,'runCommand deve resolver em exit sem aguardar close.');
  assert.equal(output,'resultado do launcher\n');assert.equal(record.exited,true);
  assert.equal(record.closed,false,'close ainda não foi emitido.');
  assert.equal(options.activeCommands.size,0,'Launcher encerrado não pode aparecer como serviço ou comando ativo.');
 }finally{
  child.emit('close',0,null);await pending;
 }
});
test('falha ao iniciar executável rejeita e não deixa comando ativo',async t=>{
 const options=fixture(t);await assert.rejects(runCommand(path.join(os.tmpdir(),'ponto-executavel-inexistente.exe'),[],options),/Não foi possível executar/);assert.equal(options.activeCommands.size,0);
});
