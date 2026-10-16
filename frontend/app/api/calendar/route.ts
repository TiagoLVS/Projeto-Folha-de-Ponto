import { proxyBackend } from '@/lib/backend-proxy';

export async function GET(request: Request) {
  return proxyBackend(`/calendario` + new URL(request.url).search, request);
}

export async function POST(request: Request) {
  return proxyBackend(`/calendario`, request);
}

