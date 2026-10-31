'use strict';
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const net=require('node:net');const http=require('node:http');const https=require('node:https');
const {spawn}=require('node:child_process');const {randomBytes}=require('node:crypto');
const {fingerprint}=require('./network.cjs');
function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
function addresses(){return Object.values(os.networkInterfaces()).flat().filter(v=>v&&v.family==='IPv4'&&!v.internal).map(v=>v.address);}
function privateAddress(address){const ip=(address||'').replace(/^::ffff:/,'');return ip==='::1'||ip.startsWith('127.')||ip.startsWith('10.')||ip.startsWith('192.168.')||/^172\.(1[6-9]|2\d|3[01])\./.test(ip)||/^f[cd][a-f0-9]{2}:/i.test(ip);}
async function start({resources,folder,encrypt,decrypt,log,gatewayPort=5173,postgresOptions=''}){
 fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(path.join(folder,'logs'),{recursive:true});
 const logs=fs.createWriteStream(path.join(folder,'logs','servicos.log'),{flags:'a'});
 const children=[];let gateway,pgStarted=false,closing=false;
 const python=path.join(resources,'runtime','python','python.exe');
 const pgbin=path.join(resources,'runtime','pgsql','bin');const pgdata=path.join(folder,'postgres');
 const server=path.join(resources,'server');const entry=path.join(server,'runtime.py');
 const dbPort=await freePort(),apiPort=await freePort();
 const secretFile=path.join(folder,'banco.bin');
 let password;
 if(fs.existsSync(secretFile))password=await decrypt(fs.readFileSync(secretFile));
 else {password=randomBytes(32).toString('hex');fs.writeFileSync(secretFile,await encrypt(password),{mode:0o600});}
 const env={...process.env,DB_HOST:'127.0.0.1',DB_PORT:String(dbPort),DB_USER:'ponto',DB_NAME:'ponto_docente',DB_PASSWORD:password,
  BACKEND_PORT:String(apiPort),BACKEND_URL:`http://127.0.0.1:${apiPort}`,PONTO_DATA_DIR:path.join(folder,'data'),PONTO_STATIC_FRONTEND:path.join(resources,'frontend'),
  EMAIL_CREDENTIALS_KEY_FILE:path.join(folder,'secrets','email.key'),PONTO_PG_DUMP:path.join(pgbin,'pg_dump.exe'),
  DIGEP_MODO_TESTE:'false',SMTP_HOST:'smtp.gmail.com',SMTP_PORT:'465',SMTP_SECURITY:'ssl',
  TESSERACT_CMD:path.join(resources,'runtime','tesseract','tesseract.exe'),TESSDATA_PREFIX:path.join(resources,'runtime','tesseract','tessdata'),OCR_LANG:'por',
  PYTHONUTF8:'1',PGPASSWORD:password};
 function child(command,args,overrides={}){
  const item=spawn(command,args,{cwd:server,env:{...env,...overrides},windowsHide:true,stdio:['ignore','pipe','pipe']});
  item.on('error',()=>{item.spawnError=true;log('Não foi possível iniciar um componente do aplicativo.');});
  item.stdout.pipe(logs,{end:false});item.stderr.pipe(logs,{end:false});children.push(item);return item;
 }
 function run(command,args,timeout=120000){return new Promise((resolve,reject)=>{
  const item=child(command,args);const timer=setTimeout(()=>{item.kill();reject(new Error('Uma etapa de inicialização demorou além do esperado. Consulte os registros.'));},timeout);
  let output='';item.stdout.on('data',chunk=>output+=chunk);
  item.once('error',()=>{clearTimeout(timer);reject(new Error('Não foi possível iniciar um componente. Extraia a pasta completa do aplicativo.'));});
  item.once('exit',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error('Não foi possível preparar os serviços. Consulte os registros do aplicativo.'));});
 });}
 async function ready(port,pathname,item){
  for(let i=0;i<180;i++){
   if(item.spawnError||item.exitCode!==null)throw new Error('Um serviço encerrou durante a inicialização. Consulte os registros.');
   try{if((await fetch(`http://127.0.0.1:${port}${pathname}`,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('O sistema demorou para iniciar. Consulte os registros.');
 }
 async function stop(){
  if(closing)return;closing=true;
  if(gateway){gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));}
  for(const item of children)if(item.exitCode===null)item.kill();
  if(pgStarted){try{await run(path.join(pgbin,'pg_ctl.exe'),['-D',pgdata,'-m','fast','-w','stop'],30000);}catch{log('Não foi possível confirmar o encerramento do banco. Consulte os registros.');}}
  logs.end();
 }
 try{
  if(!fs.existsSync(path.join(pgdata,'PG_VERSION'))){
   log('Preparando o banco de dados do computador principal…');
   const passfile=path.join(folder,'.senha-temporaria');fs.writeFileSync(passfile,password,{mode:0o600});
   try{await run(path.join(pgbin,'initdb.exe'),['-D',pgdata,'-U','ponto','--encoding=UTF8','--locale=C','--auth=scram-sha-256',`--pwfile=${passfile}`]);}finally{fs.rmSync(passfile,{force:true});}
  }
  if(fs.existsSync(path.join(pgdata,'postmaster.pid'))){
   try{await run(path.join(pgbin,'pg_ctl.exe'),['-D',pgdata,'-m','fast','-w','stop'],30000);}catch{}
  }
  log('Iniciando banco de dados…');
  await run(path.join(pgbin,'pg_ctl.exe'),['-D',pgdata,'-l',path.join(folder,'logs','postgres.log'),'-o',`-h 127.0.0.1 -p ${dbPort} ${postgresOptions}`,'-w','start']);pgStarted=true;
  await run(python,[entry,'database']);
  const tlsFolder=path.join(folder,'certificado');
  await run(python,[entry,'certificate',tlsFolder,'localhost','127.0.0.1',os.hostname(),...addresses()]);
  log('PostgreSQL ✓');
  const languages=await run(env.TESSERACT_CMD,['--list-langs']);
  if(!languages.split(/\r?\n/).some(line=>line.trim()==='por'))throw new Error('OCR português não foi encontrado. Extraia o pacote completo.');
  log('OCR português ✓');
  log('Iniciando backend e interface…');
  const backend=child(python,[entry,'serve']);await ready(apiPort,'/_ponto/health',backend);await ready(apiPort,'/',backend);
  log('Backend ✓ · Interface ✓');
  const cert=fs.readFileSync(path.join(tlsFolder,'cert.pem'));const pin=fingerprint(cert);
  gateway=https.createServer({cert,key:fs.readFileSync(path.join(tlsFolder,'key.pem')),minVersion:'TLSv1.2'},(request,response)=>{
   if(!privateAddress(request.socket.remoteAddress)){response.writeHead(403);return response.end('Acesso permitido somente na rede local.');}
   if(request.url==='/_ponto/status'){response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return response.end(JSON.stringify({application:'ponto-docente-undf',protocol:1}));}
   const headers={...request.headers};delete headers.connection;
   const upstream=http.request({host:'127.0.0.1',port:apiPort,path:request.url,method:request.method,headers},remote=>{response.writeHead(remote.statusCode,remote.headers);remote.pipe(response);});
   upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end('O sistema está indisponível. Tente novamente.');});
   response.on('close',()=>upstream.destroy());request.pipe(upstream);
  });
  gateway.requestTimeout=960000;
  await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(gatewayPort,'0.0.0.0',resolve);});
  for(const item of [backend])item.on('exit',()=>{if(!closing){log('Um serviço foi encerrado. Feche e abra o aplicativo novamente.');gateway?.close();}});
  return {url:`https://localhost:${gatewayPort}`,fingerprint:pin,exportConnection:()=>({url:`https://${addresses()[0]||os.hostname()}:${gatewayPort}`,fingerprint:pin}),stop};
 }catch(error){await stop();throw error;}
}
module.exports={start,privateAddress,freePort};
