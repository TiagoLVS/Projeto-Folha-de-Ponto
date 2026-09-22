import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const response = await fetch(
    `${process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'}/servidores`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
    },
  );
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}