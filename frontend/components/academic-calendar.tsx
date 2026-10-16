'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { useSystemLock } from '@/components/system-lock';
import { deleteCalendar, listCalendar, saveCalendar, type CalendarDraft, type CalendarEntry } from '@/lib/calendar-api';
import { toast } from 'sonner';
const labels = { FERIADO: 'Feriado', RECESSO: 'Recesso', PONTO_FACULTATIVO: 'Ponto facultativo' };
const empty: CalendarDraft = { titulo: '', tipo: 'FERIADO', inicio: '', fim: '' };
const displayDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR');
export function AcademicCalendar() {
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<CalendarDraft>(empty);
  const [editingId, setEditingId] = useState<number>();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<CalendarEntry | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const guard = useRef(false);
  const { blocked } = useSystemLock();
  useEffect(() => {
    let active = true;
    listCalendar().then(data => { if (active) { setEntries(data); setLoadError(''); setLoading(false); } }).catch(e => { if (active) { setLoadError(e.message); setLoading(false); } });
    return () => { active = false; };
  }, [attempt]);
  function edit(entry?: CalendarEntry) { setError(''); setEditingId(entry?.id); setForm(entry ? { titulo: entry.titulo, tipo: entry.tipo, inicio: entry.inicio, fim: entry.fim } : empty); setOpen(true); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (guard.current || blocked) return;
    if (!form.titulo.trim() || !form.inicio || !form.fim || form.fim < form.inicio) { setError('Informe título e um intervalo válido de datas.'); return; }
    guard.current = true; setBusy(true); setError('');
    try {
      const saved = await saveCalendar({ ...form, titulo: form.titulo.trim() }, editingId);
      setEntries(rows => editingId ? rows.map(row => row.id === editingId ? saved : row) : [...rows, saved]);
      setOpen(false); toast.success('Evento salvo.'); setAttempt(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { guard.current = false; setBusy(false); }
  }
  async function remove() {
    if (!removing || guard.current || blocked) return;
    guard.current = true; setBusy(true); setError('');
    try { await deleteCalendar(removing.id); setEntries(rows => rows.filter(row => row.id !== removing.id)); setRemoving(null); toast.success('Evento removido.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao remover evento.'); }
    finally { guard.current = false; setBusy(false); }
  }
  const visible = entries.filter(entry => !year || (entry.inicio <= `${year}-12-31` && entry.fim >= `${year}-01-01`)).sort((a, b) => a.inicio.localeCompare(b.inicio));
  return <div className="view-enter"><div className="page-heading"><div><p className="eyebrow">GESTÃO ACADÊMICA</p><h1>Calendário acadêmico</h1><p>Feriados, recessos e pontos facultativos.</p></div><Button disabled={blocked} onClick={() => edit()}><Plus size={16} />Adicionar evento</Button></div>
    {loadError && <Alert variant="destructive" className="mb-4"><AlertDescription>{loadError}<Button variant="outline" onClick={() => setAttempt(n => n + 1)}>Tentar novamente</Button></AlertDescription></Alert>}
    {error && !open && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
    <section className="table-card"><div className="table-toolbar"><CalendarDays size={18} /><Label htmlFor="calendar-year">Ano</Label><Input id="calendar-year" className="max-w-32" type="number" min={2000} max={2099} value={year} onChange={e => setYear(e.target.value)} /><span className="result-count">{visible.length} eventos</span></div>
      <Table><TableHeader><TableRow><TableHead>Evento</TableHead><TableHead>Tipo</TableHead><TableHead>Início</TableHead><TableHead>Fim</TableHead><TableHead className="actions-head">Ações</TableHead></TableRow></TableHeader><TableBody>{visible.map(entry => <TableRow key={entry.id}><TableCell>{entry.titulo}</TableCell><TableCell><span className="status-badge status-progress">{labels[entry.tipo]}</span></TableCell><TableCell>{displayDate(entry.inicio)}</TableCell><TableCell>{displayDate(entry.fim)}</TableCell><TableCell><div className="row-actions"><Button variant="ghost" size="icon" aria-label={`Editar ${entry.titulo}`} disabled={busy || blocked} onClick={() => edit(entry)}><Pencil size={16} /></Button><Button variant="ghost" size="icon" aria-label={`Excluir ${entry.titulo}`} disabled={busy || blocked} onClick={() => { setError(''); setRemoving(entry); }}><Trash2 size={16} /></Button></div></TableCell></TableRow>)}</TableBody></Table>
      {!visible.length && !loadError && <div className="empty-state"><CalendarDays size={30} /><p>{loading ? 'Carregando calendário…' : 'Nenhum evento neste ano.'}</p></div>}
    </section>
    <Dialog open={open} onOpenChange={value => { if (!guard.current) setOpen(value); }}><DialogContent className="send-dialog" onInteractOutside={e => { if (guard.current) e.preventDefault(); }} onEscapeKeyDown={e => { if (guard.current) e.preventDefault(); }}><DialogHeader><DialogTitle>{editingId ? 'Editar evento' : 'Adicionar evento'}</DialogTitle><DialogDescription>Informe o tipo e o intervalo. Para um único dia, use a mesma data no início e no fim.</DialogDescription></DialogHeader>
      <form onSubmit={save} className="space-y-4"><div className="space-y-2"><Label htmlFor="event-title">Título</Label><Input id="event-title" required maxLength={200} value={form.titulo} disabled={busy || blocked} onChange={e => setForm({ ...form, titulo: e.target.value })} /></div><div className="space-y-2"><Label htmlFor="event-type">Tipo</Label><NativeSelect id="event-type" value={form.tipo} disabled={busy || blocked} onChange={e => setForm({ ...form, tipo: e.target.value as CalendarDraft['tipo'] })}>{Object.entries(labels).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="event-start">Início</Label><Input id="event-start" type="date" required min="2000-01-01" max="2099-12-31" disabled={busy || blocked} value={form.inicio} onChange={e => setForm({ ...form, inicio: e.target.value, fim: form.fim || e.target.value })} /></div><div className="space-y-2"><Label htmlFor="event-end">Fim</Label><Input id="event-end" type="date" required min={form.inicio || '2000-01-01'} max="2099-12-31" disabled={busy || blocked} value={form.fim} onChange={e => setForm({ ...form, fim: e.target.value })} /></div></div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy || blocked}>{busy ? 'Salvando…' : 'Salvar evento'}</Button></DialogFooter>
      </form></DialogContent></Dialog>
    <ConfirmationDialog open={!!removing} title="Excluir evento?" description={removing ? `Excluir ${removing.titulo} do calendário acadêmico?` : ''} busy={busy} disabled={blocked} confirmLabel="Excluir" onConfirm={() => void remove()} onCancel={() => setRemoving(null)} />
  </div>;
}
