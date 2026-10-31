// Validação dos runtimes Windows reais em dados descartáveis; nunca envia e-mail.
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const https=require('node:https');const assert=require('node:assert/strict');
const {start,freePort}=require('../app/host.cjs');const {check}=require('../app/network.cjs');
if(process.platform!=='win32')throw new Error('Execute este teste com os runtimes Windows em Windows.');
const resources=path.resolve(process.argv[2]||path.join(__dirname,'../release/PontoDocente-win32-x64/resources'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ponto-windows-smoke-'));let host;
const headers={'X-Client-Id':'8f3a19d7-046b-4510-9ddf-eb85407ae621','X-Email-Client-Id':'8f3a19d7-046b-4510-9ddf-eb85407ae621','Content-Type':'application/json'};
function request(url,method='GET',payload){return new Promise((resolve,reject)=>{
 const req=https.request(url,{rejectUnauthorized:false,method,headers},response=>{let data='';response.on('data',chunk=>data+=chunk);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,data}));});
 req.on('error',reject);req.end(payload===undefined?undefined:JSON.stringify(payload));
});}
(async()=>{try{
 const options={resources,folder:path.join(temp,'dados'),gatewayPort:await freePort(),encrypt:async text=>Buffer.from(text),decrypt:async data=>data.toString(),log:console.log};
 host=await start(options);await check(host);
 assert.equal((await request(host.url)).status,200);
 const index=await request(host.url);
 const script=index.data.match(/src="([^"]+\.js)"/);
 assert.ok(script,'O HTML estático deve referenciar o bundle React.');
 assert.equal((await request(host.url+script[1])).status,200);
 assert.equal((await request(host.url+'/_next/image')).status,404,'Não deve existir servidor Next no desktop.');
 assert.equal((await request(host.url+'/api/system/lock/acquire','POST')).status,200);
 let result=await request(host.url+'/api/servers','POST',{name:'Teste Windows',registration:'12345',cpf:'00123456789',email:'teste@example.com',department:'Teste',workload:40});assert.equal(result.status,201,result.data);
 const professor=JSON.parse(result.data);
 result=await request(host.url+'/api/servers/'+professor.id_servidor,'PUT',{name:'Teste Windows Editado',registration:'12345',cpf:'00123456789',email:'teste@example.com',department:'Teste',workload:40});assert.equal(result.status,200,result.data);
 assert.equal(JSON.parse(result.data).nome,'Teste Windows Editado');
 result=await request(host.url+'/api/academic/folhas/gerar','POST',{id_servidor:professor.id_servidor,competencia:'2026-10',nova_versao:false});assert.equal(result.status,201,result.data);
 const document=JSON.parse(result.data);
 const pdf=await request(host.url+'/api/academic/folhas/geradas/'+document.id_documento+'/download');assert.equal(pdf.status,200,pdf.data);assert.ok(pdf.headers['content-type'].includes('application/pdf'));assert.ok(pdf.data.startsWith('%PDF-'));
 for(const endpoint of ['/api/emails','/api/email-account','/api/academic/folhas/geradas?competencia=2026-10'])assert.equal((await request(host.url+endpoint)).status,200,endpoint);
 assert.ok(fs.existsSync(path.join(temp,'dados','data','folhas','geradas','2026-10')));
 await assert.rejects(check({...host,fingerprint:'00'.repeat(32)}));
 await host.stop();host=null;
 host=await start(options);
 result=await request(host.url+'/api/servers');assert.equal(result.status,200,result.data);assert.equal(JSON.parse(result.data).length,1);
 console.log('OK: inicialização, cadastro/edição, PDF/download, histórico, estado da conta, HTTPS, rejeição de certificado incorreto, persistência e reinicialização. Sem SMTP real.');
 }catch(error){for(const name of ['servicos.log','postgres.log']){const file=path.join(temp,'dados','logs',name);if(fs.existsSync(file))console.error(fs.readFileSync(file,'utf8').slice(-5000));}throw error;}
 finally{if(host)await host.stop();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
