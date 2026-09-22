import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const backend = `${process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'}/folhas/enviar-lote`;
  const response = await fetch(backend, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(request.headers.get('Idempotency-Key')
        ? { 'Idempotency-Key': request.headers.get('Idempotency-Key') as string }
        : {}),
    },
    body: await request.text(),
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}