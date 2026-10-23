import { NextResponse } from 'next/server';
import { z } from 'zod';

import { pool, queryComoCrm } from '@/lib/db';
import { enviarMensajeCandidato } from '@/lib/waha';
import { getSession, requireRole } from '@/lib/auth';
import { candidatoVisible } from '@/lib/tenant';

const bodySchema = z.object({
  telefono: z.string().min(1, 'Falta el campo telefono').max(20),
  decision: z.enum(['validar', 'no_validar']),
});

const MENSAJE_NO_VALIDAR = 'Hola, revisamos tus documentos y notamos que la INE y el RFC no coinciden del todo. ¿Podrías enviarnos una foto más clara y completa de ambos documentos, por favor? También puedes escribirnos si prefieres hablar directamente con un reclutador. ¡Gracias! 🙏';

// Estados anteriores a la validación de documentos. Si el candidato ya va más
// adelante (p. ej. CITA_AGENDADA), validar no lo regresa a INE_VALIDADA.
const ESTADOS_ANTES_DE_VALIDAR = ['NUEVO', 'INTERESADO', 'CV_RECIBIDO', 'CV_MANUAL', 'FILTROS_COMPLETADOS', 'DOCUMENTOS_NO_COINCIDEN'];

// `empresa` es null solo para ROOT (sin filtro); el resto queda en su empresa.
async function handleDecisionValidar(telefono: string, usuario: string, empresa: string | null) {
  const upd = await queryComoCrm(
    usuario,
    `UPDATE candidatos
        SET estado = CASE WHEN estado = ANY($2) THEN 'INE_VALIDADA' ELSE estado END,
            alerta_identidad_estado = 'VALIDADO'
      WHERE telefono = $1 AND ($3::uuid IS NULL OR empresa_id = $3)
      RETURNING id, telefono, estado`,
    [telefono, ESTADOS_ANTES_DE_VALIDAR, empresa]
  );
  // Sin mensaje al candidato: no debe enterarse de la revisión
  // (regla del prompt, virgo_data/prompts/chat_prompt.md §6.2).
  if (upd.rowCount === 0) {
    return NextResponse.json({ error: 'Candidato no encontrado' }, { status: 404 });
  }
  return NextResponse.json({ success: true, estado: upd.rows[0].estado });
}

async function cancelarCitaEnBackend(telefono: string, eventoId: string, calendarId: string): Promise<boolean> {
  try {
    const backendBase = process.env.BACKEND_API_BASE || 'http://backend:8000'; // NOSONAR
    const apiKey = process.env.PYTHON_SERVICE_API_KEY;
    const resp = await fetch(`${backendBase}/internal/citas/cancelar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
      },
      body: JSON.stringify({ telefono, event_id: eventoId, calendar_id: calendarId }),
    });
    if (!resp.ok) {
      console.error('validar-identidad: fallo al cancelar cita en backend, status', resp.status);
    }
    return resp.ok;
  } catch (calErr) {
    console.error('Error cancelando la cita de Google Calendar tras "no validar":', calErr);
    return false;
  }
}

async function handleDecisionNoValidar(telefono: string, usuario: string, empresa: string | null) {
  const pre = await pool.query(
    `SELECT event_id, (SELECT calendar_id FROM reclutadores WHERE id = candidatos.asignado_a_id) AS calendar_id
     FROM candidatos WHERE telefono = $1 AND ($2::uuid IS NULL OR empresa_id = $2)`,
    [telefono, empresa]
  );
  if (pre.rowCount === 0) {
    return NextResponse.json({ error: 'Candidato no encontrado' }, { status: 404 });
  }
  const { event_id: eventoId, calendar_id: calendarId } = pre.rows[0];

  let citaCancelada = false;
  if (eventoId && calendarId) {
    citaCancelada = await cancelarCitaEnBackend(telefono, eventoId, calendarId);
  }

  const upd = await queryComoCrm(
    usuario,
    `UPDATE candidatos SET estado = 'DOCUMENTOS_NO_COINCIDEN', alerta_identidad_estado = 'RECHAZADO' WHERE telefono = $1 AND ($2::uuid IS NULL OR empresa_id = $2) RETURNING id, telefono, estado`,
    [telefono, empresa]
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
}

// ─── POST /api/db/candidato/validar-identidad ─────────────
// Resuelve la alerta de discrepancia de CURP (INE vs RFC) que el reclutador
// revisa desde el modal urgente / la campana de notificaciones.
// Body: { telefono, decision: 'validar' | 'no_validar' }
export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!requireRole(session, 'ADMIN', 'ROOT', 'ENCARGADO', 'RECLUTADOR')) {
      return NextResponse.json({ error: 'Permisos insuficientes' }, { status: 403 });
    }
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos', detail: z.flattenError(parsed.error) }, { status: 400 });
    }
    const { telefono, decision } = parsed.data;

    // Mismo 404 que un teléfono inexistente: no revela candidatos de otra empresa.
    if (!(await candidatoVisible(session, telefono))) {
      return NextResponse.json({ error: 'Candidato no encontrado' }, { status: 404 });
    }
    const empresa = session.rol === 'ROOT' ? null : (session.empresa_id ?? null);

    if (decision === 'validar') {
      return await handleDecisionValidar(telefono, String(session.usuario ?? ''), empresa);
    }
    return await handleDecisionNoValidar(telefono, String(session.usuario ?? ''), empresa);
  } catch (err) {
    console.error('Error en validar-identidad:', err);
    return NextResponse.json({ error: 'Error interno al validar identidad' }, { status: 500 });
  }
}
