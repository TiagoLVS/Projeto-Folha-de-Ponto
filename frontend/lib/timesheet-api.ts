import type { IdentifiedTimesheetData, Sheet } from './ponto';

export type ProcessedDocument = {
  backendId: number;
  status: 'OK' | 'REVISAR' | 'ERRO';
  message?: string;
  identifiedData: IdentifiedTimesheetData;
};

type DocumentResponse = {
  id_folha: number;
  status_ocr: ProcessedDocument['status'];
  mensagem?: string | null;
  matricula?: string | null;
  competencia?: string | null;
  servidor?: { nome?: string | null } | null;
  detail?: unknown;
};

export async function registerDocument(sheet: Sheet): Promise<number> {
  const attachment = await fetch(sheet.attachment.url);
  if (!attachment.ok) throw new Error('Não foi possível ler o documento.');
  const body = new FormData();
  body.append('arquivo', await attachment.blob(), sheet.attachment.name);
  const response = await fetch('/api/timesheets/register', { method: 'POST', body });
  const data = await response.json() as DocumentResponse;
  if (!response.ok || !Number.isSafeInteger(data.id_folha) || data.id_folha <= 0) {
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível guardar o documento no servidor.');
  }
  return data.id_folha;
}

export async function processDocument(sheet: Sheet, signal: AbortSignal): Promise<ProcessedDocument> {
  const attachment = await fetch(sheet.attachment.url, { signal });
  if (!attachment.ok) throw new Error('Não foi possível ler o documento.');
  const body = new FormData();
  body.append('arquivo', await attachment.blob(), sheet.attachment.name);
  const response = await fetch('/api/timesheets/process', { method: 'POST', body, signal });
  if (!response.ok) throw new Error('Não foi possível processar a folha. Tente novamente.');
  const data = await response.json() as DocumentResponse;
  if (!Number.isSafeInteger(data.id_folha) || data.id_folha <= 0 || !['OK', 'REVISAR', 'ERRO'].includes(data.status_ocr)) {
    throw new Error('O servidor não retornou um registro válido para a folha.');
  }
  // Mesmo sem leitura suficiente, o registro já existe e pode ser corrigido.
  return {
    backendId: data.id_folha,
    status: data.status_ocr,
    message: data.mensagem ?? undefined,
    identifiedData: {
      professorName: data.servidor?.nome ?? undefined,
      registration: data.matricula ?? undefined,
      competence: data.competencia ?? undefined,
    },
  };
}

export async function confirmDocument(backendId: number, professorId: string, competence: string) {
  const response = await fetch(`/api/timesheets/${backendId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_servidor: Number(professorId), competencia: competence }),
  });
  const data = await response.json() as { id_folha: number; id_servidor: number; competencia: string; status_ocr: 'OK'; detail?: unknown };
  if (!response.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível confirmar o vínculo. Confira os dados.');
  }
  if (data.id_folha !== backendId || data.id_servidor !== Number(professorId) || data.competencia !== competence || data.status_ocr !== 'OK') {
    throw new Error('O servidor não confirmou o vínculo solicitado. Tente novamente.');
  }
  return data;
}
