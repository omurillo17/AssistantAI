import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { pool } from '@/lib/db';
import { getSession, type SessionPayload } from '@/lib/auth';

// Alcance de notificaciones por destinatario (filtro SQL sobre `notificaciones`,
// con placeholders desde $<desde>). null = la sesión no ve ninguna.
// - ROOT: todas.
// - ADMIN / ENCARGADO: las de reclutadores de su empresa.
// - RECLUTADOR / USER: solo las suyas.
// Las de reclutador_id NULL no tienen empresa, así que solo las ve ROOT.
// ponytail: sin columna empresa_id en notificaciones, las NULL quedan fuera
// para todos salvo ROOT; agregarla si se necesitan avisos "de empresa".
function alcanceNotificaciones(payload: SessionPayload, desde = 1): { where: string; params: string[] } | null {
  const rol = payload.rol || 'USER';
  if (rol === 'ROOT') return { where: 'TRUE', params: [] };
  if (rol === 'ADMIN' || rol === 'ENCARGADO') {
    if (!payload.empresa_id) return null;
    return {
      where: `reclutador_id IN (SELECT id FROM reclutadores WHERE empresa_id = $${desde})`,
      params: [payload.empresa_id],
    };
  }
  if (!payload.reclutador_id) return null;
  return { where: `reclutador_id = $${desde}`, params: [payload.reclutador_id] };
}

export async function GET(request: Request) {
  try {
    const payload = await getSession(request);
    if (!payload) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const alcance = alcanceNotificaciones(payload);
    if (!alcance) {
      return NextResponse.json({ unread: 0, items: [] });
    }

    const res = await pool.query(`
      SELECT id, mensaje, leida, created_at
      FROM notificaciones
      WHERE ${alcance.where}
      ORDER BY created_at DESC
      LIMIT 20
    `, alcance.params);

    const unreadCount = res.rows.filter(r => !r.leida).length;

    return NextResponse.json({ unread: unreadCount, items: res.rows });
  } catch (err) {
    console.error('Error fetching notificaciones:', err);
    return NextResponse.json({ error: 'Error' }, { status: 500 });
  }
}

// ─── POST /api/db/notificaciones ───────────────────────────
// Crea una notificación desde el CRM. La usa el modal de verificación de
// identidad al cerrarse: en vez de seguir interrumpiendo al reclutador cada
// 10 segundos, la alerta baja a la campana y ahí espera. Se evita duplicar:
// si ya hay una notificación sin leer para ese candidato, no se inserta otra.
export async function POST(request: Request) {
  try {
    const payload = await getSession(request);
    if (!payload) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const reclutador_id = (payload.reclutador_id as string | null) ?? null;

    const body = await request.json().catch(() => ({}));
    const mensaje = typeof body?.mensaje === 'string' ? body.mensaje.trim().slice(0, 2000) : '';
    const clave = typeof body?.clave === 'string' ? body.clave.trim().slice(0, 100) : '';

    if (!mensaje) {
      return NextResponse.json({ error: 'Falta el mensaje' }, { status: 400 });
    }

    if (clave) {
      const yaExiste = await pool.query(
        `SELECT 1 FROM notificaciones
         WHERE leida = false AND mensaje LIKE $1
           AND (reclutador_id = $2 OR (reclutador_id IS NULL AND $2::varchar IS NULL))
         LIMIT 1`,
        [`%${clave}%`, reclutador_id]
      );
      if (yaExiste.rowCount) {
        return NextResponse.json({ success: true, duplicada: true });
      }
    }

    await pool.query('INSERT INTO notificaciones (reclutador_id, mensaje) VALUES ($1, $2)', [reclutador_id, mensaje]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error creando notificación:', err);
    return NextResponse.json({ error: 'Error creando notificación' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await getSession(request);
    if (!payload) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const { id } = body;

    // Con id, $1 es el id y el alcance empieza en $2.
    const alcance = alcanceNotificaciones(payload, id ? 2 : 1);
    if (!alcance) {
      return NextResponse.json({ success: true });
    }

    // Con id marca esa (si está en su alcance); sin id, todas las de su alcance.
    if (id) {
      await pool.query(`UPDATE notificaciones SET leida = true WHERE id = $1 AND ${alcance.where}`, [id, ...alcance.params]);
    } else {
      await pool.query(`UPDATE notificaciones SET leida = true WHERE ${alcance.where}`, alcance.params);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error updating notificaciones:', err);
    return NextResponse.json({ error: 'Error updating' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = await getSession(request);
    if (!payload) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    const alcance = alcanceNotificaciones(payload, id ? 2 : 1);
    if (!alcance) {
      return NextResponse.json({ success: true });
    }

    // Mismo alcance que GET: ADMIN ya no vacía las notificaciones de otras empresas.
    if (id) {
      await pool.query(`DELETE FROM notificaciones WHERE id = $1 AND ${alcance.where}`, [id, ...alcance.params]);
    } else {
      await pool.query(`DELETE FROM notificaciones WHERE ${alcance.where}`, alcance.params);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error deleting notification:", err);
    return NextResponse.json({ error: 'Error deleting notification' }, { status: 500 });
  }
}
