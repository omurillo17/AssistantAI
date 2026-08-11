import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getSession, requireRole } from '@/lib/auth';
import { syncPromptContextDisk } from '@/lib/syncPromptContext';

export const dynamic = 'force-dynamic';

// El acceso ROOT depende únicamente del rol en el JWT; nunca de usernames fijos.
async function verifyRoot(request: Request): Promise<boolean> {
  return requireRole(await getSession(request), 'ROOT');
}

export async function GET(request: Request) {
  const payload = await getSession(request);
  if (!payload) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    let query = `
      SELECT e.id, e.nombre, e.prompt_ia, e.retencion_archivos_dias, e.created_at,
        (SELECT json_agg(row_to_json(n.*)) FROM (
          SELECT id, nombre, ubicacion_maps, rfc, created_at, empresa_id FROM naves WHERE empresa_id = e.id ORDER BY created_at ASC
        ) n) as naves,
        (SELECT json_agg(row_to_json(g.*)) FROM (
          SELECT id, nombre, naves_asignadas, empresa_id FROM grupos_reclutamiento WHERE empresa_id = e.id ORDER BY created_at ASC
        ) g) as grupos
      FROM empresas e
    `;

    const params: unknown[] = [];
    if (payload.rol !== 'ROOT' && payload.empresa_id) {
      query += ` WHERE e.id = $1 `;
      params.push(payload.empresa_id);
    }
    
    query += ` ORDER BY e.created_at ASC `;

    const res = await pool.query(query, params);

    return NextResponse.json({ success: true, empresas: res.rows });
  } catch (err) {
    console.error('Error fetching empresas:', err);
    return NextResponse.json({ error: 'Error al obtener empresas' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await verifyRoot(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { nombre, prompt_ia, retencion_archivos_dias } = body;

    if (!nombre) {
      return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    }

    const res = await pool.query(
      `INSERT INTO empresas (nombre, prompt_ia, retencion_archivos_dias) VALUES ($1, $2, $3) RETURNING *`,
      [nombre, prompt_ia || '', Number.isInteger(retencion_archivos_dias) && retencion_archivos_dias > 0 ? retencion_archivos_dias : 30]
    );

    return NextResponse.json({ success: true, empresa: res.rows[0] });
  } catch (err) {
    console.error('Error creating empresa:', err);
    return NextResponse.json({ error: 'Error al crear empresa' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await verifyRoot(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, nombre, prompt_ia, retencion_archivos_dias } = body;

    if (!id || !nombre) {
      return NextResponse.json({ error: "ID y nombre son obligatorios" }, { status: 400 });
    }

    const res = await pool.query(
      `UPDATE empresas SET nombre = $1, prompt_ia = $2, retencion_archivos_dias = $3 WHERE id = $4 RETURNING *`,
      [nombre, prompt_ia || '', Number.isInteger(retencion_archivos_dias) && retencion_archivos_dias > 0 ? retencion_archivos_dias : 30, id]
    );

    // El agente lee `prompt_base` desde virgo_data/data/prompt_context.json,
    // no de esta tabla: sin regenerar el archivo, el prompt editado aquí no
    // llegaba al bot hasta que alguien guardara una vacante por otro lado.
    await syncPromptContextDisk(id);

    return NextResponse.json({ success: true, empresa: res.rows[0] });
  } catch (err) {
    console.error('Error updating empresa:', err);
    return NextResponse.json({ error: 'Error al actualizar empresa' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await verifyRoot(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: "ID de empresa es obligatorio" }, { status: 400 });
    }

    await pool.query(`DELETE FROM empresas WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting empresa:', err);
    return NextResponse.json({ error: 'Error al eliminar empresa' }, { status: 500 });
  }
}
