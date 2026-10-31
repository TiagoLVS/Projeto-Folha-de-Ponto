'use strict';
const {app,BrowserWindow,ipcMain,dialog,Menu,shell,safeStorage}=require('electron');
const fs=require('node:fs');const path=require('node:path');
const {connection,verifyCertificate,check}=require('./network.cjs');
const {start}=require('./host.cjs');
app.setName('PontoDocenteUnDF');
let window,host,config,quitting=false;
const setupFile=path.join(__dirname,'setup.html');
function file(){return path.join(app.getPath('userData'),'instalacao.json');}
function status(text){if(window&&!window.isDestroyed())window.webContents.send('status',text);}
function isSetup(event){return event.sender===window?.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame.url===require('node:url').pathToFileURL(setupFile).href;}
function save(value){fs.mkdirSync(path.dirname(file()),{recursive:true});fs.writeFileSync(file(),JSON.stringify(value),{mode:0o600});}
async function connect(value){
 let selected;
 if(value.mode==='principal'){
  if(process.platform!=='win32'&&!process.env.PONTO_RUNTIME_TEST)throw new Error('Este pacote foi preparado para Windows.');
  const folder=path.join(app.getPath('userData'),'principal');
  if(!await safeStorage.isAsyncEncryptionAvailable())throw new Error('O Windows não disponibilizou a proteção das configurações. Tente novamente.');
  host=await start({resources:process.resourcesPath,folder,log:status,
   encrypt:text=>safeStorage.encryptStringAsync(text),decrypt:async data=>(await safeStorage.decryptStringAsync(data)).result});
  selected=host;
 }else{selected=await check(value.connection);}
 config=value;save(value);
 const origin=selected.url;
 const session=window.webContents.session;
 session.setCertificateVerifyProc((request,callback)=>{
  let hostname;try{hostname=new URL(origin).hostname;}catch{return callback(-2);}
  callback(request.hostname===hostname&&verifyCertificate(request.certificate.data,selected.fingerprint)?0:-2);
 });
 session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 const previous=window;window=new BrowserWindow({width:1440,height:960,minWidth:800,minHeight:600,title:'Ponto Docente · UnDF',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
 window.webContents.setWindowOpenHandler(({url})=>new URL(url).origin===origin?{action:'allow',overrideBrowserWindowOptions:{webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}}}:{action:'deny'});
 for(const contents of [window.webContents])contents.on('did-fail-load',(_event,code,_description,_url,mainFrame)=>{if(mainFrame&&code!==-3)dialog.showMessageBox(window,{type:'error',message:'Não foi possível abrir o sistema.',detail:'Confira se o computador principal está ligado e conectado à mesma rede. Feche e abra o aplicativo para tentar novamente.'});});
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Aplicativo',submenu:[
  {label:'Exportar conexão da equipe',enabled:!!host,click:async()=>{
   const result=await dialog.showSaveDialog(window,{defaultPath:'conexao-equipe.json',filters:[{name:'Conexão da equipe',extensions:['json']}]});
   if(!result.canceled&&result.filePath)fs.writeFileSync(result.filePath,JSON.stringify(host.exportConnection(),null,2));
  }},
  {label:'Abrir pasta de suporte',click:()=>shell.openPath(app.getPath('userData'))},
  {label:'Redefinir tipo de instalação',click:async()=>{const result=await dialog.showMessageBox(window,{type:'question',buttons:['Cancelar','Redefinir e fechar'],defaultId:0,cancelId:0,message:'Na próxima abertura, escolher outro computador principal?',detail:'Os dados existentes serão preservados. No modo principal, os outros computadores perderão o acesso enquanto o aplicativo estiver fechado.'});if(result.response===1){fs.rmSync(file(),{force:true});app.quit();}}},
  {type:'separator'},{role:'quit',label:'Sair'}]},
  {label:'Exibir',submenu:[{role:'reload',label:'Atualizar'},{role:'resetZoom',label:'Zoom normal'},{role:'zoomIn',label:'Aumentar'},{role:'zoomOut',label:'Diminuir'},{role:'togglefullscreen',label:'Tela cheia'}]}]));
 await window.loadURL(origin);previous.destroy();
}
function setup(){
 window=new BrowserWindow({width:760,height:650,resizable:false,title:'Preparar Ponto Docente',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.loadFile(setupFile);
}
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>{window?.show();window?.focus();});
 app.whenReady().then(()=>{
  setup();
  ipcMain.handle('start',async(event,mode)=>{
   if(!isSetup(event)||!['principal','equipe'].includes(mode))throw new Error('Operação inválida.');
   let value={mode};
   if(mode==='equipe'){
    const result=await dialog.showOpenDialog(window,{title:'Selecione a conexão exportada pelo computador principal',properties:['openFile'],filters:[{name:'Conexão da equipe',extensions:['json']}]});
    if(result.canceled)return {cancelled:true};
    if(fs.statSync(result.filePaths[0]).size>4096)throw new Error('Arquivo de conexão inválido.');
    value.connection=connection(JSON.parse(fs.readFileSync(result.filePaths[0],'utf8')));
   }
   try{await connect(value);return {ok:true};}catch(error){status(error.message);return {error:error.message};}
  });
  window.webContents.once('did-finish-load',async()=>{
   try{if(fs.existsSync(file())){const saved=JSON.parse(fs.readFileSync(file(),'utf8'));if(!['principal','equipe'].includes(saved.mode))return;status('Iniciando o sistema…');await connect(saved);}}
   catch(error){status(error.message);}
  });
 });
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
 if(quitting||!host)return;
 event.preventDefault();quitting=true;
 host.stop().finally(()=>app.quit());
});
