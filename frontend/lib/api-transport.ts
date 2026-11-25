import { notifySessionRecheck } from './auth-session.ts';

/** Origem central do transporte. Web usa o proxy Next; desktop usa o adaptador FastAPI de mesma origem. */
let baseUrl = '';
export function configureApiTransport(origin = '') {
  if (origin) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Origem da API inválida.');
    baseUrl = url.origin;
  } else baseUrl = '';
}
export function apiUrl(path: string) {
  if (!path.startsWith('/api/')) throw new Error('Rota de API inválida.');
  return baseUrl + path;
}

const RETRY_DELAYS_MS = [250, 750];

function wait(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

/** Repete apenas leituras após falha transitória de comunicação; nunca reenvia mutações. */
export async function apiFetch(path: string, options?: RequestInit) {
  const method = (options?.method ?? 'GET').toUpperCase();
  const retryable = method === 'GET' || method === 'HEAD';
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(apiUrl(path), options);
      if (response.status === 401 && !path.startsWith('/api/auth/')) notifySessionRecheck();
      const retryableStatus = [502, 503, 504].includes(response.status);
      if (!retryable || !retryableStatus || attempt >= RETRY_DELAYS_MS.length || options?.signal?.aborted) return response;
      if (response.body) await response.body.cancel().catch(() => {});
      await wait(RETRY_DELAYS_MS[attempt]);
    } catch (error) {
      if (!retryable || attempt >= RETRY_DELAYS_MS.length || options?.signal?.aborted) throw error;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}
