import { apiRequest } from './api-client.ts';
export type ImportRow = { linha: number; nome: string; matricula: string; email?: string; acao: 'novo' | 'atualizado' | 'ignorado'; motivo?: string };
export type ImportPreview = { token: string; registros: ImportRow[]; expira_em: string };
export async function previewServerImport(file: File): Promise<ImportPreview> {
  if (!/\.xlsx$/i.test(file.name) || !file.size || file.size > 15 * 1024 * 1024) throw new Error('Selecione um arquivo .xlsx de até 15 MB.');
  const form = new FormData(); form.append('arquivo', file, file.name);
  const data = await apiRequest<ImportPreview>('/api/servers/import/preview', { method: 'POST', body: form });
  if (!data.token || !Array.isArray(data.registros) || !Number.isFinite(Date.parse(data.expira_em))
    || data.registros.some(row => !Number.isInteger(row.linha) || typeof row.nome !== 'string' || typeof row.matricula !== 'string' || !['novo', 'atualizado', 'ignorado'].includes(row.acao))) throw new Error('Pré-visualização inválida do servidor.');
  return data;
}
export async function confirmServerImport(preview: ImportPreview, key: string) {
  if (Date.parse(preview.expira_em) <= Date.now()) throw new Error('A pré-visualização expirou. Selecione novamente a planilha.');
  const data = await apiRequest<{ novos: number; atualizados: number; ignorados: number }>('/api/servers/import/confirm', {
    method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ token: preview.token }),
  });
  if (![data.novos, data.atualizados, data.ignorados].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Resultado de importação inválido. Atualize os cadastros.');
  return data;
}
