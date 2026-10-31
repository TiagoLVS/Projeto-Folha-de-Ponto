export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
let id = '';
/** Identificador por sessão do navegador; não é uma credencial de autenticação. */
export function clientId(): string {
  if (id) return id;
  try {
    id = sessionStorage.getItem('ponto:client-id') || newId();
    sessionStorage.setItem('ponto:client-id', id);
  } catch { id = newId(); }
  return id;
}
let emailId = '';
/** Identidade persistente deste perfil do navegador/aplicativo; nunca contém a senha SMTP. */
export function emailClientId(): string {
  if (emailId) return emailId;
  try {
    const saved = localStorage.getItem('ponto:email-client-id');
    emailId = saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved) ? saved : newId();
    localStorage.setItem('ponto:email-client-id', emailId);
  } catch { emailId = newId(); }
  return emailId;
}
export function sessionHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set('X-Client-Id', clientId());
  headers.set('X-Email-Client-Id', emailClientId());
  return headers;
}
