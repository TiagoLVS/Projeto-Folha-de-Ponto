'use client';
import { useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSystemLock } from '@/components/system-lock';
import { confirmServerImport, previewServerImport, type ImportPreview } from '@/lib/server-import-api';
import { toast } from 'sonner';
export function ServerImportDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (open: boolean) => void; onImported: () => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef('');
  const guard = useRef(false);
  const { blocked } = useSystemLock();
  async function selectFile(file?: File) {
    if (!file || guard.current || blocked) return;
    guard.current = true; setBusy(true); setPreview(null); setError('');
    try { setPreview(await previewServerImport(file)); key.current = crypto.randomUUID(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível ler a planilha.'); }
    finally { guard.current = false; setBusy(false); }
  }
  async function confirm() {
    if (!preview || guard.current || blocked) return;
    guard.current = true; setBusy(true); setError('');
    try {
      const result = await confirmServerImport(preview, key.current);
      toast.success(`${result.novos} novos · ${result.atualizados} atualizados · ${result.ignorados} ignorados`);
      onImported(); setPreview(null); onOpenChange(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao importar.'); }
    finally { guard.current = false; setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!guard.current) { onOpenChange(value); if (!value) { setPreview(null); setError(''); } } }}>
    <DialogContent className="send-dialog !w-[calc(100%-2rem)] !max-w-4xl" onEscapeKeyDown={e => { if (guard.current) e.preventDefault(); }} onInteractOutside={e => { if (guard.current) e.preventDefault(); }}>
      <DialogHeader><div className="dialog-icon"><FileSpreadsheet /></div><DialogTitle>Importar servidores</DialogTitle><DialogDescription>Selecione uma planilha .xlsx com Nome, Matrícula e E-mail. Confira os registros antes de confirmar. A matrícula identifica cada cadastro.</DialogDescription></DialogHeader>
      <Input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy || blocked} aria-label="Planilha de servidores" onChange={e => { void selectFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {preview && <><div className="send-month"><span>{preview.registros.filter(r => r.acao === 'novo').length} novos · {preview.registros.filter(r => r.acao === 'atualizado').length} atualizados · {preview.registros.filter(r => r.acao === 'ignorado').length} ignorados</span></div>
        <div className="max-h-80 overflow-auto"><Table><TableHeader><TableRow><TableHead>Linha</TableHead><TableHead>Nome</TableHead><TableHead>Matrícula</TableHead><TableHead>E-mail</TableHead><TableHead>Resultado</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader><TableBody>{preview.registros.map(r => <TableRow key={r.linha}><TableCell>{r.linha}</TableCell><TableCell>{r.nome}</TableCell><TableCell>{r.matricula}</TableCell><TableCell>{r.email || '—'}</TableCell><TableCell><span className={`status-badge status-${r.acao === 'ignorado' ? 'empty' : r.acao === 'novo' ? 'done' : 'progress'}`}>{r.acao}</span></TableCell><TableCell className="whitespace-normal">{r.motivo || '—'}</TableCell></TableRow>)}</TableBody></Table></div></>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setPreview(null); setError(''); onOpenChange(false); }}>Cancelar</Button><Button disabled={busy || blocked || !preview || !preview.registros.some(r => r.acao !== 'ignorado')} onClick={() => void confirm()}>{busy ? 'Aguarde…' : 'Confirmar importação'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
