import React, { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { apiFetch } from '@/lib/api-transport';
import { watchForExpiredSession } from '@/lib/auth-session';

type AuthStatus = {
  required: boolean;
  initialized: boolean;
  authenticated: boolean;
  local: boolean;
  username?: string | null;
  admin?: boolean;
};

async function loadAuthStatus(): Promise<AuthStatus> {
  const response = await apiFetch('/api/auth/status', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('Não foi possível consultar o servidor de autenticação.');
  return await response.json() as AuthStatus;
}

const formStyle: React.CSSProperties = {
  display: 'grid', gap: 14, width: '100%', maxWidth: 390,
  background: 'var(--background, #fff)', color: 'var(--foreground, #172033)',
  padding: 30, borderRadius: 18, border: '1px solid #bdcbdc',
  boxShadow: '0 12px 35px rgba(0,0,0,.12)',
};
const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '11px 12px', borderRadius: 8,
  border: '1px solid #889bb0', background: 'var(--background, #fff)',
  color: 'var(--foreground, #172033)', marginTop: 5,
};
const buttonStyle: React.CSSProperties = {
  padding: '10px 16px', border: 0, borderRadius: 8, cursor: 'pointer',
  background: '#16499a', color: 'white', fontWeight: 600,
};

async function jsonAction(path: string, data?: unknown) {
  const response = await apiFetch(path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data ?? {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.detail === 'string' ? body.detail : `Não foi possível concluir a operação (${response.status}).`);
  }
  return body;
}

export function DesktopAuth({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newAdmin, setNewAdmin] = useState(false);

  async function refresh() {
    setStatus(await loadAuthStatus());
  }

  useEffect(() => {
    refresh().catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(() => watchForExpiredSession(loadAuthStatus, expired => {
    setStatus(expired);
    setPassword('');
    setNewPassword('');
    setNewAdmin(false);
    setManage(false);
    setNotice('');
    setError('Sua sessão expirou. Entre novamente.');
  }), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      const isSetup = status?.required && !status.initialized;
      await jsonAction(isSetup ? '/api/auth/bootstrap' : '/api/auth/login', { username, password });
      setPassword('');
      await refresh();
      if (isSetup) setNotice('Administrador criado. Entre com a conta que você acabou de cadastrar.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha de autenticação.');
    } finally { setBusy(false); }
  }

  async function logout() {
    setError('');
    try {
      await jsonAction('/api/auth/logout');
      setManage(false);
      setNotice('Sessão encerrada.');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Erro ao sair.'); }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await jsonAction('/api/auth/users', { username: newUsername, password: newPassword, admin: newAdmin });
      setNotice(`Usuário ${newUsername.trim()} criado.`);
      setNewUsername(''); setNewPassword(''); setNewAdmin(false); setManage(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível cadastrar o usuário.'); }
    finally { setBusy(false); }
  }

  if (!status) return <main style={{ padding: 35, fontFamily: 'system-ui' }} role="status">
    <h2>Ponto Docente · UnDF</h2>
    <p>{error || 'Verificando acesso ao sistema…'}</p>
    {error && <button type="button" onClick={() => {setError(''); refresh().catch((cause: Error) => setError(cause.message));}}>Tentar novamente</button>}
  </main>;

  if (status.required && !status.authenticated) {
    const isSetup = !status.initialized;
    return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: '#edf2f9', fontFamily: 'system-ui' }}>
      <form style={formStyle} onSubmit={submit}>
        <h1 style={{ fontSize: 23, fontWeight: 700, margin: 0 }}>Ponto Docente · UnDF</h1>
        <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>{isSetup ? 'Criar administrador' : 'Entrar no sistema'}</h2>
        {isSetup && !status.local ? <p role="alert">A primeira conta só pode ser criada no computador principal. Abra o aplicativo nele para concluir a configuração.</p> : <>
          {isSetup && <p style={{ fontSize: 13, margin: 0 }}>Primeira instalação: cadastre o usuário responsável. A senha deve ter pelo menos 12 caracteres.</p>}
          <label>Usuário<input style={inputStyle} autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={50} /></label>
          <label>Senha<input style={inputStyle} type="password" autoComplete={isSetup ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={isSetup ? 12 : 1} maxLength={256} /></label>
          <button type="submit" disabled={busy} style={{ ...buttonStyle, opacity: busy ? .65 : 1 }}>{busy ? 'Processando…' : isSetup ? 'Criar administrador' : 'Entrar'}</button>
        </>}
        {notice && <p role="status" style={{ color: '#166534', fontSize: 13 }}>{notice}</p>}
        {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 13 }}>{error}</p>}
      </form>
    </main>;
  }

  return <>
    {children}
    {status.required && <div style={{ position: 'fixed', bottom: 10, left: 12, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10, padding: 8, background: 'var(--background, white)', color: 'var(--foreground, #172033)', boxShadow: '0 3px 15px #0002', font: '12px system-ui' }}>
      <span>Conta: <strong>{status.username}</strong></span>
      {status.admin && <button type="button" onClick={() => {setError('');setNotice('');setManage(!manage);}} style={{ ...buttonStyle, padding: '6px 8px' }}>Novo usuário</button>}
      <button type="button" onClick={logout} style={{ ...buttonStyle, background: '#555', padding: '6px 8px' }}>Sair</button>
    </div>}
    {manage && status.admin && <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', background: '#0009', padding: 15 }}>
      <form style={formStyle} onSubmit={createUser}>
        <h2 style={{ fontWeight: 700, fontSize: 20, margin: 0 }}>Cadastrar usuário</h2>
        <label>Usuário<input style={inputStyle} required minLength={3} maxLength={50} autoComplete="off" value={newUsername} onChange={e => setNewUsername(e.target.value)} /></label>
        <label>Senha inicial<input style={inputStyle} required type="password" minLength={12} maxLength={256} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
        <label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={newAdmin} onChange={e => setNewAdmin(e.target.checked)} />Permitir administração de usuários</label>
        {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}><button disabled={busy} style={buttonStyle}>Cadastrar</button><button type="button" onClick={() => setManage(false)}>Cancelar</button></div>
      </form>
    </div>}
    {notice && !manage && status.required && status.authenticated && <div role="status" style={{ position: 'fixed', bottom: 60, left: 12, zIndex: 9999, background: 'white', color: 'green', padding: 8 }}>{notice}</div>}
    {error && !manage && status.required && status.authenticated && <div role="alert" style={{ position: 'fixed', bottom: 60, left: 12, zIndex: 9999, background: 'white', color: 'darkred', padding: 8 }}>{error}</div>}
  </>;
}
