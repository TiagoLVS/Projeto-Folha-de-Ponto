import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSheetStatuses, matchesSheetStatus, sheetStatus, statusTone, timesheetStatusLabelFromOcr } from '../lib/ponto.ts';
import { canEmailSheet, confirmDocument, fromRemoteSheet } from '../lib/timesheet-api.ts';
import { setNetworkLock } from '../lib/network-lock.ts';

const remote = {
  id_folha: 77,
  id_servidor: 42,
  competencia: '2026-09',
  nome_arquivo: 'folha-sintetica.pdf',
  tamanho_arquivo: 120,
  atualizado_em: '2026-09-01T00:00:00Z',
};

test('REVISAR aguarda análise e ERRO continua marcado como falha', () => {
  const review = fromRemoteSheet({ ...remote, status_ocr: 'REVISAR' });
  const error = fromRemoteSheet({ ...remote, status_ocr: 'ERRO' });
  assert.equal(review.status, 'review');
  assert.equal(sheetStatus(review), 'Aguardando análise');
  assert.equal(statusTone(review.status), 'review');
  assert.equal(error.status, 'error');
  assert.equal(sheetStatus(error), 'Erro na leitura');
  assert.equal(statusTone(error.status), 'error');
});

test('PROCESSANDO e OK mantêm seus rótulos e aparência', () => {
  const processing = fromRemoteSheet({ ...remote, status_ocr: 'PROCESSANDO' });
  const identified = fromRemoteSheet({ ...remote, status_ocr: 'OK' });
  assert.equal(sheetStatus(processing), 'Processando');
  assert.equal(statusTone(processing.status), 'progress');
  assert.equal(sheetStatus(identified), 'Identificada');
  assert.equal(statusTone(identified.status), 'done');
});

test('filtros separam documentos aguardando análise dos que falharam', () => {
  const review = fromRemoteSheet({ ...remote, status_ocr: 'REVISAR' });
  const error = fromRemoteSheet({ ...remote, id_folha: 78, status_ocr: 'ERRO' });
  assert.equal(matchesSheetStatus(review, 'Aguardando análise'), true);
  assert.equal(matchesSheetStatus(review, 'Erro na leitura'), false);
  assert.equal(matchesSheetStatus(error, 'Erro na leitura'), true);
  assert.equal(matchesSheetStatus(error, 'Aguardando análise'), false);
  assert.equal(matchesSheetStatus(review, 'Todas as situações'), true);
  assert.equal(timesheetStatusLabelFromOcr('REVISAR'), 'Aguardando análise');
});

test('contadores mantêm revisão, erro e demais situações em grupos distintos', () => {
  const statuses = ['REVISAR', 'ERRO', 'PROCESSANDO', 'OK', 'DESCONHECIDO']
    .map((status, index) => fromRemoteSheet({ ...remote, id_folha: 80 + index, status_ocr: status }));
  const counts = countSheetStatuses([...statuses, undefined]);
  assert.deepEqual(counts, { missing: 1, uploaded: 1, processing: 1, identified: 1, review: 1, error: 1 });
});

test('documento em revisão requer resposta validada antes de poder ser enviado', async t => {
  setNetworkLock({ locked: false, unavailable: false, checked: true });
  t.after(() => setNetworkLock({ locked: false, unavailable: false, checked: true }));
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...remote, status_ocr: 'REVISAR', confirmado_em: null }));
  const review = fromRemoteSheet({ ...remote, status_ocr: 'REVISAR' });
  assert.equal(canEmailSheet(review), false);
  await assert.rejects(confirmDocument(77, '42', '2026-09'), /não confirmou/);
});

test('envio por e-mail exige folha OK, identificador remoto e confirmação', () => {
  const identified = fromRemoteSheet({ ...remote, status_ocr: 'OK', confirmado_em: '2026-09-01T01:00:00Z' });
  assert.equal(canEmailSheet(identified), true);
  assert.equal(canEmailSheet(fromRemoteSheet({ ...remote, status_ocr: 'OK' })), false);
  assert.equal(canEmailSheet(fromRemoteSheet({ ...remote, status_ocr: 'REVISAR', confirmado_em: '2026-09-01T01:00:00Z' })), false);
  assert.equal(canEmailSheet(fromRemoteSheet({ ...remote, status_ocr: 'ERRO', confirmado_em: '2026-09-01T01:00:00Z' })), false);
  assert.equal(canEmailSheet({ ...identified, backendId: undefined }), false);
});
