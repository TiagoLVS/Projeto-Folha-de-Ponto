import { proxyBackend } from '@/lib/backend-proxy';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyBackend(`/folhas/${encodeURIComponent(id)}`, request);
}
