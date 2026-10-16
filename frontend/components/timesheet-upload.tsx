'use client';
import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { useSystemLock } from '@/components/system-lock';
import { ApiError } from '@/lib/api-client';
import { listTimesheets, uploadDocument, validatePdf, validMonth } from '@/lib/timesheet-api';
import { monthLabel, type Professor, type Sheet } from '@/lib/ponto';
import { toast } from 'sonner';

type PendingFile = { id: string; file: File; professorId: string; month: string; state: 'aguardando' | 'enviada' | 'ignorada' | 'erro'; error?: string; key: string };
export function TimesheetUpload({ professors, defaultProfessorId = '', month, onSaved }: {
  professors: Professor[]; defaultProfessorId?: string; month: string; onSaved: (professorId: string, month: string, sheet: Sheet) => void;
}) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<{ name: string; month: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const guard = useRef(false);
  const chooseGuard = useRef(false);
  const decide = useRef<((overwrite: boolean) => void) | null>(null);
  const alive = useRef(true);
  const { blocked } = useSystemLock();
  useEffect(() => { alive.current = true; return () => { alive.current = false; decide.current?.(false); }; }, []);
  const patch = (id: string, data: Partial<PendingFile>) => setFiles(rows => rows.map(row => row.id === id ? { ...row, ...data } : row));
  async function choose(incoming: File[]) {
    if (guard.current || chooseGuard.current || blocked) return;
    chooseGuard.current = true;
    setError('');
    try {
      if (incoming.length + files.length > 20) throw new Error('Selecione no máximo 20 PDFs por lote.');
      for (const file of incoming) await validatePdf(file);
      if (alive.current) setFiles(rows => [...rows, ...incoming.map(file => ({ id: crypto.randomUUID(), key: crypto.randomUUID(), file, professorId: defaultProfessorId, month, state: 'aguardando' as const }))]);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Arquivos inválidos.'); }
    finally { chooseGuard.current = false; }
  }
  function askOverwrite(name: string, period: string): Promise<boolean> {
    if (!alive.current) return Promise.resolve(false);
    setConflict({ name, month: period });
    return new Promise(resolve => { decide.current = resolve; });
  }
  function answer(value: boolean) { setConflict(null); decide.current?.(value); decide.current = null; }
  async function submit() {
    if (guard.current || chooseGuard.current || blocked) return;
    const pending = files.filter(row => row.state !== 'enviada');
    if (!pending.length) return;
    const pairs = pending.map(row => `${row.professorId}:${row.month}`);
    if (pending.some(row => !row.professorId || !validMonth(row.month)) || new Set(pairs).size !== pairs.length) {
      setError('Informe servidor e competência para cada PDF. Cada combinação deve ser única no lote.'); return;
    }
    guard.current = true; setBusy(true); setError('');
    let sent = 0;
    try {
      for (const row of pending) {
        if (!alive.current) break;
        try {
          const records = await listTimesheets(row.professorId);
          let existing = records.find(record => record.competencia === row.month)?.id_folha;
          const name = professors.find(p => p.id === row.professorId)?.name ?? row.professorId;
          if (existing !== undefined && !await askOverwrite(name, row.month)) { patch(row.id, { state: 'ignorada' }); continue; }
          let saved: Sheet;
          try {
            saved = await uploadDocument(row.file, row.professorId, row.month, existing, `${row.key}:${existing ?? 'novo'}`);
          } catch (e) {
            // The conflict can be created by another user after our GET. Confirm the new record too.
            if (!(e instanceof ApiError) || e.status !== 409) throw e;
            const fresh = await listTimesheets(row.professorId);
            existing = fresh.find(record => record.competencia === row.month)?.id_folha;
            if (!existing) throw e;
            if (!await askOverwrite(name, row.month)) { patch(row.id, { state: 'ignorada' }); continue; }
            saved = await uploadDocument(row.file, row.professorId, row.month, existing, `${row.key}:${existing}`);
          }
          if (!alive.current) break;
          onSaved(row.professorId, row.month, saved);
          patch(row.id, { state: 'enviada', error: undefined }); sent++;
        } catch (e) {
          if (!alive.current) break;
          patch(row.id, { state: 'erro', error: e instanceof Error ? e.message : 'Falha no envio.' });
          if (e instanceof ApiError && e.status === 423) break;
        }
      }
      if (sent && alive.current) toast.success(`${sent} PDF(s) armazenado(s) no servidor.`);
    } finally { guard.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="space-y-4">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className={`upload-dropzone ${drag ? 'drag-active' : ''}`} onDragOver={e => { e.preventDefault(); if (!busy && !blocked) setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); void choose(Array.from(e.dataTransfer.files)); }}>
      <Upload size={28} /><strong>Arraste seus PDFs aqui</strong><span>Seleção múltipla · até 15 MB por arquivo</span>
      <Input ref={input} className="sr-only" type="file" multiple accept=".pdf,application/pdf" disabled={busy || blocked} aria-label="Selecionar PDFs" onChange={e => { void choose(Array.from(e.target.files ?? [])); e.currentTarget.value = ''; }} />
      <Button variant="outline" disabled={busy || blocked} onClick={() => input.current?.click()}>Selecionar PDFs</Button>
    </div>
    {!!files.length && <><Table><TableHeader><TableRow><TableHead>PDF</TableHead><TableHead>Servidor</TableHead><TableHead>Competência</TableHead><TableHead>Situação</TableHead><TableHead>Ações</TableHead></TableRow></TableHeader><TableBody>{files.map(row => <TableRow key={row.id}>
      <TableCell className="max-w-52 whitespace-normal break-words">{row.file.name}<small className="block text-muted-foreground">{(row.file.size / 1024 / 1024).toFixed(2)} MB</small></TableCell>
      <TableCell><NativeSelect aria-label={`Servidor de ${row.file.name}`} value={row.professorId} disabled={busy || blocked || row.state === 'enviada'} onChange={e => patch(row.id, { professorId: e.target.value, state: 'aguardando', key: crypto.randomUUID(), error: undefined })}><NativeSelectOption value="">Selecione</NativeSelectOption>{professors.map(p => <NativeSelectOption key={p.id} value={p.id}>{p.name} · {p.registration}</NativeSelectOption>)}</NativeSelect></TableCell>
      <TableCell><Input type="month" min="2000-01" max="2099-12" value={row.month} aria-label={`Competência de ${row.file.name}`} disabled={busy || blocked || row.state === 'enviada'} onChange={e => patch(row.id, { month: e.target.value, state: 'aguardando', key: crypto.randomUUID(), error: undefined })} /></TableCell>
      <TableCell className="max-w-60 whitespace-normal" role="status">{row.state}{row.error && <p className="text-destructive">{row.error}</p>}</TableCell>
      <TableCell><Button variant="ghost" size="icon" disabled={busy} aria-label={`Retirar ${row.file.name} do lote`} onClick={() => setFiles(rows => rows.filter(r => r.id !== row.id))}><Trash2 size={16} /></Button></TableCell>
    </TableRow>)}</TableBody></Table><Button disabled={busy || blocked || files.every(row => row.state === 'enviada')} onClick={() => void submit()} aria-busy={busy}>{busy ? 'Enviando PDFs…' : 'Enviar PDFs'}</Button></>}
    <ConfirmationDialog open={!!conflict} title="Sobrescrever folha existente?" description={conflict ? `Já existe uma folha para ${conflict.name} em ${monthLabel(conflict.month)}. Sobrescrever substitui o original no servidor e exige uma nova validação.` : ''} confirmLabel="Sobrescrever" disabled={blocked} onConfirm={() => answer(true)} onCancel={() => answer(false)} />
  </div>;
}
