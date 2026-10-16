import { apiRequest } from './api-client.ts';
import { validMonth } from './timesheet-api.ts';
export type EmailLog = { id: number; id_folha: number; nome: string; matricula: string; competencia: string; status: 'ENVIADO' | 'ERRO' | 'PROCESSANDO' | 'NAO_CONFIGURADO'; criado_em: string; mensagem: string };
export type EmailFilters = { nome: string; matricula: string; status: string; competencia: string };
export async function listEmailLogs(filters: EmailFilters, signal?: AbortSignal): Promise<EmailLog[]> {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  const data = await apiRequest<EmailLog[]>(`/api/emails?${query}`, { signal });
  if (!Array.isArray(data) || data.some(row => !Number.isSafeInteger(row.id) || !Number.isSafeInteger(row.id_folha) || typeof row.nome !== 'string' || typeof row.matricula !== 'string' || !validMonth(row.competencia) || !['ENVIADO', 'ERRO', 'PROCESSANDO', 'NAO_CONFIGURADO'].includes(row.status) || !Number.isFinite(Date.parse(row.criado_em)) || typeof row.mensagem !== 'string')) throw new Error('Histórico de e-mails inválido.');
  return data;
}
export async function retryEmailErrors(logIds: number[], key: string) {
  if (!logIds.length) throw new Error('Nenhum erro selecionado.');
  const data = await apiRequest<{ reenviados: number; ignorados: number }>('/api/emails/retry', { method: 'POST', body: JSON.stringify({ log_ids: logIds }), headers: { 'Idempotency-Key': key } });
  if (![data.reenviados, data.ignorados].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Resultado de reenvio inválido. Consulte o histórico.');
  return data;
}
