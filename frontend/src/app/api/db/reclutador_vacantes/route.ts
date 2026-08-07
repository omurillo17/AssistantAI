import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession, verifyInternalApiKey } from "@/lib/auth";

/**
 * GET /api/db/reclutador_vacantes?empresa_id=xxx
 *
 * Retorna la lista de reclutadores activos con sus vacantes en el mismo
 * formato que el antiguo reclutador_vacantes.json, ahora desde PostgreSQL.
 * Usado por n8n para identificar a qué reclutador pertenece un teléfono
 * y para calcular turnos de asignación de candidatos.
 * Acepta sesión de usuario (CRM) o x-api-key = N8N_API_KEY (n8n).
 */
export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session && !verifyInternalApiKey(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get("empresa_id");

  try {
    const whereClause = empresa_id
      ? `WHERE r.activo = true AND r.empresa_id = $1`
      : `WHERE r.activo = true`;
    const params = empresa_id ? [empresa_id] : [];

    const res = await pool.query(
      `SELECT
         r.id AS reclutador_id,
         r.nombre,
         r.telefono,
         r.calendar_id,
         r.color,
         u.usuario,
         u.rol AS usuario_rol,
         v.id AS vacante_id,
         v.nombre AS vacante_nombre,
         v.naves AS vacante_naves,
         v.detalles,
         v.palabras_clave,
         v.filtros,
         v.orden
       FROM reclutadores r
       LEFT JOIN usuarios u ON r.id = u.reclutador_id
       LEFT JOIN vacantes_def v ON r.id = v.reclutador_id AND v.activa = true
       ${whereClause}
       ORDER BY r.created_at ASC, v.orden ASC`,
      params
    );

    // Fetch all naves to resolve UUIDs to names for n8n matching
    const navesRes = await pool.query(`SELECT id, nombre FROM naves`);
    const naveMap = new Map<string, string>();
    for (const r of navesRes.rows) {
      naveMap.set(r.id, r.nombre);
    }

    const recMap = new Map<string, { reclutador_id: string; nombre: string; activo: boolean; telefono: string; calendar_id: string; color: string; usuario: string; es_encargado: boolean; vacantes: Record<string, unknown>[] }>();
    for (const row of res.rows) {
      if (!recMap.has(row.reclutador_id)) {
        recMap.set(row.reclutador_id, {
          reclutador_id: row.reclutador_id,
          nombre: row.nombre,
          activo: true,
          telefono: row.telefono || "",
          calendar_id: row.calendar_id || "",
          color: row.color || "#6366f1",
          usuario: row.usuario || "",
          // Jefe de grupo real (ver frontend/src/app/api/db/usuarios/route.ts) --
          // usado por definir_agenda (backend) para elegir un fallback
          // determinista en vez de "el ultimo reclutador creado".
          es_encargado: row.usuario_rol === "ENCARGADO",
          vacantes: [],
        });
      }
      if (row.vacante_id) {
        let navesArr: string[] = [];
        if (typeof row.vacante_naves === "string") {
          try { navesArr = JSON.parse(row.vacante_naves); } catch { navesArr = []; }
        } else {
          navesArr = row.vacante_naves || [];
        }
        const expandedNaves = Array.from(
          new Set([
            ...navesArr,
            ...navesArr.map((id) => naveMap.get(id)).filter((n): n is string => Boolean(n)),
          ])
        );
        recMap.get(row.reclutador_id)!.vacantes.push({
          id: row.vacante_id,
          nombre: row.vacante_nombre,
          naves: expandedNaves,
          detalles: row.detalles || "",
          palabras_clave: row.palabras_clave || "",
          filtros: row.filtros || [],
        });
      }
    }

    return NextResponse.json(Array.from(recMap.values()));
  } catch (error) {
    console.error("Error fetching reclutador_vacantes from DB:", error);
    return NextResponse.json({ success: false, error: "Error al consultar reclutadores" }, { status: 500 });
  }
}
