import { apiRequest } from './api-client.ts';
import type { ConfirmationEmail, Professor, Sheet } from './ponto.ts';

// The supplied PostgreSQL schema and confirmation endpoint use OK for validated sheets.
// Set NEXT_PUBLIC_VALIDATED_OCR_STATUS only if the backend contract changes; never trim its value.
export const VALIDATED_OCR_STATUS = process.env.NEXT_PUBLIC_VALIDATED_OCR_STATUS ?? 'OK';
export const validMonth = (month: string) => /^(20\d{2})-(0[1-9]|1[0-2])$/.test(month);
export function canEmailSheet(sheet?: Sheet): boolean {
  return !!sheet?.backendId && !!sheet.confirmedAt && sheet.statusOcr === VALIDATED_OCR_STATUS;
}
export async function validatePdf(file: File) {
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) throw new Error('Selecione exclusivamente arquivos .pdf.');
  if (!file.size || file.size > 15 * 1024 * 1024) throw new Error('Cada PDF deve ter conteúdo e no máximo 15 MB.');
  if (await file.slice(0, 5).text() !== '%PDF-') throw new Error(`O conteúdo de ${file.name} não é um PDF válido.`);
}
export type RemoteSheet = {
  id_folha: number; id_servidor: number; competencia: string; status_ocr: string;
  nome_arquivo: string; tamanho_arquivo: number; atualizado_em: string; confirmado_em?: string | null;
  mensagem?: string | null; matricula?: string | null; servidor?: { nome?: string | null };
  envio?: ConfirmationEmail;
};
export function fromRemoteSheet(data: RemoteSheet): Sheet {
  if (!Number.isSafeInteger(data.id_folha) || data.id_folha <= 0 || !validMonth(data.competencia)
    || typeof data.nome_arquivo !== 'string' || typeof data.status_ocr !== 'string'
    || !Number.isSafeInteger(data.id_servidor) || data.id_servidor <= 0
    || !Number.isFinite(data.tamanho_arquivo) || data.tamanho_arquivo < 0
    || !Number.isFinite(Date.parse(data.atualizado_em))) throw new Error('Registro de folha inválido no servidor.');
  return {
    id: String(data.id_folha), backendId: data.id_folha, statusOcr: data.status_ocr,
    status: data.status_ocr === VALIDATED_OCR_STATUS || data.status_ocr === 'OK' ? 'identified'
      : data.status_ocr === 'PROCESSANDO' ? 'processing'
      : ['ERRO', 'REVISAR'].includes(data.status_ocr) ? 'error' : 'uploaded',
    attachment: { name: data.nome_arquivo, size: data.tamanho_arquivo, type: 'application/pdf', url: `/api/timesheets/${data.id_folha}/file` },
    updatedAt: data.atualizado_em, confirmedAt: data.confirmado_em ?? undefined, email: data.envio,
    error: data.mensagem ?? undefined,
    identifiedData: { professorName: data.servidor?.nome ?? undefined, registration: data.matricula ?? undefined, competence: data.competencia },
  };
}
export async function listTimesheets(professorId?: string): Promise<RemoteSheet[]> {
  const query = professorId ? `?id_servidor=${encodeURIComponent(professorId)}` : '';
  const data = await apiRequest<RemoteSheet[]>(`/api/timesheets${query}`);
  if (!Array.isArray(data)) throw new Error('Histórico de folhas inválido.');
  data.forEach(fromRemoteSheet);
  return data;
}
export function attachRemoteSheets(professors: Professor[], sheets: RemoteSheet[]): Professor[] {
  const byId = new Map(professors.map(p => [p.id, { ...p, sheets: {} as Professor['sheets'] }]));
  for (const data of sheets) {
    const p = byId.get(String(data.id_servidor));
    if (!p) continue;
    if (p.sheets[data.competencia]) throw new Error('O backend retornou folhas duplicadas para a mesma matrícula e competência.');
    p.sheets[data.competencia] = fromRemoteSheet(data);
  }
  return [...byId.values()];
}
export async function uploadDocument(file: File, professorId: string, month: string, existingId?: number, key = crypto.randomUUID()): Promise<Sheet> {
  await validatePdf(file);
  if (!validMonth(month) || !/^\d+$/.test(professorId)) throw new Error('Selecione o servidor e uma competência válida.');
  const form = new FormData();
  form.append('arquivo', file, file.name);
  form.append('id_servidor', professorId);
  form.append('competencia', month);
  form.append('sobrescrever', existingId === undefined ? 'false' : 'true');
  if (existingId !== undefined) form.append('id_folha_existente', String(existingId));
  const data = await apiRequest<RemoteSheet>('/api/timesheets/upload', { method: 'POST', body: form, headers: { 'Idempotency-Key': key } });
  if (String(data.id_servidor) !== professorId || data.competencia !== month) throw new Error('O servidor retornou uma folha de outro vínculo. Recarregue o histórico.');
  return fromRemoteSheet(data);
}
export async function deleteDocument(id: number): Promise<void> {
  await apiRequest(`/api/timesheets/${id}`, { method: 'DELETE' });
}
export async function processDocument(sheet: Sheet, signal: AbortSignal): Promise<Sheet> {
  if (!sheet.backendId) throw new Error('Guarde o documento no servidor antes de processar.');
  const data = await apiRequest<RemoteSheet>(`/api/timesheets/${sheet.backendId}/process`, { method: 'POST', signal });
  if (data.id_folha !== sheet.backendId) throw new Error('O backend processou um documento diferente.');
  return fromRemoteSheet(data);
}
export async function confirmDocument(backendId: number, professorId: string, competence: string, existingId?: number): Promise<Sheet> {
  const data = await apiRequest<RemoteSheet>(`/api/timesheets/${backendId}`, {
    method: 'PATCH', body: JSON.stringify({ id_servidor: Number(professorId), competencia: competence,
      ...(existingId !== undefined && { sobrescrever: true, id_folha_existente: existingId }) }),
  });
  if (data.id_folha !== backendId || data.id_servidor !== Number(professorId) || data.competencia !== competence
    || data.status_ocr !== VALIDATED_OCR_STATUS || !data.confirmado_em) throw new Error('O backend não confirmou a validação e o vínculo solicitado. Recarregue o histórico.');
  return fromRemoteSheet(data);
}
