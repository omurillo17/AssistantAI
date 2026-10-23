import { pool } from '@/lib/db';

export interface EmpresaResuelta {
  empresa_id: string | null;
  grupo_id: string | null;
  naves_asignadas: string[] | null;
}

/**
 * Resuelve empresa_id/grupo_id a partir del número de WhatsApp que recibió el mensaje
 * (telefono_destino), usando grupos_reclutamiento como fuente de verdad — cada grupo
 * es dueño de su propia línea/sesión de WhatsApp.
 *
 * Mientras n8n todavía no manda telefono_destino (o no matchea ningún grupo), se
 * conserva el comportamiento de una sola empresa para no romper el día uno. Si hay
 * 2+ empresas y no hay forma de saber a cuál pertenece el mensaje, NO se adivina:
 * se deja constancia en system_logs para que la ambigüedad sea visible en vez de
 * mezclar datos de tenants distintos.
 */
export async function resolveEmpresaYGrupo(
  telefonoDestino: string | null | undefined,
  sourceLabel: string
): Promise<EmpresaResuelta> {
  const normalizado = telefonoDestino
    ? telefonoDestino.replace('@c.us', '').replace(/\D/g, '')
    : null;

  if (normalizado) {
    const grupoRes = await pool.query(
      `SELECT empresa_id, id AS grupo_id, naves_asignadas
       FROM grupos_reclutamiento
       WHERE telefono_whatsapp = $1 OR whatsapp_phone_number_id = $1
       -- Determinista si dos grupos comparten número: gana el más antiguo.
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [normalizado]
    );
    if (grupoRes.rowCount && grupoRes.rowCount > 0) {
      const row = grupoRes.rows[0];
      return { empresa_id: row.empresa_id, grupo_id: row.grupo_id, naves_asignadas: row.naves_asignadas };
    }
  }

  const empresasRes = await pool.query(`SELECT id FROM empresas ORDER BY created_at ASC LIMIT 2`);

  if (empresasRes.rowCount === 1) {
    return { empresa_id: empresasRes.rows[0].id, grupo_id: null, naves_asignadas: null };
  }

  if (empresasRes.rowCount && empresasRes.rowCount > 1) {
    try {
      await pool.query(
        `INSERT INTO system_logs (severity, node_name, error_message, error_details)
         VALUES ('high', $1, $2, $3)`,
        [
          sourceLabel,
          'No se pudo resolver empresa_id de forma inequívoca: hay múltiples empresas y telefono_destino no llegó o no matchea ningún grupo_reclutamiento',
          JSON.stringify({ telefono_destino: telefonoDestino ?? null }),
        ]
      );
    } catch (logErr) {
      console.error('Error registrando ambigüedad de empresa_id en system_logs:', logErr);
    }
    return { empresa_id: null, grupo_id: null, naves_asignadas: null };
  }

  return { empresa_id: null, grupo_id: null, naves_asignadas: null };
}
