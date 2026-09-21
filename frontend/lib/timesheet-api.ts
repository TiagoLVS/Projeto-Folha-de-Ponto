import type { IdentifiedTimesheetData, Sheet } from './ponto';

// Adapter boundary: recognition stays on the server.
export async function processDocument(
  sheet: Sheet,
  signal: AbortSignal
): Promise<IdentifiedTimesheetData> {
  const blob = await (await fetch(sheet.attachment.url)).blob();

  const body = new FormData();

  body.append('arquivo', blob, sheet.attachment.name);

  const response = await fetch(
    'http://127.0.0.1:8000/folhas/processar',
    {
      method: 'POST',
      body,
      signal,
    }
  );

  if (!response.ok) {
    throw new Error(
      'Não foi possível processar a folha. Tente novamente.'
    );
  }

  const data: {
    matricula?: string | null;
    competencia?: string | null;
    servidor?: {
      nome?: string | null;
    } | null;
    status_ocr?: string;
    mensagem?: string | null;
  } = await response.json();

  if (data.status_ocr !== 'OK') {
    throw new Error(
      data.mensagem ||
      'Nenhum dado suficiente foi identificado na folha.'
    );
  }

  const result: IdentifiedTimesheetData = {};

  if (data.servidor?.nome) {
    result.professorName = data.servidor.nome;
  }

  if (data.matricula) {
    result.registration = data.matricula;
  }

  if (data.competencia) {
    result.competence = data.competencia;
  }

  if (
    !result.professorName &&
    !result.registration &&
    !result.competence
  ) {
    throw new Error(
      'Nenhum dado impresso foi identificado.'
    );
  }

  return result;
}
