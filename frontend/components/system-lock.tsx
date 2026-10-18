'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { LockKeyhole, AlertCircle } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { sessionHeaders } from '@/lib/client-session';
import { refreshSystemLease } from '@/lib/system-lease';
import { ApiError } from '@/lib/api-client';
import { getNetworkLock, getServerNetworkLock, setNetworkLock, subscribeNetworkLock } from '@/lib/network-lock';
export function useSystemLock() {
  const status = useSyncExternalStore(subscribeNetworkLock, getNetworkLock, getServerNetworkLock);
  return { ...status, blocked: status.locked || status.unavailable || !status.checked };
}
export function SystemLock() {
  const status = useSystemLock();
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    let inFlight = false;
    async function check() {
      if (inFlight || !active) return;
      inFlight = true;
      try {
        const data = await refreshSystemLease(AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
        if (typeof data.locked !== 'boolean') throw new Error('Estado inválido');
        if (active) setNetworkLock({ locked: data.locked, unavailable: false, checked: true });
      } catch (error) {
        if (active) setNetworkLock({ locked: error instanceof ApiError && error.status === 423, unavailable: !(error instanceof ApiError && error.status === 423), checked: true });
      } finally {
        inFlight = false;
        if (active) timer = setTimeout(check, 10000);
      }
    }
    function focus() { clearTimeout(timer); if (!document.hidden) void check(); }
    function release() { void fetch('/api/system/lock', { method: 'DELETE', headers: sessionHeaders(), keepalive: true }).catch(() => {}); }
    void check();
    window.addEventListener('pagehide', release);
    document.addEventListener('visibilitychange', focus);
    return () => { active = false; clearTimeout(timer); controller.abort(); document.removeEventListener('visibilitychange', focus); window.removeEventListener('pagehide', release); };
  }, []);
  if (!status.locked && !status.unavailable) return null;
  return <Alert className="sticky top-0 z-[60] rounded-none border-border bg-[var(--glass)] text-foreground shadow-[var(--glass-shadow)] backdrop-blur-xl">
    {status.locked ? <LockKeyhole /> : <AlertCircle />}
    <AlertTitle>{status.locked ? 'Sistema em uso por outro usuário' : 'Não foi possível verificar a disponibilidade do sistema'}</AlertTitle>
    <AlertDescription>Consultas permanecem disponíveis. Alterações ficam bloqueadas até o servidor liberar o acesso.
      {status.unavailable && <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Tentar novamente</Button>}
    </AlertDescription>
  </Alert>;
}
