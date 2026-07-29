import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { ENV } from "@/lib/env";

export const dynamic = 'force-dynamic';

async function verifyAuthAndTenant() {
  const cookieStore = await cookies();
  const token = cookieStore.get("tci_session")?.value;
  if (!token) return null;
  try {
    const secretKey = new TextEncoder().encode(ENV.JWT_SECRET);
    const { payload } = await jwtVerify(token, secretKey);
    return payload;
  } catch (err) {
    return null;
  }
}

export async function GET(request: Request) {
  const payload = await verifyAuthAndTenant();
  if (!payload || (payload.rol !== 'ADMIN' && payload.rol !== 'ENCARGADO' && payload.rol !== 'ROOT')) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const empresaId = searchParams.get('empresaId');

    let query = `
      SELECT id, empresa_id, nombre, naves_asignadas, created_at 
      FROM grupos_reclutamiento 
    `;
    let params: any[] = [];

    if (empresaId) {
      query += ` WHERE empresa_id = $1 ORDER BY created_at ASC`;
      params = [empresaId];
    } else {
      query += ` ORDER BY created_at ASC`;
    }

    const res = await pool.query(query, params);
    return NextResponse.json(res.rows);
  } catch (err) {
    console.error('Error fetching grupos:', err);
    return NextResponse.json({ error: 'Error al obtener grupos' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const payload = await verifyAuthAndTenant();
  if (!payload || (payload.rol !== 'ADMIN' && payload.rol !== 'ENCARGADO' && payload.rol !== 'ROOT')) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { empresa_id, nombre, naves_asignadas, naves } = body;

    if (!empresa_id || !nombre) {
      return NextResponse.json({ error: "empresa_id y nombre son obligatorios" }, { status: 400 });
    }

    const finalNaves = naves_asignadas || naves || [];

    const res = await pool.query(
      `INSERT INTO grupos_reclutamiento (empresa_id, nombre, naves_asignadas) VALUES ($1, $2, $3::jsonb) RETURNING *`,
      [empresa_id, nombre, JSON.stringify(finalNaves)]
    );

    return NextResponse.json({ success: true, grupo: res.rows[0] });
  } catch (err) {
    console.error('Error creating grupo:', err);
    return NextResponse.json({ error: 'Error al crear grupo' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const payload = await verifyAuthAndTenant();
  if (!payload || (payload.rol !== 'ADMIN' && payload.rol !== 'ENCARGADO' && payload.rol !== 'ROOT')) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, nombre, naves_asignadas, naves } = body;

    if (!id || !nombre) {
      return NextResponse.json({ error: "ID y nombre son obligatorios" }, { status: 400 });
    }

    const finalNaves = naves_asignadas || naves || [];

    const res = await pool.query(
      `UPDATE grupos_reclutamiento SET nombre = $1, naves_asignadas = $2::jsonb WHERE id = $3 RETURNING *`,
      [nombre, JSON.stringify(finalNaves), id]
    );

    return NextResponse.json({ success: true, grupo: res.rows[0] });
  } catch (err) {
    console.error('Error updating grupo:', err);
    return NextResponse.json({ error: 'Error al actualizar grupo' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const payload = await verifyAuthAndTenant();
  if (!payload || (payload.rol !== 'ADMIN' && payload.rol !== 'ENCARGADO' && payload.rol !== 'ROOT')) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: "ID es obligatorio" }, { status: 400 });
    }

    await pool.query(`DELETE FROM grupos_reclutamiento WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting grupo:', err);
    return NextResponse.json({ error: 'Error al eliminar grupo' }, { status: 500 });
  }
}
