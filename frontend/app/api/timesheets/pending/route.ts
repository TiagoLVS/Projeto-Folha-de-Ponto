import { proxyBackend } from '@/lib/backend-proxy';
export function GET(request: Request) { return proxyBackend('/folhas/pendentes', request); }
