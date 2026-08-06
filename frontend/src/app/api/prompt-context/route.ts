import { NextResponse } from 'next/server';
import { verifyInternalApiKey } from '@/lib/auth';
import { buildPromptContext } from '@/lib/promptContext';

/**
 * GET /api/prompt-context?empresa_id=xxx
 *
 * Genera dinamicamente desde PostgreSQL todo el contexto que necesita la IA de n8n:
 * - prompt_base: Plantilla del prompt (override de la empresa si existe, si no el global)
 * - menu_naves: Lista de sucursales con direccion y link
 * - menu_vacantes: Listado simple de nombres de vacantes por nave
 * - detalle_vacantes: Detalles completos de cada vacante por nave (incluye reglas de
 *   evaluacion generadas a partir de los filtros configurados en /vacantes/[id])
 * - equipo_reclutadores: Reemplaza reclutador_vacantes.json (mismo formato)
 *
 * Acceso publico con API key (header x-api-key) para consumo desde n8n.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id');

  if (!verifyInternalApiKey(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const context = await buildPromptContext(empresa_id);
    return NextResponse.json(context);
  } catch (err) {
    console.error('Error generating prompt-context:', err);
    return NextResponse.json({ error: 'Error generando contexto' }, { status: 500 });
  }
}
