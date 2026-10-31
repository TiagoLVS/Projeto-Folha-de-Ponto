// Validação dos runtimes Windows reais em dados descartáveis; nunca envia e-mail.
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const https=require('node:https');const assert=require('node:assert/strict');
const {start,freePort}=require('../app/host.cjs');const {check}=require('../app/network.cjs');
if(process.platform!=='win32')throw new Error('Execute este teste com os runtimes Windows em Windows.');
const resources=path.resolve(process.argv[2]||path.join(__dirname,'../release/PontoDocente-win32-x64/resources'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ponto-windows-smoke-'));let host;
const headers={'X-Client-Id':'8f3a19d7-046b-4510-9ddf-eb85407ae621','X-Email-Client-Id':'8f3a19d7-046b-4510-9ddf-eb85407ae621','Content-Type':'application/json'};
function request(url,method='GET',payload){return new Promise((resolve,reject)=>{
 const req=https.request(url,{rejectUnauthorized:false,method,headers},response=>{let data='';response.on('data',chunk=>data+=chunk);response.on('end',()=>resolve({status:response.statusCode,data}));});
 req.on('error',reject);req.end(payload===undefined?undefined:JSON.stringify(payload));
});}
(async()=>{try{
 const options={resources,folder:path.join(temp,'dados'),gatewayPort:await freePort(),encrypt:async text=>Buffer.from(text),decrypt:async data=>data.toString(),log:console.log};
 host=await start(options);await check(host);
 assert.equal((await request(host.url)).status,200);
 assert.equal((await request(host.url+'/api/system/lock/acquire','POST')).status,200);
 let result=await request(host.url+'/api/servers','POST',{name:'Teste Windows',registration:'12345',cpf:'00123456789',email:'teste@example.com',department:'Teste',workload:40});assert.equal(result.status,201,result.data);
 const professor=JSON.parse(result.data);
 result=await request(host.url+'/api/academic/folhas/gerar','POST',{id_servidor:professor.id_servidor,competencia:'2026-10',nova_versao:false});assert.equal(result.status,201,result.data);
 assert.ok(fs.existsSync(path.join(temp,'dados','data','folhas','geradas','2026-10')));
 await assert.rejects(check({...host,fingerprint:'00'.repeat(32)}));
 await host.stop();host=null;
 host=await start(options);
 result=await request(host.url+'/api/servers');assert.equal(result.status,200,result.data);assert.equal(JSON.parse(result.data).length,1);
 console.log('OK: inicialização, cadastro, PDF, HTTPS, rejeição de certificado incorreto, persistência e reinicialização. Sem SMTP real.');
 }catch(error){for(const name of ['servicos.log','postgres.log']){const file=path.join(temp,'dados','logs',name);if(fs.existsSync(file))console.error(fs.readFileSync(file,'utf8').slice(-5000));}throw error;}
 finally{if(host)await host.stop();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
