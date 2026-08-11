import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/auth';

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

  const cleanEmpresaId =
    rawEmpresaId && rawEmpresaId !== "null" && rawEmpresaId !== "undefined"
      ? rawEmpresaId
      : userEmpresaId && userEmpresaId !== "null" && userEmpresaId !== "undefined"
      ? userEmpresaId
      : null;

  try {
    let query = `
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
    `;

    const params: unknown[] = [];
    let paramIdx = 1;

    if (userRole === "RECLUTADOR") {
      query += ` AND u.rol = 'RECLUTADOR'`;
      if (cleanEmpresaId) {
        query += ` AND u.empresa_id = $${paramIdx}`;
        params.push(cleanEmpresaId);
        paramIdx++;
      }
    } else if (userRole === "ENCARGADO") {
      if (userGrupoId) {
        query += ` AND (
          (u.rol = 'ENCARGADO' AND (u.grupo_id IS NULL OR u.grupo_id != $${paramIdx}))
          OR
          (u.rol = 'RECLUTADOR' AND u.grupo_id = $${paramIdx})
        )`;
        params.push(userGrupoId);
        paramIdx++;
      }
      if (cleanEmpresaId) {
        query += ` AND u.empresa_id = $${paramIdx}`;
        params.push(cleanEmpresaId);
        paramIdx++;
      }
    } else if (userRole !== "ROOT") {
      if (cleanEmpresaId) {
        query += ` AND u.empresa_id = $${paramIdx}`;
        params.push(cleanEmpresaId);
        paramIdx++;
      }
    }

    query += ` ORDER BY g.nombre ASC NULLS LAST, u.rol ASC, nombre_display ASC`;

    const result = await pool.query(query, params);

    if (isGrouped) {
      const groupMap = new Map<string, { [k: string]: unknown; reclutadores: Record<string, unknown>[] }>();

      for (const row of result.rows) {
        const groupKey = row.grupo_id || "sin_grupo";
        const groupName = row.grupo_nombre || "Sin Grupo / General";

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
          // `asignado_a_id` en candidatos/mensajes_bandeja referencia
          // reclutadores.id, no usuarios.id -- se exponía el id de cuenta
          // (u.id) aquí, así que transferir un chat le asignaba un id que
          // ningún reclutador_id de sesión iba a igualar jamás: el chat
          // quedaba huérfano (invisible tanto para el origen como para el
          // destino) y la transferencia parecía "no funcionar".
          id: row.reclutador_id,
          nombre: row.nombre_display,
          usuario: row.usuario,
          rol: row.rol,
          grupo_id: row.grupo_id,
          empresa_id: row.empresa_id
        });
      }

      return NextResponse.json({ grupos: Array.from(groupMap.values()) });
    }

    return NextResponse.json(result.rows.map(row => row.nombre_display));
  } catch (error) {
    console.error('Error fetching reclutadores:', error);
    return NextResponse.json({ error: 'Error al obtener los reclutadores' }, { status: 500 });
  }
}
