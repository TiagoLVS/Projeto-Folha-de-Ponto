import { apiRequest } from './api-client.ts';
import type { Professor } from './ponto.ts';
type ServerProfessor = { id_servidor: number; nome: string; matricula: string; cpf?: string | null; acumula_cargo?: boolean; ua?: string | null; cargo?: string | null; padrao?: string | null; funcao?: string | null; exercicio?: string | null; email: string | null; departamento: string | null; carga_horaria: number | null };
function fromServer(data: ServerProfessor): Professor {
  if (!Number.isSafeInteger(data.id_servidor) || typeof data.nome !== 'string' || typeof data.matricula !== 'string') throw new Error('Cadastro inválido retornado pelo backend.');
  return { id: String(data.id_servidor), name: data.nome, registration: data.matricula, cpf: data.cpf ?? null, accumulatesPosition: data.acumula_cargo ?? false, email: data.email ?? '', department: data.departamento ?? '', workload: data.carga_horaria ?? null, ua: data.ua ?? null, cargo: data.cargo ?? null, padrao: data.padrao ?? null, funcao: data.funcao ?? null, exercicio: data.exercicio ?? null, sheets: {} };
}
export async function listProfessors(): Promise<Professor[]> {
  const data = await apiRequest<ServerProfessor[]>('/api/servers');
  if (!Array.isArray(data)) throw new Error('Lista de servidores inválida.');
  return data.map(fromServer);
}
export async function saveProfessor(professor: Professor, isNew: boolean): Promise<Professor> {
  const data = await apiRequest<ServerProfessor>(isNew ? '/api/servers' : `/api/servers/${encodeURIComponent(professor.id)}`, {
    method: isNew ? 'POST' : 'PUT', body: JSON.stringify({ name: professor.name, registration: professor.registration, cpf: professor.cpf, acumula_cargo: professor.accumulatesPosition ?? false, email: professor.email, department: professor.department, workload: professor.workload, ua: professor.ua ?? null, cargo: professor.cargo ?? null, padrao: professor.padrao ?? null, funcao: professor.funcao ?? null, exercicio: professor.exercicio ?? null }),
  });
  return { ...fromServer(data), sheets: professor.sheets };
}
export async function deleteProfessor(id: string): Promise<void> {
  await apiRequest(`/api/servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
