'use strict';
const https=require('node:https');
const {X509Certificate}=require('node:crypto');
function connection(value){
 if(!value||typeof value.url!=='string'||typeof value.fingerprint!=='string')throw new Error('Arquivo de conexão inválido.');
 const url=new URL(value.url);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Use o arquivo de conexão exportado pelo computador principal.');
 const fingerprint=value.fingerprint.replaceAll(':','').toLowerCase();
 if(!/^[a-f0-9]{64}$/.test(fingerprint))throw new Error('Certificado de conexão inválido.');
 return {url:url.origin,fingerprint};
}
function fingerprint(pem){return new X509Certificate(pem).fingerprint256.replaceAll(':','').toLowerCase();}
function verifyCertificate(pem,pin){try{return fingerprint(pem)===pin;}catch{return false;}}
function check(value){
 const config=connection(value);
 return new Promise((resolve,reject)=>{
  const request=https.get(config.url+'/_ponto/status',{rejectUnauthorized:false,timeout:10000},response=>{
   if(!response.socket.getPeerCertificate().raw||fingerprint(response.socket.getPeerCertificate().raw)!==config.fingerprint){response.destroy();return reject(new Error('O certificado não corresponde ao arquivo de conexão.'));}
   let data='';response.on('data',chunk=>{data+=chunk;if(data.length>4096)response.destroy();});
   response.on('end',()=>{try{if(response.statusCode!==200||JSON.parse(data).application!=='ponto-docente-undf')throw new Error();resolve(config);}catch{reject(new Error('O computador principal não respondeu como esperado.'));}});
  });
  request.on('timeout',()=>request.destroy(new Error('O computador principal não respondeu. Confira se está ligado.')));
  request.on('error',()=>reject(new Error('Não foi possível acessar o computador principal. Confira a rede e se o aplicativo está aberto.')));
 });
}
module.exports={connection,fingerprint,verifyCertificate,check};
