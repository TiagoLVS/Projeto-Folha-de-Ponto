'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSystemLock } from './system-lock';
import { GeneratedEmailBatch } from './generated-email-batch';
import { downloadGenerated, generateSheets, listGenerated, getAcademicSettings, type GeneratedSheet, type GenerationReport } from '@/lib/academic-api';
import { generationCandidates } from '@/lib/generation-selection';
import { addSelection, selectAll, type AcademicSettings } from '@/lib/academic-limits';
import type { Professor } from '@/lib/ponto';

export function SheetGeneration({ professors, initialMonth }: { professors: Professor[]; initialMonth: string }) {
  const { blocked } = useSystemLock();
  const [settings, setSettings] = useState<AcademicSettings | null>(null);
  const [settingsError, setSettingsError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    getAcademicSettings(controller.signal).then(setSettings).catch(e => { if (!controller.signal.aborted) setSettingsError(e.message); });
    return () => controller.abort();
  }, []);
  function toggle(id: string, checked: boolean, download = false) {
    if (!settings) return;
    try {
      if (download) setDownloads(checked ? addSelection(downloads.map(String), id, settings.max_generated_download_batch).map(Number) : downloads.filter(value => String(value) !== id));
      else setSelected(checked ? addSelection(selectedIds, id, settings.max_generation_batch) : selectedIds.filter(value => value !== id));
      setError('');
    } catch (e) { setError((e as Error).message); }
  }
  function toggleAll() {
    if (!settings) return;
    try { setSelected(selectedIds.length === candidates.length ? [] : selectAll(candidates.map(p => p.id), settings.max_generation_batch)); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
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
  const historyReady = loaded === key && !loadError;
  const candidates = historyReady ? generationCandidates(professors, history, month, versions) : [];
  const candidateIds = new Set(candidates.map(p => p.id));
  const selectedIds = selected.filter(id => candidateIds.has(id));
  async function run(work: () => Promise<void>, mutating = false) {
    if (lock.current || (mutating && blocked)) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir a operação.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function generate() {
    if (!settings || !selectedIds.length || selectedIds.length > settings.max_generation_batch) { setError(`Selecione de 1 a ${settings?.max_generation_batch ?? '…'} professores.`); return; }
    await run(async () => {
      setReport(null);
      try {
        const result = await generateSheets(selectedIds.map(Number), month, versions);
        setReport(result);
        const completed = new Set(result.documentos.map(doc => String(doc.id_servidor)));
        setSelected(ids => ids.filter(id => !completed.has(id)));
      }
      finally { setRefresh(v => v + 1); }
    }, true);
  }
  const currentHistory = loaded === key ? history : [];
  return <div className="academic-page view-enter"><div className="page-heading"><div><h1>Gerar folhas de ponto</h1><p>Modelo institucional em branco, com calendário e dados cadastrais.</p></div></div>
    <section className="academic-panel"><div className="academic-toolbar"><label>Competência<Input type="month" min="2000-01" max="2099-12" value={month} disabled={busy} onChange={e => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value)) { setMonth(e.target.value); setReport(null); setSelected([]); setVersions(false); } }} /></label><Button variant="outline" disabled={busy || !settings || !candidates.length} onClick={toggleAll}>{selectedIds.length === candidates.length && candidates.length ? 'Desmarcar todos' : 'Selecionar todos'}</Button><span>{selectedIds.length} selecionados · máximo {settings?.max_generation_batch ?? '…'} por lote</span></div>
      <div className="professor-options">{candidates.map(p => <label className="check-label" key={p.id}><input type="checkbox" disabled={busy} checked={selectedIds.includes(p.id)} onChange={e => toggle(p.id, e.target.checked)} /><span>{p.name}<small>Matrícula {p.registration} · Carga horária: {p.workload ?? 'não informada'}</small></span></label>)}</div>{!historyReady && !loadError && <p role="status">Carregando servidores pendentes…</p>}{historyReady && !professors.length && <p>Cadastre um professor antes de gerar folhas.</p>}{historyReady && professors.length > 0 && !candidates.length && <p>Todos os servidores já têm folha gerada nesta competência.</p>}
      <label className="check-label"><input type="checkbox" checked={versions} disabled={busy} onChange={e => { setVersions(e.target.checked); setSelected([]); }} />Gerar nova versão de folhas existentes.</label><p>Horários e assinaturas ficam em branco. Gerar um modelo não confirma frequência nem envia e-mail. Cada versão preserva os eventos utilizados na sua criação.</p><Button disabled={busy || blocked || !selectedIds.length || !settings || selectedIds.length > settings.max_generation_batch} onClick={() => void generate()}>{busy ? 'Processando…' : selectedIds.length === 1 ? 'Gerar PDF' : 'Gerar PDFs selecionados'}</Button>
    </section>
    {settingsError && <p role="alert" className="form-error">Não foi possível consultar os limites: {settingsError}</p>}{error && <p role="alert" className="form-error">{error}</p>}
    {report && <section className="academic-panel" aria-label="Resultado da geração"><h2>Resultado da geração</h2><p role="status">Solicitados: {report.total} · Gerados: {report.gerados} · Não gerados: {report.nao_gerados}</p>{report.falhas.length > 0 && <ul>{report.falhas.map(f => <li key={f.id_servidor}>{professors.find(p => Number(p.id) === f.id_servidor)?.name ?? `Professor ${f.id_servidor}`}: {f.motivo}</li>)}</ul>}{report.documentos.length > 0 && <Button variant="outline" disabled={busy || !settings || report.documentos.length > settings.max_generated_download_batch} onClick={() => void run(() => downloadGenerated(report.documentos.map(d => d.id_documento), `Folhas_${month}.zip`, true))}>Baixar PDFs gerados neste lote (ZIP)</Button>}</section>}
    <section className="academic-panel"><h2>Enviar modelos por e-mail</h2><p>Envie as folhas em branco do mês aos servidores, sem abrir cada PDF.</p><GeneratedEmailBatch month={month} selectedDocumentIds={downloads} disabled={busy || !historyReady || !currentHistory.length} /></section>
    <section className="table-card"><div className="table-toolbar"><h2>Histórico de modelos · {month}</h2><span>ZIP: {downloads.length} selecionados · máximo {settings?.max_generated_download_batch ?? '…'} PDFs · {settings ? settings.max_generated_zip_bytes / (1024 * 1024) : '…'} MB</span><Button variant="outline" disabled={busy || loaded !== key} onClick={() => setRefresh(v => v + 1)}>Atualizar</Button><Button variant="outline" disabled={busy || !downloads.length || !settings || downloads.length > settings.max_generated_download_batch || loaded !== key} onClick={() => void run(() => downloadGenerated(downloads, `Folhas_${month}.zip`, true))}>Baixar selecionados (ZIP)</Button></div>{loaded !== key && <p role="status" className="academic-empty">Carregando histórico…</p>}{loadError && loaded === key && <p role="alert" className="form-error">{loadError}</p>}<div className="table-scroll"><table><thead><tr><th>Selecionar</th><th>Professor</th><th>Versão</th><th>Gerado em</th><th>Documento</th></tr></thead><tbody>{currentHistory.map(d => <tr key={d.id_documento}><td><input type="checkbox" disabled={busy} aria-label={`Selecionar ${d.dados_professor.nome}, versão ${d.versao}`} checked={downloads.includes(d.id_documento)} onChange={e => toggle(String(d.id_documento), e.target.checked, true)} /></td><td>{d.dados_professor.nome}<small className="academic-subtitle">{d.dados_professor.matricula}</small></td><td>{d.versao} · Modelo em branco</td><td>{new Date(d.gerado_em).toLocaleString('pt-BR')}</td><td><Button variant="outline" disabled={busy} onClick={() => void run(() => downloadGenerated([d.id_documento], d.nome_arquivo))}>Baixar PDF</Button></td></tr>)}</tbody></table></div>{loaded === key && !loadError && !history.length && <p className="academic-empty">Nenhum modelo gerado nesta competência.</p>}</section>
  </div>;
}
