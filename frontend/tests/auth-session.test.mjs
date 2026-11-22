import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, configureApiTransport } from '../lib/api-transport.ts';
import { watchForExpiredSession } from '../lib/auth-session.ts';

function installWindow(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  });
  return target;
}

test('401 de rota protegida confirma expiração e retorna ao estado de login', { timeout: 3000 }, async t => {
  installWindow(t);
  t.after(() => configureApiTransport(''));
  configureApiTransport('https://principal.example:5173');
  let view = 'app';
  let message = '';
  let finishCheck;
  const checked = new Promise(resolve => { finishCheck = resolve; });
  const stop = watchForExpiredSession(async () => {
    const response = await apiFetch('/api/auth/status', { credentials: 'same-origin' });
    return await response.json();
  }, () => {
    view = 'login';
    message = 'Sua sessão expirou. Entre novamente.';
    finishCheck();
  });
  t.after(stop);
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/api/auth/status')) return Response.json({ required: true, authenticated: false });
    return Response.json({ detail: 'Faça login.' }, { status: 401 });
  });

  const response = await apiFetch('/api/servers');
  assert.equal(response.status, 401);
  await checked;
  assert.equal(view, 'login');
  assert.equal(message, 'Sua sessão expirou. Entre novamente.');
});

test('login/logout bem-sucedidos e falhas de rede não marcam a sessão como expirada', { timeout: 5000 }, async t => {
  const events = installWindow(t);
  t.after(() => configureApiTransport(''));
  configureApiTransport('https://principal.example:5173');
  let view = 'app';
  let statusChecks = 0;
  const stop = watchForExpiredSession(async () => {
    statusChecks++;
    const response = await apiFetch('/api/auth/status', { credentials: 'same-origin' });
    return await response.json();
  }, () => { view = 'login'; });
  t.after(stop);
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/api/auth/status')) return Response.json({ required: true, authenticated: true });
    if (url.endsWith('/api/servers')) {
      attempts++;
      if (attempts === 1) throw new TypeError('falha temporária');
      return Response.json({ items: [] });
    }
    if (url.endsWith('/api/servers/unauthorized')) return Response.json({ detail: 'Não autorizado.' }, { status: 401 });
    return Response.json({ ok: true });
  });
  let signals = 0;
  events.addEventListener('ponto:session-recheck', () => { signals++; });

  assert.equal((await apiFetch('/api/auth/login', { method: 'POST' })).status, 200);
  assert.equal((await apiFetch('/api/auth/logout', { method: 'POST' })).status, 200);
  assert.equal((await apiFetch('/api/servers')).status, 200);
  assert.equal(attempts, 2);
  assert.equal((await apiFetch('/api/servers/unauthorized')).status, 401);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signals, 1);
  assert.equal(statusChecks, 1);
  assert.equal(view, 'app');
});

test('um 401 de endpoint de autenticação não inicia revalidação nem cria loop', async t => {
  const events = installWindow(t);
  t.after(() => configureApiTransport(''));
  configureApiTransport('https://principal.example:5173');
  let signals = 0;
  events.addEventListener('ponto:session-recheck', () => { signals++; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'Credenciais inválidas.' }, { status: 401 }));

  assert.equal((await apiFetch('/api/auth/login', { method: 'POST' })).status, 401);
  assert.equal((await apiFetch('/api/auth/status')).status, 401);
  assert.equal(signals, 0);
});

test('falha ao revalidar a sessão não é tratada como expiração', async t => {
  const events = installWindow(t);
  let view = 'app';
  const stop = watchForExpiredSession(async () => { throw new TypeError('servidor indisponível'); }, () => { view = 'login'; });
  t.after(stop);

  events.dispatchEvent(new Event('ponto:session-recheck'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view, 'app');
});
