import { credentialTransportAllowed } from '@/lib/email-account-transport';
import { proxyBackend } from '@/lib/backend-proxy';

export function GET(request: Request) { return proxyBackend('/emails/conta', request); }
export function DELETE(request: Request) { return proxyBackend('/emails/conta', request); }
export function POST(request: Request) {
  if(!credentialTransportAllowed(request.headers.get('origin') || request.url)) {
    return Response.json({detail:'Para conectar sua conta com segurança, use o endereço HTTPS fornecido pelo responsável pelo sistema.'},{status:400,headers:{'Cache-Control':'no-store'}});
  }
  return proxyBackend('/emails/conta', request);
}
