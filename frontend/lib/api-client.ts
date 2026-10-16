import { mutationsBlocked, setNetworkLock } from './network-lock.ts';

export class ApiError extends Error {
  public status: number;
  public data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/** Shared transport: no cached business records; only the backend decides locks. */
export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method ?? 'GET';
  if (!['GET', 'HEAD'].includes(method) && mutationsBlocked()) {
    throw new ApiError('Alterações indisponíveis enquanto o sistema estiver bloqueado.', 423);
  }
  const headers = new Headers(options.headers);
  if (typeof options.body === 'string') headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.status === 423) setNetworkLock({ locked: true, unavailable: false, checked: true });
  if (!response.ok) {
    const message = typeof data?.detail === 'string' ? data.detail
      : [404, 405, 501].includes(response.status) ? 'Este recurso ainda não está disponível no backend.'
      : [401, 403].includes(response.status) ? 'Acesso negado. Entre com uma conta autorizada.'
      : 'Não foi possível concluir a operação no servidor.';
    throw new ApiError(message, response.status, data && typeof data === 'object' ? data : {});
  }
  if (data === null && response.status !== 204) throw new ApiError('Resposta inválida do servidor.', 502);
  return data as T;
}
