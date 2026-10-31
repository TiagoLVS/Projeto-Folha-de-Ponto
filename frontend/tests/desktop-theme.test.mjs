import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configureApiTransport,apiUrl,apiFetch} from '../lib/api-transport.ts';
import {validTheme,resolveTheme,THEME_KEY,themePreference,setVisualTheme,themeSnapshot} from '../lib/visual-theme.ts';
test('transporte mantém proxy web e origem única desktop sem espalhar endereços',async t=>{
 assert.equal(apiUrl('/api/servers'),'/api/servers');
 try{
  configureApiTransport('https://principal.local:5173');
  assert.equal(apiUrl('/api/servers'),'https://principal.local:5173/api/servers');
  const mock=t.mock.method(globalThis,'fetch',async()=>Response.json([]));
  await apiFetch('/api/servers',{headers:{'X-Client-Id':'teste'}});
  assert.equal(mock.mock.calls[0].arguments[0],'https://principal.local:5173/api/servers');
  assert.throws(()=>configureApiTransport('https://usuario:senha@host'),/inválida/);
  assert.throws(()=>apiUrl('https://outro.local/api/servers'),/inválida/);
 }finally{configureApiTransport();}
});
test('tema padrão sistema, mudança do sistema e escolha manual',()=>{
 assert.equal(validTheme(null),'system');assert.equal(resolveTheme('system',true),'dark');assert.equal(resolveTheme('system',false),'light');
 assert.equal(resolveTheme('light',true),'light');assert.equal(resolveTheme('dark',false),'dark');
 const priorWindow=globalThis.window,priorStorage=globalThis.localStorage;const values=new Map();let dark=false;
 globalThis.window={matchMedia:()=>({matches:dark}),dispatchEvent:()=>{}};
 globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 try{
  assert.equal(themePreference(),'system');assert.equal(themeSnapshot(),'system:light');dark=true;assert.equal(themeSnapshot(),'system:dark');
  setVisualTheme('light');assert.equal(themeSnapshot(),'light:light');assert.deepEqual([...values.keys()],[THEME_KEY]);
  setVisualTheme('dark');dark=false;assert.equal(themeSnapshot(),'dark:dark');setVisualTheme('system');
 }finally{if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow;if(priorStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=priorStorage;}
});
