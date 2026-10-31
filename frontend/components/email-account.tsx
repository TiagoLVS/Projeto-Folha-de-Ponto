'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Mail} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {connectEmailAccount,disconnectEmailAccount,getEmailAccount,type EmailAccountState} from '@/lib/email-account-api';

export function EmailAccount() {
  const [state,setState]=useState<EmailAccountState|null>(null);
  const [open,setOpen]=useState(false);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [loadError,setLoadError]=useState('');
  const dismissed=useRef(false);const guard=useRef(false);
  useEffect(()=>{
    let active=true;let previousConnected=false;
    const controller=new AbortController();
    async function check(){
      if(guard.current)return;
      try{
        const data=await getEmailAccount(AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]));
        if(!active)return;
        if(previousConnected&&!data.conectado)dismissed.current=false;
        previousConnected=data.conectado;setState(data);setLoadError('');
        if(!data.modo_teste&&!data.conectado&&!dismissed.current)setOpen(true);
      }catch{if(active)setLoadError('Não foi possível conferir a conta de e-mail.');}
    }
    void check();const timer=setInterval(()=>void check(),60000);
    return()=>{active=false;controller.abort();clearInterval(timer);};
  },[]);
  function close(){if(guard.current)return;setPassword('');setError('');dismissed.current=true;setOpen(false);}
  async function connect(event:FormEvent){
    event.preventDefault();if(guard.current)return;
    guard.current=true;setBusy(true);setError('');
    try{const data=await connectEmailAccount(email,password);setState(data);setOpen(false);setLoadError('');dismissed.current=false;}
    catch(error){setError(error instanceof Error?error.message:'Não foi possível conectar sua conta.');}
    finally{setPassword('');guard.current=false;setBusy(false);}
  }
  async function disconnect(){
    if(guard.current)return;
    guard.current=true;setBusy(true);setError('');
    try{await disconnectEmailAccount();setState({modo_teste:false,conectado:false,email:null});setPassword('');dismissed.current=true;}
    catch(error){setLoadError(error instanceof Error?error.message:'Não foi possível desconectar.');}
    finally{guard.current=false;setBusy(false);}
  }
  if(state?.modo_teste)return null;
  if(!state&&!loadError)return null;
  return <><div className="flex flex-wrap items-center justify-end gap-3 border-b border-border bg-card/90 px-6 py-2 text-sm text-foreground" aria-label="Conta para envio de e-mails"><Mail size={16}/><span>{loadError|| (state?.conectado?`Conta de envio: ${state.email}`:'Conecte uma conta de e-mail para enviar folhas.')}</span>{state?.conectado?<Button variant="outline" size="sm" disabled={busy} onClick={()=>void disconnect()}>Desconectar e-mail</Button>:<Button size="sm" onClick={()=>{setEmail(state?.email||'');setError('');setOpen(true);}}>Conectar e-mail</Button>}</div>
    <Dialog open={open} onOpenChange={value=>{if(value)setOpen(true);else close();}}><DialogContent className="send-dialog" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onInteractOutside={event=>{if(busy)event.preventDefault();}}><DialogHeader><DialogTitle>Conectar conta de e-mail</DialogTitle><DialogDescription>Use a conta que enviará as folhas aos servidores. A conta ficará conectada neste computador até você desconectar.</DialogDescription></DialogHeader>
      <form onSubmit={event=>void connect(event)} autoComplete="off" className="grid gap-4"><label className="grid gap-2">E-mail de envio<Input type="email" required maxLength={255} value={email} disabled={busy} onChange={event=>setEmail(event.target.value)}/></label><label className="grid gap-2">Senha de aplicativo / SMTP<Input type="password" autoComplete="off" required maxLength={1024} value={password} disabled={busy} onChange={event=>setPassword(event.target.value)}/></label><p className="text-sm text-muted-foreground">Informe a senha de aplicativo ou de envio fornecida pelo serviço de e-mail. A senha não será gravada no cadastro dos servidores.</p><p className="text-sm text-muted-foreground">Ao conectar, apenas verificamos o acesso à conta. Nenhum e-mail será enviado nessa etapa.</p>{error&&<p role="alert" className="form-error">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Agora não</Button><Button type="submit" disabled={busy}>{busy?'Conectando…':'Conectar conta'}</Button></DialogFooter></form>
    </DialogContent></Dialog></>;
}
