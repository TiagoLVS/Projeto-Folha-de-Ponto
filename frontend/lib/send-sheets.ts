export type SheetBatch = { month: string; professorIds: string[] };
export type BatchReceipt = { jobId: string; status: "queued"; acceptedCount: number };

/** One authenticated request per batch. The server sends a separate attachment to each recipient. */
export async function sendSheetBatch(batch: SheetBatch, idempotencyKey: string): Promise<BatchReceipt> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(batch.month) || !batch.professorIds.length) {
    throw new Error("Selecione a competência e pelo menos um professor.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("/api/folhas/enviar-lote", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(batch),
      signal: controller.signal,
    });
    if (response.status === 404 || response.status === 405 || response.status === 501) {
      throw new Error("O serviço de envio ainda não está conectado. Nenhum envio foi confirmado.");
    }
    if (response.status === 401 || response.status === 403) throw new Error("Entre com uma conta autorizada para enviar as folhas.");
    if (!response.ok) throw new Error("Não foi possível confirmar o lote. Tente novamente; a mesma chave será reutilizada para evitar duplicação.");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("status" in data) || data.status !== "queued" || !("jobId" in data) || typeof data.jobId !== "string" || !data.jobId || !("acceptedCount" in data) || data.acceptedCount !== batch.professorIds.length) {
      throw new Error("O serviço retornou uma confirmação inválida. O envio não pode ser confirmado.");
    }
    return data as BatchReceipt;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("O serviço demorou a responder. Tente novamente para consultar o mesmo lote sem duplicá-lo.");
    if (error instanceof TypeError) throw new Error("Sem conexão com o serviço de envio. Tente novamente.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
