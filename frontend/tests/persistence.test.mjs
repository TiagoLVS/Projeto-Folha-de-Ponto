import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listProfessors, saveProfessor } from '../lib/professor-api.ts';
import { processDocument, confirmDocument, registerDocument } from '../lib/timesheet-api.ts';
import { restoreDocuments } from '../lib/document-storage.ts';

const server = { id_servidor: 42, nome: 'Ana', matricula: '12345', email: 'ana@example.com', departamento: 'Ensino', carga_horaria: 40 };
const professor = { id: '42', name: 'Ana', registration: '12345', email: 'ana@example.com', department: 'Ensino', workload: 40, sheets: {} };
const sheet = { id: 'local-id', status: 'uploaded', attachment: { url: 'data:application/pdf;base64,JVBERg==', name: 'folha.pdf', type: 'application/pdf', size: 4 }, updatedAt: '2026-09-01' };

test('cadastros vêm do servidor e falhas não são tratadas como lista vazia', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json([server]));
  assert.deepEqual(await listProfessors(), [professor]);
  assert.equal(fetch.mock.calls[0].arguments[1].cache, 'no-store');
  fetch.mock.mockImplementation(async () => Response.json({ detail: 'offline' }, { status: 502 }));
  await assert.rejects(listProfessors(), /carregar/);
});

test('edição usa ID do banco e adota os dados normalizados retornados', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/servers/42');
    assert.equal(options.method, 'PUT');
    assert.equal(JSON.parse(options.body).name, 'Ana atualizada');
    assert.equal(JSON.parse(options.body).workload, 20);
    return Response.json({ ...server, nome: 'Ana atualizada', email: 'novo@example.com', carga_horaria: 20 });
  });
  const saved = await saveProfessor({ ...professor, name: 'Ana atualizada', workload: 20, sheets: { '2026-09': sheet } }, false);
  assert.equal(saved.email, 'novo@example.com');
  assert.equal(saved.workload, 20);
  assert.equal(saved.sheets['2026-09'], sheet);
});

test('conflito de cadastro é exibido como erro', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'Essa matrícula já está cadastrada.' }, { status: 409 }));
  await assert.rejects(saveProfessor(professor, false), /matrícula/);
});

for (const status of ['OK', 'REVISAR', 'ERRO']) {
  test(`OCR ${status} preserva ID para correção`, async t => {
    t.mock.method(globalThis, 'fetch', async url => url === sheet.attachment.url
      ? new Response('%PDF')
      : Response.json({ id_folha: 77, status_ocr: status, mensagem: 'Conferir', matricula: '12345' }));
    const result = await processDocument(sheet, new AbortController().signal);
    assert.equal(result.backendId, 77);
    assert.equal(result.status, status);
    assert.equal(result.identifiedData.registration, '12345');
  });
}

test('confirmação envia ID real, professor e competência e propaga conflitos', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/timesheets/77');
    assert.equal(options.method, 'PATCH');
    assert.deepEqual(JSON.parse(options.body), { id_servidor: 42, competencia: '2026-09' });
    return Response.json({ detail: 'Já existe uma folha.' }, { status: 409 });
  });
  await assert.rejects(confirmDocument(77, '42', '2026-09'), /Já existe/);
});

test('vínculo sem OCR registra o documento antes de confirmar', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === sheet.attachment.url) return new Response('%PDF');
    assert.equal(url, '/api/timesheets/register');
    assert.equal(options.body.get('arquivo').name, 'folha.pdf');
    return Response.json({ id_folha: 88 }, { status: 201 });
  });
  assert.equal(await registerDocument(sheet), 88);
});

test('cache antigo não sobrescreve cadastro e IDs demo não se misturam aos reais', () => {
  const legacy = [{ ...professor, name: 'Nome local antigo', sheets: { '2026-09': sheet } }];
  assert.equal(restoreDocuments([professor], undefined, legacy)[0].name, 'Ana');
  assert.deepEqual(restoreDocuments([professor], undefined, legacy)[0].sheets['2026-09'], { ...sheet, confirmedAt: undefined });
  assert.deepEqual(restoreDocuments([{ ...professor, registration: '99999' }], undefined, legacy)[0].sheets, {});
  assert.deepEqual(restoreDocuments([], undefined, legacy), []);
});

test('cache de documentos conserva ID após mudança de matrícula no servidor', () => {
  const cached = { '42': { '2026-09': { ...sheet, backendId: 77, status: 'processing' } } };
  const restored = restoreDocuments([{ ...professor, registration: '99999' }], cached)[0];
  assert.equal(restored.registration, '99999');
  assert.equal(restored.sheets['2026-09'].backendId, 77);
  assert.equal(restored.sheets['2026-09'].status, 'error');
});

test('confirmação antiga somente local precisa ser salva no servidor', () => {
  const legacy = [{ ...professor, sheets: { '2026-09': { ...sheet, confirmedAt: '2026-09-22' } } }];
  assert.equal(restoreDocuments([professor], undefined, legacy)[0].sheets['2026-09'].confirmedAt, undefined);
});

test('resposta de sucesso incompleta não confirma vínculo na interface', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  await assert.rejects(confirmDocument(77, '42', '2026-09'), /não confirmou/);
});
