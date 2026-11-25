'use client';
import { newId } from '@/lib/client-session';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Mail, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSystemLock } from '@/components/system-lock';
import { listEmailLogs, retryEmailErrors, type EmailFilters } from '@/lib/email-api';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { monthLabel } from '@/lib/ponto';
import { toast } from 'sonner';
import { emailHistoryReducer, initialEmailHistoryState, canRetryEmailErrors, retryConfirmationText, retryIdempotencyKey } from '@/lib/email-history-state';
const initial: EmailFilters = { nome: '', matricula: '', cpf: '', status: '', competencia: '' };
export function EmailHistory() {
  const [filters, setFilters] = useState(initial);
  const [history, dispatchHistory] = useReducer(emailHistoryReducer, initialEmailHistoryState);
  const { logs, selectedIds: selection } = history;
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
      listEmailLogs(filters, controller.signal).then(data => { if (!controller.signal.aborted) { dispatchHistory({ type: 'history-loaded', logs: data }); setError(''); } }).catch(e => { if (!controller.signal.aborted) { dispatchHistory({ type: 'history-loaded', logs: [] }); setError(e.message); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [filters, attempt]);
  const failedIds = [...new Set(logs.filter(log => log.status === 'ERRO' && selection.includes(log.id)).map(log => log.id))].sort((a, b) => a - b);
  async function retry() {
    if (guard.current || !canRetryEmailErrors(failedIds.length, blocked, busy, loading)) return;
    guard.current = true; setBusy(true); setError('');
    const key = retryIdempotencyKey(retryKeys.current, failedIds, newId);
    try {
      const result = await retryEmailErrors(failedIds, key);
      (result.falhas ? toast.warning : toast.success)(`${result.reenviados} reenviados · ${result.ignorados} ignorados · ${result.falhas} falhas`);
      dispatchHistory({ type: 'clear-selection' }); setConfirmOpen(false); setAttempt(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível reenviar.'); }
    finally { guard.current = false; setBusy(false); }
  }
  const updateFilter = (next: EmailFilters) => { setFilters(next); dispatchHistory({ type: 'filters-changed' }); };
  const changeSelection = (id: number, checked: boolean) => dispatchHistory({ type: 'toggle', id, checked });
  return <div className="view-enter"><div className="page-heading"><div><p className="eyebrow">COMUNICAÇÃO</p><h1>Histórico de e-mails</h1><p>Consulte envios de modelos em branco e folhas preenchidas.</p></div><Button disabled={!canRetryEmailErrors(failedIds.length, blocked, busy, loading)} onClick={() => setConfirmOpen(true)}><RotateCw size={16} />Reenviar erros ({failedIds.length})</Button></div>
    {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}<Button variant="outline" disabled={busy} onClick={() => { dispatchHistory({ type: 'clear-selection' }); setAttempt(n => n + 1); }}>Atualizar histórico</Button></AlertDescription></Alert>}
    <section className="table-card"><div className="table-toolbar !grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <div className="space-y-2"><Label htmlFor="email-name">Nome</Label><Input id="email-name" placeholder="Nome do servidor" disabled={busy} value={filters.nome} onChange={e => updateFilter({ ...filters, nome: e.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor="email-registration">Matrícula</Label><Input id="email-registration" placeholder="Matrícula" disabled={busy} value={filters.matricula} onChange={e => updateFilter({ ...filters, matricula: e.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor="email-cpf">CPF</Label><Input id="email-cpf" placeholder="CPF do servidor" disabled={busy} value={filters.cpf} onChange={e => updateFilter({ ...filters, cpf: e.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor="email-status">Status</Label><NativeSelect id="email-status" disabled={busy} value={filters.status} onChange={e => updateFilter({ ...filters, status: e.target.value })}><NativeSelectOption value="">Todos</NativeSelectOption>{['ENVIADO', 'ERRO', 'PROCESSANDO', 'NAO_CONFIGURADO'].map(status => <NativeSelectOption key={status} value={status}>{status === 'NAO_CONFIGURADO' ? 'Não configurado' : status}</NativeSelectOption>)}</NativeSelect></div>
      <div className="space-y-2"><Label htmlFor="email-month">Competência</Label><Input id="email-month" type="month" min="2000-01" max="2099-12" disabled={busy} value={filters.competencia} onChange={e => updateFilter({ ...filters, competencia: e.target.value })} /></div>
    </div><div className="px-6 pb-4"><Button variant="outline" disabled={busy} onClick={() => updateFilter(initial)}>Limpar filtros</Button></div>
      <Table><TableHeader><TableRow><TableHead><input type="checkbox" aria-label="Selecionar todos os erros" disabled={busy || blocked || loading} checked={logs.some(l => l.status === "ERRO") && logs.filter(l => l.status === "ERRO").every(l => selection.includes(l.id))} onChange={e => dispatchHistory({ type: 'toggle-all-errors', checked: e.target.checked })} /></TableHead><TableHead>Nome</TableHead><TableHead>Matrícula</TableHead><TableHead>Competência</TableHead><TableHead>Documento</TableHead><TableHead>Destinatário</TableHead><TableHead>Status</TableHead><TableHead>Data</TableHead><TableHead>Mensagem</TableHead></TableRow></TableHeader><TableBody>{!loading && logs.map(log => <TableRow key={log.id}><TableCell><input type="checkbox" aria-label={`Selecionar erro ${log.id}`} checked={selection.includes(log.id)} disabled={busy || blocked || log.status !== "ERRO"} onChange={e => changeSelection(log.id, e.target.checked)} /></TableCell><TableCell>{log.nome}</TableCell><TableCell>{log.matricula}</TableCell><TableCell>{monthLabel(log.competencia)}</TableCell><TableCell>{log.origem === 'GERADA' ? 'Modelo em branco' : 'Folha preenchida'}</TableCell><TableCell>{log.email_destino ?? '—'}</TableCell><TableCell><span className={`status-badge status-${log.status === 'ENVIADO' ? 'done' : log.status === 'ERRO' ? 'error' : 'progress'}`}>{log.status}</span></TableCell><TableCell>{new Date(log.criado_em).toLocaleString('pt-BR')}</TableCell><TableCell className="max-w-96 whitespace-normal">{log.mensagem}</TableCell></TableRow>)}</TableBody></Table>
      {(loading || (!logs.length && !error)) && <div className="empty-state"><Mail size={30} /><p>{loading ? 'Carregando histórico…' : 'Nenhum e-mail encontrado para os filtros.'}</p></div>}
    </section>
    <ConfirmationDialog open={confirmOpen} title="Reenviar e-mails com erro?" description={retryConfirmationText(failedIds.length)} busy={busy} disabled={blocked || !failedIds.length} confirmLabel="Reenviar erros" onConfirm={() => void retry()} onCancel={() => setConfirmOpen(false)} />
  </div>;
}
