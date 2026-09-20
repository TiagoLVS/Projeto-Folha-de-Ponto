import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const formData = await request.formData();

  const arquivo = formData.get('arquivo');

  const backendData = new FormData();

  backendData.append('arquivo', arquivo, arquivo.name);

  const response = await fetch(
    'http://127.0.0.1:8000/folhas/processar',
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
