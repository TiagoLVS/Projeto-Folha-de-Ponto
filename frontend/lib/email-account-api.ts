import { apiRequest } from './api-client.ts';
import { credentialTransportAllowed } from './email-account-transport.ts';
export type EmailAccountState={modo_teste:boolean;conectado:boolean;email:string|null};
function validate(data:EmailAccountState):EmailAccountState {
  if(!data||typeof data.modo_teste!=='boolean'||typeof data.conectado!=='boolean'||(data.email!==null&&typeof data.email!=='string')||(data.conectado&&!data.email))throw new Error('Não foi possível conferir a conta de e-mail. Tente novamente.');
  return data;
}
export async function getEmailAccount(signal?:AbortSignal) {
  return validate(await apiRequest<EmailAccountState>('/api/email-account',{signal}));
}
export async function connectEmailAccount(email:string,senha:string) {
  if(typeof window!=='undefined'&&!credentialTransportAllowed(window.location.origin))throw new Error('Para conectar sua conta com segurança, use o endereço HTTPS fornecido pelo responsável pelo sistema.');
  return validate(await apiRequest<EmailAccountState>('/api/email-account',{method:'POST',body:JSON.stringify({email:email.trim(),senha}),signal:AbortSignal.timeout(70000)}));
}
export async function disconnectEmailAccount() {
  await apiRequest('/api/email-account',{method:'DELETE'});
}
