import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

/**
 * GET /api/health
 *
 * Sonda para el healthcheck de Docker (ver docker-compose.yml). Un proceso de
 * Next que arrancó pero perdió Postgres sigue respondiendo 200 en cualquier
 * página; esta ruta toca la base para que `restart: always` pueda reaccionar.
 *
 * Es pública a propósito (está en la lista de src/proxy.ts): el healthcheck
 * corre dentro del contenedor y no tiene cookie de sesión. Por eso la
 * respuesta no expone detalle del error, solo si la base responde.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pool.query("SELECT 1");
    return NextResponse.json({ status: "ok", db: true });
  } catch (error) {
    console.error("[health] Postgres no responde:", error);
    return NextResponse.json({ status: "degraded", db: false }, { status: 503 });
  }
}
