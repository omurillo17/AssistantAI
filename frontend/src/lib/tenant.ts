import { pool } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth";

/**
 * Empresa sobre la que actúa la sesión. ROOT puede pedir otra (`solicitada`,
 * p. ej. el ?empresa_id= de la URL); el resto queda siempre en la de su JWT.
 * Devuelve null cuando un usuario que no es ROOT no tiene empresa: quien llama
 * debe negar el acceso, nunca saltarse el filtro.
 */
export function empresaDeSesion(session: SessionPayload, solicitada?: string | null): string | null {
  if (session.rol === "ROOT") return solicitada || session.empresa_id || null;
  return session.empresa_id || null;
}

/** ¿La sesión puede ver o tocar al candidato con este teléfono? ROOT ve todos. */
export async function candidatoVisible(session: SessionPayload, telefono: string): Promise<boolean> {
  if (session.rol === "ROOT") return true;
  if (!session.empresa_id) return false;
  const res = await pool.query(
    `SELECT 1 FROM candidatos WHERE telefono = $1 AND empresa_id = $2 LIMIT 1`,
    [telefono, session.empresa_id]
  );
  return (res.rowCount ?? 0) > 0;
}
