import { proxyBackend } from '@/lib/backend-proxy';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyBackend(`/calendario/${encodeURIComponent(id)}`, request);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyBackend(`/calendario/${encodeURIComponent(id)}`, request);
}

