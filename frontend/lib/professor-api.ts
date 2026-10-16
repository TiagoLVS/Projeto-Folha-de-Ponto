import { apiRequest } from './api-client.ts';
import type { Professor } from './ponto.ts';
type ServerProfessor = { id_servidor: number; nome: string; matricula: string; email: string | null; departamento: string | null; carga_horaria: number | null };
function fromServer(data: ServerProfessor): Professor {
  if (!Number.isSafeInteger(data.id_servidor) || typeof data.nome !== 'string' || typeof data.matricula !== 'string') throw new Error('Cadastro inválido retornado pelo backend.');
  return { id: String(data.id_servidor), name: data.nome, registration: data.matricula, email: data.email ?? '', department: data.departamento ?? '', workload: data.carga_horaria ?? null, sheets: {} };
}
export async function listProfessors(): Promise<Professor[]> {
  const data = await apiRequest<ServerProfessor[]>('/api/servers');
  if (!Array.isArray(data)) throw new Error('Lista de servidores inválida.');
  return data.map(fromServer);
}
export async function saveProfessor(professor: Professor, isNew: boolean): Promise<Professor> {
  const data = await apiRequest<ServerProfessor>(isNew ? '/api/servers' : `/api/servers/${encodeURIComponent(professor.id)}`, {
    method: isNew ? 'POST' : 'PUT', body: JSON.stringify({ name: professor.name, registration: professor.registration, email: professor.email, department: professor.department, workload: professor.workload }),
  });
  return { ...fromServer(data), sheets: professor.sheets };
}
export async function deleteProfessor(id: string): Promise<void> {
  await apiRequest(`/api/servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
