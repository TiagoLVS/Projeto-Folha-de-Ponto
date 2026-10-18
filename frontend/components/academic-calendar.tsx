'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ConfirmationDialog } from './confirmation-dialog';
import { newId } from '@/lib/client-session';
import type { AcademicSettings } from '@/lib/academic-limits';
import { useSystemLock } from './system-lock';
import { confirmCalendar, getAcademicSettings, deleteEvent, eventTypes, importCalendar, listEvents, saveEvent, type AcademicEvent, type EventInput, type EventType, type ImportReport } from '@/lib/academic-api';

export function AcademicCalendar() {
  const [settings,setSettings] = useState<AcademicSettings | null>(null);
  const [confirmKey,setConfirmKey] = useState('');
  const [replaceCalendar,setReplaceCalendar] = useState(false);
  const [confirmReplacement,setConfirmReplacement] = useState(false);
  const [settingsError,setSettingsError] = useState('');
  useEffect(() => {
    const controller=new AbortController();
    getAcademicSettings(controller.signal).then(setSettings).catch(e=>{if(!controller.signal.aborted)setSettingsError(e.message);});
    return ()=>controller.abort();
  },[]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [wholeYear, setWholeYear] = useState(false);
  const [type, setType] = useState('');
  const [events, setEvents] = useState<AcademicEvent[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<(EventInput & { id_data_especial?: number }) | null>(null);
  const [removing, setRemoving] = useState<AcademicEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const { blocked } = useSystemLock();
  useEffect(() => {
    const controller = new AbortController();
    listEvents({ ano: Number(month.slice(0, 4)), mes: wholeYear ? undefined : Number(month.slice(5)), tipo: type }, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setEvents(result); setError(''); setLoading(false); } })
      .catch(e => { if (!controller.signal.aborted) { setError(e.message); setEvents([]); setLoading(false); } });
    return () => controller.abort();
  }, [month, wholeYear, type, refresh]);
  const [year, number] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  function changeMonth(value: string) { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) { setMonth(value); setSelected(`${value}-01`); setLoading(true); } }
  function move(delta: number) { const d = new Date(Date.UTC(year, number - 1 + delta, 1)); changeMonth(d.toISOString().slice(0, 7)); }
  async function action(work: () => Promise<void>) {
    if (lock.current || blocked) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); setRefresh(v => v + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir a operação.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function applyPreview() {
    if (!report?.token || report.pode_confirmar === false) return;
    setConfirmReplacement(false);
    await action(async()=>{
      const result=await confirmCalendar(report.token!,confirmKey);
      setReport(result);setConfirmReplacement(false);
      setNotice(result.modo==='substituir' ? `Calendário de ${result.ano} substituído. ${result.removidos ?? 0} datas antigas removidas.` : 'Datas conferidas e importadas. Confira o período selecionado.');
    });
  }
  function submit(e: FormEvent) {
    e.preventDefault(); if (!editing) return;
    const { id_data_especial, ...data } = editing;
    void action(async () => { await saveEvent(data, id_data_especial); setEditing(null); setNotice('Data especial salva.'); });
  }
  return <div className="academic-page view-enter">
    <div className="page-heading"><div><h1>Calendário acadêmico</h1><p>Feriados, recessos, pontos facultativos e outras datas.</p></div><Button disabled={busy || blocked} onClick={() => { setError(''); setEditing({ data: selected || `${month}-01`, especificacao: '', tipo: 'OUTRO' }); }}>Adicionar data</Button></div>
    <section className="academic-panel">
      <div className="academic-toolbar">
        <Button variant="outline" onClick={() => move(-1)} disabled={month === '2000-01'} aria-label="Mês anterior">←</Button>
        <label>Mês e ano<Input type="month" min="2000-01" max="2099-12" value={month} onChange={e => changeMonth(e.target.value)} /></label>
        <Button variant="outline" onClick={() => move(1)} disabled={month === '2099-12'} aria-label="Próximo mês">→</Button>
        <label>Tipo<select value={type} onChange={e => setType(e.target.value)}><option value="">Todos os tipos</option>{Object.entries(eventTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="check-label"><input type="checkbox" checked={wholeYear} onChange={e => setWholeYear(e.target.checked)} />Listar o ano inteiro</label>
        <Button variant="outline" onClick={() => setRefresh(v => v + 1)}>Atualizar</Button>
      </div>
      {loading && <p role="status">Carregando datas…</p>}
      <div className="calendar-grid" aria-label={`Calendário de ${month}`}>
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => <strong className="calendar-weekday" key={day}>{day}</strong>)}
        {Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`;
          const daily = events.filter(e => e.data === date);
          return <button key={date} className={`calendar-day ${selected === date ? 'is-selected' : ''} ${[0, 6].includes((offset + i) % 7) ? 'is-weekend' : ''}`} aria-pressed={selected === date} onClick={() => setSelected(date)}>
            <strong>{i + 1}</strong>{daily.map(e => <span key={e.id_data_especial} className={`event-tag type-${e.tipo}`} title={`${eventTypes[e.tipo]}: ${e.especificacao}`}>{e.especificacao}</span>)}
          </button>;
        })}
      </div>
      {selected && <div className="calendar-detail"><h2>{selected.split('-').reverse().join('/')}</h2>{events.filter(e => e.data === selected).map(e => <p key={e.id_data_especial}>{eventTypes[e.tipo]}: {e.especificacao}</p>)}{!events.some(e => e.data === selected) && <p>Nenhum evento com os filtros atuais.</p>}</div>}
    </section>
    {settingsError && <p role="alert" className="form-error">Não foi possível consultar os limites de importação: {settingsError}</p>}{notice && <p role="status">{notice}</p>}{error && !editing && <p role="alert" className="form-error">{error}</p>}
    <section className="table-card"><div className="table-scroll"><table><thead><tr><th>Data</th><th>Especificação</th><th>Tipo</th><th>Ações</th></tr></thead><tbody>{events.map(e => <tr key={e.id_data_especial}>
      <td>{e.data.split('-').reverse().join('/')}</td><td>{e.especificacao}</td><td><span className={`event-tag type-${e.tipo}`}>{eventTypes[e.tipo]}</span></td><td><div className="row-actions"><Button variant="outline" disabled={busy || blocked} onClick={() => { setError(''); setEditing({ data: e.data, especificacao: e.especificacao, tipo: e.tipo, id_data_especial: e.id_data_especial }); }}>Editar</Button><Button variant="outline" disabled={busy || blocked} onClick={() => setRemoving(e)}>Excluir</Button></div></td>
    </tr>)}</tbody></table></div>{!loading && !events.length && <p className="academic-empty">Nenhum evento encontrado.</p>}</section>
    <section className="academic-panel"><h2>Importar calendário</h2><p>Arquivos aceitos: Excel (.xlsx) e PDF (.pdf). Até {settings ? settings.max_upload_bytes / (1024 * 1024) : '…'} MB.</p>
      <label className="check-label"><input type="checkbox" checked={replaceCalendar} disabled={busy || blocked} onChange={e=>{setReplaceCalendar(e.target.checked);setReport(null);setNotice('');setError('');}} />Substituir calendário de {year}</label>
      <Input aria-label="Importar calendário — Excel ou PDF" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,application/pdf" disabled={busy || blocked || !settings} onChange={e => { const file = e.target.files?.[0]; e.currentTarget.value = ''; if (file) void action(async () => { setReport(null); const result=await importCalendar(file,settings!.max_upload_bytes,replaceCalendar ? {replaceYear:year} : undefined); setReport(result); setConfirmKey(newId()); setNotice(result.status==='PREVIA' ? 'Confira as datas e confirme a importação.' : 'Importação concluída. Confira o período selecionado.'); }); }} />
      {busy && <p role="status">Processando arquivo…</p>}{report && <div className="import-report"><p>{report.status==='PREVIA' ? `Prévia · ${report.validos} datas para conferir · ` : ''}{report.removidos !== undefined ? `Removidos: ${report.removidos} · ` : ''}Total: {report.total} · Novos: {report.novos} · Atualizados: {report.atualizados} · Ignorados: {report.ignorados} · Inválidos: {report.invalidos}</p><details open={report.invalidos > 0 || report.status==='PREVIA'}><summary>Detalhes por linha/página</summary><ul>{report.detalhes.map(d => <li key={d.linha}>{d.pagina ? `Página ${d.pagina} · ` : ''}Linha {d.linha}{d.origem ? ` · ${d.origem}` : ''} · {d.status}: {d.motivo}{d.data && <p>{d.data.split('-').reverse().join('/')} — {d.especificacao}</p>}{d.texto && <p className="whitespace-pre-wrap">Texto: {d.texto}</p>}</li>)}</ul></details>{report.status==='PREVIA' && <>{report.modo==='substituir' ? <p>Ao confirmar, {report.existentes_a_remover} datas antigas de {report.ano} serão apagadas e substituídas por este arquivo. Outros anos e PDFs já gerados serão preservados.</p> : <p>Somente as datas reconhecidas serão importadas. Linhas inválidas devem ser corrigidas no arquivo e importadas novamente.</p>}{report.motivo_bloqueio && <p role="alert" className="form-error">{report.motivo_bloqueio}</p>}<Button disabled={busy || blocked || !report.validos || report.pode_confirmar===false} onClick={()=>{if(report.modo==='substituir')setConfirmReplacement(true);else void applyPreview();}}>{report.modo==='substituir' ? `Substituir calendário de ${report.ano}` : 'Confirmar datas do PDF'}</Button><Button variant="outline" disabled={busy} onClick={()=>{setReport(null);setNotice('Prévia descartada. Nenhuma data foi importada.');}}>Descartar prévia</Button></>}</div>}
    </section>
    <Dialog open={editing !== null} onOpenChange={open => { if (!open && !busy) setEditing(null); }}><DialogContent><DialogHeader><DialogTitle>{editing?.id_data_especial ? 'Editar data especial' : 'Adicionar data especial'}</DialogTitle><DialogDescription>Dados persistidos no calendário do servidor.</DialogDescription></DialogHeader>
      {editing && <form className="academic-form" onSubmit={submit}><label>Data<Input type="date" required disabled={busy || blocked} value={editing.data} onChange={e => setEditing({ ...editing, data: e.target.value })} /></label><label>Especificação<Input required maxLength={300} disabled={busy || blocked} value={editing.especificacao} onChange={e => setEditing({ ...editing, especificacao: e.target.value })} /></label><label>Tipo<select disabled={busy || blocked} value={editing.tipo} onChange={e => setEditing({ ...editing, tipo: e.target.value as EventType })}>{Object.entries(eventTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{error && <p role="alert" className="form-error">{error}</p>}<Button type="submit" disabled={busy || blocked}>{busy ? 'Salvando…' : 'Salvar data'}</Button></form>}
    </DialogContent></Dialog>
    <ConfirmationDialog open={confirmReplacement} title={`Substituir calendário de ${report?.ano}?`} description={`As ${report?.existentes_a_remover ?? 0} datas atuais desse ano serão apagadas e substituídas pelas datas do novo arquivo. Outros anos e PDFs já gerados serão preservados.`} busy={busy} disabled={blocked || report?.pode_confirmar===false} confirmLabel="Substituir calendário" onConfirm={()=>void applyPreview()} onCancel={()=>{if(!busy)setConfirmReplacement(false);}} />
    <ConfirmationDialog open={!!removing} title="Excluir data especial?" description={`Excluir ${removing?.especificacao ?? ''}? Os PDFs já gerados serão preservados.`} busy={busy} disabled={blocked} confirmLabel="Excluir" onConfirm={() => void action(async () => { await deleteEvent(removing!.id_data_especial); setRemoving(null); setNotice('Data excluída.'); })} onCancel={() => setRemoving(null)} />
  </div>;
}
