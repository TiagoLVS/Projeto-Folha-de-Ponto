"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Bell, CalendarDays, CheckCheck, Clock3, Download, FileText, Mail, Pencil, Plus, Search, Send, Users, X, AlertCircle, Trash2, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { toast } from "sonner";
import { monthLabel, sheetStatus, type Professor, type Status } from "@/lib/ponto";
import { DocumentSheet } from "@/components/document-sheet";
import { attachRemoteSheets, listTimesheets, canEmailSheet } from "@/lib/timesheet-api";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { TimesheetUpload } from "@/components/timesheet-upload";
import { ServerImportDialog } from "@/components/server-import-dialog";
import { AcademicCalendar } from "@/components/academic-calendar";
import { EmailHistory } from "@/components/email-history";
import { useSystemLock } from "@/components/system-lock";
import { listProfessors, saveProfessor as saveProfessorOnServer, deleteProfessor } from "@/lib/professor-api";
import { downloadSheet } from "@/lib/export-sheet";
import { getBatchKey, sendSheetBatch, type BatchReceipt } from "@/lib/send-sheets";

type View = "professores" | "folhas" | "perfil" | "folha" | "calendario" | "emails";
const INITIAL_MONTH = new Date().toISOString().slice(0, 7);
function Logo() { return <Image unoptimized className="undf-logo" src="/undf-logo.png" alt="UnDF — Universidade do Distrito Federal" width="600" height="426" />; }

function Loading({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const leave = setTimeout(() => setLeaving(true), reduced ? 150 : 2100);
    const done = setTimeout(onDone, reduced ? 300 : 2600);
    return () => { clearTimeout(leave); clearTimeout(done); };
  }, [onDone]);
  return <div className={`loading-screen ${leaving ? "loading-leaving" : ""}`} role="status" aria-live="polite"><div className="loading-orbit" aria-hidden="true" /><div className="loading-light light-one" aria-hidden="true" /><div className="loading-light light-two" aria-hidden="true" /><div className="loading-inner"><div className="logo-assembly" aria-label="Logo da UnDF se formando">{[0, 1, 2, 3].map(i => <Image unoptimized key={i} src="/undf-logo.png" alt="" className={`logo-piece piece-${i}`} aria-hidden="true" width="600" height="426" />)}</div><div className="loading-copy"><p className="eyebrow">GESTÃO ACADÊMICA</p><h1>Ponto docente</h1><p>Preparando seu espaço de trabalho</p></div><div className="loading-track" aria-hidden="true"><span /></div></div><button className="loading-skip" onClick={onDone}>Ir para o painel <ArrowRight size={16} /></button><p className="loading-footer">Universidade do Distrito Federal</p></div>;
}
function StatusBadge({ value }: { value: Status }) { return <span className={`status-badge status-${value === "Identificada" ? "done" : value === "Erro na leitura" ? "error" : value === "Processando" || value === "Enviada" ? "progress" : "empty"}`}><span />{value}</span>; }
function Avatar({ name, index = 0 }: { name: string; index?: number }) { return <span className={`avatar avatar-${index % 4}`}>{name.split(" ").filter(Boolean).slice(0, 2).map(p => p[0]).join("")}</span>; }
function Navigation({ view, navigate }: { view: View; navigate: (v: View) => void }) {
  return <header className="floating-nav">
    <button className="nav-brand" onClick={() => navigate("professores")} aria-label="UnDF — início"><Logo /><span><strong>Ponto docente</strong><small>Gestão acadêmica</small></span></button>
    <nav className="nav-segments !grid-cols-2 xl:!grid-cols-4" aria-label="Navegação principal">
      <button aria-current={["professores", "perfil", "folha"].includes(view) ? "page" : undefined} onClick={() => navigate("professores")}><Users size={17} />Professores</button>
      <button aria-current={view === "folhas" ? "page" : undefined} onClick={() => navigate("folhas")}><FileText size={17} />Folhas de ponto</button>
      <button aria-current={view === "calendario" ? "page" : undefined} onClick={() => navigate("calendario")}><CalendarDays size={17} />Calendário</button>
      <button aria-current={view === "emails" ? "page" : undefined} onClick={() => navigate("emails")}><Mail size={17} />E-mails</button>
    </nav>
    <div className="nav-account"><span className="account-dot" /><span>Administração</span><Avatar name="Administração UnDF" /></div>
  </header>;
}

export function PontoApp({ initialView = "professores" }: { initialView?: "professores" | "calendario" | "emails" }) {
  const [loading, setLoading] = useState(true);
  const finishLoading = useCallback(() => setLoading(false), []);
  const [professors, setProfessors] = useState<Professor[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [dataError, setDataError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const reload = () => setLoadAttempt(attempt => attempt + 1);
  const { blocked, locked, unavailable } = useSystemLock();
  const professorSaveError = blocked ? (locked ? "O sistema está em uso por outro usuário. Aguarde a liberação para salvar." : unavailable ? "Não foi possível verificar a disponibilidade do sistema. Tente novamente para liberar o salvamento." : "Verificando a disponibilidade do sistema. Aguarde para salvar.") : "";
  const [selection, setSelection] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [removing, setRemoving] = useState<Professor | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteGuard = useRef(false);
  useEffect(() => {
    let active = true;
    Promise.allSettled([listProfessors(), listTimesheets()]).then(([people, sheets]) => {
      if (!active) return;
      if (people.status === 'rejected') {
        setDataError(people.reason instanceof Error ? people.reason.message : 'Não foi possível carregar os servidores.');
        setStorageReady(true); setHistoryReady(false); return;
      }
      let records = people.value;
      let problem = '';
      if (sheets.status === 'fulfilled') {
        try { records = attachRemoteSheets(records, sheets.value); }
        catch (error) { problem = error instanceof Error ? error.message : 'Histórico inválido.'; }
      } else problem = sheets.reason instanceof Error ? sheets.reason.message : 'Histórico remoto indisponível.';
      setProfessors(records); setHistoryError(problem); setHistoryReady(!problem); setDataError(''); setStorageReady(true);
    });
    return () => { active = false; };
  }, [loadAttempt]);
  async function removeProfessor() {
    if (!removing || deleteGuard.current || blocked) return;
    deleteGuard.current = true; setDeleting(true);
    try {
      await deleteProfessor(removing.id);
      setProfessors(ps => ps.filter(p => p.id !== removing.id));
      setSelection(ids => ids.filter(id => id !== removing.id));
      if (selectedId === removing.id) { setSelectedId(null); setView('professores'); }
      setRemoving(null); toast.success('Servidor excluído.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao excluir servidor.'); }
    finally { deleteGuard.current = false; setDeleting(false); }
  }
  const [month, setMonth] = useState(INITIAL_MONTH);
  const [view, setView] = useState<View>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Todas as situações");
  const [edit, setEdit] = useState<Professor | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [isNewProfessor, setIsNewProfessor] = useState(false);
  const [savingProfessor, setSavingProfessor] = useState(false);
  const professorLock = useRef(false);
  function openProfessorEditor(professor: Professor, isNew = false) {
    setEdit(professor);
    setIsNewProfessor(isNew);
    setFormError("");
    setEditOpen(true);
  }
  const [formError, setFormError] = useState("");

  const [sheetMonth, setSheetMonth] = useState(INITIAL_MONTH);
  const [historyYear, setHistoryYear] = useState(INITIAL_MONTH.slice(0, 4));
  const [send, setSend] = useState<{ ids: string[]; month: string } | null>(null);
  const [audience, setAudience] = useState("all");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [receipt, setReceipt] = useState<BatchReceipt | null>(null);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
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
  const sendCandidates = send ? professors.filter(p => send.ids.includes(p.id)) : [];
  const recipients = send ? sendCandidates.filter(p => receipt ? completedIds.includes(p.id) : canEmailSheet(p.sheets[send.month]) && p.email && (audience === "all" || !['ENVIADO', 'PROCESSANDO'].includes(p.sheets[send.month]?.email?.status ?? ''))) : [];
  const selectable = visible.filter(p => historyReady && canEmailSheet(p.sheets[month]) && p.email);
  const allChecked = selectable.length > 0 && selectable.every(p => selection.includes(p.id));
  function navigate(v: View) { setView(v); setQuery(""); setFilter("Todas as situações"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openProfile(p: Professor) { setSelectedId(p.id); setView("perfil"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openSheet(p: Professor, period: string) { setSelectedId(p.id); setSheetMonth(period); setFormError(""); setView("folha"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openSend(ids: string[], period = month) { setSend({ ids, month: period }); setAudience("all"); setSendError(""); setReceipt(null); setCompletedIds([]); }
  async function submitBatch() {
    if (!send || !recipients.length || batchLock.current || receipt || blocked || !historyReady) return;
    batchLock.current = true;
    setSending(true);
    setSendError("");
    const batch = { month: send.month, professorIds: recipients.map(p => p.id).sort() };
    const signature = JSON.stringify(batch);
    let key = batchKeys.current.get(signature);
    if (!key) { key = getBatchKey(batch); batchKeys.current.set(signature, key); }
    try {
      const result = await sendSheetBatch(batch, key);
      setCompletedIds(batch.professorIds);
      setReceipt(result);
      batchKeys.current.delete(signature);
      toast.success(`${result.sentCount} folhas enviadas com sucesso.`);
      setProfessors(ps => ps.map(p => batch.professorIds.includes(p.id) && p.sheets[batch.month] ? { ...p, sheets: { ...p.sheets, [batch.month]: { ...p.sheets[batch.month], email: { status: 'ENVIADO', mensagem: 'Envio confirmado pelo servidor.' } } } } : p));
      setSelection(ids => ids.filter(id => !batch.professorIds.includes(id)));
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Não foi possível confirmar o envio.");
    } finally { batchLock.current = false; setSending(false); }
  }
  async function saveProfessor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!edit || professorLock.current || blocked) return;
    const cleaned = { ...edit, name: edit.name.trim(), registration: edit.registration.trim(), email: edit.email.trim() };
    if (!cleaned.name || !/^\d{4,16}$/.test(cleaned.registration) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned.email)) { setFormError("Preencha um nome, uma matrícula de 4 a 16 dígitos e um e-mail válido."); return; }
    if (cleaned.workload !== null && (!Number.isInteger(cleaned.workload) || cleaned.workload < 1 || cleaned.workload > 2147483647)) { setFormError("Informe uma carga horária inteira maior que zero ou deixe o campo em branco."); return; }
    if (professors.some(p => p.id !== edit.id && p.registration === cleaned.registration)) { setFormError("Essa matrícula já está cadastrada."); return; }
    professorLock.current = true;
    setSavingProfessor(true);
    setFormError("");
    try {
      const saved = await saveProfessorOnServer(cleaned, isNewProfessor);
      setProfessors(ps => isNewProfessor ? [...ps, saved] : ps.map(p => p.id === saved.id ? { ...saved, sheets: p.sheets } : p));
      if (isNewProfessor) { setQuery(""); setFilter("Todas as situações"); }
      setEditOpen(false);
      toast.success(isNewProfessor ? "Professor cadastrado." : "Dados do professor atualizados.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível salvar o professor. Tente novamente.");
    } finally {
      professorLock.current = false;
      setSavingProfessor(false);
    }
  }

  useEffect(() => {
    type Tool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => unknown };
    const context = (document as Document & { modelContext?: { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context) return; const life = new AbortController();
    try { Promise.resolve(context.registerTool({ name: "consultar_professores", description: "Consultar professores e situação da folha na competência exibida, sem alterar dados.", inputSchema: { type: "object", properties: { busca: { type: "string" } }, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: (input) => { if (!input || typeof input !== "object" || ("busca" in input && typeof input.busca !== "string")) throw new Error("Busca inválida"); const q = ("busca" in input ? String(input.busca) : "").toLowerCase(); return professors.filter(p => (p.name + p.registration).toLowerCase().includes(q)).map(p => ({ nome: p.name, matricula: p.registration, competencia: month, situacao: sheetStatus(p.sheets[month]) })); } }, { signal: life.signal })).catch(() => {}); } catch { /* Optional browser API. */ }
    return () => life.abort();
  }, [professors, month]);

  return <><div inert={loading || !storageReady || undefined}><div className="app-shell"><Navigation view={view} navigate={navigate} /><div className="app-main">
    <header className="topbar"><div className="breadcrumb"><span>Gestão acadêmica</span><span className="slash">/</span><strong>{view === "calendario" ? "Calendário acadêmico" : view === "emails" ? "Histórico de e-mails" : view === "professores" ? "Professores" : view === "folhas" ? "Folhas de ponto" : selected?.name}</strong></div><div className="topbar-right"><button aria-label="Ver professores sem folha" className="notification" onClick={() => { navigate("professores"); setFilter("Sem folha"); }}><Bell size={19} /><i /></button></div></header>
    <main className="workspace" id="main-content">
    {dataError && <Alert variant="destructive" className="mb-4"><AlertDescription>{dataError}<Button variant="outline" onClick={reload}>Tentar novamente</Button></AlertDescription></Alert>}
    {historyError && ['professores', 'folhas', 'perfil', 'folha'].includes(view) && <Alert className="mb-4"><AlertDescription>Histórico remoto indisponível: {historyError} <Button variant="outline" onClick={reload}>Atualizar histórico</Button></AlertDescription></Alert>}
    {view === "calendario" && <AcademicCalendar />}
    {view === "emails" && <EmailHistory />}

    {(view === "professores" || view === "folhas") && <div className="view-enter"><div className="page-heading"><div><h1>{view === "folhas" ? "Folhas de ponto" : "Professores"}<span className="count-pill">{professors.length}</span></h1></div><div className="heading-actions flex-wrap"><label className="month-control"><CalendarDays size={17} /><Input type="month" aria-label="Competência" min="2000-01" max="2099-12" value={month} onChange={e => /^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value) && (setMonth(e.target.value), setSelection([]))} /></label><Button variant="outline" disabled={blocked || !historyReady} onClick={() => setUploadOpen(true)}><Upload size={16} />Adicionar PDFs</Button><Button disabled={blocked || !historyReady || !selection.some(id => professors.some(p => p.id === id && canEmailSheet(p.sheets[month])))} onClick={() => openSend(selection)}><Send size={16} />Enviar selecionados ({selection.filter(id => professors.some(p => p.id === id && canEmailSheet(p.sheets[month]))).length})</Button></div></div>
    <section className="stats" aria-label="Resumo mensal"><article className="stat"><div><p>Professores cadastrados</p><strong>{professors.length}<small>professores</small></strong><span>Todos os vínculos ativos</span></div><div className="stat-icon"><Users /></div></article><article className="stat"><div><p>Folhas identificadas</p><strong>{finished}<small>de {professors.length}</small></strong><span>{Math.round(finished / (professors.length || 1) * 100)}% do mês concluído</span></div><div className="stat-icon soft"><CheckCheck /></div><div className="stat-progress"><i style={{ width: `${finished / (professors.length || 1) * 100}%` }} /></div></article><article className="stat"><div><p>Folhas pendentes</p><strong>{professors.length - finished}<small>aguardando conclusão</small></strong><span>{progress} processando · {errors} com erro · {uploaded} enviadas · {notStarted} sem folha</span></div><div className="stat-icon neutral"><Clock3 /></div></article></section>
    {notStarted > 0 && <div className="pending-alert"><div><AlertCircle size={19} /><p><strong>{notStarted} professores</strong> ainda não enviaram a folha de {monthLabel(month).toLowerCase()}.</p></div><button onClick={() => { setFilter("Sem folha"); setQuery(""); document.getElementById("professor-table")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Ver pendentes <ArrowRight size={16} /></button></div>}
    <section className="table-card" id="professor-table"><div className="table-toolbar professor-toolbar"><label className="search-field"><Search size={18} /><Input placeholder="Buscar por nome ou matrícula" aria-label="Buscar por nome ou matrícula" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="Limpar pesquisa" onClick={() => setQuery("")}><X size={16} /></button>}</label><NativeSelect aria-label="Filtrar situação" value={filter} onChange={e => setFilter(e.target.value)}><NativeSelectOption>Todas as situações</NativeSelectOption><NativeSelectOption>Identificada</NativeSelectOption><NativeSelectOption>Enviada</NativeSelectOption><NativeSelectOption>Processando</NativeSelectOption><NativeSelectOption>Erro na leitura</NativeSelectOption><NativeSelectOption>Sem folha</NativeSelectOption></NativeSelect>{view === "professores" && <Button variant="outline" disabled={savingProfessor} onClick={() => { openProfessorEditor({ id: crypto.randomUUID(), name: "", registration: "", email: "", department: "", workload: null, sheets: {} }, true); }}><Plus size={16} />Adicionar professor</Button>}{view === 'professores' && <Button variant="outline" disabled={blocked || !!dataError} onClick={() => setImportOpen(true)}><FileSpreadsheet size={16} />Importar Excel</Button>}<span className="result-count">{visible.length} {visible.length === 1 ? "resultado" : "resultados"}</span></div><div className="table-scroll"><Table><TableHeader><TableRow><TableHead><Checkbox aria-label="Selecionar todas as folhas aptas visíveis" checked={allChecked ? true : selectable.some(p => selection.includes(p.id)) ? 'indeterminate' : false} disabled={blocked || !selectable.length} onCheckedChange={checked => setSelection(ids => checked === true ? [...new Set([...ids, ...selectable.map(p => p.id)])] : ids.filter(id => !selectable.some(p => p.id === id)))} /></TableHead><TableHead>Matrícula</TableHead><TableHead>Professor</TableHead><TableHead>Documento</TableHead><TableHead>Situação da folha</TableHead><TableHead className="actions-head">Ações</TableHead></TableRow></TableHeader><TableBody>{visible.map((p, i) => <TableRow key={p.id}><TableCell><Checkbox aria-label={`Selecionar ${p.name} para envio`} checked={selection.includes(p.id)} disabled={blocked || !historyReady || !canEmailSheet(current(p)) || !p.email} onCheckedChange={checked => setSelection(ids => checked === true ? [...new Set([...ids, p.id])] : ids.filter(id => id !== p.id))} /></TableCell><TableCell className="registration">{p.registration}</TableCell><TableCell><button className="professor-cell" onClick={() => view === "folhas" ? openSheet(p, month) : openProfile(p)}><Avatar name={p.name} index={i} /><span><strong>{p.name}</strong><small>{p.department}</small></span></button></TableCell><TableCell className="hours-cell">{current(p)?.attachment.name || "—"}</TableCell><TableCell><StatusBadge value={sheetStatus(current(p))} /></TableCell><TableCell><div className="row-actions"><button className="text-action" onClick={() => view === "folhas" ? openSheet(p, month) : openProfile(p)}>{view === "folhas" ? "Abrir folha" : "Ver detalhes"}<ArrowRight size={14} /></button><button className="icon-button" aria-label={`Editar ${p.name}`} title="Editar professor" disabled={blocked} onClick={() => { openProfessorEditor({ ...p }); }}><Pencil size={16} /></button><Button variant="ghost" size="icon" className="icon-button text-destructive" aria-label={`Excluir ${p.name}`} disabled={blocked || deleting} onClick={() => setRemoving(p)}><Trash2 size={16} /></Button></div></TableCell></TableRow>)}</TableBody></Table></div>{!visible.length && <div className="empty-state"><Search size={30} /><h3>Nenhum professor encontrado</h3><p>Tente outro nome, matrícula ou situação.</p><Button variant="outline" onClick={() => { setQuery(""); setFilter("Todas as situações"); }}>Limpar filtros</Button></div>}<footer className="table-footer"><span>Exibindo {visible.length} de {professors.length} professores</span><span>{monthLabel(month)}</span></footer></section></div>}

    {view === "perfil" && selected && <div className="view-enter"><button className="back-button" onClick={() => navigate("professores")}><ArrowLeft size={16} />Voltar para professores</button><div className="profile-heading"><div className="profile-name"><Avatar name={selected.name} /><div><p className="eyebrow">PERFIL DO PROFESSOR</p><h1>{selected.name}</h1><p>Matrícula {selected.registration}<span>·</span>{selected.email}</p></div></div><Button variant="outline" onClick={() => { openProfessorEditor({ ...selected }); }}><Pencil size={16} />Editar professor</Button></div><section className="stats profile-stats"><article className="stat"><div><p>Competência</p><strong className="date-stat">{monthLabel(month)}</strong><span>{current(selected)?.attachment.name || "Sem documento"}</span></div><div className="stat-icon"><FileText /></div></article><article className="stat"><div><p>Situação da folha</p><div className="status-stat"><StatusBadge value={sheetStatus(current(selected))} /></div><span>{current(selected)?.confirmedAt ? "Disponível para conferência" : "Aguardando conferência"}</span></div><div className="stat-icon soft"><FileText /></div></article><article className="stat"><div><p>Última atualização</p><strong className="date-stat">{current(selected)?.updatedAt ? new Date(current(selected)!.updatedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—"}</strong><span>{monthLabel(month)}</span></div><div className="stat-icon neutral"><CalendarDays /></div></article></section><div className="section-heading"><div><h2>Histórico de folhas</h2><p>Todas as competências, em um só lugar.</p></div><Button disabled={blocked || !historyReady || !canEmailSheet(current(selected))} onClick={() => openSend([selected.id])}><Mail size={16} />Enviar folha do mês</Button></div><section className="table-card"><div className="table-toolbar"><NativeSelect aria-label="Ano do histórico" value={historyYear} onChange={e => setHistoryYear(e.target.value)}>{Array.from(new Set([...Object.keys(selected.sheets).map(k => k.slice(0, 4)), month.slice(0, 4)])).sort().reverse().map(y => <NativeSelectOption key={y} value={y}>Ano: {y}</NativeSelectOption>)}</NativeSelect><Button variant="outline" onClick={() => openSheet(selected, month)}>Abrir competência atual</Button></div><div className="table-scroll"><Table><TableHeader><TableRow><TableHead>Competência</TableHead><TableHead>Documento</TableHead><TableHead>Situação</TableHead><TableHead className="actions-head">Ações</TableHead></TableRow></TableHeader><TableBody>{Array.from({ length: 12 }, (_, i) => `${historyYear}-${String(i + 1).padStart(2, "0")}`).map(m => { const s = selected.sheets[m]; return <TableRow key={m}><TableCell><span className="month-cell"><FileText size={18} />{monthLabel(m)}</span></TableCell><TableCell className="hours-cell">{s?.attachment.name || "—"}</TableCell><TableCell><StatusBadge value={sheetStatus(s)} /></TableCell><TableCell><div className="row-actions"><button className="text-action" onClick={() => openSheet(selected, m)}>Abrir folha</button><button className="icon-button" aria-label={`Baixar folha de ${monthLabel(m)}`} disabled={!s?.attachment} onClick={() => downloadSheet(selected, m)}><Download size={16} /></button><button className="icon-button" aria-label={`Enviar folha de ${monthLabel(m)}`} disabled={blocked || !historyReady || !canEmailSheet(s)} onClick={() => openSend([selected.id], m)}><Mail size={16} /></button></div></TableCell></TableRow>; })}</TableBody></Table></div></section></div>}

    {view === "folha" && selected && <DocumentSheet key={`${selected.id}-${sheetMonth}`} professor={selected} professors={professors} month={sheetMonth} onMonth={setSheetMonth} onBack={() => setView("perfil")} onChange={setProfessors} onLinked={(id, period) => { setSelectedId(id); setSheetMonth(period); }} />}
    <footer className="workspace-footer"><span>UnDF · Gestão de ponto docente</span></footer></main></div></div></div>

    <ServerImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={reload} />
    <Dialog open={uploadOpen} onOpenChange={setUploadOpen}><DialogContent className="send-dialog !w-[calc(100%-2rem)] !max-w-5xl"><DialogHeader><DialogTitle>Adicionar folhas de ponto</DialogTitle><DialogDescription>Selecione vários PDFs e informe o servidor e a competência de cada arquivo. Duplicidades exigem confirmação.</DialogDescription></DialogHeader><TimesheetUpload professors={professors} month={month} onSaved={(id, period, sheet) => setProfessors(ps => ps.map(p => p.id === id ? { ...p, sheets: { ...p.sheets, [period]: sheet } } : p))} /></DialogContent></Dialog>
    <ConfirmationDialog open={!!removing} title="Excluir servidor?" description={removing ? `Excluir ${removing.name}, matrícula ${removing.registration}? O servidor deve impedir a exclusão se houver vínculos que precisem ser preservados.` : ''} busy={deleting} disabled={blocked} confirmLabel="Excluir servidor" onConfirm={() => void removeProfessor()} onCancel={() => setRemoving(null)} />
    <Sheet open={editOpen} onOpenChange={open => { if (!professorLock.current) setEditOpen(open); }}><SheetContent className="edit-sheet"><SheetHeader><span className="eyebrow">CADASTRO</span><SheetTitle>{isNewProfessor ? "Adicionar professor" : "Editar professor"}</SheetTitle><SheetDescription>{isNewProfessor ? "Preencha os dados de identificação e contato." : "Atualize os dados de identificação e contato."}</SheetDescription></SheetHeader>{professorSaveError && <Alert variant="destructive" role="alert"><AlertDescription>{professorSaveError}{unavailable && <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>Tentar novamente</Button>}</AlertDescription></Alert>}{edit && <form onSubmit={saveProfessor} className="edit-form" aria-busy={savingProfessor}><div className="edit-avatar"><Avatar name={edit.name} /></div><label>Nome completo<Input required maxLength={120} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label><label>Matrícula<Input required inputMode="numeric" pattern="[0-9]{4,16}" value={edit.registration} onChange={e => setEdit({ ...edit, registration: e.target.value })} /></label><label>E-mail institucional<Input required type="email" maxLength={254} value={edit.email} onChange={e => setEdit({ ...edit, email: e.target.value })} /></label><label>Área de atuação<Input value={edit.department} maxLength={100} onChange={e => setEdit({ ...edit, department: e.target.value })} /></label><label>Carga horária (horas)<Input type="number" min={1} max={2147483647} step={1} placeholder="Ex.: 40" value={edit.workload ?? ""} onChange={e => setEdit({ ...edit, workload: e.target.value === "" ? null : e.target.valueAsNumber })} /></label>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="edit-form-footer"><Button type="button" variant="outline" disabled={savingProfessor} onClick={() => setEditOpen(false)}>Cancelar</Button><Button type="submit" disabled={savingProfessor || blocked}>{savingProfessor ? "Salvando…" : isNewProfessor ? "Adicionar professor" : "Salvar alterações"}</Button></div></form>}</SheetContent></Sheet>
    <Dialog open={!!send} onOpenChange={open => !open && !batchLock.current && setSend(null)}>
      <DialogContent className="send-dialog" onEscapeKeyDown={event => { if (batchLock.current) event.preventDefault(); }} onInteractOutside={event => { if (batchLock.current) event.preventDefault(); }}>
        <DialogHeader><div className="dialog-icon"><Mail size={24} /></div><DialogTitle>{receipt ? "Envio concluído" : "Enviar folhas do mês"}</DialogTitle><DialogDescription>{receipt ? "O processamento terminou. As mensagens foram aceitas pelo serviço de e-mail." : "Uma única ação para enviar a folha de cada professor ao respectivo e-mail."}</DialogDescription></DialogHeader>
        {send && <>
          <div className="send-month"><CalendarDays size={19} /><div><small>COMPETÊNCIA</small><strong>{monthLabel(send.month)}</strong></div></div>
          {!receipt && <Tabs value={audience} onValueChange={value => { if (!sending) setAudience(value); }}><TabsList className="w-full"><TabsTrigger value="all" disabled={sending}>Selecionados aptos</TabsTrigger><TabsTrigger value="pending" disabled={sending}>Aptos ainda não enviados</TabsTrigger></TabsList></Tabs>}
          {!receipt && <p className="email-note">{sendCandidates.length - recipients.length} selecionado(s) excluído(s) pela regra de aptidão ou pelo filtro. Apenas folhas validadas e vinculadas podem ser enviadas.</p>}
          <div className="recipient-list" aria-label="Destinatários do lote">{recipients.map(p => <div key={p.id}><Avatar name={p.name} /><span><strong>{p.name}</strong><small>{p.email}</small></span><FileText size={15} /></div>)}</div>
          {receipt && <p role="status" className="email-note">{receipt.sentCount} folhas enviadas. Protocolo: {receipt.jobId}</p>}
          {sendError && <p role="alert" className="form-error">{sendError}</p>}
          {!receipt && <p className="email-note"><AlertCircle size={17} /><span>Cada destinatário recebe somente sua própria folha. O envio requer o serviço de e-mail conectado.</span></p>}
          <DialogFooter><Button variant="outline" disabled={sending} onClick={() => setSend(null)}>{receipt ? "Concluir" : "Cancelar"}</Button>{!receipt && <Button disabled={sending || blocked || !historyReady || !recipients.length} onClick={submitBatch} aria-busy={sending}><Send size={16} />{sending ? "Enviando lote…" : sendError ? "Tentar novamente" : recipients.length === 1 ? "Enviar folha" : `Enviar todas (${recipients.length})`}</Button>}</DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
{loading && <Loading onDone={finishLoading} />}
  </>;
}
