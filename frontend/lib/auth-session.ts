export const SESSION_RECHECK_EVENT = 'ponto:session-recheck';

export type SessionStatus = {
  required: boolean;
  authenticated: boolean;
};

export function notifySessionRecheck() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_RECHECK_EVENT));
}

/** Confirma o estado no backend antes de tratar um 401 como sessão expirada. */
export function watchForExpiredSession<T extends SessionStatus>(
  loadStatus: () => Promise<T>,
  onExpired: (status: T) => void,
) {
  if (typeof window === 'undefined') return () => {};
  const target = window;
  let checking = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      const status = await loadStatus();
      if (status.required && !status.authenticated) onExpired(status);
    } catch {
      // Falhas de conexão não confirmam expiração e preservam o estado atual.
    } finally {
      checking = false;
    }
  };
  target.addEventListener(SESSION_RECHECK_EVENT, check);
  return () => target.removeEventListener(SESSION_RECHECK_EVENT, check);
}
