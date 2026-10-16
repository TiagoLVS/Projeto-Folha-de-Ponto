import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest } from '../lib/api-client.ts';
import { setNetworkLock } from '../lib/network-lock.ts';
import { listTimesheets, attachRemoteSheets, canEmailSheet, uploadDocument } from '../lib/timesheet-api.ts';
import { sendSheetBatch } from '../lib/send-sheets.ts';
const person = { id_servidor: 42, nome: 'Ana', matricula: '12345', email: 'ana@example.com', departamento: 'Ensino', carga_horaria: 40 };
const remote = { id_folha: 77, id_servidor: 42, competencia: '2026-09', status_ocr: 'OK', confirmado_em: '2026-09-01T10:00:00Z', atualizado_em: '2026-09-01T10:00:00Z', nome_arquivo: 'folha.pdf', tamanho_arquivo: 12 };
const professor = { id: '42', name: 'Ana', registration: '12345', email: person.email, department: 'Ensino', workload: 40, sheets: {} };

test('histórico remoto permite enviar apenas a seleção validada e conserva o protocolo do lote', async t => {
  setNetworkLock({ locked: false, unavailable: false, checked: true });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url, options]);
    if (url === '/api/servers') return Response.json([person]);
    if (url === '/api/timesheets') { assert.equal(options.cache, 'no-store'); return Response.json([remote]); }
    assert.equal(url, '/api/timesheets/send');
    assert.deepEqual(JSON.parse(options.body), { month: '2026-09', professorIds: ['42'] });
    assert.equal(options.headers.get('Idempotency-Key'), 'batch-1');
    return Response.json({ jobId: 'batch-1', status: 'completed', sentCount: 1 });
  });
  const records = attachRemoteSheets([professor], await listTimesheets());
  assert.equal(canEmailSheet(records[0].sheets['2026-09']), true);
  assert.equal(records[0].sheets['2026-09'].attachment.url, '/api/timesheets/77/file');
  assert.equal((await sendSheetBatch({ month: '2026-09', professorIds: ['42'] }, 'batch-1')).sentCount, 1);
  assert.equal(calls.filter(([url]) => url === '/api/timesheets/send').length, 1);
});

test('folha não validada, arquivo disfarçado, conflito e lock não viram sucesso nem sobrescrita automática', async t => {
  setNetworkLock({ locked: false, unavailable: false, checked: true });
  t.after(() => setNetworkLock({ locked: false, unavailable: false, checked: true }));
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/servers') return Response.json([person]);
    if (url === '/api/timesheets') return Response.json([{ ...remote, status_ocr: 'REVISAR' }]);
    writes++;
    assert.equal(options.body.get('sobrescrever'), 'false');
    return Response.json({ detail: 'Já existe uma folha.', id_folha_existente: 77 }, { status: 409 });
  });
  await assert.rejects(sendSheetBatch({ month: '2026-09', professorIds: ['42'] }, 'batch-2'), /não estão validadas/);
  await assert.rejects(uploadDocument(new File(['fake'], 'folha.pdf', { type: 'application/pdf' }), '42', '2026-09'), /não é um PDF/);
  assert.equal(writes, 0);
  await assert.rejects(uploadDocument(new File(['%PDF-1.7\n'], 'folha.pdf', { type: 'application/pdf' }), '42', '2026-09'), error => error.status === 409);
  assert.equal(writes, 1);
  setNetworkLock({ locked: true, unavailable: false, checked: true });
  await assert.rejects(apiRequest('/api/timesheets/77', { method: 'DELETE' }), error => error.status === 423);
  assert.equal(writes, 1);
});
