import { proxyBackend } from '@/lib/backend-proxy';
import { validatePdf } from '@/lib/timesheet-api';
export async function POST(request: Request) {
  try {
    const form = await request.clone().formData();
    const file = form.get('arquivo');
    if (!(file instanceof File)) return Response.json({ detail: 'PDF obrigatório.' }, { status: 400 });
    await validatePdf(file);
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : 'Upload inválido.' }, { status: 400 });
  }
  return proxyBackend('/folhas/registrar', request);
}
