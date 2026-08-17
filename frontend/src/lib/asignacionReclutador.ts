import { pool } from '@/lib/db';

/**
 * Asigna un candidato al reclutador dueño de la vacante elegida (por vacante + nave),
 * o al Gerente de Reclutamiento si nadie calza exacto. Es idempotente y segura de
 * llamar en cada webhook que pueda ser el primero en conocer la vacante real del
 * candidato (n8n-incoming y webhook/expediente pueden llegar en cualquier orden según
 * si el candidato sube documentos antes o después de que la IA etiquete la vacante),
 * porque el UPDATE solo toca la fila si `asignado_a_id` sigue en NULL.
 */
export async function asignarReclutadorPorVacante(
  candidatoId: string,
  vacante: string | null | undefined,
  nave: string | null | undefined,
  empresaId: string | null
): Promise<void> {
  const vacanteEntrante = (vacante || '').trim();
  if (!vacanteEntrante || vacanteEntrante === 'General') return;

  try {
    const equipoRes = await pool.query(
      `SELECT r.id AS reclutador_id, r.nombre AS reclutador_nombre, v.nombre AS vacante_nombre, v.naves
       FROM reclutadores r
       JOIN vacantes_def v ON v.reclutador_id = r.id AND v.activa = true
       WHERE r.activo = true AND ($1::uuid IS NULL OR r.empresa_id = $1)`,
      [empresaId]
    );

    const cleanStr = (s: string) => s ? s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim() : '';
    const vacanteClean = cleanStr(vacanteEntrante);
    const naveClean = nave ? String(nave).trim() : null;

    const matches = equipoRes.rows.filter((row) => {
      if (cleanStr(row.vacante_nombre) !== vacanteClean) return false;
      if (!naveClean) return true;
      let navesArr: string[] = [];
      try { navesArr = typeof row.naves === 'string' ? JSON.parse(row.naves) : (row.naves || []); } catch { navesArr = []; }
      return navesArr.length === 0 || navesArr.includes(naveClean);
    });

    let reclutadorAsignado: { reclutador_id: string; reclutador_nombre: string } | null = null;
    if (matches.length === 1) {
      reclutadorAsignado = matches[0];
    } else if (matches.length === 0) {
      const gerenteRes = await pool.query(
        `SELECT id AS reclutador_id, nombre AS reclutador_nombre FROM reclutadores WHERE nombre = 'Gerente de Reclutamiento' AND activo = true LIMIT 1`
      );
      if (gerenteRes.rowCount) reclutadorAsignado = gerenteRes.rows[0];
    }
    // Si hay varios reclutadores para la misma vacante/nave, no forzamos una asignación
    // individual aquí — el sistema de turnos que ya existe en el agendado de entrevista se encarga.

    if (reclutadorAsignado) {
      await pool.query(
        `UPDATE candidatos SET asignado_a_id = $1 WHERE id = $2 AND asignado_a_id IS NULL`,
        [reclutadorAsignado.reclutador_id, candidatoId]
      );
    }
  } catch (err) {
    console.error('Error asignando candidato al reclutador de la vacante:', err);
  }
}
