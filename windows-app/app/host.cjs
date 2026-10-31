'use strict';
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const net=require('node:net');const http=require('node:http');const https=require('node:https');
const {spawn}=require('node:child_process');const {randomBytes}=require('node:crypto');
const {fingerprint}=require('./network.cjs');
const {runCommand}=require('./commands.cjs');
const {alive,within,track,terminate,waitPidExit,closeLog}=require('./lifecycle.cjs');
function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
function addresses(){return Object.values(os.networkInterfaces()).flat().filter(v=>v&&v.family==='IPv4'&&!v.internal).map(v=>v.address);}
function privateAddress(address){const ip=(address||'').replace(/^::ffff:/,'');return ip==='::1'||ip.startsWith('127.')||ip.startsWith('10.')||ip.startsWith('192.168.')||/^172\.(1[6-9]|2\d|3[01])\./.test(ip)||/^f[cd][a-f0-9]{2}:/i.test(ip);}
async function start({resources,folder,encrypt,decrypt,log,gatewayPort=5173,postgresOptions=''}){
 fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(path.join(folder,'logs'),{recursive:true});
 const logs=fs.createWriteStream(path.join(folder,'logs','servicos.log'),{flags:'a'});
 const services=[],commands=new Set();let commandNumber=0;let gateway,pgStarted=false,closing=false,stopPromise,postgresPid;
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
 function startService(command,args,overrides={}){
  const item=spawn(command,args,{cwd:server,env:{...env,...overrides},windowsHide:true,stdio:['ignore','pipe','pipe']});
  item.on('error',()=>{item.spawnError=true;log('Não foi possível iniciar um componente do aplicativo.');});
  item.stdout.pipe(logs,{end:false});item.stderr.pipe(logs,{end:false});services.push(track(item,path.basename(command)));return item;
 }
 async function run(command,args,timeout=120000){
  const action=command===python?args[1]:(args.includes('start')?'start':args.includes('stop')?'stop':'');
  const label=path.basename(command)+(action?' '+action:'');
  const outputFile=path.join(folder,'logs','comando-'+(++commandNumber)+'-'+path.basename(command)+'.log');
  try{
   const output=await runCommand(command,args,{cwd:server,env,outputFile,activeCommands:commands,timeout,label});
   logs.write(output);return output;
  }catch(error){
   // Conserva também a saída de comandos que falharam no log do smoke.
   try{if(fs.existsSync(outputFile))logs.write(fs.readFileSync(outputFile,'utf8'));}catch(readError){log('Não foi possível ler o log de '+label+': '+readError.message);}
   throw error;
  }
 }
 async function ready(port,pathname,item){
  for(let i=0;i<180;i++){
   if(item.spawnError||item.exitCode!==null||item.signalCode!==null)throw new Error('Um serviço encerrou durante a inicialização. Consulte os registros.');
   try{if((await fetch(`http://127.0.0.1:${port}${pathname}`,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('O sistema demorou para iniciar. Consulte os registros.');
 }
 function processStatus(){
  return [...services.map(record=>({pid:record.pid,command:record.command,active:!record.closed&&alive(record.pid),streamsClosed:record.closed})),
   ...[...commands].map(record=>({pid:record.pid,command:record.command,kind:'command',active:!record.exited&&alive(record.pid)})),
   ...(postgresPid?[{pid:postgresPid,command:'postgres',active:alive(postgresPid)}]:[])];
 }
 function stop(){
  if(stopPromise)return stopPromise;
  closing=true;
  stopPromise=(async()=>{
   const errors=[];
   async function attempt(action){try{await action();}catch(error){errors.push(error);}}
   if(gateway)await attempt(()=>within(new Promise((resolve,reject)=>{
    gateway.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve());gateway.closeAllConnections();
   }),15000,'fechar gateway HTTPS'));
   await Promise.all([...services,...commands].map(record=>attempt(()=>terminate(record))));
   if(pgStarted||fs.existsSync(path.join(pgdata,'postmaster.pid')))await attempt(async()=>{
    await run(path.join(pgbin,'pg_ctl.exe'),['-D',pgdata,'-m','fast','-w','stop'],30000);
    if(postgresPid)await waitPidExit(postgresPid);
    if(fs.existsSync(path.join(pgdata,'postmaster.pid')))throw new Error('PostgreSQL manteve postmaster.pid após stop.');
   });
   // Apenas serviços e comandos ainda ativos; launchers encerrados não são serviços.
   await Promise.all([...services,...commands].map(record=>attempt(()=>terminate(record))));
   const remaining=processStatus().filter(item=>item.active||item.streamsClosed===false);
   if(remaining.length)errors.push(new Error('Processos/streams pendentes: '+JSON.stringify(remaining)));
   if(gateway?.listening)errors.push(new Error('Gateway HTTPS continua escutando.'));
   await attempt(()=>closeLog(logs));
   if(errors.length)throw new AggregateError(errors,'Falha ao encerrar serviços: '+errors.map(error=>error.message).join('; '));
  })();
  return stopPromise;
 }

 try{
  if(!fs.existsSync(path.join(pgdata,'PG_VERSION'))){
   log('Preparando o banco de dados do computador principal…');
   const passfile=path.join(folder,'.senha-temporaria');fs.writeFileSync(passfile,password,{mode:0o600});
   try{await run(path.join(pgbin,'initdb.exe'),['-D',pgdata,'-U','ponto','--encoding=UTF8','--locale=C','--auth=scram-sha-256',`--pwfile=${passfile}`]);}finally{fs.rmSync(passfile,{force:true});}
  }
  if(fs.existsSync(path.join(pgdata,'postmaster.pid'))){
   const previousPid=Number(fs.readFileSync(path.join(pgdata,'postmaster.pid'),'utf8').split(/\r?\n/)[0]);
   if(alive(previousPid))await run(path.join(pgbin,'pg_ctl.exe'),['-D',pgdata,'-m','fast','-w','stop'],30000);
   else log('Recuperando banco após encerramento anterior; PostgreSQL verificará o arquivo de PID.');
  }
  log('Iniciando banco de dados…');
  await run(path.join(pgbin,'pg_ctl.exe'),['-D',pgdata,'-l',path.join(folder,'logs','postgres.log'),'-o',`-h 127.0.0.1 -p ${dbPort} ${postgresOptions}`,'-w','start']);pgStarted=true;
  postgresPid=Number(fs.readFileSync(path.join(pgdata,'postmaster.pid'),'utf8').split(/\r?\n/)[0]);
  if(!Number.isSafeInteger(postgresPid)||postgresPid<=0)throw new Error('PID do PostgreSQL inválido.');
  if(!alive(postgresPid))throw new Error('PostgreSQL encerrou após o launcher. PID '+postgresPid);
  await run(python,[entry,'postgres-check'],15000);
  if(!alive(postgresPid))throw new Error('PostgreSQL encerrou após SELECT 1. PID '+postgresPid);
  await run(python,[entry,'database']);
  const tlsFolder=path.join(folder,'certificado');
  await run(python,[entry,'certificate',tlsFolder,'localhost','127.0.0.1',os.hostname(),...addresses()]);
  log('PostgreSQL ✓');
  const languages=await run(env.TESSERACT_CMD,['--list-langs']);
  if(!languages.split(/\r?\n/).some(line=>line.trim()==='por'))throw new Error('OCR português não foi encontrado. Extraia o pacote completo.');
  log('OCR português ✓');
  log('Iniciando backend e interface…');
  const backend=startService(python,[entry,'serve']);await ready(apiPort,'/_ponto/health',backend);await ready(apiPort,'/',backend);
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
  return {url:`https://localhost:${gatewayPort}`,fingerprint:pin,processStatus,exportConnection:()=>({url:`https://${addresses()[0]||os.hostname()}:${gatewayPort}`,fingerprint:pin}),stop};
 }catch(error){try{await stop();}catch(shutdown){throw new AggregateError([error,shutdown],'Inicialização e encerramento falharam.',{cause:error});}throw error;}
}
module.exports={start,privateAddress,freePort};
