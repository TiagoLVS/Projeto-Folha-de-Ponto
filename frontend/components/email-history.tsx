'use client';
import { useEffect, useRef, useState } from 'react';
import { Mail, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSystemLock } from '@/components/system-lock';
import { listEmailLogs, retryEmailErrors, type EmailFilters, type EmailLog } from '@/lib/email-api';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { monthLabel } from '@/lib/ponto';
import { toast } from 'sonner';
const initial: EmailFilters = { nome: '', matricula: '', status: '', competencia: '' };
export function EmailHistory() {
  const [filters, setFilters] = useState(initial);
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const guard = useRef(false);
  const retryKeys = useRef(new Map<string, string>());
  const { blocked } = useSystemLock();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      listEmailLogs(filters, controller.signal).then(data => { if (!controller.signal.aborted) { setLogs(data); setError(''); } }).catch(e => { if (!controller.signal.aborted) { setLogs([]); setError(e.message); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [filters, attempt]);
  const failedIds = [...new Set(logs.filter(log => log.status === 'ERRO').map(log => log.id))].sort((a, b) => a - b);
  async function retry() {
    if (guard.current || blocked || !failedIds.length) return;
    guard.current = true; setBusy(true); setError('');
    const signature = JSON.stringify(failedIds);
    let key = retryKeys.current.get(signature);
    if (!key) { key = crypto.randomUUID(); retryKeys.current.set(signature, key); }
    try {
      const result = await retryEmailErrors(failedIds, key);
      toast.success(`${result.reenviados} reenviados · ${result.ignorados} ignorados`);
      setConfirmOpen(false); setAttempt(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível reenviar.'); }
    finally { guard.current = false; setBusy(false); }
  }
  return <div className="view-enter"><div className="page-heading"><div><p className="eyebrow">COMUNICAÇÃO</p><h1>Histórico de e-mails</h1><p>Consulte envios e reenvie falhas das folhas validadas.</p></div><Button disabled={blocked || busy || loading || !failedIds.length} onClick={() => setConfirmOpen(true)}><RotateCw size={16} />Reenviar erros ({failedIds.length})</Button></div>
    {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}<Button variant="outline" disabled={busy} onClick={() => setAttempt(n => n + 1)}>Atualizar histórico</Button></AlertDescription></Alert>}
    <section className="table-card"><div className="table-toolbar !grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-2"><Label htmlFor="email-name">Nome</Label><Input id="email-name" placeholder="Nome do servidor" disabled={busy} value={filters.nome} onChange={e => setFilters({ ...filters, nome: e.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor="email-registration">Matrícula</Label><Input id="email-registration" placeholder="Matrícula" disabled={busy} value={filters.matricula} onChange={e => setFilters({ ...filters, matricula: e.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor="email-status">Status</Label><NativeSelect id="email-status" disabled={busy} value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><NativeSelectOption value="">Todos</NativeSelectOption>{['ENVIADO', 'ERRO', 'PROCESSANDO', 'NAO_CONFIGURADO'].map(status => <NativeSelectOption key={status} value={status}>{status === 'NAO_CONFIGURADO' ? 'Não configurado' : status}</NativeSelectOption>)}</NativeSelect></div>
      <div className="space-y-2"><Label htmlFor="email-month">Competência</Label><Input id="email-month" type="month" min="2000-01" max="2099-12" disabled={busy} value={filters.competencia} onChange={e => setFilters({ ...filters, competencia: e.target.value })} /></div>
    </div><div className="px-6 pb-4"><Button variant="outline" disabled={busy} onClick={() => setFilters(initial)}>Limpar filtros</Button></div>
      <Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Matrícula</TableHead><TableHead>Competência</TableHead><TableHead>Status</TableHead><TableHead>Data</TableHead><TableHead>Mensagem</TableHead></TableRow></TableHeader><TableBody>{!loading && logs.map(log => <TableRow key={log.id}><TableCell>{log.nome}</TableCell><TableCell>{log.matricula}</TableCell><TableCell>{monthLabel(log.competencia)}</TableCell><TableCell><span className={`status-badge status-${log.status === 'ENVIADO' ? 'done' : log.status === 'ERRO' ? 'error' : 'progress'}`}>{log.status}</span></TableCell><TableCell>{new Date(log.criado_em).toLocaleString('pt-BR')}</TableCell><TableCell className="max-w-96 whitespace-normal">{log.mensagem}</TableCell></TableRow>)}</TableBody></Table>
      {(loading || (!logs.length && !error)) && <div className="empty-state"><Mail size={30} /><p>{loading ? 'Carregando histórico…' : 'Nenhum e-mail encontrado para os filtros.'}</p></div>}
    </section>
    <ConfirmationDialog open={confirmOpen} title="Reenviar e-mails com erro?" description={`Reenviar os ${failedIds.length} erros dos filtros atuais? O servidor deve revalidar a aptidão e ignorar folhas removidas ou já enviadas.`} busy={busy} disabled={blocked} confirmLabel="Reenviar erros" onConfirm={() => void retry()} onCancel={() => setConfirmOpen(false)} />
  </div>;
}
