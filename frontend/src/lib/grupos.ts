import { pool } from '@/lib/db';

// Resuelve un grupo_id (grupos_reclutamiento) a la lista de IDs de nave
// que tiene asignados. Se usa para filtrar candidatos/mensajes/vacantes por
// grupo: como esas tablas guardan nave_id (no grupo_id), el filtro por grupo
// se traduce a "nave_id = ANY(naves del grupo)".
// Devuelve null si no se especificó grupo_id, o un array (posiblemente vacío)
// si el grupo existe pero no tiene naves asignadas.
export async function resolveGrupoNaveIds(grupoId: string | null | undefined): Promise<string[] | null> {
  if (!grupoId) return null;
  const res = await pool.query(
    `SELECT naves_asignadas FROM grupos_reclutamiento WHERE id = $1`,
    [grupoId]
  );
  const raw = res.rows[0]?.naves_asignadas;
  return Array.isArray(raw) ? raw.map(String) : [];
}
