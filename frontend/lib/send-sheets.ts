export function getBatchKey(batch: SheetBatch): string {
  const signature = JSON.stringify({ month: batch.month, professorIds: [...batch.professorIds].sort() });
  const storageKey = `ponto-docente:envio:${signature}`;
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) return saved;
    const key = crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
    return key;
  } catch {
    return crypto.randomUUID();
  }
}

export type SheetBatch = {
  month: string;
  professorIds: string[];
};

export type BatchReceipt = {
  jobId: string;
  status: "completed";
  sentCount: number;
};

/**
 * Envia um lote de folhas.
 * O backend processa os envios durante a própria requisição
 * e só responde quando o processamento termina.
 */
export async function sendSheetBatch(
  batch: SheetBatch,
  idempotencyKey: string
): Promise<BatchReceipt> {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(batch.month) ||
    !batch.professorIds.length
  ) {
    throw new Error(
      "Selecione a competência e pelo menos um professor."
    );
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    20000
  );

  try {
    const response = await fetch(
      "/api/timesheets/send",
      {
        method: "POST",
        credentials: "same-origin",

        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },

        body: JSON.stringify(batch),
        signal: controller.signal,
      }
    );

    if (
      response.status === 404 ||
      response.status === 405 ||
      response.status === 501
    ) {
      throw new Error(
        "O serviço de envio ainda não está conectado. Nenhum envio foi confirmado."
      );
    }

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      throw new Error(
        "Entre com uma conta autorizada para enviar as folhas."
      );
    }

    if (!response.ok) {
      const error = await response.json().catch(() => null) as { detail?: unknown } | null;
      throw new Error(typeof error?.detail === 'string' ? error.detail : "Não foi possível concluir o envio das folhas.");
    }

    const data: unknown = await response.json();

    if (
      !data ||
      typeof data !== "object" ||
      !("status" in data) ||
      data.status !== "completed" ||
      !("jobId" in data) ||
      typeof data.jobId !== "string" ||
      !data.jobId ||
      !("sentCount" in data) ||
      typeof data.sentCount !== "number" ||
      data.sentCount !== batch.professorIds.length
    ) {
      throw new Error(
        "O serviço retornou uma confirmação inválida. O envio não pode ser confirmado."
      );
    }

    return data as BatchReceipt;

  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        "O serviço demorou mais de 20 segundos. O envio pode continuar no servidor; tente novamente para consultar o mesmo lote."
      );
    }

    if (error instanceof TypeError) {
      throw new Error(
        "Sem conexão com o serviço de envio."
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}