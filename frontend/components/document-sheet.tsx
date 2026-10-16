'use client';
import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ArrowLeft, Download, FileText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { TimesheetUpload } from '@/components/timesheet-upload';
import { useSystemLock } from '@/components/system-lock';
import { confirmDocument, deleteDocument, listTimesheets, processDocument, fromRemoteSheet, validMonth } from '@/lib/timesheet-api';
import { ApiError } from '@/lib/api-client';
import { monthLabel, sheetStatus, type Professor, type Sheet } from '@/lib/ponto';
import { toast } from 'sonner';
type Props = { professor: Professor; professors: Professor[]; month: string; onMonth: (month: string) => void; onBack: () => void; onChange: Dispatch<SetStateAction<Professor[]>>; onLinked: (id: string, month: string) => void };
export function DocumentSheet({ professor, professors, month, onMonth, onBack, onChange, onLinked }: Props) {
  const sheet = professor.sheets[month];
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(!sheet);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [overwriteId, setOverwriteId] = useState<number>();
  const [target, setTarget] = useState(professor.id);
  const [period, setPeriod] = useState(month);
  const [editing, setEditing] = useState(!sheet?.confirmedAt);
  const [preview, setPreview] = useState(true);
  const guard = useRef(false);
  const { blocked } = useSystemLock();
  function update(value?: Sheet) {
    onChange(ps => ps.map(p => { if (p.id !== professor.id) return p; const sheets = { ...p.sheets }; if (value) sheets[month] = value; else delete sheets[month]; return { ...p, sheets }; }));
  }
  async function process() {
    if (!sheet || guard.current || blocked) return;
    guard.current = true; setBusy(true); setError('');
    try {
      const value = await processDocument(sheet, AbortSignal.timeout(60000)); update(value);
      const match = professors.find(p => p.registration === value.identifiedData?.registration);
      setTarget(match?.id ?? professor.id); setPeriod(value.identifiedData?.competence ?? month); setEditing(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao processar.'); }
    finally { guard.current = false; setBusy(false); }
  }
  async function requestConfirmation() {
    if (!sheet || !target || !validMonth(period) || guard.current || blocked) return;
    guard.current = true; setBusy(true); setError('');
    try {
      const records = await listTimesheets(target);
      const existing = records.find(record => record.competencia === period && record.id_folha !== sheet.backendId);
      setOverwriteId(existing?.id_folha); setConfirmOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao conferir o vínculo.'); }
    finally { guard.current = false; setBusy(false); }
  }
  async function confirm() {
    if (!sheet?.backendId || guard.current || blocked) return;
    guard.current = true; setBusy(true); setError('');
    try {
      const value = await confirmDocument(sheet.backendId, target, period, overwriteId);
      onChange(ps => ps.map(p => { const sheets = { ...p.sheets }; if (p.id === professor.id) delete sheets[month]; if (p.id === target) sheets[period] = value; return { ...p, sheets }; }));
      setConfirmOpen(false); setEditing(false); onLinked(target, period);
      if (value.email?.status === 'ENVIADO') toast.success(value.email.mensagem);
      else toast.success('Vínculo validado no servidor.');
      if (value.email && value.email.status !== 'ENVIADO') toast.warning(value.email.mensagem);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao validar o vínculo.');
      setConfirmOpen(false);
      // A concurrent conflict needs another explicit confirmation, never an automatic overwrite.
      if (e instanceof ApiError && e.status === 409) toast.warning('O vínculo mudou no servidor. Confira novamente antes de substituir.');
    } finally { guard.current = false; setBusy(false); }
  }
  async function remove() {
    if (!sheet?.backendId || guard.current || blocked) return;
    guard.current = true; setBusy(true); setError('');
    try { await deleteDocument(sheet.backendId); update(); setRemoveOpen(false); setUploadOpen(true); toast.success('Folha removida do servidor.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao remover.'); }
    finally { guard.current = false; setBusy(false); }
  }
  async function refresh() {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError('');
    try {
      const records = await listTimesheets(professor.id);
      onChange(ps => ps.map(p => p.id === professor.id ? { ...p, sheets: Object.fromEntries(records.map(record => [record.competencia, fromRemoteSheet(record)])) } : p));
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao atualizar.'); }
    finally { guard.current = false; setBusy(false); }
  }
  return <div className="view-enter"><Button variant="ghost" className="back-button" disabled={busy} onClick={onBack}><ArrowLeft size={16} />Voltar ao professor</Button>
    <div className="page-heading"><div><p className="eyebrow">DOCUMENTO DE PONTO</p><h1>{professor.name}</h1><p>Matrícula: {professor.registration}</p></div><label className="month-control">Competência<Input type="month" min="2000-01" max="2099-12" value={month} disabled={busy} aria-label="Competência da folha" onChange={e => { if (validMonth(e.target.value)) onMonth(e.target.value); }} /></label></div>
    {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
    <section className="table-card uploaded-sheet-card"><div className="table-toolbar"><h2>{monthLabel(month)}</h2><span role="status" className={`status-badge status-${sheet?.confirmedAt ? 'done' : sheet?.status === 'error' ? 'error' : sheet ? 'progress' : 'empty'}`}>{sheetStatus(sheet)}</span><Button variant="outline" disabled={busy} onClick={() => void refresh()}>Atualizar</Button></div>
      <div className="document-body">
        <p className="email-note">O original e o histórico são consultados no servidor. Confira os dados digitais antes de validar.</p>
        {uploadOpen && <TimesheetUpload professors={professors} defaultProfessorId={professor.id} month={month} onSaved={(id, competence, value) => { onChange(ps => ps.map(p => p.id === id ? { ...p, sheets: { ...p.sheets, [competence]: value } } : p)); if (id === professor.id && competence === month) setEditing(true); }} />}
        {sheet && <><div className="uploaded-file-meta"><FileText /><div><strong>{sheet.attachment.name}</strong><span>{(sheet.attachment.size / 1024 / 1024).toFixed(2)} MB</span></div></div>
          <div className="document-actions"><Button variant="outline" onClick={() => setPreview(value => !value)}>Visualizar folha</Button><Button variant="outline" asChild><a href={sheet.attachment.url} download={sheet.attachment.name}><Download size={16} />Baixar original</a></Button><Button variant="outline" disabled={busy || blocked} onClick={() => setUploadOpen(value => !value)}>Substituir / adicionar PDFs</Button><Button variant="outline" disabled={busy || blocked} onClick={() => setRemoveOpen(true)}><Trash2 size={16} />Remover folha</Button></div>
          {preview && <div className="sheet-preview"><iframe src={sheet.attachment.url} title={`Folha: ${sheet.attachment.name}`} /></div>}
          {sheet.error && <Alert variant="destructive"><AlertDescription>{sheet.error}</AlertDescription></Alert>}
          {!sheet.confirmedAt && <div className="document-actions"><Button disabled={busy || blocked} onClick={() => void process()}>{busy ? 'Aguarde…' : 'Processar documento'}</Button><Button variant="outline" disabled={busy || blocked} onClick={() => setEditing(true)}>Conferir manualmente</Button></div>}
          <section className="identified-panel"><h2>{sheet.confirmedAt && !editing ? 'Vínculo validado' : 'Conferência dos dados'}</h2>
            <dl><dt>Professor</dt><dd>{sheet.identifiedData?.professorName || professor.name}</dd><dt>Matrícula</dt><dd>{sheet.identifiedData?.registration || professor.registration}</dd><dt>Competência</dt><dd>{monthLabel(sheet.identifiedData?.competence || month)}</dd><dt>Arquivo</dt><dd>{sheet.attachment.name}</dd></dl>
            {sheet.email && <p className="email-note">{sheet.email.mensagem}</p>}
            {editing ? <><div className="space-y-2"><Label htmlFor="link-professor">Servidor para vínculo</Label><NativeSelect id="link-professor" value={target} disabled={busy || blocked} onChange={e => setTarget(e.target.value)}>{professors.map(p => <NativeSelectOption key={p.id} value={p.id}>{p.name} · {p.registration}</NativeSelectOption>)}</NativeSelect></div><div className="space-y-2"><Label htmlFor="link-month">Competência para vínculo</Label><Input id="link-month" type="month" min="2000-01" max="2099-12" value={period} disabled={busy || blocked} onChange={e => setPeriod(e.target.value)} /></div><Button disabled={busy || blocked || !target || !validMonth(period)} onClick={() => void requestConfirmation()}>Confirmar validação e vínculo</Button></> : <Button variant="outline" disabled={busy || blocked} onClick={() => { setTarget(professor.id); setPeriod(month); setEditing(true); }}>Corrigir vínculo</Button>}
          </section></>}
      </div></section>
    <ConfirmationDialog open={removeOpen} title="Remover folha do servidor?" description="O documento original e seu registro serão excluídos no servidor. A remoção só será refletida na tela após a confirmação do backend." busy={busy} disabled={blocked} confirmLabel="Remover folha" onConfirm={() => void remove()} onCancel={() => setRemoveOpen(false)} />
    <ConfirmationDialog open={confirmOpen} title={overwriteId ? 'Sobrescrever vínculo existente?' : 'Validar folha?'} description={overwriteId ? 'Já existe outra folha para esse servidor e competência. Deseja sobrescrever o arquivo e o vínculo existentes?' : 'Confirma que o documento e os dados do vínculo foram conferidos? O backend atual pode iniciar o envio automático após validar.'} busy={busy} disabled={blocked} confirmLabel={overwriteId ? 'Sobrescrever' : 'Validar'} onConfirm={() => void confirm()} onCancel={() => setConfirmOpen(false)} />
  </div>;
}
