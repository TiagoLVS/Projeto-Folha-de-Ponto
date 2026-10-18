/** Timeouts por operação, compartilhados pelo cliente e pelo proxy Next. */
export const ACADEMIC_TIMEOUTS = { common: 65_000, generation: 900_000, zip: 180_000, calendar: 660_000 };
export function academicTimeout(path: string): number {
  const route = path.split('?')[0];
  if (/\/folhas\/gerar(?:-lote)?$/.test(route) || route.endsWith('/geradas/enviar-lote')) return ACADEMIC_TIMEOUTS.generation;
  if (route.endsWith('/download-lote')) return ACADEMIC_TIMEOUTS.zip;
  if (route.endsWith('/datas-especiais/importar')) return ACADEMIC_TIMEOUTS.calendar;
  return ACADEMIC_TIMEOUTS.common;
}
export type AcademicSettings = { max_generation_batch: number; max_generated_download_batch: number; max_generated_zip_bytes: number; max_upload_bytes: number };
export function addSelection(current: string[], id: string, maximum: number): string[] {
  if (current.includes(id)) return current;
  if (current.length >= maximum) throw new Error(`Selecione no máximo ${maximum} itens por lote. Desmarque um item para continuar.`);
  return [...current, id];
}
export function selectAll(ids: string[], maximum: number): string[] {
  if (ids.length > maximum) throw new Error(`Existem ${ids.length} professores. O limite é ${maximum} por lote; selecione os professores individualmente.`);
  return [...ids];
}
