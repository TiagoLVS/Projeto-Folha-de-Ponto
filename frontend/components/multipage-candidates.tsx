'use client';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useSystemLock } from './system-lock';
import { importPage, listPackages, listTimesheets, type PageCandidate, type RemoteSheet } from '@/lib/timesheet-api';
import type { Professor } from '@/lib/ponto';

export function MultipageCandidates({ professors, refresh, onSaved }: { professors: Professor[]; refresh: number; onSaved: () => void }) {
  const [packages, setPackages] = useState<(RemoteSheet & { paginas: PageCandidate[] })[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { blocked } = useSystemLock();
  useEffect(() => {
    let active = true;
    listPackages().then(rows => { if (active) { setPackages(rows); setError(''); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [refresh, attempt]);
  async function save(source: number, candidate: PageCandidate, form: HTMLFormElement) {
    if (busy || blocked) return;
    const values = new FormData(form);
    const id = Number(values.get('servidor')), month = String(values.get('month'));
    setBusy(true); setError('');
    try {
      const previous = (await listTimesheets(String(id))).find(r => r.competencia === month);
      if (previous && !window.confirm('Já existe uma folha nesse vínculo. Preservar a anterior como OLD e importar esta página?')) return;
      await importPage(source, candidate.pagina, id, month, previous?.id_folha);
      setAttempt(n => n + 1); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível importar a página.'); }
    finally { setBusy(false); }
  }
  if (!packages.length && !error) return null;
  return <section className="academic-panel my-5"><h2>Páginas candidatas de PDFs multipágina</h2><p>Cada página é uma folha independente. Confira matrícula e competência; duplicidades exigem confirmação de substituição.</p>{error && <p role="alert" className="form-error">{error} <Button variant="outline" onClick={() => setAttempt(n => n + 1)}>Atualizar</Button></p>}
    {packages.map(pkg => <details key={pkg.id_folha} open><summary>{pkg.nome_arquivo} · {pkg.paginas.length} páginas</summary>{pkg.paginas.map(page => <form key={page.pagina} className="academic-toolbar my-4" onSubmit={e => { e.preventDefault(); void save(pkg.id_folha, page, e.currentTarget); }}>
      <span>Página {page.pagina} · {page.status_ocr}{page.duplicidade ? ' · Duplicidade' : ''}{page.matricula ? ` · Matrícula lida: ${page.matricula}` : ''}{page.mensagem ? ` · ${page.mensagem}` : ''}</span>
      <select name="servidor" required defaultValue={page.servidor?.id_servidor ?? ''} disabled={busy || blocked || !!page.importado_id} aria-label={`Servidor da página ${page.pagina}`}><option value="">Selecione o servidor</option>{professors.map(p => <option key={p.id} value={p.id}>{p.name} · {p.registration}</option>)}</select>
      <Input type="month" name="month" required min="2000-01" max="2099-12" defaultValue={page.competencia || pkg.competencia || ''} disabled={busy || blocked || !!page.importado_id} aria-label={`Competência da página ${page.pagina}`} />
      <Button disabled={busy || blocked || !!page.importado_id}>{page.importado_id ? 'Página importada' : 'Importar página'}</Button>
    </form>)}</details>)}
  </section>;
}
