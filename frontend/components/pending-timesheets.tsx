'use client';
import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import { confirmDocument, type RemoteSheet } from '@/lib/timesheet-api';
import type { Professor } from '@/lib/ponto';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useSystemLock } from './system-lock';
export function PendingTimesheets({ professors, refresh, onSaved }: { professors: Professor[]; refresh: number; onSaved: () => void }) {
  const [rows, setRows] = useState<RemoteSheet[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { blocked } = useSystemLock();
  useEffect(() => {
    let active = true;
    apiRequest<RemoteSheet[]>('/api/timesheets/pending').then(value => { if (active) { if (!Array.isArray(value)) throw new Error('Lista de pendentes inválida.'); setRows(value); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [refresh]);
  async function confirm(id: number, form: HTMLFormElement) {
    if (busy || blocked) return;
    const fields = new FormData(form); setBusy(true); setError('');
    try { await confirmDocument(id, String(fields.get('person')), String(fields.get('month'))); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível confirmar.'); }
    finally { setBusy(false); }
  }
  if (!rows.length && !error) return null;
  return <section className="academic-panel my-5"><h2>Folhas antigas aguardando vínculo</h2><p>Confira o original e complete servidor e competência. Confirmar o vínculo pode iniciar o envio de e-mail.</p>{error && <p role="alert" className="form-error">{error}</p>}{rows.map(row => <form key={row.id_folha} className="academic-toolbar" onSubmit={e => { e.preventDefault(); if (window.confirm('Confirma que o documento e o vínculo foram conferidos?')) void confirm(row.id_folha, e.currentTarget); }}>
    <a href={`/api/timesheets/${row.id_folha}/file`} target="_blank" rel="noreferrer">{row.nome_arquivo}</a><span>{row.status_ocr} · {row.matricula || 'Matrícula não identificada'}</span>
    <select name="person" required disabled={busy || blocked} defaultValue={row.id_servidor ?? ''} aria-label="Servidor da folha pendente"><option value="">Selecione servidor</option>{professors.map(p => <option key={p.id} value={p.id}>{p.name} · {p.registration}</option>)}</select>
    <Input type="month" name="month" required min="2000-01" max="2099-12" defaultValue={row.competencia || row.competencia_lida || ''} disabled={busy || blocked} aria-label="Competência da folha pendente" /><Button disabled={busy || blocked}>Confirmar vínculo</Button>
  </form>)}</section>;
}
