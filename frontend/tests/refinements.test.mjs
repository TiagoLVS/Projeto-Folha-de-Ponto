import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSelection, selectAll, academicTimeout, ACADEMIC_TIMEOUTS } from '../lib/academic-limits.ts';
import { getAcademicSettings, importCalendar, confirmCalendar } from '../lib/academic-api.ts';
import { saveProfessor, listProfessors } from '../lib/professor-api.ts';
import { setNetworkLock } from '../lib/network-lock.ts';
const free=()=>setNetworkLock({locked:false,unavailable:false,checked:true});
test('seleção aceita 100, 101 e 500; 501º e selecionar todos acima do limite não truncam a lista',()=>{
  const ids=Array.from({length:501},(_,i)=>String(i+1));
  for(const size of [1,100,101,500])assert.equal(selectAll(ids.slice(0,size),500).length,size);
  assert.throws(()=>selectAll(ids,500),/501.*500/);
  assert.equal(addSelection(ids.slice(0,499),'500',500).length,500);
  assert.throws(()=>addSelection(ids.slice(0,500),'501',500),/500/);
  assert.equal(addSelection(['1'],'1',500).length,1);
  assert.throws(()=>selectAll(['1','2'],1),/limite/);
});
test('timeout comum, geração grande, calendário OCR e ZIP têm prazos finitos distintos',()=>{
  assert.equal(academicTimeout('/folhas/gerar-lote'),900000);
  assert.equal(academicTimeout('/folhas/gerar'),900000);
  assert.equal(academicTimeout('/folhas/geradas/download-lote'),180000);
  assert.equal(academicTimeout('/datas-especiais/importar'),660000);
  assert.equal(academicTimeout('/datas-especiais?ano=2027'),65000);
  assert.ok(Object.values(ACADEMIC_TIMEOUTS).every(value=>Number.isFinite(value)&&value>0));
});
test('limites vêm do backend e configuração inválida não é aceita',async t=>{
  free();const settings={max_generation_batch:500,max_generated_download_batch:400,max_generated_zip_bytes:262144000,max_upload_bytes:15728640};
  const mock=t.mock.method(globalThis,'fetch',async url=>{assert.equal(url,'/api/academic/folhas/configuracao');return Response.json(settings);});
  assert.deepEqual(await getAcademicSettings(),settings);
  mock.mock.mockImplementation(async()=>Response.json({...settings,max_generation_batch:0}));
  await assert.rejects(getAcademicSettings(),/inesperada/);
});
test('PDF do calendário exibe prévia OCR, confirma token e chave e rejeita MIME incorreto',async t=>{
  free();t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.ok(options.signal);
    if(url.endsWith('/confirm')){
      assert.deepEqual(JSON.parse(options.body),{token:'token'});assert.equal(options.headers.get('Idempotency-Key'),'key');
      return Response.json({total:2,novos:1,atualizados:0,ignorados:0,invalidos:1,detalhes:[]});
    }
    assert.equal(options.body.get('arquivo').name,'calendario.pdf');
    return Response.json({status:'PREVIA',token:'token',validos:1,total:2,novos:0,atualizados:0,ignorados:0,invalidos:1,detalhes:[{linha:1,pagina:2,origem:'OCR',texto:'21/04/2027 Tiradentes',status:'REVISAR',motivo:'Confira'}]});
  });
  const report=await importCalendar(new File(['pdf'],'calendario.pdf',{type:'application/pdf'}));
  assert.equal(report.status,'PREVIA');assert.equal(report.detalhes[0].origem,'OCR');assert.equal(report.detalhes[0].pagina,2);
  assert.equal((await confirmCalendar(report.token,'key')).novos,1);
  await assert.rejects(importCalendar(new File(['x'],'calendario.pdf',{type:'image/png'})),/conteúdo/);
  await assert.rejects(importCalendar(new File(['x'],'calendario.txt')),/xlsx.*pdf/);
  await assert.rejects(importCalendar(new File(['123'],'calendario.pdf',{type:'application/pdf'}),2),/limite/);
});
test('cadastro e edição preservam CPF, jornada 20/40 e acumulação Sim/Não no contrato real',async t=>{
  free();let current={id_servidor:1,nome:'Ana',matricula:'0012345',cpf:'00123456789',email:'a@example.com',departamento:'Ensino',carga_horaria:20,acumula_cargo:false};
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(options.method==='GET'||!options.method)return Response.json([current]);
    const body=JSON.parse(options.body);assert.equal(body.cpf,current.cpf);assert.ok([20,40].includes(body.workload));assert.equal(typeof body.acumula_cargo,'boolean');
    current={...current,carga_horaria:body.workload,acumula_cargo:body.acumula_cargo};return Response.json(current);
  });
  let professor=(await listProfessors())[0];assert.equal(professor.workload,20);assert.equal(professor.accumulatesPosition,false);
  professor=await saveProfessor({...professor,workload:40,accumulatesPosition:true},false);assert.equal(professor.workload,40);assert.equal(professor.accumulatesPosition,true);
  professor=await saveProfessor({...professor,workload:20,accumulatesPosition:false},false);assert.equal(professor.workload,20);assert.equal(professor.accumulatesPosition,false);
});

test('lista de geração oculta quem já tem PDF no mês e conserva histórico/nova versão',async()=>{
  const {generationCandidates}=await import('../lib/generation-selection.ts');
  const people=[{id:'1',name:'Ana'},{id:'2',name:'Bruno'},{id:'3',name:'Carla'}];
  const history=[{id_servidor:1,competencia:'2026-10'},{id_servidor:2,competencia:'2026-09'}];
  assert.deepEqual(generationCandidates(people,history,'2026-10').map(p=>p.id),['2','3']);
  assert.deepEqual(generationCandidates(people,history,'2026-09').map(p=>p.id),['1','3']);
  assert.deepEqual(generationCandidates(people,[...history,{id_servidor:3,competencia:'2026-10'}],'2026-10').map(p=>p.id),['2']);
  assert.equal(generationCandidates(people,history,'2026-10',true).length,3);
  assert.equal(history.length,2);assert.equal(people.length,3);
});

test('substituição anual envia modo/ano, exige prévia e confirma somente o token',async t=>{
  free();let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++;
    if(url.endsWith('/confirm')){
      assert.deepEqual(JSON.parse(options.body),{token:'substituicao'});
      assert.equal(options.headers.get('Idempotency-Key'),'substituir-key');
      return Response.json({modo:'substituir',ano:2026,removidos:10,total:1,novos:1,atualizados:0,ignorados:0,invalidos:0,detalhes:[]});
    }
    assert.equal(options.body.get('modo'),'substituir');assert.equal(options.body.get('ano'),'2026');
    return Response.json({status:'PREVIA',modo:'substituir',ano:2026,existentes_a_remover:10,pode_confirmar:true,token:'substituicao',validos:1,total:1,novos:0,atualizados:0,ignorados:0,invalidos:0,detalhes:[]});
  });
  const report=await importCalendar(new File(['excel'],'novo.xlsx'),15728640,{replaceYear:2026});
  assert.equal(calls,1);assert.equal(report.existentes_a_remover,10);assert.equal(report.status,'PREVIA');
  assert.equal((await confirmCalendar(report.token,'substituir-key')).removidos,10);
  await assert.rejects(importCalendar(new File(['excel'],'novo.xlsx'),15728640,{replaceYear:0}),/ano válido/);
});

test('prévia de envio de modelos usa destinatários do servidor e histórico aceita modelo em branco',async t=>{
  const {previewGeneratedEmails}=await import('../lib/academic-api.ts');
  const {listEmailLogs}=await import('../lib/email-api.ts');
  free();const mock=t.mock.method(globalThis,'fetch',async url=>{
    if(url.startsWith('/api/emails'))return Response.json([{id:10,id_folha:null,id_documento:5,origem:'GERADA',nome:'Ana',matricula:'12345',competencia:'2026-09',status:'ENVIADO',criado_em:'2026-09-01T00:00:00Z',mensagem:''}]);
    assert.equal(url,'/api/academic/folhas/geradas/para-envio?competencia=2026-09');
    return Response.json({competencia:'2026-09',configurado:true,modo_teste:false,destinatario_teste:null,limite_lote:500,documentos:[{id_documento:5,id_servidor:1,nome:'Ana',email:'ana@example.com',competencia:'2026-09',versao:2,apto:true,apto_reenvio:true,motivo:'',status_envio:null}]});
  });
  assert.equal((await previewGeneratedEmails('2026-09')).documentos[0].versao,2);
  assert.equal((await listEmailLogs({nome:'',matricula:'',cpf:'',status:'',competencia:''}))[0].origem,'GERADA');
  mock.mock.mockImplementation(async()=>Response.json({competencia:'2026-09',configurado:true,modo_teste:false,destinatario_teste:null,limite_lote:500,documentos:[{id_documento:5,id_servidor:1,nome:'Ana',email:'ana@example.com',competencia:'2026-09',versao:2,apto:false,motivo:'Já enviado ou em processamento.',status_envio:'ENVIADO'}]}));
  assert.equal((await previewGeneratedEmails('2026-09')).documentos[0].apto,false);
  mock.mock.mockImplementation(async()=>Response.json({competencia:'2026-09',documentos:[]}));
  await assert.rejects(previewGeneratedEmails('2026-09'),/inesperada/);
});
test('uma ação envia modelos sequencialmente, mostra progresso e repete as mesmas chaves ao retomar',async t=>{
  const {sendGeneratedEmails}=await import('../lib/academic-api.ts');
  free();const keys=[];let failure=true;const effects=new Set();
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url.startsWith('/api/system/lock'))return Response.json({locked:false,holder:true,expires_at:new Date(Date.now()+45000).toISOString()});
    assert.equal(url,'/api/academic/folhas/geradas/enviar-lote');
    const body=JSON.parse(options.body);assert.equal(body.competencia,'2026-09');assert.equal(body.ids_documentos.length,1);
    const id=body.ids_documentos[0];keys.push(options.headers.get('Idempotency-Key'));
    if(id===2 && failure){failure=false;throw new TypeError('Conexão interrompida');}
    effects.add(id);
    return Response.json({total:1,enviados:1,ignorados:0,falhas:0,detalhes:[{id_documento:id,status:'ENVIADO',mensagem:''}]});
  });
  const progress=[];
  await assert.rejects(sendGeneratedEmails([1,2],'2026-09','key',500,r=>progress.push(r.enviados)),/Continuar envio/);
  assert.deepEqual(progress,[0,1]);
  assert.equal((await sendGeneratedEmails([1,2],'2026-09','key',500)).enviados,2);
  assert.deepEqual(keys,['key:1','key:2','key:1','key:2']);assert.equal(effects.size,2);
  await assert.rejects(sendGeneratedEmails([1,1],'2026-09','key',500),/distintos/);
});

test('reenvio de modelos envia autorização explícita e conserva a chave ao retomar',async t=>{
  const {sendGeneratedEmails}=await import('../lib/academic-api.ts');
  free();const keys=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url.startsWith('/api/system/lock'))return Response.json({locked:false,holder:true,expires_at:new Date(Date.now()+45000).toISOString()});
    const payload=JSON.parse(options.body);assert.equal(payload.reenviar,true);
    keys.push(options.headers.get('Idempotency-Key'));
    return Response.json({total:1,enviados:1,ignorados:0,falhas:0,detalhes:[{id_documento:1,status:'ENVIADO',mensagem:''}]});
  });
  await sendGeneratedEmails([1],'2026-09','reenvio',500,undefined,true);
  await sendGeneratedEmails([1],'2026-09','reenvio',500,undefined,true);
  assert.deepEqual(keys,['reenvio:1','reenvio:1']);
});
