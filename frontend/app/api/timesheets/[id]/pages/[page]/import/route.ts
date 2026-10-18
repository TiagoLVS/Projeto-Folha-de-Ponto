import { proxyBackend } from '@/lib/backend-proxy';
export async function POST(request: Request, context: { params: Promise<{ id: string; page: string }> }) {
  const { id, page } = await context.params;
  if (!/^\d+$/.test(id) || !/^\d+$/.test(page)) return Response.json({ detail: 'Identificador inválido.' }, { status: 422 });
  return proxyBackend(`/folhas/${id}/paginas/${page}/importar`, request);
}
