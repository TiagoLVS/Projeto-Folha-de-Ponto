// Proxy restrito às funcionalidades do calendário, incluindo multipart e downloads.
async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = path.join('/');
  if (!/^(datas-especiais(?:\/(?:importar|\d+))?|folhas\/(?:gerar|gerar-lote|geradas(?:\/(?:download-lote|\d+(?:\/download)?))?))$/.test(target)) {
    return Response.json({ detail: 'Rota não encontrada.' }, { status: 404 });
  }
  try {
    const headers = new Headers();
    const contentType = request.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    const response = await fetch(`${process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'}/${target}${new URL(request.url).search}`, {
      method: request.method, headers, cache: 'no-store',
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    });
    const outgoing = new Headers({ 'Cache-Control': 'no-store' });
    for (const key of ['content-type', 'content-disposition']) {
      const value = response.headers.get(key);
      if (value) outgoing.set(key, value);
    }
    return new Response(response.status === 204 ? null : response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json({ detail: 'Não foi possível conectar ao servidor.' }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
