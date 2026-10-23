import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/auth';

function buildReclutadoresFilter(userRole: string, userGrupoId: string | null, cleanEmpresaId: string | null) {
  let clause = "";
  const params: unknown[] = [];
  let paramIdx = 1;

  if (userRole === "RECLUTADOR") {
    clause += ` AND u.rol = 'RECLUTADOR'`;
    if (cleanEmpresaId) {
      clause += ` AND u.empresa_id = $${paramIdx++}`;
      params.push(cleanEmpresaId);
    }
  } else if (userRole === "ENCARGADO") {
    if (userGrupoId) {
      clause += ` AND (
        (u.rol = 'ENCARGADO' AND (u.grupo_id IS NULL OR u.grupo_id != $${paramIdx}))
        OR
        (u.rol = 'RECLUTADOR' AND u.grupo_id = $${paramIdx})
      )`;
      params.push(userGrupoId);
      paramIdx++;
    }
    if (cleanEmpresaId) {
      clause += ` AND u.empresa_id = $${paramIdx++}`;
      params.push(cleanEmpresaId);
    }
  } else if (userRole !== "ROOT" && cleanEmpresaId) {
    clause += ` AND u.empresa_id = $${paramIdx++}`;
    params.push(cleanEmpresaId);
  }

  return { clause, params };
}

function groupReclutadoresRows(rows: Record<string, unknown>[]) {
  const groupMap = new Map<string, { [k: string]: unknown; reclutadores: Record<string, unknown>[] }>();

  for (const row of rows) {
    const groupKey = (row.grupo_id as string) || "sin_grupo";
    const groupName = (row.grupo_nombre as string) || "Sin Grupo / General";

    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, {
        grupo_id: row.grupo_id,
        grupo_nombre: groupName,
        empresa_id: row.empresa_id,
        empresa_nombre: row.empresa_nombre || "General",
        reclutadores: []
      });
    }

    groupMap.get(groupKey)!.reclutadores.push({
      id: row.reclutador_id,
      nombre: row.nombre_display,
      usuario: row.usuario,
      rol: row.rol,
      grupo_id: row.grupo_id,
      empresa_id: row.empresa_id
    });
  }

  return Array.from(groupMap.values());
}

export async function GET(request: Request) {
  // Fail-closed: sin sesión válida no se devuelve nada (antes continuaba como "USER").
  const payload = await getSession(request);
  if (!payload) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const userRole = (payload.rol as string) || "USER";
  const userEmpresaId = (payload.empresa_id as string | null) ?? null;
  const userGrupoId = (payload.grupo_id as string | null) ?? null;

  const { searchParams } = new URL(request.url);
  const rawEmpresaId = searchParams.get("empresa_id");
  const isGrouped = searchParams.get("grouped") === "true";

  const sanitizeId = (id: string | null) => (id && id !== "null" && id !== "undefined" ? id : null);
  // ?empresa_id= solo lo respeta ROOT; el resto queda en la empresa de su JWT.
  const cleanEmpresaId = userRole === "ROOT"
    ? sanitizeId(rawEmpresaId) ?? sanitizeId(userEmpresaId)
    : sanitizeId(userEmpresaId);
  if (userRole !== "ROOT" && !cleanEmpresaId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  try {
    const { clause, params } = buildReclutadoresFilter(userRole, userGrupoId, cleanEmpresaId);
    const query = `
      SELECT
        u.id,
        u.reclutador_id,
        u.usuario,
        u.rol,
        u.grupo_id,
        u.empresa_id,
        UPPER(COALESCE(r.nombre, u.usuario)) AS nombre_display,
        g.nombre AS grupo_nombre,
        e.nombre AS empresa_nombre
      FROM usuarios u
      LEFT JOIN reclutadores r ON u.reclutador_id = r.id
      LEFT JOIN grupos_reclutamiento g ON u.grupo_id = g.id
      LEFT JOIN empresas e ON u.empresa_id = e.id
      WHERE u.rol IN ('RECLUTADOR', 'ENCARGADO') AND u.reclutador_id IS NOT NULL
      ${clause}
      ORDER BY g.nombre ASC NULLS LAST, u.rol ASC, nombre_display ASC
    `;

    const result = await pool.query(query, params);

    if (isGrouped) {
      return NextResponse.json({ grupos: groupReclutadoresRows(result.rows) });
    }

    return NextResponse.json(result.rows.map(row => row.nombre_display));
  } catch (error) {
    console.error('Error fetching reclutadores:', error);
    return NextResponse.json({ error: 'Error al obtener los reclutadores' }, { status: 500 });
  }
}
