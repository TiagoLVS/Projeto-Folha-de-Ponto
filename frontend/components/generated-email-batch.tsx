'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { previewGeneratedEmails, sendGeneratedEmails, type GeneratedEmailPreview, type GeneratedEmailResult } from '@/lib/academic-api';
import { newId } from '@/lib/client-session';
import { useSystemLock } from './system-lock';

export function GeneratedEmailBatch({ month, selectedDocumentIds, disabled }: { month: string; selectedDocumentIds: number[]; disabled: boolean }) {
  const { blocked }=useSystemLock();
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [sending,setSending]=useState(false);
  const [preview,setPreview]=useState<GeneratedEmailPreview|null>(null);
  const [progress,setProgress]=useState<GeneratedEmailResult|null>(null);
  const [completed,setCompleted]=useState(false);
  const [resend,setResend]=useState(false);
  const [error,setError]=useState('');
  const key=useRef('');const guard=useRef(false);
  const targets=preview?.documentos.filter(d=>d.apto || (resend && d.apto_reenvio===true)) ?? [];
  async function prepare(selected=false) {
    if (guard.current || blocked || disabled) return;
    guard.current=true;setOpen(true);setLoading(true);setPreview(null);setProgress(null);setCompleted(false);setResend(false);setError('');key.current=newId();
    try {
      const data=await previewGeneratedEmails(month);
      setPreview(selected ? {...data,documentos:data.documentos.filter(d=>selectedDocumentIds.includes(d.id_documento))} : data);
    } catch(e) { setError(e instanceof Error ? e.message : 'Não foi possível consultar os modelos.'); }
    finally {guard.current=false;setLoading(false);}
  }
  async function send() {
    if (guard.current || blocked || !preview?.configurado || !targets.length || completed) return;
    guard.current=true;setSending(true);setError('');
    try {
      setProgress(await sendGeneratedEmails(targets.map(d=>d.id_documento),preview.competencia,key.current,preview.limite_lote,setProgress,resend));
      setCompleted(true);
    } catch(e) {setError(e instanceof Error ? e.message : 'Não foi possível concluir o envio.');}
    finally {guard.current=false;setSending(false);}
  }
  return <><div className="flex flex-wrap gap-2"><Button disabled={disabled || blocked || loading || sending} onClick={()=>void prepare()}>Enviar todas por e-mail</Button><Button variant="outline" disabled={disabled || blocked || loading || sending || !selectedDocumentIds.length} onClick={()=>void prepare(true)}>Enviar selecionadas por e-mail</Button></div>
    <Dialog open={open} onOpenChange={value=>{if(!loading&&!sending)setOpen(value);}}><DialogContent className="!max-w-2xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Enviar modelos em branco · {preview?.competencia ?? month}</DialogTitle><DialogDescription>Uma folha por servidor, usando a versão mais recente do mês. Não é necessário abrir ou validar OCR dos modelos gerados.</DialogDescription></DialogHeader>
      {loading && <p role="status">Consultando destinatários…</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {preview && <><label className="flex items-center gap-2"><input type="checkbox" checked={resend} disabled={sending || !!progress || completed} onChange={e=>setResend(e.target.checked)} />Incluir folhas já enviadas (enviar novamente)</label>{resend && <p>Ao confirmar, os servidores selecionados receberão novamente suas folhas, mesmo que já tenham sido enviadas.</p>}<p>{targets.length} folhas para enviar · {preview.documentos.length-targets.length} já enviadas, em processamento ou indisponíveis.</p>
        {!preview.configurado && <p role="alert">Conecte uma conta de e-mail para enviar as folhas. Se o sistema estiver em modo de teste, procure o responsável pela configuração.</p>}
        {preview.configurado && preview.modo_teste && <p role="status">Modo de teste: as mensagens serão enviadas para {preview.destinatario_teste}, em vez dos servidores.</p>}
        <details><summary>Destinatários e documentos</summary><ul>{preview.documentos.map(d=><li key={d.id_documento}>{d.nome} · {d.email || 'Sem e-mail'} · versão {d.versao}{d.motivo ? ` · ${d.motivo}` : ''}</li>)}</ul></details>
        {!targets.length && <p>Nenhuma folha pendente de envio nesta seleção. Confira os modelos e o histórico de e-mails.</p>}
        {targets.length>preview.limite_lote && <p role="alert">Selecione até {preview.limite_lote} folhas por vez no histórico e use Enviar selecionadas por e-mail.</p>}
      </>}
      {progress && <p role="status">{sending ? 'Enviando' : completed ? 'Envio concluído' : 'Envio interrompido'}: {progress.enviados+progress.ignorados+progress.falhas} de {progress.total} · Enviadas: {progress.enviados} · Ignoradas: {progress.ignorados} · Falhas: {progress.falhas}</p>}
      {progress && progress.detalhes.length > 0 && <details open={progress.falhas>0}><summary>Resultado por servidor</summary><ul>{progress.detalhes.map(d=><li key={d.id_documento}>{preview?.documentos.find(p=>p.id_documento===d.id_documento)?.nome ?? `Documento ${d.id_documento}`} · {d.status}{d.mensagem ? ` · ${d.mensagem}` : ''}</li>)}</ul></details>}
      {progress?.falhas ? <p>Consulte E-mails para conferir e reenviar as falhas.</p> : null}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={loading || sending} onClick={()=>setOpen(false)}>{completed ? 'Fechar' : 'Cancelar'}</Button>{!completed && <Button disabled={loading || sending || blocked || !preview?.configurado || !targets.length || targets.length>preview.limite_lote} onClick={()=>void send()}>{sending ? 'Enviando…' : progress ? 'Continuar envio' : `${resend ? 'Enviar novamente' : 'Enviar'} ${targets.length} folhas`}</Button>}</div>
    </DialogContent></Dialog></>;
}
