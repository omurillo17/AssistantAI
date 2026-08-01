import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getSession, requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function verifyRootOrAdmin(request: Request): Promise<boolean> {
  return requireRole(await getSession(request), 'ROOT', 'ADMIN');
}

// GET: Obtener todas las relaciones de empresas ligadas
export async function GET(request: Request) {
  if (!(await verifyRootOrAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const res = await pool.query(`
      SELECT el.id, el.empresa_origen_id, el.empresa_destino_id, el.created_at,
             eo.nombre as origen_nombre, ed.nombre as destino_nombre
      FROM empresas_ligadas el
      JOIN empresas eo ON el.empresa_origen_id = eo.id
      JOIN empresas ed ON el.empresa_destino_id = ed.id
      ORDER BY el.created_at DESC
    `);
    return NextResponse.json({ success: true, relaciones: res.rows });
  } catch (err) {
    console.error('Error fetching empresas ligadas:', err);
    return NextResponse.json({ error: 'Error al obtener relaciones' }, { status: 500 });
  }
}

// POST: Crear relación bidireccional entre empresas
export async function POST(request: Request) {
  if (!(await verifyRootOrAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { empresa_origen_id, empresa_destino_id } = body;

    if (!empresa_origen_id || !empresa_destino_id) {
      return NextResponse.json({ error: "Ambas empresas son obligatorias" }, { status: 400 });
    }

    if (empresa_origen_id === empresa_destino_id) {
      return NextResponse.json({ error: "No puedes ligar una empresa consigo misma" }, { status: 400 });
    }

    // Insert bidirectional (A→B and B→A)
    await pool.query(`
      INSERT INTO empresas_ligadas (empresa_origen_id, empresa_destino_id)
      VALUES ($1, $2), ($2, $1)
      ON CONFLICT DO NOTHING
    `, [empresa_origen_id, empresa_destino_id]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error creating relacion:', err);
    return NextResponse.json({ error: 'Error al crear relación' }, { status: 500 });
  }
}

// DELETE: Eliminar relación bidireccional
export async function DELETE(request: Request) {
  if (!(await verifyRootOrAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const empresaA = searchParams.get('empresaA');
    const empresaB = searchParams.get('empresaB');

    if (!empresaA || !empresaB) {
      return NextResponse.json({ error: "Ambas empresas son obligatorias" }, { status: 400 });
    }

    await pool.query(`
      DELETE FROM empresas_ligadas 
      WHERE (empresa_origen_id = $1 AND empresa_destino_id = $2)
         OR (empresa_origen_id = $2 AND empresa_destino_id = $1)
    `, [empresaA, empresaB]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting relacion:', err);
    return NextResponse.json({ error: 'Error al eliminar relación' }, { status: 500 });
  }
}
