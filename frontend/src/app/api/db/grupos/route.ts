import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { getSession, requireRole, type SessionPayload } from '@/lib/auth';
import { empresaDeSesion } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

// ENCARGADO también gestiona grupos a propósito: /usuarios le muestra el
// botón "Grupos" (GroupsModal). Siempre dentro de su propia empresa.
function puedeGestionarGrupos(payload: SessionPayload | null): payload is SessionPayload {
  return requireRole(payload, 'ADMIN', 'ENCARGADO', 'ROOT');
}

const grupoBodySchema = z.object({
  id: z.uuid().optional(),
  // GroupsModal manda "" mientras no se elige empresa; para no-ROOT se ignora.
  empresa_id: z.uuid().or(z.literal('')).optional().nullable(),
  nombre: z.string().trim().min(1).max(255),
  naves_asignadas: z.array(z.string()).optional(),
  naves: z.array(z.string()).optional(),
  telefono_whatsapp: z.string().max(50).optional().nullable(),
});

/**
 * ¿El número de WhatsApp ya es la línea de un grupo de OTRA empresa? Los
 * mensajes entrantes se enrutan a la empresa por este número
 * (lib/empresaResolution.ts), así que compartirlo mezclaría tenants.
 */
async function telefonoDeOtraEmpresa(telefono: string | null | undefined, empresaId: string): Promise<boolean> {
  const digitos = (telefono || '').replace(/\D/g, '');
  if (!digitos) return false;
  const res = await pool.query(
    `SELECT 1 FROM grupos_reclutamiento
      WHERE regexp_replace(telefono_whatsapp, '\\D', '', 'g') = $1 AND empresa_id <> $2
      LIMIT 1`,
    [digitos, empresaId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function GET(request: Request) {
  const payload = await getSession(request);
  if (!puedeGestionarGrupos(payload)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    // ROOT sin ?empresaId= ve todos (panel SaaS); el resto, solo su empresa.
    const empresaId = payload.rol === 'ROOT' ? searchParams.get('empresaId') : empresaDeSesion(payload);
    if (!empresaId && payload.rol !== 'ROOT') {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    let query = `
      SELECT id, empresa_id, nombre, naves_asignadas, telefono_whatsapp, whatsapp_phone_number_id, created_at
      FROM grupos_reclutamiento
    `;
    let params: unknown[] = [];

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
  const payload = await getSession(request);
  if (!puedeGestionarGrupos(payload)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const parsed = grupoBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "empresa_id y nombre son obligatorios" }, { status: 400 });
    }
    const { nombre, naves_asignadas, naves, telefono_whatsapp } = parsed.data;

    // Solo ROOT elige empresa; el resto crea dentro de la de su JWT.
    const empresa_id = empresaDeSesion(payload, parsed.data.empresa_id);
    if (!empresa_id) {
      return NextResponse.json({ error: "empresa_id y nombre son obligatorios" }, { status: 400 });
    }
    if (await telefonoDeOtraEmpresa(telefono_whatsapp, empresa_id)) {
      return NextResponse.json({ error: "Ese número de WhatsApp ya pertenece a otra empresa" }, { status: 409 });
    }

    const finalNaves = naves_asignadas || naves || [];

    const res = await pool.query(
      `INSERT INTO grupos_reclutamiento (empresa_id, nombre, naves_asignadas, telefono_whatsapp) VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
      [empresa_id, nombre, JSON.stringify(finalNaves), telefono_whatsapp || '']
    );

    return NextResponse.json({ success: true, grupo: res.rows[0] });
  } catch (err) {
    console.error('Error creating grupo:', err);
    return NextResponse.json({ error: 'Error al crear grupo' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const payload = await getSession(request);
  if (!puedeGestionarGrupos(payload)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const parsed = grupoBodySchema.safeParse(await request.json());
    if (!parsed.success || !parsed.data.id) {
      return NextResponse.json({ error: "ID y nombre son obligatorios" }, { status: 400 });
    }
    const { id, nombre, naves_asignadas, naves, telefono_whatsapp } = parsed.data;

    // null = ROOT, sin filtro de empresa.
    const empresaSesion = payload.rol === 'ROOT' ? null : empresaDeSesion(payload);
    if (!empresaSesion && payload.rol !== 'ROOT') {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const actual = await pool.query(
      `SELECT empresa_id FROM grupos_reclutamiento WHERE id = $1 AND ($2::uuid IS NULL OR empresa_id = $2)`,
      [id, empresaSesion]
    );
    if (actual.rowCount === 0) {
      return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
    }
    if (await telefonoDeOtraEmpresa(telefono_whatsapp, actual.rows[0].empresa_id)) {
      return NextResponse.json({ error: "Ese número de WhatsApp ya pertenece a otra empresa" }, { status: 409 });
    }

    const finalNaves = naves_asignadas || naves || [];

    // COALESCE: el panel SaaS reasigna naves mandando solo id/nombre/naves;
    // antes eso borraba el telefono_whatsapp del grupo.
    const res = await pool.query(
      `UPDATE grupos_reclutamiento SET nombre = $1, naves_asignadas = $2::jsonb, telefono_whatsapp = COALESCE($3, telefono_whatsapp)
        WHERE id = $4 AND ($5::uuid IS NULL OR empresa_id = $5) RETURNING *`,
      [nombre, JSON.stringify(finalNaves), telefono_whatsapp ?? null, id, empresaSesion]
    );

    return NextResponse.json({ success: true, grupo: res.rows[0] });
  } catch (err) {
    console.error('Error updating grupo:', err);
    return NextResponse.json({ error: 'Error al actualizar grupo' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const payload = await getSession(request);
  if (!puedeGestionarGrupos(payload)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: "ID es obligatorio" }, { status: 400 });
    }

    const empresaSesion = payload.rol === 'ROOT' ? null : empresaDeSesion(payload);
    if (!empresaSesion && payload.rol !== 'ROOT') {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const res = await pool.query(
      `DELETE FROM grupos_reclutamiento WHERE id = $1 AND ($2::uuid IS NULL OR empresa_id = $2)`,
      [id, empresaSesion]
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting grupo:', err);
    return NextResponse.json({ error: 'Error al eliminar grupo' }, { status: 500 });
  }
}
