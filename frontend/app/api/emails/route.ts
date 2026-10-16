import { proxyBackend } from '@/lib/backend-proxy';

export async function GET(request: Request) {
  return proxyBackend(`/emails/historico` + new URL(request.url).search, request);
}

