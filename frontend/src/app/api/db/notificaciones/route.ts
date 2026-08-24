import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const payload = await getSession(request);
    if (!payload) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const reclutador_id = (payload.reclutador_id as string | null) ?? null;
    const rol = (payload.rol as string) || "USER";

    if (!reclutador_id && rol !== "ADMIN") {
      return NextResponse.json({ unread: 0, items: [] });
    }

    let filter = "";
    const params: string[] = [];
    if (rol === "RECLUTADOR") {
      filter = "WHERE (reclutador_id = $1 OR reclutador_id IS NULL)";
      params.push(reclutador_id as string);
    }

    const res = await pool.query(`
      SELECT id, mensaje, leida, created_at
      FROM notificaciones
      ${filter}
      ORDER BY created_at DESC
      LIMIT 20
    `, params);

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
    const reclutador_id = (payload.reclutador_id as string | null) ?? null;
    const rol = (payload.rol as string) || "USER";

    const body = await request.json().catch(() => ({}));
    const { id } = body;

    if (id) {
      await pool.query('UPDATE notificaciones SET leida = true WHERE id = $1', [id]);
    } else if (rol === "RECLUTADOR" && reclutador_id) {
      await pool.query('UPDATE notificaciones SET leida = true WHERE reclutador_id = $1 OR reclutador_id IS NULL', [reclutador_id]);
    } else {
      // ADMIN, ROOT o USER sin reclutador_id específico -> marcar todas como leídas
      await pool.query('UPDATE notificaciones SET leida = true');
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
    const reclutador_id = (payload.reclutador_id as string | null) ?? null;
    const rol = (payload.rol as string) || "USER";

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      await pool.query('DELETE FROM notificaciones WHERE id = $1', [id]);
    } else if (rol === "ADMIN" || rol === "ROOT") {
      await pool.query('DELETE FROM notificaciones');
    } else if (reclutador_id) {
      await pool.query('DELETE FROM notificaciones WHERE reclutador_id = $1', [reclutador_id]);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error deleting notification:", err);
    return NextResponse.json({ error: 'Error deleting notification' }, { status: 500 });
  }
}
