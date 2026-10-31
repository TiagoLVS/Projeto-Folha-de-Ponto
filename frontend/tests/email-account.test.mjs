import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getEmailAccount,connectEmailAccount,disconnectEmailAccount} from '../lib/email-account-api.ts';
import {credentialTransportAllowed} from '../lib/email-account-transport.ts';
import {setNetworkLock} from '../lib/network-lock.ts';

test('conta de e-mail conecta e desconecta por sessão, inclusive sem reserva de edição',async t=>{
 setNetworkLock({locked:true,unavailable:false,checked:true});
 let connected=false;const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'/api/email-account');assert.ok(options.headers.get('X-Client-Id'));
  calls.push(options.method||'GET');
  if(options.method==='POST'){
   const body=JSON.parse(options.body);assert.equal(body.email,'nova@example.com');assert.equal(body.senha,'senha-simulada');connected=true;
  }
  if(options.method==='DELETE'){connected=false;return new Response(null,{status:204});}
  return Response.json({modo_teste:false,conectado:connected,email:connected?'nova@example.com':null});
 });
 assert.equal((await getEmailAccount()).conectado,false);
 assert.equal((await connectEmailAccount(' nova@example.com ','senha-simulada')).email,'nova@example.com');
 await disconnectEmailAccount();assert.equal((await getEmailAccount()).conectado,false);
 assert.deepEqual(calls,['GET','POST','DELETE','GET']);
 setNetworkLock({locked:false,unavailable:false,checked:true});
});
test('respostas inválidas e falha de autenticação ficam visíveis',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({modo_teste:false,conectado:true,email:null}));
 await assert.rejects(getEmailAccount(),/conferir a conta/);
 mock.mock.mockImplementation(async()=>Response.json({detail:'Confira o e-mail e a senha de aplicativo.'},{status:422}));
 await assert.rejects(connectEmailAccount('a@example.com','simulada'),/Confira o e-mail/);
});
test('transporte de credenciais aceita HTTPS e loopback, rejeitando HTTP na rede',()=>{
 for(const address of ['https://equipe.exemplo.com/api/email-account','http://localhost:5173/api/email-account','http://127.0.0.1:5173/api/email-account','http://[::1]:5173/api/email-account'])assert.equal(credentialTransportAllowed(address),true);
 for(const address of ['http://192.168.1.10:5173/api/email-account','http://computador-principal:5173/api/email-account','ftp://localhost/api/email-account','inválido'])assert.equal(credentialTransportAllowed(address),false);
});

test('não transmite a senha quando a tela foi aberta por HTTP na rede',async t=>{
 const before=globalThis.window;
 globalThis.window={location:{origin:'http://192.168.1.10:5173'}};
 const mock=t.mock.method(globalThis,'fetch',async()=>{throw new Error('Não deveria enviar a senha');});
 try{await assert.rejects(connectEmailAccount('a@example.com','senha-simulada'),/HTTPS/);assert.equal(mock.mock.callCount(),0);}
 finally{if(before===undefined)delete globalThis.window;else globalThis.window=before;}
});

test('identidade de e-mail permanece ao reabrir e não contém senha',async()=>{
 const before=globalThis.localStorage;const saved=new Map();
 globalThis.localStorage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
 try {
  const first=await import('../lib/client-session.ts?first-email-open');
  const identifier=first.emailClientId();
  const reopened=await import('../lib/client-session.ts?second-email-open');
  assert.equal(reopened.emailClientId(),identifier);
  assert.equal(reopened.sessionHeaders().get('X-Email-Client-Id'),identifier);
  assert.deepEqual([...saved.keys()],['ponto:email-client-id']);
  assert.match(identifier,/^[0-9a-f-]{36}$/);
 } finally {if(before===undefined)delete globalThis.localStorage;else globalThis.localStorage=before;}
});
