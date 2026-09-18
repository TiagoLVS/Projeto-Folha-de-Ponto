import type { IdentifiedTimesheetData, Sheet } from './ponto';
// Adapter boundary: recognition stays on the server. No browser OCR or inferred results.
export async function processDocument(sheet: Sheet, signal: AbortSignal): Promise<IdentifiedTimesheetData> {
  const blob = await (await fetch(sheet.attachment.url)).blob();
  const body = new FormData(); body.append('file', blob, sheet.attachment.name); body.append('id', sheet.id);
  const response = await fetch('/api/timesheets/process', { method: 'POST', body, signal, credentials: 'same-origin', headers: { 'Idempotency-Key': sheet.id } });
  if ([404, 405, 501].includes(response.status)) throw new Error('O serviço de leitura ainda não está conectado. Você pode selecionar o professor manualmente.');
  if (!response.ok) throw new Error('Não foi possível identificar os dados da folha. Tente novamente.');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('identifiedData' in data) || !data.identifiedData || typeof data.identifiedData !== 'object') throw new Error('Resposta de leitura inválida.');
  const fields = data.identifiedData as Record<string, unknown>;
  const result: IdentifiedTimesheetData = {};
  for (const key of ['professorName', 'registration', 'competence'] as const) { if (typeof fields[key] === 'string') result[key] = fields[key]; }
  if (!result.professorName && !result.registration && !result.competence) throw new Error('Nenhum dado impresso foi identificado. Selecione o professor manualmente.');
  if (result.competence && !/^\d{4}-(0[1-9]|1[0-2])$/.test(result.competence)) result.competence = undefined;
  return result;
}
