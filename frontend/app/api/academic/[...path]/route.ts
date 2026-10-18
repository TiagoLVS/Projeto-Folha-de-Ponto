import { proxyBackend } from '../../../../lib/backend-proxy.ts';
// Proxy restrito às funcionalidades do calendário, incluindo multipart e downloads.
async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = path.join('/');
  if (!/^(datas-especiais(?:\/(?:importar(?:\/confirm)?|\d+))?|folhas\/(?:configuracao|gerar|gerar-lote|geradas(?:\/(?:download-lote|para-envio|enviar-lote|\d+(?:\/download)?))?))$/.test(target)) {
    return Response.json({ detail: 'Rota não encontrada.' }, { status: 404 });
  }
  return proxyBackend(`/${target}${new URL(request.url).search}`, request, target.includes('download'));
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
