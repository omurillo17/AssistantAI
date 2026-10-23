import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/lib/auth';
import { candidatoVisible } from '@/lib/tenant';

const bodySchema = z.object({
  telefono: z.string().min(1, 'Falta el campo telefono').max(20),
});

// ─── POST /api/db/candidato/clasificar-archivos ─────────────
// Vuelve a pasar por la IA los archivos YA guardados de un candidato para
// saber cuál es la INE, cuál la Constancia y cuáles son "otros archivos".
// Solo hace falta en expedientes anteriores a la clasificación por archivo:
// los nuevos ya llegan clasificados desde el analizador.
//
// El trabajo pesado (leer los archivos + Gemini) vive en el backend Python;
// esta ruta existe para exigir sesión de reclutador, porque el proxy genérico
// /api/backend no valida usuario.
export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos', detail: z.flattenError(parsed.error) }, { status: 400 });
    }
    // El backend busca solo por teléfono: sin esto se podían reclasificar
    // (y leer) los archivos de un candidato de otra empresa.
    if (!(await candidatoVisible(session, parsed.data.telefono))) {
      return NextResponse.json({ error: 'Candidato no encontrado' }, { status: 404 });
    }

    const backendBase = process.env.BACKEND_API_BASE || 'http://backend:8000'; // NOSONAR
    const apiKey = process.env.PYTHON_SERVICE_API_KEY;
    const resp = await fetch(`${backendBase}/internal/documentos/clasificar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
      },
      body: JSON.stringify({ telefono: parsed.data.telefono }),
    });

    if (!resp.ok) {
      console.error('clasificar-archivos: backend respondió', resp.status);
      return NextResponse.json({ error: 'No se pudo clasificar con IA' }, { status: 502 });
    }

    return NextResponse.json(await resp.json());
  } catch (err) {
    console.error('Error clasificando archivos del candidato:', err);
    return NextResponse.json({ error: 'Error interno al clasificar archivos' }, { status: 500 });
  }
}
