export type ConfirmationEmail = { status: 'ENVIADO' | 'ERRO' | 'PROCESSANDO' | 'NAO_CONFIGURADO'; mensagem: string };
export type TimesheetStatus = 'missing' | 'uploaded' | 'processing' | 'identified' | 'review' | 'error';
export type IdentifiedTimesheetData = { professorName?: string; registration?: string; competence?: string };
export type SheetAttachment = { name: string; type: string; size: number; url: string };
export type Sheet = { pages?: import('./timesheet-api').PageCandidate[]; id: string; backendId?: number; statusOcr?: string; email?: ConfirmationEmail; status: TimesheetStatus; updatedAt: string; attachment: SheetAttachment; identifiedData?: IdentifiedTimesheetData; confirmedAt?: string; identificationSource?: 'api' | 'manual'; error?: string };
export type Professor = { id: string; name: string; registration: string; cpf: string | null; accumulatesPosition?: boolean; ua?: string | null; cargo?: string | null; padrao?: string | null; funcao?: string | null; exercicio?: string | null; email: string; department: string; workload: number | null; sheets: Record<string, Sheet> };
export const statusLabels = { missing: 'Sem folha', uploaded: 'Enviada', processing: 'Processando', identified: 'Identificada', review: 'Aguardando análise', error: 'Erro na leitura' } as const;
export type Status = typeof statusLabels[TimesheetStatus];
export function sheetStatus(sheet?: Sheet): Status { return statusLabels[sheet?.status ?? 'missing']; }
export type OcrStatus = 'REVISAR' | 'ERRO' | 'PROCESSANDO' | 'OK' | string;
export function timesheetStatusFromOcr(status: OcrStatus, validatedStatus = 'OK'): TimesheetStatus {
  if (status === 'REVISAR') return 'review';
  if (status === 'ERRO') return 'error';
  if (status === 'PROCESSANDO') return 'processing';
  if (status === validatedStatus || status === 'OK') return 'identified';
  return 'uploaded';
}
export function timesheetStatusLabelFromOcr(status: OcrStatus, validatedStatus = 'OK'): Status {
  return statusLabels[timesheetStatusFromOcr(status, validatedStatus)];
}
export type StatusTone = 'done' | 'review' | 'error' | 'progress' | 'empty';
export function statusTone(status: TimesheetStatus | Status): StatusTone {
  if (status === 'identified' || status === 'Identificada') return 'done';
  if (status === 'review' || status === 'Aguardando análise') return 'review';
  if (status === 'error' || status === 'Erro na leitura') return 'error';
  if (status === 'processing' || status === 'Processando' || status === 'Enviada') return 'progress';
  return 'empty';
}
export function matchesSheetStatus(sheet: Sheet | undefined, filter: string): boolean {
  return filter === 'Todas as situações' || sheetStatus(sheet) === filter;
}
export type TimesheetCounts = Record<TimesheetStatus, number>;
export function countSheetStatuses(sheets: Array<Sheet | undefined>): TimesheetCounts {
  const counts: TimesheetCounts = { missing: 0, uploaded: 0, processing: 0, identified: 0, review: 0, error: 0 };
  for (const sheet of sheets) counts[sheet?.status ?? 'missing']++;
  return counts;
}
export function monthLabel(month: string) { const [year, m] = month.split('-').map(Number); return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, m - 1, 1))).replace(/^./, c => c.toUpperCase()); }

export function validEmail(value: string): boolean { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()); }
export function matchesProfessor(professor: Professor, query: string): boolean {
  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const q = normalize(query);
  return normalize(`${professor.name} ${professor.registration} ${professor.cpf ?? ''}`).includes(q)
    || !!professor.cpf && !!query.replace(/\D/g, '') && professor.cpf.includes(query.replace(/\D/g, ''));
}
