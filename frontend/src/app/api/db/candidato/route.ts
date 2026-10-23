import { NextResponse } from 'next/server';
import { z } from "zod";

import { pool, queryComoCrm } from '@/lib/db';

const getQuerySchema = z.object({
  telefono: z.string().min(1, "Falta el parámetro telefono").max(20),
});

const patchBodySchema = z.object({
  telefono: z.string().min(1, "Falta el campo telefono").max(20),
  estado: z.string().max(50).optional(),
  notas: z.string().optional(),
  vacante_interes: z.string().max(100).optional(),
  escalado: z.boolean().nullable().optional(),
  escalation_reason: z.string().nullable().optional(),
  event_id: z.string().nullable().optional(),
  asignado_a_id: z.string().max(100).nullable().optional(),
  empresa_id: z.uuid().optional(),
});

import { enviarNotificacionReclutador } from '@/lib/messagingService';
import { getSession } from '@/lib/auth';

// ─── GET /api/db/candidato?telefono=xxx ───────────────────
export async function GET(request: Request) {

  const { searchParams } = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    telefono: searchParams.get('telefono'),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { telefono } = parsed.data;

  const payload = await getSession(request);
  if (!payload) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // Sin empresa en el JWT (y sin ser ROOT) se niega: nunca se salta el filtro.
  if (payload.rol !== 'ROOT' && !payload.empresa_id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }
  const rol = (payload.rol as string) || "USER";
  const reclutador_id = (payload.reclutador_id as string | null) ?? null;
  const jwt_empresa_id = (payload.empresa_id as string | null) ?? null;

  let filter_empresa_id = searchParams.get('empresa_id');
  const filter_nave_id = searchParams.get('nave_id');
  if (rol !== "ROOT") {
    filter_empresa_id = jwt_empresa_id;
  }

  try {
    let filterClause = "telefono LIKE $1";
    const queryParams: unknown[] = [`%${telefono}%`];
    let idx = 2;

    if (filter_empresa_id) {
      filterClause += ` AND empresa_id = $${idx}`;
      queryParams.push(filter_empresa_id);
      idx++;
    }

    if (filter_nave_id) {
      filterClause += ` AND nave_id = $${idx}`;
      queryParams.push(filter_nave_id);
      idx++;
    }

    if (rol === "RECLUTADOR" && reclutador_id) {
      filterClause += `
        AND vacante_interes IN (
          SELECT nombre FROM vacantes_def WHERE reclutador_id = $${idx}
        )
      `;
      queryParams.push(reclutador_id);
      idx++;
    }

    const res = await pool.query(
      `SELECT * FROM candidatos WHERE ${filterClause} ORDER BY ultima_interaccion DESC LIMIT 1`,
      queryParams
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Candidato no encontrado' }, { status: 404 });
    }

    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error('Error fetching candidate:', err);
    return NextResponse.json({ error: 'Error al conectar con la base de datos' }, { status: 500 });
  }
}

function buildCandidatoUpdateFields(data: z.infer<typeof patchBodySchema>) {
  const { estado, notas, vacante_interes, escalado, escalation_reason, event_id, asignado_a_id, empresa_id } = data;
  const campos: string[] = ['updated_at = NOW()'];
  const valores: (string | boolean | null)[] = [];
  let idx = 1;

  if (estado !== undefined) {
    campos.push(`estado = $${idx++}`);
    valores.push(estado);
  }
  // `notas` es un alias viejo de escalation_reason; si llegan ambos gana
  // escalation_reason (asignar dos veces la columna hace fallar el UPDATE).
  if (notas !== undefined && escalation_reason === undefined) {
    campos.push(`escalation_reason = $${idx++}`);
    valores.push(notas);
  }
  if (escalation_reason !== undefined) {
    campos.push(`escalation_reason = $${idx++}`);
    valores.push(escalation_reason);
  }
  if (vacante_interes !== undefined) {
    campos.push(`vacante_interes = $${idx++}`);
    valores.push(vacante_interes);
  }
  if (event_id !== undefined) {
    campos.push(`event_id = $${idx++}`);
    valores.push(event_id);
  }
  if (asignado_a_id !== undefined) {
    campos.push(`asignado_a_id = $${idx++}`);
    valores.push(asignado_a_id);
  }
  if (empresa_id !== undefined) {
    campos.push(`empresa_id = $${idx++}`);
    valores.push(empresa_id);
  }
  if (escalado !== undefined) {
    campos.push(`escalado = $${idx++}`);
    valores.push(escalado);
    if (escalado === true) {
      campos.push(`escalated_at = NOW()`);
    } else {
      campos.push(`escalated_at = NULL`);
      if (!estado || estado === "ESCALADO") {
        campos.push(`estado = 'INTERESADO'`);
      }
    }
  }

  return { campos, valores, nextIdx: idx };
}

async function notificarReclutadorTransferencia(asignado_a_id: string, telefono: string) {
  try {
    const recRes = await pool.query('SELECT telefono FROM reclutadores WHERE id = $1 AND activo = true LIMIT 1', [asignado_a_id]);
    if (recRes.rows.length > 0) {
      const recTelefono = recRes.rows[0].telefono;
      const msg = `🔔 *Atención*: Se te ha transferido un nuevo candidato.\n\n👤 *Teléfono:* ${telefono}\nPor favor revisa la plataforma para atenderlo.`;
      await enviarNotificacionReclutador(recTelefono, msg, asignado_a_id);
      console.log(`Notificación enviada al reclutador ${asignado_a_id} (${recTelefono})`);
    }
  } catch (notifyErr) {
    console.error('Error al notificar al reclutador:', notifyErr);
  }
}

// ─── PATCH /api/db/candidato ─────────────────────────────
// Body: { telefono, estado?, notas?, vacante_interes?, escalado?, escalation_reason? }
export async function PATCH(request: Request) {
  try {
    const payload = await getSession(request);
    if (!payload) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const rol = (payload.rol as string) || "USER";
    const jwt_empresa_id = (payload.empresa_id as string | null) ?? null;

    const { searchParams } = new URL(request.url);
    // Igual que en GET: solo ROOT elige empresa; el resto queda en la suya.
    const target_empresa = rol === "ROOT" ? (searchParams.get('empresa_id') || jwt_empresa_id) : jwt_empresa_id;
    if (!target_empresa && rol !== "ROOT") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const target_nave = searchParams.get('nave_id');
    const body = await request.json();
    const parsed = patchBodySchema.safeParse(body);

    if (!parsed.success) {
      console.error("Zod validation error:", parsed.error.issues);
      // Los issues de Zod solo van al log: no se exponen al cliente.
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    // Mover un candidato de empresa es cosa de ROOT.
    if (parsed.data.empresa_id !== undefined && rol !== "ROOT" && parsed.data.empresa_id !== jwt_empresa_id) {
      return NextResponse.json({ error: "No autorizado para cambiar la empresa" }, { status: 403 });
    }
    // Solo se puede asignar a un reclutador de la empresa del candidato.
    if (parsed.data.asignado_a_id && target_empresa) {
      const rec = await pool.query(
        `SELECT 1 FROM reclutadores WHERE id = $1 AND empresa_id = $2`,
        [parsed.data.asignado_a_id, parsed.data.empresa_id ?? target_empresa]
      );
      if (rec.rowCount === 0) {
        return NextResponse.json({ error: "Reclutador fuera de la empresa" }, { status: 403 });
      }
    }

    const { campos, valores, nextIdx } = buildCandidatoUpdateFields(parsed.data);

    if (campos.length === 1) {
      return NextResponse.json({ error: 'No hay campos para actualizar' }, { status: 400 });
    }

    let idx = nextIdx;
    const telefonoIdx = idx++;
    valores.push(parsed.data.telefono);
    let filtroExtra = "";
    if (target_empresa) {
      filtroExtra += ` AND empresa_id = $${idx++}`;
      valores.push(target_empresa);
    }
    if (target_nave) {
      filtroExtra += ` AND nave_id = $${idx++}`;
      valores.push(target_nave);
    }
    const res = await queryComoCrm(
      String(payload.usuario ?? ''),
      `UPDATE candidatos SET ${campos.join(', ')} WHERE telefono = $${telefonoIdx}${filtroExtra} RETURNING id, telefono, estado, escalado, escalated_at, updated_at`,
      valores
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Candidato no encontrado' }, { status: 404 });
    }

    if (parsed.data.asignado_a_id && parsed.data.escalado === true) {
      await notificarReclutadorTransferencia(parsed.data.asignado_a_id, parsed.data.telefono);
    }

    return NextResponse.json(res.rows[0]);
  } catch (err) {
    // check_violation: el trigger candidatos_estado_guard rechazó el estado.
    if ((err as { code?: string }).code === '23514') {
      return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
    }
    console.error('Error updating candidate:', err);
    return NextResponse.json({ error: 'Error al actualizar el candidato' }, { status: 500 });
  }
}

