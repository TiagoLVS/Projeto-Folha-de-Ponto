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
export function apiFetch(path: string, options?: RequestInit) { return fetch(apiUrl(path), options); }
