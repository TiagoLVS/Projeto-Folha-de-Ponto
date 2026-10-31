'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {runCommand}=require('../app/commands.cjs');const {alive,waitPidExit}=require('../app/lifecycle.cjs');
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
test('launcher exit 0 conclui com descendente vivo e saída herdada aberta',async t=>{
 const options={...fixture(t),timeout:5000};let descendant;
 t.after(async()=>{if(descendant&&alive(descendant)){process.kill(descendant,'SIGKILL');await waitPidExit(descendant);}});
 const source="const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});console.log(child.pid);child.unref()";
 const output=await runCommand(process.execPath,['-e',source],options);
 descendant=Number(output.trim());assert.ok(Number.isSafeInteger(descendant)&&descendant>0,output);
 assert.equal(alive(descendant),true,'Descendente deve continuar vivo, como o postmaster após pg_ctl start.');
 assert.equal(options.activeCommands.size,0,'Launcher encerrado não pode aparecer como serviço ou comando ativo.');
});
test('falha ao iniciar executável rejeita e não deixa comando ativo',async t=>{
 const options=fixture(t);await assert.rejects(runCommand(path.join(os.tmpdir(),'ponto-executavel-inexistente.exe'),[],options),/Não foi possível executar/);assert.equal(options.activeCommands.size,0);
});
