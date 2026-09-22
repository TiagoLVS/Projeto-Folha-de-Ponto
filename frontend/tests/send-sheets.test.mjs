import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBatchKey, sendSheetBatch } from '../lib/send-sheets.ts';

const batch = { month: '2026-09', professorIds: ['1', '2'] };

test('envio síncrono reconhece o recibo completed', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/timesheets/send');
    assert.equal(options.headers['Idempotency-Key'], 'lote-1');
    return Response.json({ jobId: 'lote-1', status: 'completed', sentCount: 2 });
  });
  assert.equal((await sendSheetBatch(batch, 'lote-1')).sentCount, 2);
});

test('resposta antiga de fila não é tratada como envio concluído', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ jobId: 'lote-1', status: 'queued', acceptedCount: 2 }));
  await assert.rejects(sendSheetBatch(batch, 'lote-1'), /confirmação inválida/);
});

test('lote em andamento informa a mensagem do backend', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'A requisição original ainda está em processamento.' }, { status: 409 }));
  await assert.rejects(sendSheetBatch(batch, 'lote-1'), /ainda está em processamento/);
});

test('timeout orienta nova consulta e reutiliza a chave', async t => {
  const keys = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    keys.push(options.headers['Idempotency-Key']);
    throw new DOMException('Timeout', 'AbortError');
  });
  await assert.rejects(sendSheetBatch(batch, 'lote-1'), /pode continuar no servidor/);
  await assert.rejects(sendSheetBatch(batch, 'lote-1'), /mesmo lote/);
  assert.deepEqual(keys, ['lote-1', 'lote-1']);
});

test('chave persistida é recuperada para os mesmos professores em outra ordem', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const storage = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else delete globalThis.sessionStorage;
  });
  const key = getBatchKey(batch);
  assert.equal(getBatchKey({ ...batch, professorIds: ['2', '1'] }), key);
  assert.notEqual(getBatchKey({ ...batch, month: '2026-10' }), key);
});
