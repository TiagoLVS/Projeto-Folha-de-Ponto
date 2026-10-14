'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PeriodEvents } from './period-events';
import { downloadGenerated, generateSheets, listGenerated, type GeneratedSheet, type GenerationReport } from '@/lib/academic-api';
import type { Professor } from '@/lib/ponto';

export function SheetGeneration({ professors, initialMonth }: { professors: Professor[]; initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [selected, setSelected] = useState<string[]>([]);
  const [versions, setVersions] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [report, setReport] = useState<GenerationReport | null>(null);
  const [history, setHistory] = useState<GeneratedSheet[]>([]);
  const [downloads, setDownloads] = useState<number[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState('');
  const key = `${month}:${refresh}`;
  useEffect(() => {
    const controller = new AbortController();
    listGenerated(month, controller.signal).then(rows => { setHistory(rows); setLoaded(key); setLoadError(''); setDownloads([]); })
      .catch(e => { if (!controller.signal.aborted) { setLoadError(e.message); setHistory([]); setLoaded(key); } });
    return () => controller.abort();
  }, [month, refresh, key]);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir a operação.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function generate() {
    if (!selected.length || selected.length > 100) { setError('Selecione de 1 a 100 professores.'); return; }
    await run(async () => {
      setReport(null);
      try { setReport(await generateSheets(selected.map(Number), month, versions)); }
      finally { setRefresh(v => v + 1); }
    });
  }
  const currentHistory = loaded === key ? history : [];
  return <div className="academic-page view-enter"><div className="page-heading"><div><h1>Gerar folhas de ponto</h1><p>Modelo provisório em branco, com calendário e dados cadastrais.</p></div></div>
    <section className="academic-panel"><div className="academic-toolbar"><label>Competência<Input type="month" min="2000-01" max="2099-12" value={month} disabled={busy} onChange={e => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value)) { setMonth(e.target.value); setReport(null); } }} /></label><Button variant="outline" disabled={busy || !professors.length} onClick={() => setSelected(selected.length === professors.length ? [] : professors.map(p => p.id))}>{selected.length === professors.length && professors.length ? 'Desmarcar todos' : 'Selecionar todos'}</Button><span>{selected.length} selecionados · máximo 100 por lote</span></div>
      <div className="professor-options">{professors.map(p => <label className="check-label" key={p.id}><input type="checkbox" disabled={busy} checked={selected.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /><span>{p.name}<small>Matrícula {p.registration} · Carga horária: {p.workload ?? 'não informada'}</small></span></label>)}</div>{!professors.length && <p>Cadastre um professor antes de gerar folhas.</p>}
      <label className="check-label"><input type="checkbox" checked={versions} disabled={busy} onChange={e => setVersions(e.target.checked)} />Autorizar nova versão quando já existir modelo para o professor e a competência.</label><p>Horários e assinaturas ficam em branco. Gerar um modelo não confirma frequência nem envia e-mail. Cada versão preserva os eventos utilizados na sua criação.</p><Button disabled={busy || !selected.length || selected.length > 100} onClick={() => void generate()}>{busy ? 'Processando…' : selected.length === 1 ? 'Gerar PDF' : 'Gerar PDFs selecionados'}</Button>
    </section>
    {error && <p role="alert" className="form-error">{error}</p>}
    {report && <section className="academic-panel" aria-label="Resultado da geração"><h2>Resultado da geração</h2><p role="status">Solicitados: {report.total} · Gerados: {report.gerados} · Não gerados: {report.nao_gerados}</p>{report.falhas.length > 0 && <ul>{report.falhas.map(f => <li key={f.id_servidor}>{professors.find(p => Number(p.id) === f.id_servidor)?.name ?? `Professor ${f.id_servidor}`}: {f.motivo}</li>)}</ul>}{report.documentos.length > 0 && <Button variant="outline" disabled={busy} onClick={() => void run(() => downloadGenerated(report.documentos.map(d => d.id_documento), `Folhas_${month}.zip`, true))}>Baixar PDFs gerados neste lote (ZIP)</Button>}</section>}
    <PeriodEvents month={month} />
    <section className="table-card"><div className="table-toolbar"><h2>Histórico de modelos · {month}</h2><Button variant="outline" disabled={busy || loaded !== key} onClick={() => setRefresh(v => v + 1)}>Atualizar</Button><Button variant="outline" disabled={busy || !downloads.length || downloads.length > 100 || loaded !== key} onClick={() => void run(() => downloadGenerated(downloads, `Folhas_${month}.zip`, true))}>Baixar selecionados (ZIP)</Button></div>{loaded !== key && <p role="status" className="academic-empty">Carregando histórico…</p>}{loadError && loaded === key && <p role="alert" className="form-error">{loadError}</p>}<div className="table-scroll"><table><thead><tr><th>Selecionar</th><th>Professor</th><th>Versão</th><th>Gerado em</th><th>Documento</th></tr></thead><tbody>{currentHistory.map(d => <tr key={d.id_documento}><td><input type="checkbox" disabled={busy} aria-label={`Selecionar ${d.dados_professor.nome}, versão ${d.versao}`} checked={downloads.includes(d.id_documento)} onChange={e => setDownloads(ids => e.target.checked ? [...ids, d.id_documento] : ids.filter(id => id !== d.id_documento))} /></td><td>{d.dados_professor.nome}<small className="academic-subtitle">{d.dados_professor.matricula}</small></td><td>{d.versao} · Modelo em branco</td><td>{new Date(d.gerado_em).toLocaleString('pt-BR')}</td><td><Button variant="outline" disabled={busy} onClick={() => void run(() => downloadGenerated([d.id_documento], d.nome_arquivo))}>Baixar PDF</Button></td></tr>)}</tbody></table></div>{loaded === key && !loadError && !history.length && <p className="academic-empty">Nenhum modelo gerado nesta competência.</p>}</section>
  </div>;
}
