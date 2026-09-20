import type { Professor } from "./ponto";
export function downloadSheet(p: Professor, month: string) { const file = p.sheets[month]?.attachment; if (!file) return; const a = document.createElement("a"); a.href = file.url; a.download = file.name; a.click(); }
