import { apiRequest } from './api-client.ts';
import { attachRemoteSheets, canEmailSheet, listTimesheets, validMonth } from './timesheet-api.ts';
import { listProfessors } from './professor-api.ts';
export type SheetBatch = { month: string; professorIds: string[] };
export type BatchReceipt = { jobId: string; status: 'completed'; sentCount: number };
const signature = (batch: SheetBatch) => JSON.stringify({ month: batch.month, professorIds: [...batch.professorIds].sort() });
export function getBatchKey(batch: SheetBatch): string {
  try {
    const storageKey = `ponto-docente:envio:${signature(batch)}`;
    const saved = sessionStorage.getItem(storageKey);
    if (saved) return saved;
    const key = crypto.randomUUID(); sessionStorage.setItem(storageKey, key); return key;
  } catch { return crypto.randomUUID(); }
}
function finishBatch(batch: SheetBatch) {
  try { sessionStorage.removeItem(`ponto-docente:envio:${signature(batch)}`); } catch { /* Storage is optional. */ }
}
export async function sendSheetBatch(batch: SheetBatch, idempotencyKey: string): Promise<BatchReceipt> {
  if (!validMonth(batch.month) || !batch.professorIds.length || new Set(batch.professorIds).size !== batch.professorIds.length) throw new Error('Selecione uma competência válida e servidores distintos.');
  // Revalidate against remote records just before sending; a prior screen snapshot is insufficient.
  const [people, documents] = await Promise.all([listProfessors(), listTimesheets()]);
  const records = attachRemoteSheets(people, documents);
  if (batch.professorIds.some(id => !records.some(p => p.id === id && p.email && canEmailSheet(p.sheets[batch.month])))) throw new Error('Uma ou mais folhas não estão validadas e vinculadas. Atualize o histórico antes de enviar.');
  try {
    const data = await apiRequest<BatchReceipt>('/api/timesheets/send', {
      method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(batch), signal: AbortSignal.timeout(20000),
    });
    if (data.status !== 'completed' || typeof data.jobId !== 'string' || !data.jobId || data.sentCount !== batch.professorIds.length) throw new Error('O serviço retornou uma confirmação inválida. O envio não pode ser confirmado.');
    finishBatch(batch);
    return data;
  } catch (error) {
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new Error('O serviço demorou mais de 20 segundos. O envio pode continuar no servidor; tente novamente para consultar o mesmo lote.');
    if (error instanceof TypeError) throw new Error('Sem conexão com o serviço de envio.');
    throw error;
  }
}
