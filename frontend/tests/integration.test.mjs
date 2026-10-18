import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewServerImport, confirmServerImport } from '../lib/server-import-api.ts';
import { listProfessors, saveProfessor } from '../lib/professor-api.ts';
import { matchesProfessor } from '../lib/ponto.ts';
import { listEmailLogs, retryEmailErrors } from '../lib/email-api.ts';
import { refreshSystemLease, releaseSystemLease } from '../lib/system-lease.ts';
import { apiRequest } from '../lib/api-client.ts';
import { setNetworkLock } from '../lib/network-lock.ts';
import { listPackages, importPage, validatePdf } from '../lib/timesheet-api.ts';
const free=()=>setNetworkLock({locked:false,unavailable:false,checked:true});
const server={id_servidor:1,nome:'João Silva',matricula:'0012345',cpf:'00123456789',email:'a@example.com',departamento:'Ensino',carga_horaria:40,acumula_cargo:false};
test('CPF é carregado, buscado formatado e enviado no cadastro/edição',async t=>{
  free();const mock=t.mock.method(globalThis,'fetch',async()=>Response.json([server]));
  const p=(await listProfessors())[0];assert.equal(p.cpf,'00123456789');assert.ok(matchesProfessor(p,'001.234.567-89'));assert.ok(matchesProfessor(p,'joao'));
  mock.mock.mockImplementation(async(url,opts)=>{assert.equal(JSON.parse(opts.body).cpf,'00123456789');assert.ok(opts.headers.get('X-Client-Id'));return Response.json(server);});
  assert.equal((await saveProfessor(p,false)).cpf,'00123456789');
});
test('prévia XLS/XLSX inclui CPF; confirmação envia só token e chave e respeita expiração',async t=>{
  free();const preview={token:'token',expira_em:new Date(Date.now()+60000).toISOString(),registros:[{linha:2,nome:'Ana',matricula:'0012345',cpf:'00123456789',acao:'novo',valido:true}]};
  t.mock.method(globalThis,'fetch',async(url,opts)=>{
    if(url.endsWith('/preview')){assert.ok(opts.body.get('arquivo'));return Response.json(preview);}
    assert.deepEqual(JSON.parse(opts.body),{token:'token'});assert.equal(opts.headers.get('Idempotency-Key'),'confirm-key');return Response.json({novos:1,atualizados:0,ignorados:0});
  });
  for(const ext of ['xls','xlsx'])assert.equal((await previewServerImport(new File(['excel'],`cadastros.${ext}`))).registros[0].cpf,'00123456789');
  assert.equal((await confirmServerImport(preview,'confirm-key')).novos,1);
  await assert.rejects(confirmServerImport({...preview,expira_em:'2000-01-01'},'x'),/expirou/);
});
test('histórico de e-mails filtra CPF e reenvio conserva erros individuais',async t=>{
  free();t.mock.method(globalThis,'fetch',async(url,opts)=>{
    if(url.startsWith('/api/emails?')){assert.match(url,/cpf=00123456789/);return Response.json([{id:1,id_folha:2,nome:'Ana',matricula:'0012345',cpf:'00123456789',competencia:'2026-10',status:'ERRO',criado_em:'2026-10-01T00:00:00Z',mensagem:'Teste'}]);}
    assert.deepEqual(JSON.parse(opts.body),{log_ids:[1]});assert.equal(opts.headers.get('Idempotency-Key'),'retry');return Response.json({reenviados:0,ignorados:0,falhas:1});
  });
  assert.equal((await listEmailLogs({nome:'',matricula:'',cpf:'00123456789',status:'ERRO',competencia:''}))[0].status,'ERRO');
  assert.equal((await retryEmailErrors([1],'retry')).falhas,1);
});
test('lease adquire, renova, libera e impede mutações de outro holder',async t=>{
  free();let holder=false;const paths=[];
  t.mock.method(globalThis,'fetch',async(url,opts)=>{
    paths.push(url);assert.match(opts.headers.get('X-Client-Id'),/^[0-9a-f-]{36}$/);
    if(opts.method==='DELETE')return new Response(null,{status:204});
    if(opts.method==='POST')holder=true;
    return Response.json({locked:false,holder,expires_at:holder?new Date(Date.now()+45000).toISOString():null});
  });
  assert.ok((await refreshSystemLease()).holder);await refreshSystemLease();await releaseSystemLease();
  assert.ok(paths.includes('/api/system/lock/acquire'));assert.ok(paths.includes('/api/system/lock/renew'));
  setNetworkLock({locked:true,unavailable:false,checked:true});await assert.rejects(apiRequest('/api/servers/1',{method:'DELETE'}),e=>e.status===423);free();
});
test('lease expirado é readquirido e erro de outro cliente é exibido',async t=>{
  free();const mock=t.mock.method(globalThis,'fetch',async(url)=>url.endsWith('/renew')?Response.json({detail:'Expirou'},{status:409}):Response.json({locked:false,holder:true,expires_at:new Date(Date.now()+10000).toISOString()}));
  assert.ok((await refreshSystemLease()).holder);
  mock.mock.mockImplementation(async()=>Response.json({locked:true,holder:false,expires_at:new Date(Date.now()+10000).toISOString()}));assert.ok((await refreshSystemLease()).locked);
});
test('candidatas por página vêm do servidor e importação exige vínculo explícito',async t=>{
  free();const remote={id_folha:9,id_servidor:1,competencia:'2026-10',nome_arquivo:'Ana.pdf',tamanho_arquivo:100,atualizado_em:'2026-10-01T00:00:00Z',status_ocr:'REVISAR'};
  t.mock.method(globalThis,'fetch',async(url,opts)=>{
    if(url.endsWith('/packages'))return Response.json([{...remote,paginas:[{pagina:1,duplicidade:true,status_ocr:'REVISAR'}]}]);
    assert.equal(url,'/api/timesheets/8/pages/1/import');assert.equal(JSON.parse(opts.body).id_folha_existente,8);return Response.json(remote);
  });
  assert.ok((await listPackages())[0].paginas[0].duplicidade);assert.equal((await importPage(8,1,1,'2026-10',8)).backendId,9);
  const files=[new File(['%PDF-1.7'],'a.pdf',{type:'application/pdf'}),new File(['imagem'],'b.png',{type:'image/png'}),new File(['%PDF-1.7'],'c.pdf',{type:'application/pdf'})];
  const result=await Promise.allSettled(files.map(validatePdf));assert.deepEqual(result.map(r=>r.status),['fulfilled','rejected','fulfilled']);
});
