import type { Professor } from './ponto';

type ServerProfessor = {
  id_servidor: number;
  nome: string;
  matricula: string;
  email: string | null;
  departamento: string | null;
  carga_horaria: number | null;
};

function fromServer(data: ServerProfessor): Professor {
  return {
    id: String(data.id_servidor),
    name: data.nome,
    registration: data.matricula,
    email: data.email ?? '',
    department: data.departamento ?? '',
    workload: data.carga_horaria ?? null,
    sheets: {},
  };
}

export async function listProfessors(): Promise<Professor[]> {
  const response = await fetch('/api/servers', { cache: 'no-store' });
  if (!response.ok) throw new Error('Não foi possível carregar os professores do servidor.');
  const data: ServerProfessor[] = await response.json();
  return data.map(fromServer);
}

export async function saveProfessor(professor: Professor, isNew: boolean): Promise<Professor> {
  const response = await fetch(isNew ? '/api/servers' : `/api/servers/${encodeURIComponent(professor.id)}`, {
    method: isNew ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: professor.name,
      registration: professor.registration,
      email: professor.email,
      department: professor.department,
      workload: professor.workload ?? null,
    }),
  });
  const data = await response.json() as ServerProfessor & { detail?: unknown };
  if (!response.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Confira os dados do professor e tente novamente.');
  }
  return { ...fromServer(data), sheets: professor.sheets };
}
