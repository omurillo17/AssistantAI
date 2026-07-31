import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { pool } from '@/lib/db';
import { jwtVerify } from "jose";
import { ENV } from "@/lib/env";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("tci_session")?.value;
    if (!token) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    
    let reclutador_id = null;
    let rol = "USER";

    try {
      const secretKey = new TextEncoder().encode(ENV.JWT_SECRET);
      const { payload } = await jwtVerify(token, secretKey);
      reclutador_id = payload.reclutador_id as string | null;
      rol = payload.rol as string;
    } catch (err) {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    if (!reclutador_id && rol !== "ADMIN") {
      return NextResponse.json({ unread: 0, items: [] });
    }

    let filter = "";
    let params: any[] = [];
    if (rol === "RECLUTADOR") {
      filter = "WHERE (reclutador_id = $1 OR reclutador_id IS NULL)";
      params.push(reclutador_id);
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

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { id } = body;
    
    if (id) {
      await pool.query('UPDATE notificaciones SET leida = true WHERE id = $1', [id]);
    } else {
      // Mark all as read for user
      const cookieStore = await cookies();
      const token = cookieStore.get("tci_session")?.value;
      if (!token) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
      }
      
      try {
        const secretKey = new TextEncoder().encode(ENV.JWT_SECRET);
        const { payload } = await jwtVerify(token, secretKey);
        const reclutador_id = payload.reclutador_id as string | null;
        const rol = payload.rol as string;

        if (rol === "RECLUTADOR" && reclutador_id) {
          await pool.query('UPDATE notificaciones SET leida = true WHERE reclutador_id = $1 OR reclutador_id IS NULL', [reclutador_id]);
        } else {
          // ADMIN, ROOT or USER without specific reclutador_id -> mark all notifications as read
          await pool.query('UPDATE notificaciones SET leida = true');
        }
      } catch (err) {
        return NextResponse.json({ error: "Token inválido" }, { status: 401 });
      }
    }
    
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error updating notificaciones:', err);
    return NextResponse.json({ error: 'Error updating' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      await pool.query('DELETE FROM notificaciones WHERE id = $1', [id]);
    } else {
      // Delete all notifications for user
      const cookieStore = await cookies();
      const token = cookieStore.get("tci_session")?.value;
      if (!token) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
      }

      try {
        const secretKey = new TextEncoder().encode(ENV.JWT_SECRET);
        const { payload } = await jwtVerify(token, secretKey);
        const reclutador_id = payload.reclutador_id as string | null;
        const rol = payload.rol as string;

        if (rol === "ADMIN" || rol === "ROOT") {
          await pool.query('DELETE FROM notificaciones');
        } else if (reclutador_id) {
          await pool.query('DELETE FROM notificaciones WHERE reclutador_id = $1', [reclutador_id]);
        }
      } catch (err) {
        return NextResponse.json({ error: "Token inválido" }, { status: 401 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error deleting notification:", err);
    return NextResponse.json({ error: 'Error deleting notification' }, { status: 500 });
  }
}

