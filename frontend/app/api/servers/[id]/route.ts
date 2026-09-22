import { proxyBackend } from '@/lib/backend-proxy';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyBackend(`/servidores/${encodeURIComponent(id)}`, request);
}
