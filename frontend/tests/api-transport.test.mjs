import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, configureApiTransport } from '../lib/api-transport.ts';

test('apiFetch retenta leituras após falha transitória de rede', async t => {
  t.after(() => configureApiTransport(''));
  configureApiTransport('https://ponto.example:5173');
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    attempts++;
    assert.equal(url, 'https://ponto.example:5173/api/auth/status');
    if (attempts < 3) throw new TypeError('falha de rede');
    return Response.json({ authenticated: true });
  });

  const response = await apiFetch('/api/auth/status');
  assert.equal(response.status, 200);
  assert.equal(attempts, 3);
});

test('apiFetch retenta leituras quando o gateway retorna indisponibilidade temporária', async t => {
  t.after(() => configureApiTransport(''));
  configureApiTransport('https://ponto.example:5173');
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    if (attempts === 1) return new Response('indisponível', { status: 502 });
    return Response.json({ authenticated: true });
  });

  const response = await apiFetch('/api/auth/status');
  assert.equal(response.status, 200);
  assert.equal(attempts, 2);
});

test('apiFetch não repete mutações nem requisições canceladas', async t => {
  t.after(() => configureApiTransport(''));
  configureApiTransport('https://ponto.example:5173');
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    throw new TypeError('falha de rede');
  });

  await assert.rejects(apiFetch('/api/timesheets/upload', { method: 'POST' }), /falha de rede/);
  assert.equal(attempts, 1);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(apiFetch('/api/auth/status', { signal: controller.signal }), /falha de rede/);
  assert.equal(attempts, 2);
});
