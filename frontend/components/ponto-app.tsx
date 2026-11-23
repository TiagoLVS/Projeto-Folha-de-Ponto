"use client";
import { formatCpf } from '@/lib/cpf';
import { newId } from '@/lib/client-session';

import { BrandImage } from "@/components/brand-image";
import { ThemeToggle } from "@/components/visual-theme";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Bell, CalendarDays, CheckCheck, Clock3, Download, FileText, Mail, Pencil, Plus, Search, Send, Users, X, AlertCircle, Trash2, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { toast } from "sonner";
import { countSheetStatuses, matchesSheetStatus, monthLabel, sheetStatus, matchesProfessor, statusTone, validEmail, type Professor, type Status } from "@/lib/ponto";
import { DocumentSheet } from "@/components/document-sheet";
import { attachRemoteSheets, listTimesheets, canEmailSheet } from "@/lib/timesheet-api";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { TimesheetUpload } from "@/components/timesheet-upload";
import { ServerImportDialog } from "@/components/server-import-dialog";
import { PendingTimesheets } from "@/components/pending-timesheets";
import { MultipageCandidates } from "@/components/multipage-candidates";
import { SheetGeneration } from "@/components/sheet-generation";
import { AcademicCalendar } from "@/components/academic-calendar";
import { EmailHistory } from "@/components/email-history";
import { useSystemLock } from "@/components/system-lock";
import { listProfessors, saveProfessor as saveProfessorOnServer, deleteProfessor } from "@/lib/professor-api";
import { downloadSheet } from "@/lib/export-sheet";
import { getBatchKey, sendSheetBatch, type BatchReceipt } from "@/lib/send-sheets";

type View = "professores" | "folhas" | "perfil" | "folha" | "calendario" | "emails";
const INITIAL_MONTH = new Date().toISOString().slice(0, 7);
function Logo() { return <BrandImage className="undf-logo" src="/undf-logo.png" alt="UnDF â€” Universidade do Distrito Federal" width="600" height="426" />; }

function Loading({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const leave = setTimeout(() => setLeaving(true), reduced ? 150 : 2100);
    const done = setTimeout(onDone, reduced ? 300 : 2600);
    return () => { clearTimeout(leave); clearTimeout(done); };
  }, [onDone]);
  return <div className={`loading-screen ${leaving ? "loading-leaving" : ""}`} role="status" aria-live="polite"><div className="loading-orbit" aria-hidden="true" /><div className="loading-light light-one" aria-hidden="true" /><div className="loading-light light-two" aria-hidden="true" /><div className="loading-inner"><div className="logo-assembly" aria-label="Logo da UnDF se formando">{[0, 1, 2, 3].map(i => <BrandImage key={i} src="/undf-logo.png" alt="" className={`logo-piece piece-${i}`} aria-hidden="true" width="600" height="426" />)}</div><div className="loading-copy"><p className="eyebrow">GESTÃƒO ACADÃŠMICA</p><h1>Ponto docente</h1><p>Preparando seu espaÃ§o de trabalho</p></div><div className="loading-track" aria-hidden="true"><span /></div></div><button className="loading-skip" onClick={onDone}>Ir para o painel <ArrowRight size={16} /></button><p className="loading-footer">Universidade do Distrito Federal</p></div>;
}
function StatusBadge({ value }: { value: Status }) { return <span className={`status-badge status-${statusTone(value)}`}><span />{value}</span>; }
function Avatar({ name, index = 0 }: { name: string; index?: number }) { return <span className={`avatar avatar-${index % 4}`}>{name.split(" ").filter(Boolean).slice(0, 2).map(p => p[0]).join("")}</span>; }
function Navigation({ view, navigate }: { view: View; navigate: (v: View) => void }) {
  return <header className="floating-nav">
    <button className="nav-brand" onClick={() => navigate("professores")} aria-label="UnDF â€” inÃ­cio"><Logo /><span><strong>Ponto docente</strong><small>GestÃ£o acadÃªmica</small></span></button>
    <nav className="nav-segments !grid-cols-2 xl:!grid-cols-4" aria-label="NavegaÃ§Ã£o principal">
      <button aria-current={["professores", "perfil", "folha"].includes(view) ? "page" : undefined} onClick={() => navigate("professores")}><Users size={17} />Professores</button>
      <button aria-current={view === "folhas" ? "page" : undefined} onClick={() => navigate("folhas")}><FileText size={17} />Folhas de ponto</button>
      <button aria-current={view === "calendario" ? "page" : undefined} onClick={() => navigate("calendario")}><CalendarDays size={17} />CalendÃ¡rio</button>
      <button aria-current={view === "emails" ? "page" : undefined} onClick={() => navigate("emails")}><Mail size={17} />E-mails</button>
    </nav>
    <div className="nav-account"><span className="account-dot" /><span>AdministraÃ§Ã£o</span><Avatar name="AdministraÃ§Ã£o UnDF" /></div>
  </header>;
}

export function PontoApp({ initialView = "professores", desktopNavigation = false }: { initialView?: "professores" | "calendario" | "emails" | "folhas"; desktopNavigation?: boolean }) {
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
  const professorSaveError = blocked ? (locked ? "O sistema estÃ¡ em uso por outro usuÃ¡rio. Aguarde a liberaÃ§Ã£o para salvar." : unavailable ? "NÃ£o foi possÃ­vel verificar a disponibilidade do sistema. Tente novamente para liberar o salvamento." : "Verificando a disponibilidade do sistema. Aguarde para salvar.") : "";
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
        setDataError(people.reason instanceof Error ? people.reason.message : 'NÃ£o foi possÃ­vel carregar os servidores.');
        setStorageReady(true); setHistoryReady(false); return;
      }
      let records = people.value;
      let problem = '';
      if (sheets.status === 'fulfilled') {
        try { records = attachRemoteSheets(records, sheets.value); }
        catch (error) { problem = error instanceof Error ? error.message : 'HistÃ³rico invÃ¡lido.'; }
      } else problem = sheets.reason instanceof Error ? sheets.reason.message : 'HistÃ³rico remoto indisponÃ­vel.';
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
      setRemoving(null); toast.success('Servidor excluÃ­do.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao excluir servidor.'); }
    finally { deleteGuard.current = false; setDeleting(false); }
  }
  const [month, setMonth] = useState(INITIAL_MONTH);
  const [view, setView] = useState<View>(initialView);
  const [sheetsTab, setSheetsTab] = useState("branco");
  useEffect(() => {
    if (!desktopNavigation) return;
    const change = () => { const view = window.location.hash.slice(1); if (['professores','folhas','calendario','emails'].includes(view)) setView(view as View); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, [desktopNavigation]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Todas as situaÃ§Ãµes");
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
  const statusCounts = countSheetStatuses(professors.map(current));
  const finished = statusCounts.identified;
  const notStarted = statusCounts.missing;
  const progress = statusCounts.processing;
  const errors = statusCounts.error;
  const reviews = statusCounts.review;
  const uploaded = statusCounts.uploaded;
  const visible = useMemo(() => professors.filter(p => matchesProfessor(p, query) && matchesSheetStatus(p.sheets[month], filter)), [professors, query, filter, month]);
  const sendCandidates = send ? professors.filter(p => send.ids.includes(p.id)) : [];
  const recipients = send ? sendCandidates.filter(p => receipt ? completedIds.includes(p.id) : canEmailSheet(p.sheets[send.month]) && validEmail(p.email) && (audience === "all" || !['ENVIADO', 'PROCESSANDO'].includes(p.sheets[send.month]?.email?.status ?? ''))) : [];
  const selectable = visible.filter(p => historyReady && canEmailSheet(p.sheets[month]) && validEmail(p.email));
  const allChecked = selectable.length > 0 && selectable.every(p => selection.includes(p.id));
  function openGeneration() { setSheetsTab("branco"); navigate("folhas"); }
  function navigate(v: View) { if (desktopNavigation && !["perfil", "folha"].includes(v)) window.location.hash = v; setView(v); setQuery(""); setFilter("Todas as situaÃ§Ãµes"); window.scrollTo({ top: 0, behavior: "smooth" }); }
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
    if (!key) { key =6ãnx¶‰žËkºwµç]¥¸µÑ½Àè€ÉÁàìô(¹¹…ØµÍ•µ•¹ÑÌì‘¥ÍÁ±…äè™±•àì…±¥¸µ¥Ñ•µÌè•¹Ñ•Èì…Àè€ÕÁàìÁ…‘‘¥¹œè€ÕÁàì‰½É‘•Èè€ÅÁàÍ½±¥€™™™™™˜ÜÔì‰½É‘•ÈµÉ…‘¥ÕÌè€äåÁàì‰…­É½Õ¹è€ŒÕ‘•”ÌÌìô(¹¹…ØµÍ•µ•¹ÑÌ‰ÕÑÑ½¸ì‘¥ÍÁ±…äè™±•àì…±¥¸µ¥Ñ•µÌè•¹Ñ•Èì©ÕÍÑ¥™äµ½¹Ñ•¹Ðè•¹Ñ•Èì…Àè€åÁàìµ¥¸µ¡•¥¡Ðè€ÐÑÁàìÁ…‘‘¥¹œè€ÄÁÁà€ÈÅÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€äåÁàì½±½Èè€ŒÔÄÙàÔì™½¹ÐµÍ¥é”è€ÄÑÁàì™½¹ÐµÝ•¥¡Ðè€ÔÔÀìÑÉ…¹Í¥Ñ¥½¸è‰…­É½Õ¹€¸ÈÉÌ°½±½È€¸ÈÉÌ°‰½àµÍ¡…‘½Ü€¸ÈÉÌìô(¹¹…ØµÍ•µ•¹ÑÌ‰ÕÑÑ½¸é¡½Ù•Èì‰…­É½Õ¹è€™™™™™˜àÔì½±½Èè€ŒÈÀÕåˆìô(¹¹…ØµÍ•µ•¹ÑÌ‰ÕÑÑ½¹m…É¥„µÕÉÉ•¹ÐõÁ…•tì½±½Èè€™™˜ì‰…­É½Õ¹è±¥¹•…ÈµÉ…‘¥•¹Ð ÄÌÕ‘•œ°ŒÌÌÝ™ŒÄ°ŒÈÌÕ„Ð¤ì‰½àµÍ¡…‘½Üè€À€ÑÁà€ÄÉÁà€ŒÈÐØáˆÌÉˆ°¥¹Í•Ð€À€ÅÁà€À€™™™™™˜ÐÀìô(¹¹…Øµ…½Õ¹Ðì‘¥ÍÁ±…äè™±•àì…±¥¸µ¥Ñ•µÌè•¹Ñ•Èì…Àè€ÄÁÁàì™½¹ÐµÍ¥é”è€ÄÉÁàì½±½Èè€ŒÔÄÙŒàÈìÁ…‘‘¥¹œµ±•™Ðè€ÄÁÁàìô(¹…½Õ¹Ðµ‘½ÐìÝ¥‘Ñ è€ÙÁàì¡•¥¡Ðè€ÙÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€ÔÀ”ì‰…­É½Õ¹è€ŒÐÌàÜäÀìô(¹¹…Øµ…½Õ¹Ð€¹…Ù…Ñ…Èì‰½É‘•ÈµÉ…‘¥ÕÌè€ÔÀ”ìÝ¥‘Ñ è€ÐÉÁàì¡•¥¡Ðè€ÐÉÁàì‰…­É½Õ¹è€™™™™™™„Øì½±½Èè€ŒÈÌÕŒåˆì‰½É‘•Èè€ÅÁàÍ½±¥€™™˜ìô(¹…ÁÀµµ…¥¸ìµ…àµÝ¥‘Ñ è€ÄÌÄÁÁàìµ…É¥¸è…ÕÑ¼ìô(¹Ñ½Á‰…Èì‰…­É½Õ¹èÑÉ…¹ÍÁ…É•¹Ðì‰½É‘•Èè€Àì¡•¥¡Ðè€ÜÑÁàìÁ…‘‘¥¹œè€À€ÄÉÁàìô(¹Ñ½Á‰…ÈµÉ¥¡Ðì…Àè€ÄÙÁàì½±½Èè€ŒÔØÜÄá„ìô(¹‘•µ¼µ±…‰•°ì‰…­É½Õ¹è€™™™™™˜ØØì‰½É‘•Èµ½±½Èè€™™™™™™Œäì½±½Èè€ŒÔÈÙŒàÌìô(¹¹½Ñ¥™¥…Ñ¥½¸ìÁ…‘‘¥¹œè€Àì‰½É‘•Èè€ÅÁàÍ½±¥€™™™™™™ˆÌì‰½É‘•ÈµÉ…‘¥ÕÌè€ÔÀ”ìÝ¥‘Ñ è€ÌáÁàì¡•¥¡Ðè€ÌáÁàì‰…­É½Õ¹è€™™™™™˜ØÌìô(¹¹½Ñ¥™¥…Ñ¥½¸¤ìÑ½Àè€áÁàìÉ¥¡Ðè€åÁàìô(¹‰É•…‘ÉÕµˆì½±½Èè€ŒØÀÜääÄìô(¹Ý½É­ÍÁ…”ìÁ…‘‘¥¹œè€ÄáÁà€ÄÉÁà€ÌÁÁàìµ…àµÝ¥‘Ñ è¹½¹”ìô(¹Á…”µ¡•…‘¥¹œìµ…É¥¸µ‰½ÑÑ½´è€ÌÁÁàìô(¹Á…”µ¡•…‘¥¹œ Ä°€¹ÁÉ½™¥±”µ¡•…‘¥¹œ Äì™½¹ÐµÍ¥é”è±…µÀ ÌÁÁà°ÍÙÜ°ÐÉÁà¤ì™½¹ÐµÝ•¥¡Ðè€ØÔÀì±•ÑÑ•ÈµÍÁ…¥¹œè€´Ä¸ÙÁàìô(¹Á…”µ¡•…‘¥¹œÀé¹½Ð ¹•å•‰É½Ü¤°€¹ÁÉ½™¥±”µ¡•…‘¥¹œÀé¹½Ð ¹•å•‰É½Ü¤ì½±½Èè€ŒØÀÜàá”ìô(¹•å•‰É½Üì½±½Èè€ŒÑ˜ÜàåŒ…¥µÁ½ÉÑ…¹Ðì™½¹ÐµÍ¥é”è€ÄÅÁà…¥µÁ½ÉÑ…¹Ðì±•ÑÑ•ÈµÍÁ…¥¹œè€¸ÄÝ•´ìô(¹½Õ¹ÐµÁ¥±°ì‰½É‘•ÈµÉ…‘¥ÕÌè€äåÁàì‰½É‘•Èè€ÅÁàÍ½±¥€™™™™™™‰„ì‰…­É½Õ¹è€™™™™™˜ÜÜìÁ…‘‘¥¹œè€ÝÁà€ÄÅÁàìô)m‘…Ñ„µÍ±½Ðõ‰ÕÑÑ½¹tì‰½É‘•ÈµÉ…‘¥ÕÌè€äåÁàìµ¥¸µ¡•¥¡Ðè€ÐÙÁàìÁ…‘‘¥¹œè€ÄÅÁà€ÈÁÁàìÑÉ…¹Í¥Ñ¥½¸èÑÉ…¹Í™½É´€¸ÉÌ°‰…­É½Õ¹€¸ÉÌ°‰½àµÍ¡…‘½Ü€¸ÉÌìô)m‘…Ñ„µÍ±½Ðõ‰ÕÑÑ½¹té…Ñ¥Ù”ìÑÉ…¹Í™½É´èÍ…±” ¸äÜ¤ìô)m‘…Ñ„µÍ±½Ðõ‰ÕÑÑ½¹um‘…Ñ„µÙ…É¥…¹Ðõ‘•™…Õ±Ñtì‰…­É½Õ¹è±¥¹•…ÈµÉ…‘¥•¹Ð ÄÌÕ‘•œ°ŒÌÈÝ‰”°ŒÈÐÕ‘„Ü¤ì‰½àµÍ¡…‘½Üè€À€ÙÁà€ÄÙÁà€ŒÈÐØáˆÌÈà°¥¹Í•Ð€À€ÅÁà€À€™™™™™˜ÌÀìô)m‘…Ñ„µÍ±½Ðõ‰ÕÑÑ½¹um‘…Ñ„µÙ…É¥…¹Ðõ½ÕÑ±¥¹•tì‰…­É½Õ¹è€™™™™™˜àÔì‰½É‘•Èµ½±½Èè€™™˜ìô)m‘…Ñ„µÍ±½Ðõ¥¹ÁÕÑtì‰½É‘•ÈµÉ…‘¥ÕÌè€ÄÑÁàì‰…­É½Õ¹è€™™™™™™„Øì‰½É‘•Èµ½±½Èè€ŒÕá”Ôìô(¹µ½¹Ñ µ½¹ÑÉ½°ì¡•¥¡Ðè€ÐÙÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€äåÁàì‰…­É½Õ¹è€™™™™™˜àÌì‰½É‘•Èµ½±½Èè€™™™™™™‘˜ìô(¹ÍÑ…ÑÌì…Àè€ÈÁÁàìµ…É¥¸µ‰½ÑÑ½´è€ÈÑÁàìô(¹ÍÑ…Ð°€¹Ñ…‰±”µ…É°€¹Í¡••ÐµÍÕµµ…Éäì(€‰…­É½Õ¹èÙ…È ´µ±…ÍÌ¤ì‰½É‘•Èè€ÅÁàÍ½±¥Ù…È ´µ±…ÍÌµ‰½É‘•È¤ì‰½É‘•ÈµÉ…‘¥ÕÌè€ÈÙÁàì(€‰½àµÍ¡…‘½ÜèÙ…È ´µ±…ÍÌµÍ¡…‘½Ü¤ì(€‰…­‘É½Àµ™¥±Ñ•Èè‰±ÕÈ ÈÁÁà¤Í…ÑÕÉ…Ñ” ÄÌÔ”¤ì€µÝ•‰­¥Ðµ‰…­‘É½Àµ™¥±Ñ•Èè‰±ÕÈ ÈÁÁà¤Í…ÑÕÉ…Ñ” ÄÌÔ”¤ì)ô(¹ÍÑ…Ðìµ¥¸µ¡•¥¡Ðè€ÄÜÉÁàìÁ…‘‘¥¹œè€ÈÙÁàìÑÉ…¹Í¥Ñ¥½¸èÑÉ…¹Í™½É´€¸ÈÕÌ°‰½àµÍ¡…‘½Ü€¸ÈÕÌìô(¹ÍÑ…Ðé¡½Ù•ÈìÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ•d ´ÍÁà¤ì‰½àµÍ¡…‘½Üè€À€ÄÙÁà€ÌáÁà€ŒÈÀÔÔàÈÄÌ°¥¹Í•Ð€À€ÅÁà€™™˜ìô(¹ÍÑ…ÐÀ°€¹ÍÑ…ÐÍÁ…¸°€¹ÍÑ…ÐÍÑÉ½¹œÍµ…±°ì½±½Èè€ŒÕÜØáŒìô(¹ÍÑ…ÐÍÑÉ½¹œì™½¹ÐµÍ¥é”è€ÐÁÁàì™½¹ÐµÝ•¥¡Ðè€ØÀÀì±•ÑÑ•ÈµÍÁ…¥¹œè€´Ä¸ÕÁàìô(¹ÍÑ…Ðµ¥½¸°€¹ÍÑ…Ðµ¥½¸¹Í½™Ð°€¹ÍÑ…Ðµ¥½¸¹¹•ÕÑÉ…°ì¡•¥¡Ðè€ÐáÁàìÝ¥‘Ñ è€ÐáÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€ÄÝÁàì‰½É‘•Èè€ÅÁàÍ½±¥€™™™™™™‘ˆì‰…­É½Õ¹è±¥¹•…ÈµÉ…‘¥•¹Ð ÄÐÕ‘•œ°™™™™™™Ø°ŒÉ‘•˜ÐÝ„¤ì‰½àµÍ¡…‘½Üè€À€ÑÁà€ÄÉÁà€ŒÌÀÙå˜Á„ì½±½Èè€ŒÍˆÜåˆÔìô(¹ÍÑ…Ðµ¥½¸ÍÙœìÝ¥‘Ñ è€ÈÉÁàì¡•¥¡Ðè€ÈÉÁàìô(¹ÍÑ…ÐµÁÉ½É•ÍÌì±•™Ðè€ÈÙÁàìÉ¥¡Ðè€ÈÙÁàì‰½ÑÑ½´è€ÄÙÁàì¡•¥¡Ðè€ÑÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€ÄÁÁàì½Ù•É™±½Üè¡¥‘‘•¸ì‰…­É½Õ¹è€Œå‘‘•ŒÜÀìô(¹ÍÑ…ÐµÁÉ½É•ÍÌ¤ì‰…­É½Õ¹è±¥¹•…ÈµÉ…‘¥•¹Ð äÁ‘•œ°ŒÈÐØáˆÌ°Œá‰‰•„¤ì‰½É‘•ÈµÉ…‘¥ÕÌè€ÄÁÁàìô(¹Á•¹‘¥¹œµ…±•ÉÐì‰…­É½Õ¹è€™™˜á”ÙˆÌì‰½É‘•Èè€ÅÁàÍ½±¥€™™™™™™‘˜ì‰½É‘•ÈµÉ…‘¥ÕÌè€ÈÁÁàì½±½Èè€ŒÝŒØÀÉŒìÁ…‘‘¥¹œè€ÄÝÁà€ÈÉÁàì‰…­‘É½Àµ™¥±Ñ•Èè‰±ÕÈ ÄÕÁà¤ìô(¹Ñ…‰±”µ…ÉìÍÉ½±°µµ…É¥¸µÑ½Àè€ÄÌÁÁàìô(¹Ñ…‰±”µÑ½½±‰…ÈìÁ…‘‘¥¹œè€ÈÑÁàìô(¹Í•…É µ™¥•±ì‰½É‘•ÈµÉ…‘¥ÕÌè€äåÁàì‰…­É½Õ¹è€˜Õ™…™™…„ì‰½É‘•Èè€ÅÁàÍ½±¥€å”Ù•˜ìÁ…‘‘¥¹œè€À€ÄÝÁàìô(¹Í•…É µ™¥•±¥¹ÁÕÐèéÁ±…•¡½±‘•Èì½±½Èè€ŒØÌÝäÐìô(¹Ñ…‰±”µÑ½½±‰…ÈÍ•±•Ðì‰½É‘•ÈµÉ…‘¥ÕÌè€äåÁàì‰…­É½Õ¹è€™™™™™™„Øì‰½É‘•Èµ½±½Èè€á”Ñ•Œì½±½Èè€ŒÐØØÌÝ”ìô(¹É•ÍÕ±Ðµ½Õ¹Ðì½±½Èè€ŒÕÜÜá˜ìô)Ñ ì‰…­É½Õ¹è€•˜Ñ™„ääì½±½Èè€ŒÕÜääÀì‰½É‘•Èµ‰½ÑÑ½´µ½±½Èè€‘”á˜ÄìÁ…‘‘¥¹œµÑ½Àè€ÄÝÁàìÁ…‘‘¥¹œµ‰½ÑÑ½´è€ÄÝÁàìô)Ñì¡•¥¡Ðè€àÁÁàì‰½É‘•Èµ‰½ÑÑ½´µ½±½Èè€‘”Ù•˜áŒìô)Ñ‰½‘äÑÈé¡½Ù•Èì‰…­É½Õ¹è€™™™™™˜àÀìô(¹É•¥ÍÑÉ…Ñ¥½¸°€¹ÁÉ½™•ÍÍ½Èµ•±°Íµ…±°°€¹Ñ…‰±”µ™½½Ñ•È°€¹Ý½É­ÍÁ…”µ™½½Ñ•Èì½±½Èè€ŒØÈÝˆäÄìô(¹ÁÉ½™•ÍÍ½Èµ•±°ÍÑÉ½¹œì½±½Èè€ŒÈäÐÔÕ˜ì™½¹ÐµÝ•¥¡Ðè€ØÀÀìô(¹…Ù…Ñ…Èì‰½É‘•ÈµÉ…‘¥ÕÌè€ÄÑÁàì¡•¥¡Ðè€ÐÉÁàìÝ¥‘Ñ è€ÐÉÁàì‰½É‘•Èè€ÅÁàÍ½±¥€™™™™™™äìô(¹ÍÑ…ÑÕÌµ‰…‘”ìÁ…‘‘¥¹œè€åÁà€ÄÉÁàì‰½É‘•Èè€ÅÁàÍ½±¥€™™™™™˜áŒìô(¹ÍÑ…ÑÕÌµ‘½¹”ì‰…­É½Õ¹è€‘•˜Å”áŒì½±½Èè€ŒÌÜÙ˜ÔÔìô(¹ÍÑ…ÑÕÌµÁÉ½É•ÍÌì‰…­É½Õ¹è€‘‘•‰™…Œì½±½Èè€ŒÍˆØÜå„ìô(¹ÍÑ…ÑÕÌµ•µÁÑäì‰…­É½Õ¹è€™™˜ÁÉŒì½±½Èè€ŒàäØÈÈÌìô(¹ÍÑ…ÑÕÌµÉ•Ù¥•Üì‰…­É½Õ¹è€™™˜ÁÉŒì½±½Èè€ŒàäØÈÈÌìô(¹¥½¸µ‰ÕÑÑ½¸ìµ¥¸µÝ¥‘Ñ è€ÐÁÁàìµ¥¸µ¡•¥¡Ðè€ÐÁÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€ÔÀ”ì½±½Èè€ŒÕŒÝŒääìô(¹¥½¸µ‰ÕÑÑ½¸é¡½Ù•Èì‰…­É½Õ¹è€™™™™™™Œäì‰½É‘•Èµ½±½Èè€™™˜ìô(¹Ñ…‰±”µ™½½Ñ•Èì‰½É‘•ÈµÑ½Àµ½±½Èè€‘”Ý•˜ìÁ…‘‘¥¹œè€ÄáÁà€ÈÑÁàìô(¹Ý½É­ÍÁ…”µ™½½Ñ•ÈìÁ…‘‘¥¹œè€À€ÝÁàìô(¹ÁÉ½™¥±”µ¹…µ”€ø€¹…Ù…Ñ…Èì‰½É‘•ÈµÉ…‘¥ÕÌè€ÈÕÁàì‰½àµÍ¡…‘½ÜèÙ…È ´µ±…ÍÌµÍ¡…‘½Ü¤ìô(¹ÁÉ½™¥±”µ¡•…‘¥¹œìÁ…‘‘¥¹œè€áÁà€Àìô(¹‰…¬µ‰ÕÑÑ½¸ì‰…­É½Õ¹è€™™™™™˜ÜÔì‰½É‘•Èè€ÅÁàÍ½±¥€™™™™™™‰˜ìÁ…‘‘¥¹œè€áÁà€ÄÑÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€äåÁàìµ¥¸µ¡•¥¡Ðè€ÐÁÁàìô(¹Í¡••ÐµÍÕµµ…Éäì‰…­É½Õ¹è€•…˜Õ™‰ˆÌìô(¹•‘¥Ñ…‰±”µÑ…‰±”¥¹ÁÕÐì‰½É‘•ÈµÉ…‘¥ÕÌè€ÄÉÁàì‰…­É½Õ¹è€™™™™™™„Øìô(¹Í•¹µ‘¥…±½œì‰…­É½Õ¹è€˜Á˜Ý™•…¥µÁ½ÉÑ…¹Ðì‰½É‘•Èè€ÅÁàÍ½±¥€™™˜…¥µÁ½ÉÑ…¹Ðì‰½É‘•ÈµÉ…‘¥ÕÌè€ÌÁÁà…¥µÁ½ÉÑ…¹Ðì‰…­‘É½Àµ™¥±Ñ•Èè‰±ÕÈ ÌÉÁà¤ì‰½àµÍ¡…‘½Üè€À€ÌÁÁà€ÄÀÁÁà€ŒÄÜÌÜÔàÌÌ°¥¹Í•Ð€À€ÅÁà€™™˜ìô)m‘…Ñ„µÍ±½Ðõ‘¥…±½œµ½Ù•É±…åt°m‘…Ñ„µÍ±½ÐõÍ¡••Ðµ½Ù•É±…åtì‰…­É½Õ¹è€ŒÄÈÌäÔØÌÀì‰…­‘É½Àµ™¥±Ñ•Èè‰±ÕÈ ÝÁà¤ìô(¹•‘¥ÐµÍ¡••Ðì¥¹Í•Ðè€ÄáÁà€ÄáÁà€ÄáÁà…ÕÑ¼…¥µÁ½ÉÑ…¹Ðì¡•¥¡Ðè…±Œ ÄÀÁ‘Ù €´€ÌÙÁà¤…¥µÁ½ÉÑ…¹ÐìÝ¥‘Ñ èµ¥¸ ÐØÁÁà±…±Œ ÄÀÁÙÜ€´€ÌÙÁà¤¤…¥µÁ½ÉÑ…¹Ðì‰½É‘•Èè€ÅÁàÍ½±¥€™™˜…¥µÁ½ÉÑ…¹Ðì‰½É‘•ÈµÉ…‘¥ÕÌè€ÌÁÁàì‰…­É½Õ¹è€˜Á˜Ý™•ì‰…­‘É½Àµ™¥±Ñ•Èè‰±ÕÈ ÌÉÁà¤ì‰½àµÍ¡…‘½Üè€À€ÈÁÁà€àÁÁà€ŒÄÜÌÜÔàÈØìô(¹‘¥…±½œµ¥½¸°€¹Í•¹µµ½¹Ñ °€¹…Õ‘¥•¹”µ½ÁÑ¥½¹Ì±…‰•°ì‰½É‘•ÈµÉ…‘¥ÕÌè€ÄáÁàìô(¹•µ…¥°µ¹½Ñ”°€¹…Õ‘¥•¹”µ½ÁÑ¥½¹ÌÍÁ…¸°€¹É•¥Á¥•¹Ðµ±¥ÍÐÍµ…±°ì½±½Èè€ŒÕŒÜØáìô(¹Ù¥•Üµ•¹Ñ•Èì…¹¥µ…Ñ¥½¸è±…ÍÍ¹Ñ•È€¸ÕÌÕ‰¥Œµ‰•é¥•È ¸È°¸ÜÔ°¸ÈÔ°Ä¤‰½Ñ ìô)­•å™É…µ•Ì±…ÍÍ¹Ñ•Èì™É½´ì½Á…¥Ñäè€ÀìÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ•d ÄÑÁà¤Í…±” ¸ääÔ¤ìôÑ¼ì½Á…¥Ñäè€ÄìÑÉ…¹Í™½É´è¹½¹”ìôô((¼¨¹¥µ…Ñ”Õ¹Ñ½Õ¡•Á¥á•±Ì™É½´Ñ¡”ÍÕÁÁ±¥•±½¼ì¹¼•áÑ•É¹…°…¹¥µ…Ñ¥½¸‘•Á•¹‘•¹ä¸€¨¼(¹±½…‘¥¹œµÍÉ••¸ì‰…­É½Õ¹è€•™˜Ù™ŒìÑÉ…¹Í¥Ñ¥½¸è½Á…¥Ñä€¸ØÕÌ•…Í”°Ù¥Í¥‰¥±¥Ñä€¸ØÕÌ•…Í”ìô(¹±½…‘¥¹œµ±¥¡ÐìÁ½Í¥Ñ¥½¸è…‰Í½±ÕÑ”ìÝ¥‘Ñ è€ØÕÙµ…àì¡•¥¡Ðè€ØÕÙµ…àì‰½É‘•ÈµÉ…‘¥ÕÌè€ÔÀ”ì™¥±Ñ•Èè‰±ÕÈ ÜÁÁà¤ì½Á…¥Ñäè€¸ØìÁ½¥¹Ñ•Èµ•Ù•¹ÑÌè¹½¹”ì…¹¥µ…Ñ¥½¸è…µ‰¥•¹ÑÉ¥™Ð€ÍÌ•…Í”µ½ÕÐ‰½Ñ ìô(¹±¥¡Ðµ½¹”ì±•™Ðè€´ÈÕÙµ…àìÑ½Àè€´ÈÕÙµ…àì‰…­É½Õ¹èÉ…‘¥…°µÉ…‘¥•¹Ð¡¥É±”°Œá‰‰•„ää±ÑÉ…¹ÍÁ…É•¹Ð€ØØ”¤ìô(¹±¥¡ÐµÑÝ¼ìÉ¥¡Ðè€´ÈÝÙµ…àì‰½ÑÑ½´è€´ÌÁÙµ…àì‰…­É½Õ¹èÉ…‘¥…°µÉ…‘¥•¹Ð¡¥É±”°ŒÜå„É”ÔàÀ±ÑÉ…¹ÍÁ…É•¹Ð€ØØ”¤ìô(¹±½…‘¥¹œµ½É‰¥ÐìÝ¥‘Ñ èµ¥¸ ÔÜÁÁà°äÕÙÜ¤ì¡•¥¡Ðèµ¥¸ ÔÜÁÁà°äÕÙÜ¤ì‰½É‘•Èµ½±½Èè€™™™™™˜åŒì‰½àµÍ¡…‘½Üè€À€À€À€ØÕÁà€™™™™™˜ÈÀ°À€À€À€ÄÌÁÁà€™™™™™˜ÄÈì…¹¥µ…Ñ¥½¸è½É‰¥ÑM•ÑÑ±”€È¸ÝÌ•…Í”µ½ÕÐ‰½Ñ ìô(¹±½…‘¥¹œµ¥¹¹•Èìµ…É¥¸µÑ½Àè€´ÐÕÁàìÑÉ…¹Í¥Ñ¥½¸èÑÉ…¹Í™½É´€¸ØÕÌÕ‰¥Œµ‰•é¥•È ¸È°¸Ü°¸Ì°Ä¤°™¥±Ñ•È€¸ØÕÌìô(¹±½…‘¥¹œµ±•…Ù¥¹œ€¹±½…‘¥¹œµ¥¹¹•ÈìÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ•d ´ÄáÁà¤Í…±” Ä¸ÀÌÔ¤ì™¥±Ñ•Èè‰±ÕÈ ÕÁà¤ìô(¹±½¼µ…ÍÍ•µ‰±äìÝ¥‘Ñ èµ¥¸ ÐØÁÁà°äÉÙÜ¤ìÁ•ÉÍÁ•Ñ¥Ù”è€àÀÁÁàìô(¹±½¼µÁ¥•”ìÑÉ…¹Í™½É´µ½É¥¥¸è€ÔÀ”€ÌØ”ìô(¹Á¥•”´Àì…¹¥µ…Ñ¥½¸èÉåÍÑ…±1•™Ð€Ä¸ÈÕÌÕ‰¥Œµ‰•é¥•È ¸ÄØ°Ä°¸Ì°Ä¤€¸ÄÉÌ™½ÉÝ…É‘Ììô(¹Á¥•”´Äì…¹¥µ…Ñ¥½¸èÉåÍÑ…±•¹Ñ•È€Ä¸ÍÌÕ‰¥Œµ‰•é¥•È ¸ÄØ°Ä°¸Ì°Ä¤€¸ÈÕÌ™½ÉÝ…É‘Ììô(¹Á¥•”´Èì…¹¥µ…Ñ¥½¸èÉåÍÑ…±I¥¡Ð€Ä¸ÈÕÌÕ‰¥Œµ‰•é¥•È ¸ÄØ°Ä°¸Ì°Ä¤€¸ÌáÌ™½ÉÝ…É‘Ììô(¹Á¥•”´Ìì…¹¥µ…Ñ¥½¸èÝ½É‘½ÕÌ€¸ØÕÌ•…Í”€¸äÕÌ™½ÉÝ…É‘Ììô(¹±½…‘¥¹œµ½Áäì…¹¥µ…Ñ¥½¸èÝ½É‘½ÕÌ€¸ÙÌ•…Í”€Ä¸ÉÌ‰½Ñ ìô(¹±½…‘¥¹œµ½Áä Äì™½¹ÐµÍ¥é”è€ÈÝÁàì±•ÑÑ•ÈµÍÁ…¥¹œè€´¸áÁàìô(¹±½…‘¥¹œµ½Áä€øÀé±…ÍÐµ¡¥±ì½±½Èè€ŒØÀÝˆäÈìô(¹±½…‘¥¹œµÑÉ…¬ìÝ¥‘Ñ è€ÄÈÁÁàì¡•¥¡Ðè€ÑÁàì‰…­É½Õ¹è€ŒÝ‘‘•ˆìµ…É¥¸µÑ½Àè€ÈÑÁàì…¹¥µ…Ñ¥½¸èÉ•Ù•…±]½É€¸ÐÕÌ•…Í”€Ä¸ÌÕÌ‰½Ñ ìô(¹±½…‘¥¹œµÑÉ…¬ÍÁ…¸ì…¹¥µ…Ñ¥½¸è±½…‘AÉ½É•ÍÌ€È¸ÈÕÌÕ‰¥Œµ‰•é¥•È ¸È°¸Ø°¸Ì°Ä¤‰½Ñ ì‰½É‘•ÈµÉ…‘¥ÕÌè€áÁàìô(¹±½…‘¥¹œµÍ­¥Àìèµ¥¹‘•àè€Èì‰½É‘•ÈµÉ…‘¥ÕÌè€äåÁàìÁ…‘‘¥¹œè€ÄÅÁà€ÄÝÁàì½±½Èè€ŒÐÜÙ„àÜì‰…­É½Õ¹è€™™™™™˜Ý„ì‰½É‘•Èè€ÅÁàÍ½±¥€™™™™™™Œäì‰…­‘É½Àµ™¥±Ñ•Èè‰±ÕÈ ÄÕÁà¤ìô(¹±½…‘¥¹œµ™½½Ñ•Èìèµ¥¹‘•àè€Äì½±½Èè€ŒÙ„àÌäàìô)­•å™É…µ•ÌÉåÍÑ…±1•™Ðì€À”ì½Á…¥Ñäè€ÀìÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ”Í ´äÕÁà°ÈáÁà°´äÁÁà¤É½Ñ…Ñ” ´Äá‘•œ¤Í…±” ¸à¤ì™¥±Ñ•Èè‰±ÕÈ ÝÁà¤ìô€ØÔ”ì½Á…¥Ñäè€Äì™¥±Ñ•Èè‰±ÕÈ À¤ìô€àÈ”ìÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ”Í ÍÁà°´ÅÁà°À¤É½Ñ…Ñ” ¸Ý‘•œ¤ìô€ÄÀÀ”ì½Á…¥Ñäè€ÄìÑÉ…¹Í™½É´è¹½¹”ì™¥±Ñ•Èè¹½¹”ìôô)­•å™É…µ•ÌÉåÍÑ…±•¹Ñ•Èì€À”ì½Á…¥Ñäè€ÀìÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ”Í À°´äÁÁà°´ÄÌÁÁà¤É½Ñ…Ñ” ÄÉ‘•œ¤Í…±” ¸Ø¤ì™¥±Ñ•Èè‰±ÕÈ ÝÁà¤ìô€ØÔ”ì½Á…¥Ñäè€Äì™¥±Ñ•Èè‰±ÕÈ À¤ìô€àÈ”ìÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ”Í À°ÍÁà°À¤ìô€ÄÀÀ”ì½Á…¥Ñäè€ÄìÑÉ…¹Í™½É´è¹½¹”ì™¥±Ñ•Èè¹½¹”ìôô)­•å™É…µ•ÌÉåÍÑ…±I¥¡Ðì€À”ì½Á…¥Ñäè€ÀìÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ”Í äÕÁà°ÈáÁà°´äÁÁà¤É½Ñ…Ñ” Äá‘•œ¤Í…±” ¸à¤ì™¥±Ñ•Èè‰±ÕÈ ÝÁà¤ìô€ØÔ”ì½Á…¥Ñäè€Äì™¥±Ñ•Èè‰±ÕÈ À¤ìô€àÈ”ìÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ”Í ´ÍÁà°´ÅÁà°À¤É½Ñ…Ñ” ´¸Ý‘•œ¤ìô€ÄÀÀ”ì½Á…¥Ñäè€ÄìÑÉ…¹Í™½É´è¹½¹”ì™¥±Ñ•Èè¹½¹”ìôô)­•å™É…µ•ÌÝ½É‘½ÕÌì™É½´ì½Á…¥Ñäè€ÀìÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ•d åÁà¤ì™¥±Ñ•Èè‰±ÕÈ ÑÁà¤ìôÑ¼ì½Á…¥Ñäè€ÄìÑÉ…¹Í™½É´è¹½¹”ì™¥±Ñ•Èè¹½¹”ìôô)­•å™É…µ•Ì…µ‰¥•¹ÑÉ¥™Ðì™É½´ìÑÉ…¹Í™½É´èÍ…±” ¸Ü¤ÑÉ…¹Í±…Ñ•d ÌÁÁà¤ì½Á…¥Ñäè€¸ÈìôÑ¼ìÑÉ…¹Í™½É´è¹½¹”ì½Á…¥Ñäè€¸Øìôô)­•å™É…µ•Ì½É‰¥ÑM•ÑÑ±”ì™É½´ì½Á…¥Ñäè€ÀìÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ•d ´ÌÕÁà¤Í…±” ¸àØ¤ìôÑ¼ì½Á…¥Ñäè€ÄìÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ•d ´ÌÕÁà¤Í…±” Ä¤ìôô)µ•‘¥„€¡µ…àµÝ¥‘Ñ è€ÄÀÔÁÁà¤ì(€€¹…ÁÀµÍ¡•±°ìÁ…‘‘¥¹œè€ÄáÁà€ÈÉÁà€Àìô(€€¹™±½…Ñ¥¹œµ¹…ØìÑ½Àè€ÄÙÁàì…Àè€ÄÁÁàìô(€€¹¹…Øµ…½Õ¹Ð€øÍÁ…¸é¹½Ð ¹…Ù…Ñ…È¤ì‘¥ÍÁ±…äè¹½¹”ìô(€€¹¹…ØµÍ•µ•¹ÑÌ‰ÕÑÑ½¸ìÁ…‘‘¥¹œè€ÄÁÁà€ÄÕÁàìô(€€¹¹…Øµ‰É…¹ÍÑÉ½¹œì™½¹ÐµÍ¥é”è€ÄÑÁàìô(€€¹¹…Øµ‰É…¹€¹Õ¹‘˜µ±½¼ìÝ¥‘Ñ è€äÙÁàìô(€€¹Á…”µ¡•…‘¥¹œì™±•àµÝÉ…ÀèÝÉ…Àìô(€€¹ÍÑ…ÐìÁ…‘‘¥¹œè€ÈÉÁàìô)ô)µ•‘¥„€¡µ…àµÝ¥‘Ñ è€ÜÀÁÁà¤ì(€€¹…ÁÀµÍ¡•±°ìÁ…‘‘¥¹œè€ÄÑÁà€ÄÑÁà€Àìô(€€¹™±½…Ñ¥¹œµ¹…ØìÑ½Àè€ÄÉÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€ÌÁÁàì™±•àµÝÉ…ÀèÝÉ…ÀìÁ…‘‘¥¹œè€ÕÁà€ÄÁÁà€ÄÁÁàì…Àè€ÍÁàìô(€€¹¹…Øµ‰É…¹ì½É‘•Èè€Àìô(€€¹¹…Øµ…½Õ¹Ðì½É‘•Èè€Äìµ…É¥¸µ±•™Ðè…ÕÑ¼ìô(€€¹¹…Øµ…½Õ¹Ð€¹…Ù…Ñ…ÈìÝ¥‘Ñ è€ÌÙÁàì¡•¥¡Ðè€ÌÙÁàìô(€€¹¹…ØµÍ•µ•¹ÑÌì½É‘•Èè€ÈìÝ¥‘Ñ è€ÄÀÀ”ì…Àè€ÑÁàìÁ…‘‘¥¹œè€ÑÁàìô(€€¹¹…ØµÍ•µ•¹ÑÌ‰ÕÑÑ½¸ì™±•àè€Äì™½¹ÐµÍ¥é”è€ÄÍÁàìµ¥¸µ¡•¥¡Ðè€ÐÍÁàìÁ…‘‘¥¹œè€åÁà€ÄÁÁàìô(€€¹¹…Øµ‰É…¹€¹Õ¹‘˜µ±½¼ì¡•¥¡Ðè€ÔÝÁàìÝ¥‘Ñ è€äÁÁàìô(€€¹Ñ½Á‰…Èì¡•¥¡Ðè€ØÉÁàìÁ…‘‘¥¹œè€À€ÑÁàì…Àè€áÁàìô(€€¹‰É•…‘ÉÕµˆ€¹Í±…Í ì‘¥ÍÁ±…äè¹½¹”ìô(€€¹Ñ½Á‰…ÈµÉ¥¡Ðì…Àè€áÁàìô(€€¹Ý½É­ÍÁ…”ìÁ…‘‘¥¹œè€ÄÙÁà€ÉÁà€ÈÑÁàìô(€€¹Á…”µ¡•…‘¥¹œì…Àè€ÄáÁàìµ…É¥¸µ‰½ÑÑ½´è€ÈÉÁàìô(€€¹Á…”µ¡•…‘¥¹œ Ä°€¹ÁÉ½™¥±”µ¡•…‘¥¹œ Äì™½¹ÐµÍ¥é”è€ÌÅÁàì±•ÑÑ•ÈµÍÁ…¥¹œè€´ÅÁàìô(€€¹¡•…‘¥¹œµ…Ñ¥½¹Ììµ…É¥¸è€Àì…Àè€åÁàìô(€€¹¡•…‘¥¹œµ…Ñ¥½¹Ì€øm‘…Ñ„µÍ±½Ðõ‰ÕÑÑ½¹tìÁ…‘‘¥¹œµ±•™Ðè€ÄÑÁàìÁ…‘‘¥¹œµÉ¥¡Ðè€ÄÑÁàì™½¹ÐµÍ¥é”è€ÄÍÁàìô(€€¹µ½¹Ñ µ½¹ÑÉ½°ìÁ…‘‘¥¹œè€À€ÄÉÁàìô(€€¹µ½¹Ñ µ½¹ÑÉ½°¥¹ÁÕÐìÝ¥‘Ñ è€ÄÈÕÁàìô(€€¹ÍÑ…ÑÌìÉ¥µÑ•µÁ±…Ñ”µ½±Õµ¹Ìè€Å™Èì…Àè€ÄÉÁàìµ…É¥¸µÑ½Àè€Àìô(€€¹ÍÑ…Ðìµ¥¸µ¡•¥¡Ðè€ÄÐÉÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€ÈÑÁàìÁ…‘‘¥¹œè€ÈÍÁàìô(€€¹ÍÑ…ÐÍÑÉ½¹œì™½¹ÐµÍ¥é”è€ÌÑÁàìô(€€¹ÍÑ…ÐµÁÉ½É•ÍÌì‰½ÑÑ½´è€ÄÉÁàìô(€€¹Á•¹‘¥¹œµ…±•ÉÐìÁ…‘‘¥¹œè€ÄáÁàìô(€€¹Ñ…‰±”µ…Éì‰½É‘•ÈµÉ…‘¥ÕÌè€ÈÑÁàìÍÉ½±°µµ…É¥¸µÑ½Àè€ÄÔÕÁàìô(€€¹Ñ…‰±”µÑ½½±‰…ÈìÁ…‘‘¥¹œè€ÄáÁàìô(€€¹Ñ…‰±”µÑ½½±‰…ÈÍ•±•Ðìµ…àµÝ¥‘Ñ è€ÄÀÀ”ìô(€€¹Ñ…‰±”µ™½½Ñ•ÈìÁ…‘‘¥¹œè€ÄÙÁàì…Àè€ÄÕÁàìô(€€¹Ñ…‰±”µ™½½Ñ•ÈÍÁ…¸ìÝ¡¥Ñ”µÍÁ…”è¹½Éµ…°ìô(€€¹Í•¹µ‘¥…±½œì‰½É‘•ÈµÉ…‘¥ÕÌè€ÈáÁà…¥µÁ½ÉÑ…¹Ðìô(€€¹±½…‘¥¹œµ¥¹¹•Èìµ…É¥¸µÑ½Àè€´ÌÁÁàìô(€€¹±½…‘¥¹œµÍ­¥ÀìÑ½Àè€ÈÉÁàìÉ¥¡Ðè€ÈÁÁàìô)ô)µ•‘¥„€¡ÁÉ•™•ÉÌµÉ•‘Õ•µµ½Ñ¥½¸èÉ•‘Õ”¤ì(€€¨°€¨èé‰•™½É”°€¨èé…™Ñ•Èì…¹¥µ…Ñ¥½¸µ‘ÕÉ…Ñ¥½¸è€¸ÀÅµÌ…¥µÁ½ÉÑ…¹Ðì…¹¥µ…Ñ¥½¸µ‘•±…äè€ÁµÌ…¥µÁ½ÉÑ…¹ÐìÑÉ…¹Í¥Ñ¥½¸µ‘ÕÉ…Ñ¥½¸è€¸ÀÅµÌ…¥µÁ½ÉÑ…¹ÐìÍÉ½±°µ‰•¡…Ù¥½Èè…ÕÑ¼…¥µÁ½ÉÑ…¹Ðìô(€€¹±½¼µÁ¥•”°€¹±½…‘¥¹œµ½Áä°€¹±½…‘¥¹œµÑÉ…¬ì½Á…¥Ñäè€Ä…¥µÁ½ÉÑ…¹ÐìÑÉ…¹Í™½É´è¹½¹”…¥µÁ½ÉÑ…¹Ðì™¥±Ñ•Èè¹½¹”…¥µÁ½ÉÑ…¹Ðìô)ô)ÍÕÁÁ½ÉÑÌ¹½Ð€¡‰…­‘É½Àµ™¥±Ñ•Èè‰±ÕÈ ÅÁà¤¤ì(€€¹™±½…Ñ¥¹œµ¹…Ø°€¹ÍÑ…Ð°€¹Ñ…‰±”µ…É°€¹Í¡••ÐµÍÕµµ…Éäì‰…­É½Õ¹è€˜Å˜Ý™Œìô)ô(