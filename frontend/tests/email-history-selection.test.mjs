import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canRetryEmailErrors,
  emailHistoryReducer,
  initialEmailHistoryState,
  retryConfirmationText,
  retryIdempotencyKey,
} from '../lib/email-history-state.ts';

const errors = [
  { id: 10, status: 'ERRO' },
  { id: 11, status: 'ERRO' },
  { id: 12, status: 'ENVIADO' },
];

test('histórico inicial e carregamentos começam sem seleção', () => {
  assert.deepEqual(initialEmailHistoryState, { logs: [], selectedIds: [] });
  const loaded = emailHistoryReducer(initialEmailHistoryState, { type: 'history-loaded', logs: errors });
  assert.deepEqual(loaded.selectedIds, []);
});

test('seleciona um ou vários erros individualmente e permite desmarcar', () => {
  let state = emailHistoryReducer(initialEmailHistoryState, { type: 'history-loaded', logs: errors });
  state = emailHistoryReducer(state, { type: 'toggle', id: 10, checked: true });
  assert.deepEqual(state.selectedIds, [10]);
  state = emailHistoryReducer(state, { type: 'toggle', id: 11, checked: true });
  assert.deepEqual(state.selectedIds, [10, 11]);
  state = emailHistoryReducer(state, { type: 'toggle', id: 10, checked: false });
  assert.deepEqual(state.selectedIds, [11]);
  assert.deepEqual(emailHistoryReducer(state, { type: 'toggle', id: 12, checked: true }).selectedIds, [11]);
});

test('selecionar todos é explícito e pode ser desfeito', () => {
  let state = emailHistoryReducer(initialEmailHistoryState, { type: 'history-loaded', logs: errors });
  state = emailHistoryReducer(state, { type: 'toggle-all-errors', checked: true });
  assert.deepEqual(state.selectedIds, [10, 11]);
  state = emailHistoryReducer(state, { type: 'toggle-all-errors', checked: false });
  assert.deepEqual(state.selectedIds, []);
});

test('mudanças de filtro, atualização e novo carregamento limpam a seleção', () => {
  let state = emailHistoryReducer(initialEmailHistoryState, { type: 'history-loaded', logs: errors });
  state = emailHistoryReducer(state, { type: 'toggle', id: 10, checked: true });
  state = emailHistoryReducer(state, { type: 'filters-changed' });
  assert.deepEqual(state.selectedIds, []);
  state = emailHistoryReducer(state, { type: 'toggle', id: 11, checked: true });
  state = emailHistoryReducer(state, { type: 'history-loaded', logs: errors });
  assert.deepEqual(state.selectedIds, []);
});

test('reenvio exige seleção e a confirmação informa a quantidade exata', () => {
  assert.equal(canRetryEmailErrors(0, false, false, false), false);
  assert.equal(canRetryEmailErrors(1, false, false, false), true);
  assert.equal(canRetryEmailErrors(1, true, false, false), false);
  assert.equal(canRetryEmailErrors(1, false, true, false), false);
  assert.equal(canRetryEmailErrors(1, false, false, true), false);
  assert.match(retryConfirmationText(1), /exatamente 1 mensagem selecionada/);
  assert.match(retryConfirmationText(3), /exatamente 3 mensagens selecionadas/);
});

test('a chave idempotente é reutilizada para a mesma seleção e muda para outro conjunto', () => {
  const keys = new Map();
  let generated = 0;
  const create = () => `retry-${++generated}`;
  assert.equal(retryIdempotencyKey(keys, [11, 10], create), 'retry-1');
  assert.equal(retryIdempotencyKey(keys, [10, 11], create), 'retry-1');
  assert.equal(retryIdempotencyKey(keys, [10], create), 'retry-2');
  assert.equal(generated, 2);
});
