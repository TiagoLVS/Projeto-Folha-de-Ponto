import { proxyBackend } from '@/lib/backend-proxy';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyBackend(`/folhas/${encodeURIComponent(id)}/arquivo`, request, true);
}

