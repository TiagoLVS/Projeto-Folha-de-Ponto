/** Senhas só trafegam por HTTPS; HTTP é permitido apenas no próprio computador. */
export function credentialTransportAllowed(address:string):boolean {
  try {
    const url=new URL(address);
    return url.protocol==='https:' || (url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  } catch { return false; }
}
