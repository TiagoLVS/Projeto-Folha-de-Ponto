import { NextResponse } from 'next/server';

export async function proxyBackend(path: string, request?: Request) {
  try {
    const response = await fetch(
      `${process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'}${path}`,
      {
        method: request?.method ?? 'GET',
        cache: 'no-store',
        ...(request && {
          headers: { 'Content-Type': 'application/json' },
          body: await request.text(),
        }),
      },
    );
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json(
      { detail: 'Não foi possível conectar ao servidor. Tente novamente.' },
      { status: 502 },
    );
  }
}
