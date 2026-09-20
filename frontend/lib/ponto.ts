export type TimesheetStatus = "missing" | "uploaded" | "processing" | "identified" | "error";
export type IdentifiedTimesheetData = { professorName?: string; registration?: string; competence?: string };
export type SheetAttachment = { name: string; type: string; size: number; url: string };
export type Sheet = { id: string; status: TimesheetStatus; updatedAt: string; attachment: SheetAttachment; identifiedData?: IdentifiedTimesheetData; confirmedAt?: string; identificationSource?: "api" | "manual"; error?: string };
export type Professor = { id: string; name: string; registration: string; email: string; department: string; sheets: Record<string, Sheet> };
export const statusLabels = { missing: "Sem folha", uploaded: "Enviada", processing: "Processando", identified: "Identificada", error: "Erro na leitura" } as const;
export type Status = typeof statusLabels[TimesheetStatus];
export function sheetStatus(sheet?: Sheet): Status { return statusLabels[sheet?.status ?? "missing"]; }
export function monthLabel(month: string) { const [year, m] = month.split("-").map(Number); return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, m - 1, 1))).replace(/^./, c => c.toUpperCase()); }
export function createDemoData(): Professor[] {
  const people = [["Ana Souza", "Ciências da Educação"], ["Carlos Lima", "Tecnologia da Informação"], ["Mariana Alves", "Ciências da Saúde"], ["Pedro Santos", "Ciências Humanas"], ["Beatriz Costa", "Gestão e Negócios"], ["Lucas Ferreira", "Ciências Exatas"], ["Juliana Rocha", "Ciências da Educação"], ["Rafael Oliveira", "Tecnologia da Informação"]];
  return people.map(([name, department], i) => {
    return { id: String(i + 1), name, department, registration: String(20261001 + i), email: name.toLowerCase().replace(/ /g, ".") + "@example.com", sheets: {} };
  });
}
