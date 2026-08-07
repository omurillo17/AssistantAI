import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/auth';

// ─── GET /api/db/alertas-identidad ─────────────────────────
// Candidatos con una discrepancia de CURP (INE vs RFC) pendiente de
// validar por el reclutador responsable de la vacante. Alimenta el modal
// urgente y la campana de notificaciones en cualquier pantalla del CRM.
export async function GET(request: Request) {
  try {
    const payload = await getSession(request);
    if (!payload) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const reclutador_id = (payload.reclutador_id as string | null) ?? null;
    const rol = (payload.rol as string) || 'USER';

    if (!reclutador_id && rol !== 'ADMIN' && rol !== 'ROOT') {
      return NextResponse.json({ items: [] });
    }

    let filter = "WHERE c.alerta_identidad_estado = 'PENDIENTE'";
    const params: string[] = [];
    if (rol !== 'ADMIN' && rol !== 'ROOT') {
      filter += ' AND c.asignado_a_id = $1';
      params.push(reclutador_id as string);
    }

    const res = await pool.query(
      `SELECT
         c.telefono,
         COALESCE(NULLIF(TRIM(c.nombre_ine), ''), c.nombre) AS nombre_ine,
         c.curp_ine,
         c.nombre_constancia,
         c.curp_rfc,
         c.vacante_interes,
         c.alerta_identidad_motivo,
         c.updated_at
       FROM candidatos c
       ${filter}
       ORDER BY c.updated_at DESC
       LIMIT 20`,
      params
    );

    return NextResponse.json({ items: res.rows });
  } catch (err) {
    console.error('Error fetching alertas-identidad:', err);
    return NextResponse.json({ error: 'Error' }, { status: 500 });
  }
}
