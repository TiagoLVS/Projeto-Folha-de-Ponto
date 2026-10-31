'use strict';
// GUI real e dados descartáveis. Não conecta SMTP nem usa o perfil normal do usuário.
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {spawn,spawnSync}=require('node:child_process');const assert=require('node:assert/strict');const {chromium}=require('playwright-core');
if(process.platform!=='win32')throw new Error('Homologação GUI do pacote Windows precisa executar em Windows.');
const root=path.resolve(__dirname,'..');const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ponto-gui-'));
fs.writeFileSync(path.join(temporary,'.ponto-smoke'),'teste');
let child,browser;
(async()=>{try{
 const env={...process.env,PONTO_TEST_USER_DATA:temporary,PATH:path.join(process.env.SystemRoot||'C:\\Windows','System32')};delete env.ELECTRON_RUN_AS_NODE;delete env.PYTHONHOME;delete env.PYTHONPATH;
 child=spawn(path.join(root,'release/PontoDocente-win32-x64/PontoDocente.exe'),['--ponto-test-mode','--remote-debugging-port=0','--disable-gpu'],{env,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(new Error('A janela Electron não abriu. '+text.slice(-1000))),45000);child.stderr.on('data',chunk=>{text+=chunk;const found=text.match(/DevTools listening on (ws:\/\/\S+)/);if(found){clearTimeout(timeout);resolve(found[1]);}});child.on('error',reject);child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Electron encerrou ao abrir: '+code));});});
 browser=await chromium.connectOverCDP(endpoint);const context=browser.contexts()[0];const errors=[];context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));await context.route('**/*',route=>{const url=new URL(route.request().url());return url.protocol==='file:'||url.hostname==='localhost'||url.hostname==='127.0.0.1'?route.continue():route.abort();});const setup=context.pages()[0];
 await setup.getByRole('button',{name:'Este é o computador principal',exact:true}).waitFor({timeout:30000});
 const next=context.waitForEvent('page',{timeout:180000});await setup.getByRole('button',{name:'Este é o computador principal',exact:true}).click();const page=await next;
 await page.getByRole('heading',{name:'Conectar conta de e-mail'}).waitFor({timeout:120000});await page.getByRole('button',{name:'Agora não',exact:true}).click();
 await page.getByRole('navigation',{name:'Navegação principal'}).waitFor();
 // Sem internet: somente a origem HTTPS privada permanece acessível ao renderer.
 // A interceptação já está ativa desde antes de abrir a interface.
 await page.getByRole('button',{name:'Configurações',exact:true}).click();
 for(const [scheme,name] of [['dark','Escuro'],['light','Claro']]){
  await page.getByRole('radio',{name,exact:true}).check();await page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,scheme==='dark');
  for(const section of ['Professores','Folhas de ponto','Calendário','E-mails','Configurações']){await page.getByRole('navigation',{name:'Navegação principal'}).getByRole('button',{name:section,exact:true}).click();await page.locator('.workspace').waitFor();}
 }
 await page.getByRole('radio',{name:'Sistema',exact:true}).check();await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
 await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>!document.documentElement.classList.contains('dark'));
 await page.getByRole('button',{name:'Professores',exact:true}).click();await page.getByRole('button',{name:'Adicionar professor',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
 await page.reload();await page.getByRole('navigation',{name:'Navegação principal'}).waitFor();
 assert.deepEqual(errors,[],'A janela não pode apresentar erros JavaScript.');
 await page.close();await new Promise((resolve,reject)=>{if(child.exitCode!==null)return resolve();const timeout=setTimeout(()=>reject(new Error('O principal não encerrou seus serviços.')),45000);child.once('exit',()=>{clearTimeout(timeout);resolve();});});
 assert.equal(fs.existsSync(path.join(temporary,'principal/postgres/postmaster.pid')),false,'Banco privado deve encerrar sem processo órfão.');
 console.log('OK: janela Electron, startup, UI estática offline, formulários, temas, reload e encerramento, com PATH sem runtimes globais.');
 }finally{if(browser?.isConnected())await browser.close().catch(error=>console.warn('Encerramento da automação: '+error.message));if(child?.exitCode===null){child.kill();await new Promise((resolve,reject)=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>reject(new Error('Processo Electron de teste não encerrou.')),10000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}const pgdata=path.join(temporary,'principal/postgres');if(fs.existsSync(path.join(pgdata,'postmaster.pid'))){const stopped=spawnSync(path.join(root,'release/PontoDocente-win32-x64/resources/runtime/pgsql/bin/pg_ctl.exe'),['-D',pgdata,'-m','fast','-w','stop'],{windowsHide:true,encoding:'utf8',timeout:30000});if(stopped.status!==0)throw new Error('Não foi possível encerrar o PostgreSQL descartável: '+(stopped.stderr||stopped.error));}fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
