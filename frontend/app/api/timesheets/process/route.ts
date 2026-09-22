import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const formData = await request.formData();

  const arquivo = formData.get('arquivo');
  if (!(arquivo instanceof File)) {
    return Response.json({ detail: 'Arquivo obrigatório.' }, { status: 400 });
  }

  const backendData = new FormData();

  backendData.append('arquivo', arquivo, arquivo.name);

  const response = await fetch(
    `${process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'}/folhas/processar`,
    {
      method: 'POST',
      body: backendData,
    }
  );

  const data = await response.json();

  return NextResponse.json(data, {
    status: response.status,
  });
}
