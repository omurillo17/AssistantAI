import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { ENV } from "@/lib/env";
import { syncPromptContextDisk } from "@/lib/syncPromptContext";

export const dynamic = 'force-dynamic';

async function verifyRoot() {
  const cookieStore = await cookies();
  const token = cookieStore.get("tci_session")?.value;
  if (!token) return false;
  try {
    const secretKey = new TextEncoder().encode(ENV.JWT_SECRET);
    const { payload } = await jwtVerify(token, secretKey);
    return payload.usuario === 'omurillo17' || payload.usuario === 'root' || payload.rol === 'ROOT';
  } catch (err) {
    return false;
  }
}

export async function POST(request: Request) {
  if (!(await verifyRoot())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { empresa_id, nombre, rfc, ubicacion_maps } = body;

    if (!empresa_id || !nombre) {
      return NextResponse.json({ error: "Empresa ID y nombre son obligatorios" }, { status: 400 });
    }

    const res = await pool.query(
      `INSERT INTO naves (empresa_id, nombre, rfc, ubicacion_maps) VALUES ($1, $2, $3, $4) RETURNING *`,
      [empresa_id, nombre, rfc || '', ubicacion_maps || '']
    );

    await syncPromptContextDisk(empresa_id);

    return NextResponse.json({ success: true, nave: res.rows[0] });
  } catch (err) {
    console.error('Error creating nave:', err);
    return NextResponse.json({ error: 'Error al crear nave' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await verifyRoot())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, nombre, rfc, ubicacion_maps } = body;

    if (!id || !nombre) {
      return NextResponse.json({ error: "ID y nombre son obligatorios" }, { status: 400 });
    }

    const res = await pool.query(
      `UPDATE naves SET nombre = $1, rfc = $2, ubicacion_maps = $3 WHERE id = $4 RETURNING *`,
      [nombre, rfc || '', ubicacion_maps || '', id]
    );

    if (res.rows[0]?.empresa_id) {
      await syncPromptContextDisk(res.rows[0].empresa_id);
    } else {
      await syncPromptContextDisk();
    }

    return NextResponse.json({ success: true, nave: res.rows[0] });
  } catch (err) {
    console.error('Error updating nave:', err);
    return NextResponse.json({ error: 'Error al actualizar nave' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await verifyRoot())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: "ID de nave es obligatorio" }, { status: 400 });
    }

    await pool.query(`DELETE FROM naves WHERE id = $1`, [id]);
    await syncPromptContextDisk();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting nave:', err);
    return NextResponse.json({ error: 'Error al eliminar nave' }, { status: 500 });
  }
}
