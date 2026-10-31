const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('setup',{start:mode=>ipcRenderer.invoke('start',mode),onStatus:callback=>ipcRenderer.on('status',(_event,text)=>callback(String(text)))});
