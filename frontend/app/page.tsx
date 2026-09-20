"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Bell, CalendarDays, CheckCheck, Clock3, Download, FileText, Mail, Pencil, Plus, Search, Send, Users, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast, Toaster } from "sonner";
import { createDemoData, monthLabel, sheetStatus, type Professor, type Status } from "@/lib/ponto";
import { DocumentSheet } from "@/components/document-sheet";
import { loadProfessors, persistProfessors } from "@/lib/document-storage";
import { downloadSheet } from "@/lib/export-sheet";
import { sendSheetBatch, type BatchReceipt } from "@/lib/send-sheets";

type View = "professores" | "folhas" | "perfil" | "folha";
const INITIAL_MONTH = "2026-09";
function Logo() { return <img className="undf-logo" src="/undf-logo.png" alt="UnDF — Universidade do Distrito Federal" width="600" height="426" />; }

function Loading({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const leave = setTimeout(() => setLeaving(true), reduced ? 150 : 2100);
    const done = setTimeout(onDone, reduced ? 300 : 2600);
    return () => { clearTimeout(leave); clearTimeout(done); };
  }, [onDone]);
  return <div className={`loading-screen ${leaving ? "loading-leaving" : ""}`} role="status" aria-live="polite"><div className="loading-orbit" aria-hidden="true" /><div className="loading-light light-one" aria-hidden="true" /><div className="loading-light light-two" aria-hidden="true" /><div className="loading-inner"><div className="logo-assembly" aria-label="Logo da UnDF se formando">{[0, 1, 2, 3].map(i => <img key={i} src="/undf-logo.png" alt="" className={`logo-piece piece-${i}`} aria-hidden="true" width="600" height="426" />)}</div><div className="loading-copy"><p className="eyebrow">GESTÃO ACADÊMICA</p><h1>Ponto docente</h1><p>Preparando seu espaço de trabalho</p></div><div className="loading-track" aria-hidden="true"><span /></div></div><button className="loading-skip" onClick={onDone}>Ir para o painel <ArrowRight size={16} /></button><p className="loading-footer">Universidade do Distrito Federal</p></div>;
}
function StatusBadge({ value }: { value: Status }) { return <span className={`status-badge status-${value === "Identificada" ? "done" : value === "Erro na leitura" ? "error" : value === "Processando" || value === "Enviada" ? "progress" : "empty"}`}><span />{value}</span>; }
function Avatar({ name, index = 0 }: { name: string; index?: number }) { return <span className={`avatar avatar-${index % 4}`}>{name.split(" ").filter(Boolean).slice(0, 2).map(p => p[0]).join("")}</span>; }
function Navigation({ view, navigate }: { view: View; navigate: (v: View) => void }) {
  return <header className="floating-nav">
    <button className="nav-brand" onClick={() => navigate("professores")} aria-label="UnDF — início"><Logo /><span><strong>Ponto docente</strong><small>Gestão acadêmica</small></span></button>
    <nav className="nav-segments" aria-label="Navegação principal">
      <button aria-current={view !== "folhas" ? "page" : undefined} onClick={() => navigate("professores")}><Users size={17} />Professores</button>
      <button aria-current={view === "folhas" ? "page" : undefined} onClick={() => navigate("folhas")}><FileText size={17} />Folhas de ponto</button>
    </nav>
    <div className="nav-account"><span className="account-dot" /><span>Administração</span><Avatar name="Administração UnDF" /></div>
  </header>;
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const finishLoading = useCallback(() => setLoading(false), []);
  const [professors, setProfessors] = useState<Professor[]>(createDemoData);
  const [storageReady, setStorageReady] = useState(false);
  const storageQueue = useRef(Promise.resolve());
  useEffect(() => { loadProfessors().then(data => { if (data) setProfessors(data); setStorageReady(true); }).catch(() => toast.error("Não foi possível abrir o armazenamento local. Recarregue a página.")); }, []);
  useEffect(() => { if (storageReady) { storageQueue.current = storageQueue.current.then(() => persistProfessors(professors)).catch(() => { toast.error("Não foi possível salvar os dados neste navegador. Mantenha uma cópia dos arquivos originais."); }); } }, [professors, storageReady]);
  const [month, setMonth] = useState(INITIAL_MONTH);
  const [view, setView] = useState<View>("professores");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Todas as situações");
  const [edit, setEdit] = useState<Professor | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [isNewProfessor, setIsNewProfessor] = useState(false);
  function openProfessorEditor(professor: Professor, isNew = false) {
    setEdit(professor);
    setIsNewProfessor(isNew);
    setFormError("");
    setEditOpen(true);
  }
  const [formError, setFormError] = useState("");

  const [sheetMonth, setSheetMonth] = useState(INITIAL_MONTH);
  const [historyYear, setHistoryYear] = useState("2026");
  const [send, setSend] = useState<{ ids: string[]; month: string } | null>(null);
  const [audience, setAudience] = useState("all");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [receipt, setReceipt] = useState<BatchReceipt | null>(null);
  const batchLock = useRef(false);
  const batchKeys = useRef(new Map<string, string>());
  const selected = professors.find(p => p.id === selectedId);
  const current = (p: Professor) => p.sheets[month];
  const finished = professors.filter(p => sheetStatus(current(p)) === "Identificada").length;
  const notStarted = professors.filter(p => sheetStatus(current(p)) === "Sem folha").length;
  const progress = professors.filter(p => current(p)?.status === "processing").length;
  const errors = professors.filter(p => current(p)?.status === "error").length;
  const uploaded = professors.filter(p => current(p)?.status === "uploaded").length;
  const visible = useMemo(() => { const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); const q = normalize(query); return professors.filter(p => normalize(`${p.name} ${p.registration}`).includes(q) && (filter === "Todas as situações" || sheetStatus(p.sheets[month]) === filter)); }, [professors, query, filter, month]);
  const recipients = send ? professors.filter(p => send.ids.includes(p.id) && (audience === "all" || sheetStatus(p.sheets[send.month]) !== "Identificada")) : [];
  function navigate(v: View) { setView(v); setQuery(""); setFilter("Todas as situações"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openProfile(p: Professor) { setSelectedId(p.id); setView("perfil"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openSheet(p: Professor, period: string) { setSelectedId(p.id); setSheetMonth(period); setFormError(""); setView("folha"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openSend(ids: string[], period = month) { setSend({ ids, month: period }); setAudience("all"); setSendError(""); setReceipt(null); }
  async function submitBatch() {
    if (!send || !recipients.length || batchLock.current || receipt) return;
    batchLock.current = true;
    setSending(true);
    setSendError("");
    const batch = { month: send.month, professorIds: recipients.map(p => p.id).sort() };
    const signature = JSON.stringify(batch);
    let key = batchKeys.current.get(signature);
    if (!key) { key = crypto.randomUUID(); batchKeys.current.set(signature, key); }
    try {
      const result = await sendSheetBatch(batch, key);
      setReceipt(result);
      toast.success(`Lote recebido: ${result.acceptedCount} folhas na fila de envio.`);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Não foi possível confirmar o envio.");
    } finally { batchLock.current = false; setSending(false); }
  }
  function saveProfessor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!edit) return;
    const cleaned = { ...edit, name: edit.name.trim(), registration: edit.registration.trim(), email: edit.email.trim() };
    if (!cleaned.name || !/^\d{4,16}$/.test(cleaned.registration) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned.email)) { setFormError("Preencha um nome, uma matrícula de 4 a 16 dígitos e um e-mail válido."); return; }
    if (professors.some(p => p.id !== edit.id && p.registration === cleaned.registration)) { setFormError("Essa matrícula já está cadastrada."); return; }
    setProfessors(ps => isNewProfessor ? [...ps, cleaned] : ps.map(p => p.id === cleaned.id ? cleaned : p));
    if (isNewProfessor) { setQuery(""); setFilter("Todas as situações"); }
    setEditOpen(false);
    toast.success(isNewProfessor ? "Professor adicionado neste navegador." : "Dados do professor atualizados neste navegador.");
  }

  useEffect(() => {
    type Tool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => unknown };
    const context = (document as Document & { modelContext?: { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context) return; const life = new AbortController();
    try { Promise.resolve(context.registerTool({ name: "consultar_professores", description: "Consultar professores e situação da folha na competência exibida, sem alterar dados.", inputSchema: { type: "object", properties: { busca: { type: "string" } }, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: (input) => { if (!input || typeof input !== "object" || ("busca" in input && typeof input.busca !== "string")) throw new Error("Busca inválida"); const q = ("busca" in input ? String(input.busca) : "").toLowerCase(); return professors.filter(p => (p.name + p.registration).toLowerCase().includes(q)).map(p => ({ nome: p.name, matricula: p.registration, competencia: month, situacao: sheetStatus(p.sheets[month]) })); } }, { signal: life.signal })).catch(() => {}); } catch { /* Optional browser API. */ }
    return () => life.abort();
  }, [professors, month]);

  return <><div inert={loading || !storageReady || undefined}><div className="app-shell"><Navigation view={view} navigate={navigate} /><div className="app-main">
    <header className="topbar"><div className="breadcrumb"><span>Gestão acadêmica</span><span className="slash">/</span><strong>{view === "professores" ? "Professores" : view === "folhas" ? "Folhas de ponto" : selected?.name}</strong></div><div className="topbar-right"><button aria-label="Ver professores sem folha" className="notification" onClick={() => { navigate("professores"); setFilter("Sem folha"); }}><Bell size={19} /><i /></button></div></header>
    <main className="workspace" id="main-content">
    {(view === "professores" || view === "folhas") && <div className="view-enter"><div className="page-heading"><div><h1>{view === "folhas" ? "Folhas de ponto" : "Professores"}<span className="count-pill">{professors.length}</span></h1></div><div className="heading-actions"><label className="month-control"><CalendarDays size={17} /><input type="month" aria-label="Competência" min="2000-01" max="2099-12" value={month} onChange={e => /^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value) && setMonth(e.target.value)} /></label><Button onClick={() => openSend(professors.map(p => p.id))}><Send size={16} />Enviar folhas do mês</Button></div></div>
    <section className="stats" aria-label="Resumo mensal"><article className="stat"><div><p>Professores cadastrados</p><strong>{professors.length}<small>professores</small></strong><span>Todos os vínculos ativos</span></div><div className="stat-icon"><Users /></div></article><article className="stat"><div><p>Folhas identificadas</p><strong>{finished}<small>de {professors.length}</small></strong><span>{Math.round(finished / (professors.length || 1) * 100)}% do mês concluído</span></div><div className="stat-icon soft"><CheckCheck /></div><div className="stat-progress"><i style={{ width: `${finished / (professors.length || 1) * 100}%` }} /></div></article><article className="stat"><div><p>Folhas pendentes</p><strong>{professors.length - finished}<small>aguardando conclusão</small></strong><span>{progress} processando · {errors} com erro · {uploaded} enviadas · {notStarted} sem folha</span></div><div className="stat-icon neutral"><Clock3 /></div></article></section>
    {notStarted > 0 && <div className="pending-alert"><div><AlertCircle size={19} /><p><strong>{notStarted} professores</strong> ainda não enviaram a folha de {monthLabel(month).toLowerCase()}.</p></div><button onClick={() => { setFilter("Sem folha"); setQuery(""); document.getElementById("professor-table")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Ver pendentes <ArrowRight size={16} /></button></div>}
    <section className="table-card" id="professor-table"><div className="table-toolbar professor-toolbar"><label className="search-field"><Search size={18} /><Input placeholder="Buscar por nome ou matrícula" aria-label="Buscar por nome ou matrícula" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="Limpar pesquisa" onClick={() => setQuery("")}><X size={16} /></button>}</label><select aria-label="Filtrar situação" value={filter} onChange={e => setFilter(e.target.value)}><option>Todas as situações</option><option>Identificada</option><option>Enviada</option><option>Processando</option><option>Erro na leitura</option><option>Sem folha</option></select>{view === "professores" && <Button variant="outline" onClick={() => { openProfessorEditor({ id: crypto.randomUUID(), name: "", registration: "", email: "", department: "", sheets: {} }, true); }}><Plus size={16} />Adicionar professor</Button>}<span className="result-count">{visible.length} {visible.length === 1 ? "resultado" : "resultados"}</span></div><div className="table-scroll"><table><thead><tr><th>Matrícula</th><th>Professor</th><th>Documento</th><th>Situação da folha</th><th className="actions-head">Ações</th></tr></thead><tbody>{visible.map((p, i) => <tr key={p.id}><td className="registration">{p.registration}</td><td><button className="professor-cell" onClick={() => view === "folhas" ? openSheet(p, month) : openProfile(p)}><Avatar name={p.name} index={i} /><span><strong>{p.name}</strong><small>{p.department}</small></span></button></td><td className="hours-cell">{current(p)?.attachment.name || "—"}</td><td><StatusBadge value={sheetStatus(current(p))} /></td><td><div className="row-actions"><button className="text-action" onClick={() => view === "folhas" ? openSheet(p, month) : openProfile(p)}>{view === "folhas" ? "Abrir folha" : "Ver detalhes"}<ArrowRight size={14} /></button><button className="icon-button" aria-label={`Editar ${p.name}`} title="Editar professor" onClick={() => { openProfessorEditor({ ...p }); }}><Pencil size={16} /></button></div></td></tr>)}</tbody></table></div>{!visible.length && <div className="empty-state"><Search size={30} /><h3>Nenhum professor encontrado</h3><p>Tente outro nome, matrícula ou situação.</p><Button variant="outline" onClick={() => { setQuery(""); setFilter("Todas as situações"); }}>Limpar filtros</Button></div>}<footer className="table-footer"><span>Exibindo {visible.length} de {professors.length} professores</span><span>{monthLabel(month)}</span></footer></section></div>}

    {view === "perfil" && selected && <div className="view-enter"><button className="back-button" onClick={() => navigate("professores")}><ArrowLeft size={16} />Voltar para professores</button><div className="profile-heading"><div className="profile-name"><Avatar name={selected.name} /><div><p className="eyebrow">PERFIL DO PROFESSOR</p><h1>{selected.name}</h1><p>Matrícula {selected.registration}<span>·</span>{selected.email}</p></div></div><Button variant="outline" onClick={() => { openProfessorEditor({ ...selected }); }}><Pencil size={16} />Editar professor</Button></div><section className="stats profile-stats"><article className="stat"><div><p>Competência</p><strong className="date-stat">{monthLabel(month)}</strong><span>{current(selected)?.attachment.name || "Sem documento"}</span></div><div className="stat-icon"><FileText /></div></article><article className="stat"><div><p>Situação da folha</p><div className="status-stat"><StatusBadge value={sheetStatus(current(selected))} /></div><span>{current(selected)?.confirmedAt ? "Disponível para conferência" : "Aguardando conferência"}</span></div><div className="stat-icon soft"><FileText /></div></article><article className="stat"><div><p>Última atualização</p><strong className="date-stat">{current(selected)?.updatedAt ? new Date(current(selected)!.updatedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—"}</strong><span>{monthLabel(month)}</span></div><div className="stat-icon neutral"><CalendarDays /></div></article></section><div className="section-heading"><div><h2>Histórico de folhas</h2><p>Todas as competências, em um só lugar.</p></div><Button onClick={() => openSend([selected.id])}><Mail size={16} />Enviar folha do mês</Button></div><section className="table-card"><div className="table-toolbar"><select aria-label="Ano do histórico" value={historyYear} onChange={e => setHistoryYear(e.target.value)}>{Array.from(new Set([...Object.keys(selected.sheets).map(k => k.slice(0, 4)), month.slice(0, 4)])).sort().reverse().map(y => <option key={y} value={y}>Ano: {y}</option>)}</select><Button variant="outline" onClick={() => openSheet(selected, month)}>Abrir competência atual</Button></div><div className="table-scroll"><table><thead><tr><th>Competência</th><th>Documento</th><th>Situação</th><th className="actions-head">Ações</th></tr></thead><tbody>{Array.from({ length: 12 }, (_, i) => `${historyYear}-${String(i + 1).padStart(2, "0")}`).map(m => { const s = selected.sheets[m]; return <tr key={m}><td><span className="month-cell"><FileText size={18} />{monthLabel(m)}</span></td><td className="hours-cell">{s?.attachment.name || "—"}</td><td><StatusBadge value={sheetStatus(s)} /></td><td><div className="row-actions"><button className="text-action" onClick={() => openSheet(selected, m)}>Abrir folha</button><button className="icon-button" aria-label={`Baixar folha de ${monthLabel(m)}`} disabled={!s?.attachment} onClick={() => downloadSheet(selected, m)}><Download size={16} /></button><button className="icon-button" aria-label={`Enviar folha de ${monthLabel(m)}`} onClick={() => openSend([selected.id], m)}><Mail size={16} /></button></div></td></tr>; })}</tbody></table></div></section></div>}

    {view === "folha" && selected && <DocumentSheet key={`${selected.id}-${sheetMonth}`} professor={selected} professors={professors} month={sheetMonth} onMonth={setSheetMonth} onBack={() => setView("perfil")} onChange={setProfessors} onLinked={(id, period) => { console.log("PROFESSOR VINCULADO:", id, period); setSelectedId(id); setSheetMonth(period); }} />}
    <footer className="workspace-footer"><span>UnDF · Gestão de ponto docente</span></footer></main></div></div></div>

    <Sheet open={editOpen} onOpenChange={setEditOpen}><SheetContent className="edit-sheet"><SheetHeader><span className="eyebrow">CADASTRO</span><SheetTitle>{isNewProfessor ? "Adicionar professor" : "Editar professor"}</SheetTitle><SheetDescription>{isNewProfessor ? "Preencha os dados de identificação e contato." : "Atualize os dados de identificação e contato."}</SheetDescription></SheetHeader>{edit && <form onSubmit={saveProfessor} className="edit-form"><div className="edit-avatar"><Avatar name={edit.name} /></div><label>Nome completo<Input required maxLength={120} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label><label>Matrícula<Input required inputMode="numeric" pattern="[0-9]{4,16}" value={edit.registration} onChange={e => setEdit({ ...edit, registration: e.target.value })} /></label><label>E-mail institucional<Input required type="email" maxLength={254} value={edit.email} onChange={e => setEdit({ ...edit, email: e.target.value })} /></label><label>Área de atuação<Input value={edit.department} maxLength={100} onChange={e => setEdit({ ...edit, department: e.target.value })} /></label>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="edit-form-footer"><Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button><Button type="submit">{isNewProfessor ? "Adicionar professor" : "Salvar alterações"}</Button></div></form>}</SheetContent></Sheet>
    <Dialog open={!!send} onOpenChange={open => !open && !batchLock.current && setSend(null)}>
      <DialogContent className="send-dialog" onEscapeKeyDown={event => { if (batchLock.current) event.preventDefault(); }} onInteractOutside={event => { if (batchLock.current) event.preventDefault(); }}>
        <DialogHeader><div className="dialog-icon"><Mail size={24} /></div><DialogTitle>{receipt ? "Lote na fila de envio" : "Enviar folhas do mês"}</DialogTitle><DialogDescription>{receipt ? "O serviço recebeu o lote. A entrega dos e-mails será processada em segundo plano." : "Uma única ação para enviar a folha de cada professor ao respectivo e-mail."}</DialogDescription></DialogHeader>
        {send && <>
          <div className="send-month"><CalendarDays size={19} /><div><small>COMPETÊNCIA</small><strong>{monthLabel(send.month)}</strong></div></div>
          {send.ids.length > 1 && !receipt && <RadioGroup className="audience-options" disabled={sending} value={audience} onValueChange={v => { setAudience(v); setSendError(""); }}><label><RadioGroupItem value="all" /><div><strong>Todos os professores</strong><span>{send.ids.length} destinatários</span></div></label><label><RadioGroupItem value="pending" /><div><strong>Somente com pendência</strong><span>Folhas processando ou sem folha</span></div></label></RadioGroup>}
          <div className="recipient-list" aria-label="Destinatários do lote">{recipients.map(p => <div key={p.id}><Avatar name={p.name} /><span><strong>{p.name}</strong><small>{p.email}</small></span><FileText size={15} /></div>)}</div>
          {receipt && <p role="status" className="email-note">{receipt.acceptedCount} folhas aceitas para processamento. Protocolo: {receipt.jobId}</p>}
          {sendError && <p role="alert" className="form-error">{sendError}</p>}
          {!receipt && <p className="email-note"><AlertCircle size={17} /><span>Cada destinatário recebe somente sua própria folha. O envio requer o serviço de e-mail conectado.</span></p>}
          <DialogFooter><Button variant="outline" disabled={sending} onClick={() => setSend(null)}>{receipt ? "Concluir" : "Cancelar"}</Button>{!receipt && <Button disabled={sending || !recipients.length} onClick={submitBatch} aria-busy={sending}><Send size={16} />{sending ? "Enviando lote…" : sendError ? "Tentar novamente" : recipients.length === 1 ? "Enviar folha" : `Enviar todas (${recipients.length})`}</Button>}</DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
    <Toaster position="bottom-right" richColors />{loading && <Loading onDone={finishLoading} />}
  </>;
}
