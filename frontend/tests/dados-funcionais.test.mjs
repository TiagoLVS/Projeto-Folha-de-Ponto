import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listProfessors, saveProfessor } from '../lib/professor-api.ts';
import { setNetworkLock } from '../lib/network-lock.ts';

test('dados funcionais percorrem consulta, cadastro e edição sem confundir exercício com departamento',async t=>{
  setNetworkLock({locked:false,unavailable:false,checked:true});
  const fields={ua:'001 – UnDF',cargo:'PROF-D20',padrao:'PD-4V',funcao:null,exercicio:'Escola Superior de Engenharia, Tecnologia e Inovação'};
  let server={id_servidor:1,nome:'Ana Silva',matricula:'0012345',cpf:'00123456789',email:'ana@example.com',departamento:'Ensino',carga_horaria:40,acumula_cargo:false,...fields};
  const methods=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(!options.method||options.method==='GET')return Response.json([server]);
    methods.push(options.method);
    const body=JSON.parse(options.body);assert.equal(body.department,'Ensino');
    for(const field of Object.keys(fields))assert.ok(Object.hasOwn(body,field));
    server={...server,...Object.fromEntries(Object.keys(fields).map(k=>[k,body[k]]))};
    return Response.json(server);
  });
  let professor=(await listProfessors())[0];
  for(const field of Object.keys(fields))assert.equal(professor[field],fields[field]);
  professor=await saveProfessor(professor,true);
  professor=await saveProfessor({...professor,cargo:'TUT-M40',funcao:'Coordenação',exercicio:null},false);
  assert.equal(professor.cargo,'TUT-M40');assert.equal(professor.funcao,'Coordenação');assert.equal(professor.exercicio,null);
  assert.equal((await listProfessors())[0].funcao,'Coordenação');
  assert.deepEqual(methods,['POST','PUT']);
});
