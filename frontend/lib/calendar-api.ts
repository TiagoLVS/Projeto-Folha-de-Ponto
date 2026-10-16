import { apiRequest } from './api-client.ts';
export type CalendarEntry = { id: number; titulo: string; tipo: 'FERIADO' | 'RECESSO' | 'PONTO_FACULTATIVO'; inicio: string; fim: string };
export type CalendarDraft = Omit<CalendarEntry, 'id'>;
function validEntry(entry: CalendarEntry): boolean {
  return Number.isSafeInteger(entry.id) && entry.id > 0 && typeof entry.titulo === 'string'
    && ['FERIADO', 'RECESSO', 'PONTO_FACULTATIVO'].includes(entry.tipo)
    && /^20\d{2}-\d{2}-\d{2}$/.test(entry.inicio) && /^20\d{2}-\d{2}-\d{2}$/.test(entry.fim)
    && Number.isFinite(Date.parse(entry.inicio)) && Number.isFinite(Date.parse(entry.fim)) && entry.fim >= entry.inicio;
}
export async function listCalendar(): Promise<CalendarEntry[]> {
  const data = await apiRequest<CalendarEntry[]>('/api/calendar');
  if (!Array.isArray(data) || data.some(entry => !validEntry(entry))) throw new Error('Calendário inválido.');
  return data;
}
export async function saveCalendar(data: CalendarDraft, id?: number) {
  const result = await apiRequest<CalendarEntry>(id ? `/api/calendar/${id}` : '/api/calendar', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
  if (!validEntry(result)) throw new Error('Evento inválido retornado pelo backend.');
  return result;
}
export function deleteCalendar(id: number) { return apiRequest<void>(`/api/calendar/${id}`, { method: 'DELETE' }); }
