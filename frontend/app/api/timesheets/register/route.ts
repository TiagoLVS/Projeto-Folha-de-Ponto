import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const response = await fetch(
      `${process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'}/folhas/registrar`,
      { method: 'POST', body: await request.formData() },
    );
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ detail: 'Não foi possível guardar o documento no servidor.' }, { status: 502 });
  }
}
