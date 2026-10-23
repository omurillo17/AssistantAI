import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession, verifyInternalApiKey } from "@/lib/auth";
import { empresaDeSesion } from "@/lib/tenant";

/**
 * GET /api/db/encargados-por-nave?empresa_id=xxx
 *
 * Para cada grupo de reclutamiento que tiene un ENCARGADO asignado,
 * devuelve los datos de contacto de ese encargado junto con los nombres
 * de las naves que cubre su grupo. Usado por n8n (Sofia) para resolver
 * un reclutador de respaldo especifico de la nave del candidato, en vez
 * de un unico fallback global hardcodeado.
 */
export async function GET(request: Request) {
  // Acepta sesión de usuario (CRM) o x-api-key = N8N_API_KEY (n8n).
  const session = await getSession(request);
  const porApiKey = verifyInternalApiKey(request);
  if (!session && !porApiKey) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  // Con llave interna (backend) o ROOT manda ?empresa_id=; con sesión de
  // cualquier otro rol se fuerza la empresa del JWT.
  const empresa_id = porApiKey || session?.rol === "ROOT"
    ? searchParams.get("empresa_id")
    : empresaDeSesion(session!);
  if (!porApiKey && session?.rol !== "ROOT" && !empresa_id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  try {
    const whereClause = empresa_id ? `WHERE g.empresa_id = $1` : "";
    const params = empresa_id ? [empresa_id] : [];

    const res = await pool.query(
      `SELECT
         g.id AS grupo_id,
         g.nombre AS grupo_nombre,
         r.nombre AS encargado_nombre,
         r.telefono AS encargado_telefono,
         r.calendar_id AS encargado_calendar,
         array_agg(DISTINCT n.nombre) AS naves
       FROM grupos_reclutamiento g
       JOIN usuarios u ON u.grupo_id = g.id AND u.rol = 'ENCARGADO'
       JOIN reclutadores r ON r.id = u.reclutador_id AND r.activo = true
       JOIN naves n ON n.empresa_id = g.empresa_id AND g.naves_asignadas ? n.id::text
       ${whereClause}
       GROUP BY g.id, g.nombre, r.nombre, r.telefono, r.calendar_id`,
      params
    );

    return NextResponse.json(res.rows);
  } catch (error) {
    console.error("Error fetching encargados-por-nave:", error);
    return NextResponse.json({ success: false, error: "Error al consultar encargados" }, { status: 500 });
  }
}
