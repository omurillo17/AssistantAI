import { NextResponse } from 'next/server';
import { z } from 'zod';

import { pool } from '@/lib/db';
import { enviarMensajeCandidato } from '@/lib/waha';
import { getSession } from '@/lib/auth';

const bodySchema = z.object({
  telefono: z.string().min(1, 'Falta el campo telefono').max(20),
  decision: z.enum(['validar', 'no_validar']),
});

const MENSAJE_NO_VALIDAR = 'Hola, revisamos tus documentos y notamos que la INE y el RFC no coinciden del todo. ¿Podrías enviarnos una foto más clara y completa de ambos documentos, por favor? También puedes escribirnos si prefieres hablar directamente con un reclutador. ¡Gracias! 🙏';

// ─── POST /api/db/candidato/validar-identidad ─────────────
// Resuelve la alerta de discrepancia de CURP (INE vs RFC) que el reclutador
// revisa desde el modal urgente / la campana de notificaciones.
// Body: { telefono, decision: 'validar' | 'no_validar' }
export async function POST(request: Request) {
  try {
    if (!(await getSession(request))) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos', detail: parsed.error.flatten() }, { status: 400 });
    }
    const { telefono, decision } = parsed.data;

    if (decision === 'validar') {
      const upd = await pool.query(
        `UPDATE candidatos SET estado = 'INE_VALIDADA', alerta_identidad_estado = 'VALIDADO' WHERE telefono = $1 RETURNING id, telefono, estado`,
        [telefono]
      );
      if (upd.rowCount === 0) {
        return NextResponse.json({ error: 'Candidato no encontrado' }, { status: 404 });
      }
      return NextResponse.json({ success: true, estado: 'INE_VALIDADA' });
    }

    // no_validar: se queda bloqueado, se le pide al candidato una foto más clara.
    // Si ya tenía una entrevista agendada (posible ahora que las discrepancias
    // menores de CURP ya no bloquean el agendamiento), se cancela también el
    // evento de Google Calendar -- no tiene sentido dejarla en pie mientras se
    // resuelve una identidad que resultó no válida. El cancelado va ANTES del
    // UPDATE final porque /internal/citas/cancelar también escribe su propio
    // estado (CITA_CANCELADA) en candidatos -- si corriera después, pisaría el
    // DOCUMENTOS_NO_COINCIDEN que es el estado correcto para este caso.
    const pre = await pool.query(
      `SELECT event_id, (SELECT calendar_id FROM reclutadores WHERE id = candidatos.asignado_a_id) AS calendar_id
       FROM candidatos WHERE telefono = $1`,
      [telefono]
    );
    if (pre.rowCount === 0) {
      return NextResponse.json({ error: 'Candidato no encontrado' }, { status: 404 });
    }
    const { event_id: eventoId, calendar_id: calendarId } = pre.rows[0];

    let citaCancelada = false;
    if (eventoId && calendarId) {
      try {
        const backendBase = process.env.BACKEND_API_BASE || 'http://backend:8000';
        const apiKey = process.env.PYTHON_SERVICE_API_KEY;
        const resp = await fetch(`${backendBase}/internal/citas/cancelar`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
          },
          body: JSON.stringify({ telefono, event_id: eventoId, calendar_id: calendarId }),
        });
        citaCancelada = resp.ok;
        if (!resp.ok) {
          console.error('validar-identidad: fallo al cancelar cita en backend, status', resp.status);
        }
      } catch (calErr) {
        console.error('Error cancelando la cita de Google Calendar tras "no validar":', calErr);
      }
    }

    const upd = await pool.query(
      `UPDATE candidatos SET estado = 'DOCUMENTOS_NO_COINCIDEN', alerta_identidad_estado = 'RECHAZADO' WHERE telefono = $1 RETURNING id, telefono, estado`,
      [telefono]
    );
    if (upd.rowCount === 0) {
      return NextResponse.json({ error: 'Candidato no encontrado' }, { status: 404 });
    }

    try {
      await enviarMensajeCandidato(telefono, MENSAJE_NO_VALIDAR);
    } catch (msgErr) {
      console.error('Error enviando mensaje de "no validar" al candidato:', msgErr);
    }

    return NextResponse.json({ success: true, estado: 'DOCUMENTOS_NO_COINCIDEN', cita_cancelada: citaCancelada });
  } catch (err) {
    console.error('Error en validar-identidad:', err);
    return NextResponse.json({ error: 'Error interno al validar identidad' }, { status: 500 });
  }
}
