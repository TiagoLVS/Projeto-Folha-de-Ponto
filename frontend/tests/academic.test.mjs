import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listEvents, saveEvent, deleteEvent, importCalendar, generateSheets, listGenerated, fetchDownload } from '../lib/academic-api.ts';
import { GET, POST, DELETE } from '../app/api/academic/[...path]/route.ts';
const event = { id_data_especial: 1, data: '2027-02-15', especificacao: 'Recesso', tipo: 'RECESSO' };
const doc = { id_documento: 1, id_servidor: 42, versao: 1, competencia: '2027-02', nome_arquivo: 'folha.pdf', gerado_em: '2027-02-01T00:00:00Z', dados_professor: { nome: 'Ana', matricula: '12345' }, situacao: 'MODELO_EM_BRANCO' };

test('calendário consulta filtros reais, salva e exclui com 204', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (opts.method === 'DELETE') return new Response(null, { status: 204 });
    if (opts.method === 'PUT') { assert.equal(JSON.parse(opts.body).tipo, 'RECESSO'); return Response.json(event); }
    assert.match(url, /ano=2027&mes=2&tipo=RECESSO/);
    return Response.json([event]);
  });
  assert.deepEqual(await listEvents({ ano: 2027, mes: 2, tipo: 'RECESSO' }), [event]);
  assert.deepEqual(await saveEvent({ data: event.data, especificacao: event.especificacao, tipo: event.tipo }, 1), event);
  await deleteEvent(1);
  assert.equal(mock.mock.callCount(), 3);
});

test('respostas inválidas e erros de validação são visíveis', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ unexpected: true }));
  await assert.rejects(listEvents({}), /inesperada/);
  await assert.rejects(listGenerated('2027-02'), /inesperada/);
  mock.mock.mockImplementation(async () => Response.json({ detail: [{ msg: 'Data inválida' }] }, { status: 422 }));
  await assert.rejects(saveEvent(event), /Data inválida/);
});

test('importação usa multipart, aceita resumo parcial e rejeita xls e tamanho excedido', async t => {
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    assert.equal(url, '/api/academic/datas-especiais/importar');
    assert.equal(opts.body.get('arquivo').name, 'calendario.xlsx');
    return Response.json({ total: 2, novos: 1, atualizados: 0, ignorados: 0, invalidos: 1, detalhes: [{ linha: 3, status: 'INVALIDO', motivo: 'Data inválida' }] });
  });
  assert.equal((await importCalendar(new File(['xlsx'], 'calendario.xlsx'))).invalidos, 1);
  await assert.rejects(importCalendar(new File(['xls'], 'calendario.xls')), /xlsx/);
  await assert.rejects(importCalendar({ name: 'grande.xlsx', size: 15 * 1024 * 1024 + 1 }), /15 MB/);
});

test('geração individual e lote distinguem conflitos de resultados parciais', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const payload = JSON.parse(opts.body);
    assert.equal(payload.competencia, '2027-02');
    assert.equal(payload.nova_versao, false);
    return Response.json(url.endsWith('gerar') ? doc : { total: 2, gerados: 1, nao_gerados: 1, documentos: [doc], falhas: [{ id_servidor: 99, motivo: 'Professor não encontrado.' }] });
  });
  assert.equal((await generateSheets([42], '2027-02', false)).gerados, 1);
  assert.equal((await generateSheets([42, 99], '2027-02', false)).nao_gerados, 1);
  mock.mock.mockImplementation(async () => Response.json({ detail: 'Já existe modelo' }, { status: 409 }));
  await assert.rejects(generateSheets([42], '2027-02', false), /Já existe/);
});

test('downloads conferem erros e tipo antes de salvar PDF ou ZIP', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async url => new Response('arquivo', { headers: { 'content-type': url.endsWith('download-lote') ? 'application/zip' : 'application/pdf' } }));
  assert.equal((await fetchDownload([1])).type, 'application/pdf');
  assert.equal((await fetchDownload([1, 2], true)).type, 'application/zip');
  mock.mock.mockImplementation(async () => Response.json({ detail: 'Arquivo indisponível' }, { status: 404 }));
  await assert.rejects(fetchDownload([1]), /indisponível/);
  mock.mock.mockImplementation(async () => new Response('<html>erro</html>'));
  await assert.rejects(fetchDownload([1]), /inesperada/);
});

test('proxy preserva query, multipart, binários e 204 e restringe destinos', async t => {
  const context = path => ({ params: Promise.resolve({ path: path.split('/') }) });
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /\/datas-especiais\?ano=2027$/);
    assert.equal(options.method, 'GET');
    return Response.json([event]);
  });
  const result = await GET(new Request('http://localhost/api/academic/datas-especiais?ano=2027'), context('datas-especiais'));
  assert.deepEqual(await result.json(), [event]);
  mock.mock.mockImplementation(async (url, options) => {
    assert.match(options.headers.get('content-type'), /multipart\/form-data/);
    assert.ok(options.body.byteLength > 0);
    return Response.json({ total: 0 });
  });
  const form = new FormData(); form.append('arquivo', new File(['excel'], 'a.xlsx'));
  assert.equal((await POST(new Request('http://localhost/api/academic/datas-especiais/importar', { method: 'POST', body: form }), context('datas-especiais/importar'))).status, 200);
  mock.mock.mockImplementation(async () => new Response(null, { status: 204 }));
  assert.equal((await DELETE(new Request('http://localhost/api/academic/datas-especiais/1', { method: 'DELETE' }), context('datas-especiais/1'))).status, 204);
  mock.mock.mockImplementation(async () => new Response('%PDF', { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename=folha.pdf' } }));
  const pdf = await GET(new Request('http://localhost/api/academic/folhas/geradas/1/download'), context('folhas/geradas/1/download'));
  assert.equal(await pdf.text(), '%PDF');
  assert.match(pdf.headers.get('content-disposition'), /attachment/);
  assert.equal((await GET(new Request('http://localhost/api/academic/qualquer'), context('../servidores'))).status, 404);
});
