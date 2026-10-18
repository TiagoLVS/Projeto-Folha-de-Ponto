import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listProfessors, saveProfessor, deleteProfessor } from '../lib/professor-api.ts';
import { listTimesheets, attachRemoteSheets, processDocument, confirmDocument, uploadDocument, deleteDocument } from '../lib/timesheet-api.ts';
import { setNetworkLock } from '../lib/network-lock.ts';
const server = { id_servidor: 42, nome: 'Ana', matricula: '0012345', cpf: '00123456789', email: 'ana@example.com', departamento: 'Ensino', carga_horaria: 40 };
const remote = { id_folha: 77, id_servidor: 42, competencia: '2026-09', status_ocr: 'REVISAR', nome_arquivo: 'Ana-2026-09.pdf', tamanho_arquivo: 120, atualizado_em: '2026-09-01T00:00:00Z', matricula: '0012345' };
const open = () => setNetworkLock({ locked: false, unavailable: false, checked: true });
test('cadastros e histórico são reconstruídos remotamente', async t => {
  open();
  const mock = t.mock.method(globalThis, 'fetch', async url => Response.json(url === '/api/servers' ? [server] : [remote]));
  const records = attachRemoteSheets(await listProfessors(), await listTimesheets());
  assert.equal(records[0].registration, '0012345');
  assert.equal(records[0].sheets['2026-09'].backendId, 77);
  assert.equal(records[0].sheets['2026-09'].attachment.url, '/api/timesheets/77/file');
  mock.mock.mockImplementation(async () => Response.json({ detail: 'Servidor indisponível' }, { status: 503 }));
  await assert.rejects(listProfessors(), /indisponível/); await assert.rejects(listTimesheets(), /indisponível/);
});
test('edição e exclusão propagam dados e conflitos reais', async t => {
  open();
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json([server]));
  const professor = (await listProfessors())[0];
  mock.mock.mockImplementation(async (url, opts) => {
    assert.equal(url, '/api/servers/42'); assert.equal(opts.method, 'PUT');
    return Response.json({ ...server, nome: 'Ana atualizada', carga_horaria: 20 });
  });
  assert.equal((await saveProfessor({ ...professor, name: 'Ana atualizada', workload: 20 }, false)).workload, 20);
  mock.mock.mockImplementation(async () => Response.json({ detail: 'Servidor possui folhas' }, { status: 409 }));
  await assert.rejects(deleteProfessor('42'), /possui folhas/);
  mock.mock.mockImplementation(async () => new Response(null, { status: 204 })); await deleteProfessor('42');
});
for (const status of ['OK', 'REVISAR', 'ERRO']) test(`OCR por ID conserva resultado ${status}`, async t => {
  open();
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    assert.equal(url, '/api/timesheets/77/process'); assert.equal(opts.method, 'POST');
    return Response.json({ ...remote, status_ocr: status });
  });
  const result = await processDocument({ backendId: 77 }, new AbortController().signal);
  assert.equal(result.backendId, 77); assert.equal(result.statusOcr, status);
});
test('upload exige autorização explícita de substituição e exclusão remota', async t => {
  open(); t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (opts.method === 'DELETE') return new Response(null, { status: 204 });
    assert.equal(url, '/api/timesheets/upload'); assert.equal(opts.body.get('sobrescrever'), 'true');
    assert.equal(opts.body.get('id_folha_existente'), '76'); assert.equal(opts.body.get('id_servidor'), '42');
    return Response.json(remote, { status: 201 });
  });
  assert.equal((await uploadDocument(new File(['%PDF-1.7'], 'folha.pdf', { type: 'application/pdf' }), '42', '2026-09', 76)).backendId, 77);
  await deleteDocument(77);
});
for (const status of ['ENVIADO', 'ERRO', 'PROCESSANDO', 'NAO_CONFIGURADO']) test(`confirmação conserva resultado de envio ${status}`, async t => {
  open(); t.mock.method(globalThis, 'fetch', async () => Response.json({ ...remote, status_ocr: 'OK', confirmado_em: '2026-09-01T01:00:00Z', envio: { status, mensagem: 'Resultado' } }));
  const result = await confirmDocument(77, '42', '2026-09'); assert.equal(result.email.status, status); assert.ok(result.confirmedAt);
});
test('respostas incompletas e conflitos não confirmam vínculo', async t => {
  open(); const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  await assert.rejects(confirmDocument(77, '42', '2026-09'), /não confirmou/);
  mock.mock.mockImplementation(async () => Response.json({ detail: 'Já existe folha' }, { status: 409 }));
  await assert.rejects(confirmDocument(77, '42', '2026-09'), /Já existe/);
});
