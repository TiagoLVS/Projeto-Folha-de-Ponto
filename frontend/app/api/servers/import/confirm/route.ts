import { proxyBackend } from '@/lib/backend-proxy';

export async function POST(request: Request) {
  return proxyBackend(`/servidores/importar/confirm`, request);
}

