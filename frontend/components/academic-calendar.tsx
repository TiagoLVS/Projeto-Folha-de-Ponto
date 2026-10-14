'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { deleteEvent, eventTypes, importCalendar, listEvents, saveEvent, type AcademicEvent, type EventInput, type EventType, type ImportReport } from '@/lib/academic-api';

export function AcademicCalendar({ initialMonth }: { initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [wholeYear, setWholeYear] = useState(false);
  const [type, setType] = useState('');
  const [events, setEvents] = useState<AcademicEvent[]>([]);
  const [loaded, setLoaded] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState(`${initialMonth}-01`);
  const [editing, setEditing] = useState<(EventInput & { id_data_especial?: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const key = `${month}:${wholeYear}:${type}:${refresh}`;
  useEffect(() => {
    const controller = new AbortController();
    listEvents({ ano: Number(month.slice(0, 4)), mes: wholeYear ? undefined : Number(month.slice(5)), tipo: type }, controller.signal)
      .then(result => { setEvents(result); setLoaded(key); setLoadError(''); })
      .catch(e => { if (!controller.signal.aborted) { setLoadError(e.message); setLoaded(key); setEvents([]); } });
    return () => controller.abort();
  }, [month, wholeYear, type, refresh, key]);
  const loading = loaded !== key;
  const shown = loading ? [] : events;
  const [year, number] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  function changeMonth(value: string) { if (/^(20\d{2})-(0[1-9]|1[0-2])$/.test(value)) { setMonth(value); setSelected(`${value}-01`); } }
  function move(delta: number) { const d = new Date(Date.UTC(year, number - 1 + delta, 1)); changeMonth(d.toISOString().slice(0, 7)); }
  async function action(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); setRefresh(v => v + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir a operação.'); }
    finally { lock.current = false; setBusy(false); }
  }
  function submit(e: FormEvent) { e.preventDefault(); if (!editing) return; const { id_data_especial, ...data } = editing; void action(async () => { await saveEvent(data, id_data_especial); setEditing(null); setNotice('Data especial salva.'); }); }
  return <div className="academic-page view-enter"><div className="page-heading"><div><h1>Calendário acadêmico</h1><p>Gerencie as datas especiais utilizadas nas folhas de ponto.</p></div><Button disabled={busy} onClick={() => { setError(''); setEditing({ data: selected, especificacao: '', tipo: 'OUTRO' }); }}>Adicionar data</Button></div>
    <section className="academic-panel"><div className="academic-toolbar"><Button variant="outline" onClick={() => move(-1)} disabled={month === '2000-01'} aria-label="Mês anterior">←</Button><label>Mês e ano<Input type="month" min="2000-01" max="2099-12" value={month} onChange={e => changeMonth(e.target.value)} /></label><Button variant="outline" onClick={() => move(1)} disabled={month === '2099-12'} aria-label="Próximo mês">→</Button><label>Tipo<select value={type} onChange={e => setType(e.target.value)}><option value="">Todos os tipos</option>{Object.entries(eventTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="check-label"><input type="checkbox" checked={wholeYear} onChange={e => setWholeYear(e.target.checked)} />Listar o ano inteiro</label></div>
      {loading && <p role="status">Carregando datas…</p>}{loadError && !loading && <p role="alert" className="form-error">{loadError} <Button variant="outline" onClick={() => setRefresh(v => v + 1)}>Tentar novamente</Button></p>}
      <div className="calendar-grid" aria-label={`Calendário de ${month}`}>{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => <strong className="calendar-weekday" key={day}>{day}</strong>)}{Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} />)}{Array.from({ length: days }, (_, i) => { const date = `${month}-${String(i + 1).padStart(2, '0')}`; const daily = shown.filter(e => e.data === date); return <button key={date} className={`calendar-day ${selected === date ? 'is-selected' : ''} ${[0, 6].includes((offset + i) % 7) ? 'is-weekend' : ''}`} aria-pressed={selected === date} aria-label={`${date.split('-').reverse().join('/')}, ${daily.length} eventos`} onClick={() => setSelected(date)}><strong>{i + 1}</strong>{daily.map(e => <span key={e.id_data_especial} className={`event-tag type-${e.tipo}`} title={`${eventTypes[e.tipo]}: ${e.especificacao}`}>{eventTypes[e.tipo]} · {e.especificacao}</span>)}</button>; })}</div>
      <div className="calendar-detail"><h2>{selected.split('-').reverse().join('/')}</h2>{shown.filter(e => e.data === selected).map(e => <p key={e.id_data_especial}><span className={`event-tag type-${e.tipo}`}>{eventTypes[e.tipo]}</span> {e.especificacao}</p>)}{!loading && !loadError && !shown.some(e => e.data === selected) && <p>Nenhum evento para esta data com os filtros selecionados.</p>}</div>
    </section>
    {notice && <p role="status">{notice}</p>}{error && !editing && <p role="alert" className="form-error">{error}</p>}
    <section className="table-card"><div className="table-toolbar"><h2>Datas cadastradas · {wholeYear ? year : month}</h2></div><div className="table-scroll"><table><thead><tr><th>Data</th><th>Especificação</th><th>Tipo</th><th>Ações</th></tr></thead><tbody>{shown.map(e => <tr key={e.id_data_especial}><td>{e.data.split('-').reverse().join('/')}</td><td>{e.especificacao}</td><td><span className={`event-tag type-${e.tipo}`}>{eventTypes[e.tipo]}</span></td><td><div className="row-actions"><Button variant="outline" disabled={busy} onClick={() => { setError(''); setEditing({ id_data_especial: e.id_data_especial, data: e.data, especificacao: e.especificacao, tipo: e.tipo }); }}>Editar</Button><Button variant="outline" disabled={busy} onClick={() => { if (window.confirm(`Excluir “${e.especificacao}”? Os PDFs já gerados serão preservados.`)) void action(async () => { await deleteEvent(e.id_data_especial); setNotice('Data especial excluída.'); }); }}>Excluir</Button></div></td></tr>)}</tbody></table></div>{!loading && !loadError && !shown.length && <p className="academic-empty">Nenhum evento cadastrado para este filtro.</p>}</section>
    <section className="academic-panel"><h2>Importar calendário Excel</h2><p>Planilha .xlsx com colunas Data e Especificação. Datas do Excel ou texto DD/MM/AAAA. Até 15 MB e 5.000 linhas.</p><label>Selecionar planilha<input type="file" accept=".xlsx" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.currentTarget.value = ''; if (file) void action(async () => { setReport(null); const result = await importCalendar(file); setReport(result); setNotice('Importação concluída. Confira o resumo e os filtros do calendário.'); }); }} /></label>{busy && <p role="status">Processando…</p>}{report && <div className="import-report"><h3>Importação concluída</h3><p>Total: {report.total} · Novos: {report.novos} · Atualizados: {report.atualizados} · Ignorados: {report.ignorados} · Inválidos: {report.invalidos}</p><details open={report.invalidos > 0}><summary>Detalhes por linha</summary><ul>{report.detalhes.map(d => <li key={d.linha}>Linha {d.linha} · {d.status}: {d.motivo}</li>)}</ul></details></div>}</section>
    <Dialog open={editing !== null} onOpenChange={open => { if (!open && !busy) setEditing(null); }}><DialogContent><DialogHeader><DialogTitle>{editing?.id_data_especial ? 'Editar data especial' : 'Adicionar data especial'}</DialogTitle><DialogDescription>As alterações serão salvas no calendário do servidor.</DialogDescription></DialogHeader>{editing && <form className="academic-form" onSubmit={submit}><label>Data<Input type="date" required value={editing.data} onChange={e => setEditing({ ...editing, data: e.target.value })} /></label><label>Especificação<Input required maxLength={300} value={editing.especificacao} onChange={e => setEditing({ ...editing, especificacao: e.target.value })} /></label><label>Tipo<select value={editing.tipo} onChange={e => setEditing({ ...editing, tipo: e.target.value as EventType })}>{Object.entries(eventTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{error && <p role="alert" className="form-error">{error}</p>}<Button type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar data'}</Button></form>}</DialogContent></Dialog>
  </div>;
}
