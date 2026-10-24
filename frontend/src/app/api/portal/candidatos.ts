import { pool } from '@/lib/db';

/**
 * Candidatos del portal por SUFIJO exacto de 10 dígitos (nunca por subcadena)
 * y, si viene, por empresa. Lo comparten codigo/buscar/subir para que el
 * candidato al que se le mandó el código sea el mismo al que se le suben los
 * archivos. Si el teléfono existe en más de una empresa devuelve null: sin
 * empresa_id no hay forma segura de saber de quién es el expediente.
 */
export async function buscarCandidatoPortal(telefono: string, empresaId: string | null) {
  const res = await pool.query(
    `SELECT id, empresa_id, telefono, nombre, nombre_chat, nombre_solicitud, asignado_a_id,
            vacante_interes, nave_interes, alerta_identidad_motivo,
            tiene_cv, link_cv, cv_manual, datos_ine, datos_rfc
     FROM candidatos
     WHERE RIGHT(regexp_replace(telefono, '\\D', '', 'g'), 10) = $1
       AND ($2::uuid IS NULL OR empresa_id = $2::uuid)
     ORDER BY updated_at DESC`,
    [telefono, empresaId]
  );
  if (res.rowCount === 0) return null;
  if (new Set(res.rows.map((r) => r.empresa_id)).size > 1) return null;
  return res.rows[0];
}
