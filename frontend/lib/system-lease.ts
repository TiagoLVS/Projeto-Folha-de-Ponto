import { apiRequest, ApiError } from './api-client.ts';
export type SystemLease = { locked: boolean; holder: boolean; expires_at: string | null };
function valid(value: SystemLease): SystemLease {
  if (typeof value.locked !== 'boolean' || typeof value.holder !== 'boolean' || (value.expires_at !== null && !Number.isFinite(Date.parse(value.expires_at)))) throw new Error('Lease inválido retornado pelo servidor.');
  return value;
}
export async function refreshSystemLease(signal?: AbortSignal): Promise<SystemLease> {
  const state = valid(await apiRequest<SystemLease>('/api/system/lock', { signal }));
  if (state.locked) return state;
  try {
    return valid(await apiRequest<SystemLease>(state.holder ? '/api/system/lock/renew' : '/api/system/lock/acquire', { method: 'POST', signal }));
  } catch (error) {
    if (state.holder && error instanceof ApiError && error.status === 409) return valid(await apiRequest<SystemLease>('/api/system/lock/acquire', { method: 'POST', signal }));
    throw error;
  }
}
export async function releaseSystemLease() { await apiRequest('/api/system/lock', { method: 'DELETE' }); }
