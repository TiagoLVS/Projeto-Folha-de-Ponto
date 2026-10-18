import { refreshSystemLease } from './system-lease.ts';
import { setNetworkLock } from './network-lock.ts';
import { academicTimeout, type AcademicSettings } from './academic-limits.ts';
import { sessionHeaders } from './client-session.ts';
import { mutationsBlocked } from './network-lock.ts';
export const eventTypes = { FERIADO: 'Feriado', RECESSO: 'Recesso', PONTO_FACULTATIVO: 'Ponto facultativo', OUTRO: 'Outro' } as const;
export type EventType = keyof typeof eventTypes;
export type AcademicEvent = { id_data_especial: number; data: string; especificacao: string; tipo: EventType };
export type EventInput = Omit<AcademicEvent, 'id_data_especial'>;
export type ImportReport = { total: number; novos: number; atualizados: number; ignorados: number; invalidos: number; status?: 'PREVIA'; modo?: 'mesclar' | 'substituir'; ano?: number | null; existentes_a_remover?: number; removidos?: number; pode_confirmar?: boolean; motivo_bloqueio?: string; token?: string; validos?: number; expira_em?: string; detalhes: { linha: number; status: string; motivo: string; pagina?: number; texto?: string; origem?: string; data?: string; especificacao?: string }[] };
export type GeneratedSheet = { id_documento: number; id_servidor: number; competencia: string; versao: number; nome_arquivo: string; gerado_em: string; dados_professor: { nome: string; matricula: string }; situacao: string };
export type GenerationReport = { total: number; gerados: number; nao_gerados: number; documentos: GeneratedSheet[]; falhas: { id_servidor: number; motivo: string }[] };
const base = '/api/academic';
const unexpected = () => new Error('O servidor retornou uma resposta inesperada. Recarregue e tente novamente.');

async function checkedResponse(path: string, options?: RequestInit) {
  if (options?.method && options.method !== 'GET' && !path.endsWith('/download-lote') && mutationsBlocked()) throw new Error('Sistema em uso por outro usuário.');
  const response = await fetch(base + path, { cache: 'no-store', ...options, signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(academicTimeout(path))]) : AbortSignal.timeout(academicTimeout(path)), headers: sessionHeaders(options?.headers) });
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
export async function getAcademicSettings(signal?: AbortSignal): Promise<AcademicSettings> {
  const data = await json('/folhas/configuracao', { signal });
  const keys = ['max_generation_batch', 'max_generated_download_batch', 'max_generated_zip_bytes', 'max_upload_bytes'];
  if (!record(data) || !keys.every(k => Number.isSafeInteger(data[k]) && Number(data[k]) > 0)) throw unexpected();
  return data as AcademicSettings;
}
function importReport(data: unknown): ImportReport {
  if (!record(data) || !['total', 'novos', 'atualizados', 'ignorados', 'invalidos'].every(k => Number.isInteger(data[k])) || !Array.isArray(data.detalhes) || !data.detalhes.every(d => record(d) && Number.isInteger(d.linha) && typeof d.status === 'string' && typeof d.motivo === 'string')) throw unexpected();
  if (data.status === 'PREVIA' && (typeof data.token !== 'string' || !Number.isInteger(data.validos))) throw unexpected();
  if (data.modo === 'substituir' && (!Number.isInteger(data.ano) || (data.status === 'PREVIA' && (typeof data.pode_confirmar !== 'boolean' || !Number.isInteger(data.existentes_a_remover))))) throw unexpected();
  return data as ImportReport;
}
export async function importCalendar(file: File, maximumBytes = 15 * 1024 * 1024, options?: { replaceYear: number }): Promise<ImportReport> {
  const pdf = file.name.toLowerCase().endsWith('.pdf');
  if (!pdf && !file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Selecione Excel (.xlsx) ou PDF (.pdf).');
  if (pdf && file.type !== 'application/pdf') throw new Error('Tipo de conteúdo inválido para PDF.');
  if (!pdf && file.type && !['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'].includes(file.type)) throw new Error('Tipo de conteúdo inválido para Excel.');
  if (file.size > maximumBytes) throw new Error(`O limite de upload é ${maximumBytes / (1024 * 1024)} MB.`);
  const form = new FormData(); form.append('arquivo', file);
  if (options) {
    if (!Number.isInteger(options.replaceYear) || options.replaceYear < 2000 || options.replaceYear > 2099) throw new Error('Selecione um ano válido para substituir o calendário.');
    form.append('modo', 'substituir'); form.append('ano', String(options.replaceYear));
  }
  return importReport(await json('/datas-especiais/importar', { method: 'POST', body: form }));
}
export async function confirmCalendar(token: string, key: string): Promise<ImportReport> {
  return importReport(await json('/datas-especiais/importar/confirm', { ...body('POST', { token }), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key } }));
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


export type GeneratedEmailTarget = { id_documento: number; id_servidor: number; nome: string; email: string; competencia: string; versao: number; apto: boolean; apto_reenvio?: boolean; motivo: string; status_envio: string | null };
export type GeneratedEmailPreview = { competencia: string; configurado: boolean; modo_teste: boolean; destinatario_teste: string | null; limite_lote: number; documentos: GeneratedEmailTarget[] };
export type GeneratedEmailResult = { total: number; enviados: number; ignorados: number; falhas: number; detalhes: { id_documento: number; status: string; mensagem: string }[] };
export async function previewGeneratedEmails(month: string): Promise<GeneratedEmailPreview> {
  const data=await json(`/folhas/geradas/para-envio?competencia=${encodeURIComponent(month)}`);
  if (!record(data) || data.competencia!==month || typeof data.configurado!=='boolean' || typeof data.modo_teste!=='boolean' || !Number.isSafeInteger(data.limite_lote) || Number(data.limite_lote)<1 || (data.destinatario_teste!==null && typeof data.destinatario_teste!=='string') || !Array.isArray(data.documentos)
      || !data.documentos.every(d=>record(d) && Number.isSafeInteger(d.id_documento) && Number.isSafeInteger(d.id_servidor) && typeof d.nome==='string' && typeof d.email==='string' && d.competencia===month && typeof d.apto==='boolean' && typeof d.motivo==='string')) throw unexpected();
  return data as GeneratedEmailPreview;
}
export async function sendGeneratedEmails(ids: number[],month: string,key: string,maximum: number,onProgress?: (result: GeneratedEmailResult)=>void,reenviar=false): Promise<GeneratedEmailResult> {
  if (!ids.length || ids.length>maximum || new Set(ids).size!==ids.length || ids.some(id=>!Number.isSafeInteger(id)||id<=0)) throw new Error(`Selecione de 1 a ${maximum} modelos distintos.`);
  let result: GeneratedEmailResult={total:ids.length,enviados:0,ignorados:0,falhas:0,detalhes:[]};
  onProgress?.(result);
  // Uma ação do usuário; cada PDF tem requisição/chave própria, progresso e retomada.
  for (const id of ids) {
    try {
      const lease=await refreshSystemLease();
      setNetworkLock({locked:lease.locked,unavailable:false,checked:true});
      if (lease.locked) throw new Error('Sistema em uso por outro usuário.');
      const data=await json('/folhas/geradas/enviar-lote',{...body('POST',{ids_documentos:[id],competencia:month,...(reenviar ? {reenviar:true} : {})}),headers:{'Content-Type':'application/json','Idempotency-Key':`${key}:${id}`}});
      if (!record(data) || data.total!==1 || !['enviados','ignorados','falhas'].every(k=>Number.isSafeInteger(data[k])&&Number(data[k])>=0) || Number(data.enviados)+Number(data.ignorados)+Number(data.falhas)!==1 || !Array.isArray(data.detalhes) || data.detalhes.length!==1 || !record(data.detalhes[0]) || data.detalhes[0].id_documento!==id || !['ENVIADO','ERRO','IGNORADO'].includes(String(data.detalhes[0].status)) || typeof data.detalhes[0].mensagem!=='string') throw unexpected();
      result={total:ids.length,enviados:result.enviados+Number(data.enviados),ignorados:result.ignorados+Number(data.ignorados),falhas:result.falhas+Number(data.falhas),detalhes:[...result.detalhes,...data.detalhes] as GeneratedEmailResult['detalhes']};
      onProgress?.(result);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : 'Não foi possível concluir o envio.'} Confira o histórico. Use Continuar envio para retomar o mesmo lote sem repetir os envios confirmados.`);
    }
  }
  return result;
}
