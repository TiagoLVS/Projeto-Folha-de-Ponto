import { NextResponse } from 'next/server';

/** Preserve authentication, concurrency and idempotency headers without forwarding arbitrary headers. */
export async function proxyBackend(path: string, request?: Request, binary = false) {
  const method = request?.method ?? 'GET';
  const headers = new Headers();
  for (const name of ['authorization', 'cookie', 'idempotency-key', 'if-match']) {
    const value = request?.headers.get(name);
    if (value) headers.set(name, value);
  }
  const body = request && !['GET', 'HEAD'].includes(method) ? await request.arrayBuffer() : undefined;
  if (body?.byteLength && request?.headers.get('content-type')) headers.set('content-type', request.headers.get('content-type')!);
  try {
    const response = await fetch(`${process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'}${path}`, {
      method, headers, body: body?.byteLength ? body : undefined, cache: 'no-store',
      signal: AbortSignal.timeout(65000), redirect: 'manual',
    });
    const outputHeaders = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'content-disposition', 'etag', 'retry-after']) {
      const value = response.headers.get(name);
      if (value) outputHeaders.set(name, value);
    }
    if (binary) outputHeaders.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.status === 204 ? null : response.body, { status: response.status, headers: outputHeaders });
  } catch {
    return NextResponse.json({ detail: 'Não foi possível conectar ao servidor. Tente novamente.' }, { status: 502 });
  }
}
