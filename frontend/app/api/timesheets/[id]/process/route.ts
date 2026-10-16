import { proxyBackend } from '@/lib/backend-proxy';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyBackend(`/folhas/${encodeURIComponent(id)}/processar`, request);
}

