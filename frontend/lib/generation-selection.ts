/** O histórico remoto define quem ainda precisa de uma folha nesta competência. */
export function generationCandidates<T extends { id: string }>(
  professors: T[], documents: { id_servidor: number; competencia: string }[], month: string, newVersion = false,
): T[] {
  if (newVersion) return professors;
  const generated = new Set(documents.filter(doc => doc.competencia === month).map(doc => String(doc.id_servidor)));
  return professors.filter(professor => !generated.has(professor.id));
}
