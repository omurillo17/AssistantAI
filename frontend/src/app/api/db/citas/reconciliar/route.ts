import { NextResponse } from 'next/server';
import { z } from "zod";

import { pool } from '@/lib/db';
import { getSession } from '@/lib/auth';

const bodySchema = z.object({
  candidato_ids: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * POST /api/db/citas/reconciliar
 *
 * Cuando alguien borra una cita directo en Google Calendar (sin pasar por el
 * CRM ni por el chatbot), la fila de `candidatos` se queda huerfana: sigue en
 * estado CITA_AGENDADA/RECORDATORIO_ENVIADO con un event_id que ya no existe.
 *
 * El frontend (`/calendario`) ya carga en vivo los eventos reales de Google
 * Calendar (rango -2/+3 meses) para dibujar el calendario; con esos mismos
 * datos detecta que candidatos tienen un event_id que ya no aparece ahi y
 * manda aqui la lista de ids para corregir el estado en BD. No se le avisa
 * al candidato por WhatsApp (no sabemos si fue un error o intencional) —
 * solo se notifica al reclutador asignado para que le de seguimiento.
 */
export async function POST(request: Request) {
  const payload = await getSession(request);
  if (!payload) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const { candidato_ids } = parsed.data;
    const rol = (payload.rol as string) || "USER";
    const empresaId = (payload.empresa_id as string | null) ?? null;

    const params: unknown[] = [candidato_ids];
    let empresaClause = "";
    if (rol !== "ROOT" && empresaId) {
      empresaClause = " AND empresa_id = $2";
      params.push(empresaId);
    }

    const res = await pool.query(
      `UPDATE candidatos
       SET estado = 'CITA_CANCELADA', event_id = NULL, fecha_entrevista = NULL, updated_at = NOW()
       WHERE id = ANY($1::uuid[])
         AND estado IN ('CITA_AGENDADA', 'RECORDATORIO_ENVIADO')${empresaClause}
       RETURNING id, telefono, asignado_a_id, vacante_interes,
                 COALESCE(NULLIF(TRIM(nombre_chat),''), NULLIF(TRIM(nombre_solicitud),''), NULLIF(TRIM(nombre),''), telefono) AS nombre`,
      params
    );

    for (const row of res.rows) {
      if (row.asignado_a_id) {
        await pool.query(
          `INSERT INTO notificaciones (reclutador_id, mensaje) VALUES ($1, $2)`,
          [
            row.asignado_a_id,
            `⚠️ La cita de ${row.nombre} (${row.vacante_interes || 'vacante'}) ya no existe en Google Calendar. Se marcó como cancelada automáticamente — verifica con el candidato si sigue interesado.`,
          ]
        );
      }
    }

    return NextResponse.json({ success: true, reconciliados: res.rows.length });
  } catch (err) {
    console.error('Error reconciliando citas huérfanas:', err);
    return NextResponse.json({ error: 'Error al reconciliar citas' }, { status: 500 });
  }
}
