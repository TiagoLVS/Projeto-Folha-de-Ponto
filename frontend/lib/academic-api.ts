export const eventTypes = { FERIADO: 'Feriado', RECESSO: 'Recesso', PONTO_FACULTATIVO: 'Ponto facultativo', OUTRO: 'Outro' } as const;
export type EventType = keyof typeof eventTypes;
export type AcademicEvent = { id_data_especial: number; data: string; especificacao: string; tipo: EventType };
export type EventInput = Omit<AcademicEvent, 'id_data_especial'>;
export type ImportReport = { total: number; novos: number; atualizados: number; ignorados: number; invalidos: number; detalhes: { linha: number; status: string; motivo: string }[] };
export type GeneratedSheet = { id_documento: number; id_servidor: number; competencia: string; versao: number; nome_arquivo: string; gerado_em: string; dados_professor: { nome: string; matricula: string }; situacao: string };
export type GenerationReport = { total: number; gerados: number; nao_gerados: number; documentos: GeneratedSheet[]; falhas: { id_servidor: number; motivo: string }[] };
const base = '/api/academic';
const unexpected = () => new Error('O servidor retornou uma resposta inesperada. Recarregue e tente novamente.');

async function checkedResponse(path: string, options?: RequestInit) {
  const response = await fetch(base + path, { cache: 'no-store', ...options });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = record(body) ? body.detail : undefined;
    throw new Error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map(item => record(item) && typeof item.msg === 'string' ? item.msg : 'Dados inválidos').join('; ') : 'Não foi possível concluir a operação. Tente novamente.');
  }
  return response;
}
async function json(path: string, options?: RequestInit): Promise<unknown> {
  const response = await checkedResponse(path, options);
  return response.json().catch(() => { throw unexpected(); });
}
const body = (method: string, value: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';
const event = (value: unknown): value is AcademicEvent => record(value) && Number.isInteger(value.id_data_especial) && typeof value.data === 'string' && typeof value.especificacao === 'string' && typeof value.tipo === 'string' && Object.hasOwn(eventTypes, value.tipo);
const sheet = (value: unknown): value is GeneratedSheet => record(value) && Number.isInteger(value.id_documento) && Number.isInteger(value.id_servidor) && Number.isInteger(value.versao) && typeof value.competencia === 'string' && typeof value.nome_arquivo === 'string' && typeof value.gerado_em === 'string' && record(value.dados_professor) && typeof value.dados_professor.nome === 'string';

export async function listEvents(filters: { ano?: number; mes?: number; tipo?: string; inicio?: string; fim?: string }, signal?: AbortSignal): Promise<AcademicEvent[]> {
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
  const data = await json(`/datas-especiais?${query}`, { signal });
  if (!Array.isArray(data) || !data.every(event)) throw unexpected();
  return data;
}
export async function saveEvent(value: EventInput, id?: number) {
  const result = await json(`/datas-especiais${id ? `/${id}` : ''}`, body(id ? 'PUT' : 'POST', value));
  if (!event(result)) throw unexpected();
  return result;
}
export async function deleteEvent(id: number) { await checkedResponse(`/datas-especiais/${id}`, { method: 'DELETE' }); }
export async function importCalendar(file: File): Promise<ImportReport> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Selecione uma planilha .xlsx.');
  if (file.size > 15 * 1024 * 1024) throw new Error('O limite de upload é 15 MB.');
  const form = new FormData(); form.append('arquivo', file);
  const data = await json('/datas-especiais/importar', { method: 'POST', body: form });
  if (!record(data) || !['total', 'novos', 'atualizados', 'ignorados', 'invalidos'].every(k => Number.isInteger(data[k])) || !Array.isArray(data.detalhes) || !data.detalhes.every(d => record(d) && Number.isInteger(d.linha) && typeof d.status === 'string' && typeof d.motivo === 'string')) throw unexpected();
  return data as ImportReport;
}
export async function listGenerated(competencia: string, signal?: AbortSignal): Promise<GeneratedSheet[]> {
  const data = await json(`/folhas/geradas?competencia=${encodeURIComponent(competencia)}`, { signal });
  if (!Array.isArray(data) || !data.every(sheet)) throw unexpected();
  return data;
}
export async function generateSheets(ids: number[], competencia: string, nova_versao: boolean): Promise<GenerationReport> {
  if (ids.length === 1) {
    const data = await json('/folhas/gerar', body('POST', { id_servidor: ids[0], competencia, nova_versao }));
    if (!sheet(data)) throw unexpected();
    return { total: 1, gerados: 1, nao_gerados: 0, documentos: [data], falhas: [] };
  }
  const data = await json('/folhas/gerar-lote', body('POST', { ids_servidores: ids, competencia, nova_versao }));
  if (!record(data) || !['total', 'gerados', 'nao_gerados'].every(k => Number.isInteger(data[k])) || !Array.isArray(data.documentos) || !data.documentos.every(sheet) || !Array.isArray(data.falhas) || !data.falhas.every(f => record(f) && Number.isInteger(f.id_servidor) && typeof f.motivo === 'string')) throw unexpected();
  return data as GenerationReport;
}
export async function fetchDownload(ids: number[], zip = false): Promise<Blob> {
  const response = await checkedResponse(zip ? '/folhas/geradas/download-lote' : `/folhas/geradas/${ids[0]}/download`, zip ? body('POST', { ids_documentos: ids }) : undefined);
  if (!response.headers.get('content-type')?.includes(zip ? 'application/zip' : 'application/pdf')) throw unexpected();
  return response.blob();
}
export async function downloadGenerated(ids: number[], filename: string, zip = false) {
  const blob = await fetchDownload(ids, zip);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
