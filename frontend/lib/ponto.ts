export type TimesheetStatus = "missing" | "uploaded" | "processing" | "identified" | "error";
export type IdentifiedTimesheetData = { professorName?: string; registration?: string; competence?: string };
export type SheetAttachment = { name: string; type: string; size: number; url: string };
export type Sheet = { id: string; backendId?: number; status: TimesheetStatus; updatedAt: string; attachment: SheetAttachment; identifiedData?: IdentifiedTimesheetData; confirmedAt?: string; identificationSource?: "api" | "manual"; error?: string };
export type Professor = { id: string; name: string; registration: string; email: string; department: string; workload: number | null; sheets: Record<string, Sheet> };
export const statusLabels = { missing: "Sem folha", uploaded: "Enviada", processing: "Processando", identified: "Identificada", error: "Erro na leitura" } as const;
export type Status = typeof statusLabels[TimesheetStatus];
export function sheetStatus(sheet?: Sheet): Status { return statusLabels[sheet?.status ?? "missing"]; }
export function monthLabel(month: string) { const [year, m] = month.split("-").map(Number); return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, m - 1, 1))).replace(/^./, c => c.toUpperCase()); }
