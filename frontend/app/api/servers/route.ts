import { proxyBackend } from '@/lib/backend-proxy';

export async function GET() {
  return proxyBackend('/servidores');
}

export async function POST(request: Request) {
  return proxyBackend('/servidores', request);
}
