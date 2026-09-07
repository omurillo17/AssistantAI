import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { candidatoMachine, ESTADOS_VALIDOS } from '@/lib/stateMachine';
import { createActor } from 'xstate';
import { verifyInternalApiKey } from '@/lib/auth';
import { resolveEmpresaYGrupo } from '@/lib/empresaResolution';
import { asignarReclutadorPorVacante } from '@/lib/asignacionReclutador';
import { esPlaceholderVacante, limpiarVacante } from '@/lib/vacantes';
import type { CandidatoEvent } from "@/lib/stateMachine";

/**
 * Estas banderas llegaban de n8n como el STRING 'true' (todo en n8n viaja como
 * texto), pero el backend de Python las manda como booleanos JSON reales. Las
 * comparaciones `=== 'true'` que quedaron del puerto original nunca se cumplen
 * con `true`, así que en producción `privacidad` y `cita_cancelada` se perdían
 * en silencio: la cita se borraba de Google Calendar pero el expediente nunca
 * pasaba a cancelado. Se acepta cualquiera de las dos formas.
 */
const esVerdadero = (v: unknown): boolean => v === true || v === 'true';

function determineCandidatoEvent({
  privacidad,
  currentState,
  es_cv,
  cv_manual,
  cita_creada,
  fecha_entrevista,
  cita_cancelada,
  resumen,
}: {
  privacidad: unknown;
  currentState: string;
  es_cv: unknown;
  cv_manual: unknown;
  cita_creada: unknown;
  fecha_entrevista?: string;
  cita_cancelada: unknown;
  resumen?: string;
}): CandidatoEvent {
  let event: CandidatoEvent = { type: 'INTERES' };

  if (esVerdadero(privacidad) && currentState === 'NUEVO') {
    event = { type: 'INTERES' };
  }
  if (esVerdadero(es_cv) || cv_manual) {
    event = { type: 'RECIBE_CV' };
  }
  if (esVerdadero(cita_creada) || fecha_entrevista) {
    event = { type: 'AGENDA_CITA', fecha: fecha_entrevista || 'Por confirmar' };
  }
  if (esVerdadero(cita_cancelada)) {
    event = { type: 'CANCELA_CITA' };
  }
  if (resumen && (resumen as string).includes('solicitó apoyo')) {
    event = { type: 'ESCALA_HUMANO' };
  }
  return event;
}

function extractNombreFromResumen(resumen: unknown): string {
  if (typeof resumen !== 'string') return '';
  const nameMatch = /Nombre:\s*([^.\n|]+)/i.exec(resumen);
  if (!nameMatch?.[1]) return '';
  const extracted = nameMatch[1].trim();
  const invalid = ['Candidato', 'Desconocido', 'No registrado', 'Pendiente'];
  if (!extracted || invalid.includes(extracted) || /^\+?\d+$/.test(extracted)) {
    return '';
  }
  return extracted;
}

function extractNombreFromWpp(nombre_wpp?: string): string {
  const trimmed = nombre_wpp?.trim();
  if (!trimmed || trimmed === 'Candidato' || /^[^\w\s]+$/.test(trimmed)) {
    return '';
  }
  return trimmed;
}

function extractCandidatoNombre(nombre: string | undefined, resumen: unknown, nombre_wpp: string | undefined, telefono: string): string {
  let finalNombre = (nombre && nombre !== 'Candidato') ? nombre.trim() : '';

  if (!finalNombre || finalNombre === 'Candidato') {
    finalNombre = extractNombreFromResumen(resumen);
  }

  if (!finalNombre || finalNombre === 'Candidato') {
    finalNombre = extractNombreFromWpp(nombre_wpp);
  }

  if (!finalNombre || finalNombre === telefono || /^\+?\d+$/.test(finalNombre)) {
    return 'Candidato';
  }
  return finalNombre;
}

function extractLugarResidencia(lugar_residencia: unknown, resumen: unknown): string {
  let finalLugarResidencia = (lugar_residencia && typeof lugar_residencia === 'string') ? lugar_residencia.trim() : '';
  if (!finalLugarResidencia && resumen && typeof resumen === 'string') {
    const resMatch = /(?:Lugar de )?residencia:\s*([^.\n|]+)/i.exec(resumen);
    if (resMatch?.[1]) {
      const extRes = resMatch[1].trim();
      const noUsables = ['pendiente', 'desconocido', 'none', 'null', 'x', 'n/a'];
      if (extRes && !noUsables.includes(extRes.toLowerCase())) {
        finalLugarResidencia = extRes;
      }
    }
  }
  return finalLugarResidencia;
}

function extractIncomingVacante(vacante: string | undefined, resumen: unknown): string {
  let finalVacante = esPlaceholderVacante(vacante) ? '' : limpiarVacante(vacante);
  if (!finalVacante && resumen && typeof resumen === 'string') {
    const vacMatch = /Vacante:\s*([^.\n|]+)/i.exec(resumen);
    if (vacMatch?.[1] && !esPlaceholderVacante(vacMatch[1])) {
      finalVacante = limpiarVacante(vacMatch[1]);
    }
  }
  return finalVacante;
}

function parseFiltrosVeredicto(filtros: unknown): { veredicto: string | null; motivo_analisis: string | null } {
  let veredicto: string | null = null;
  let motivo_analisis: string | null = null;
  if (typeof filtros === 'string') {
    try {
      const parsed = JSON.parse(filtros);
      if (parsed && typeof parsed === 'object') {
        if (parsed.viable === true) veredicto = 'VIABLE';
        else if (parsed.viable === false) veredicto = 'NO VIABLE';
        if (parsed.motivo) motivo_analisis = parsed.motivo;
      }
    } catch {
      // Ignorar si no es JSON válido
    }
  }
  return { veredicto, motivo_analisis };
}

async function fetchCandidatoCurrentContext(telefono: string) {
  const res = await pool.query('SELECT id, estado, tiene_cv, cv_manual as db_cv_manual, fecha_entrevista as db_fecha, privacidad_aceptada, escalado, vacante_interes, asignado_a_id FROM candidatos WHERE telefono = $1 ORDER BY updated_at DESC LIMIT 1', [telefono]);
  let currentState = 'NUEVO';
  let context = {
    telefono,
    tiene_cv: false,
    cv_manual: false,
    fecha_entrevista: null,
    privacidad_aceptada: false,
    escalado: false,
  };

  const resRechazados = await pool.query(`SELECT nave_interes FROM candidatos WHERE telefono = $1 AND estado IN ('RECHAZADO', 'OTRA_CIUDAD') LIMIT 1`, [telefono]);
  const fueRechazadoGlobalmente = resRechazados.rowCount ? (resRechazados.rowCount > 0) : false;
  const naveRechazo = fueRechazadoGlobalmente ? resRechazados.rows[0].nave_interes : null;

  if (res.rowCount && res.rowCount > 0) {
    currentState = res.rows[0].estado;
    if (!ESTADOS_VALIDOS.has(currentState)) {
      console.warn(`[n8n-incoming] estado desconocido '${currentState}' para ${telefono}; se usa NUEVO`);
      currentState = 'NUEVO';
    }
    context = {
      telefono,
      tiene_cv: res.rows[0].tiene_cv || false,
      cv_manual: !!res.rows[0].db_cv_manual,
      fecha_entrevista: res.rows[0].db_fecha || null,
      privacidad_aceptada: res.rows[0].privacidad_aceptada || false,
      escalado: res.rows[0].escalado || false,
    };
  }

  return { currentState, context, fueRechazadoGlobalmente, naveRechazo };
}

async function actualizarBandejaCompartida(candidatoId: string, telefono: string, mensaje_ia?: string, mensaje_candidato?: string) {
  const ultimoMensajeTexto = mensaje_ia || mensaje_candidato;
  const ultimoMensajeRol = mensaje_ia ? 'assistant' : 'user';
  await pool.query(`
    INSERT INTO mensajes_bandeja (candidato_id, telefono, ultimo_mensaje, ultimo_mensaje_rol, mensajes_no_leidos, activo, ultimo_mensaje_at)
    VALUES ($1, $2, $3, $4, 1, true, NOW())
    ON CONFLICT (candidato_id) DO UPDATE SET
      ultimo_mensaje = EXCLUDED.ultimo_mensaje,
      ultimo_mensaje_rol = EXCLUDED.ultimo_mensaje_rol,
      ultimo_mensaje_at = NOW(),
      mensajes_no_leidos = mensajes_bandeja.mensajes_no_leidos + 1,
      activo = true
  `, [candidatoId, telefono, ultimoMensajeTexto, ultimoMensajeRol]);
}

export async function POST(request: Request) {
  if (!verifyInternalApiKey(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const data = await request.json();
    const {
      telefono,
      telefono_destino,
      nombre,
      cita_creada,
      vacante,
      resumen,
      cita_cancelada,
      filtros,
      experiencia_actividades,
      cv_manual,
      fecha_entrevista,
      privacidad,
      nombre_wpp,
      nave,
      es_cv,
      mensaje_ia,
      mensaje_candidato,
      lugar_residencia,
      nombre_confirmado,
    } = data;

    if (!telefono) {
      return NextResponse.json({ error: 'Falta telefono' }, { status: 400 });
    }

    // 1. Obtener estado actual
    const { currentState, context, fueRechazadoGlobalmente, naveRechazo } = await fetchCandidatoCurrentContext(telefono);

    if (currentState === "RECHAZADO" || currentState === "OTRA_CIUDAD" || fueRechazadoGlobalmente) {
      console.log(`[n8n-incoming] Candidato ${telefono} está ${currentState}. Se omite procesamiento para ahorrar tokens.`);
      return NextResponse.json({ success: true, ignored: true, reason: `Candidato en ${currentState}` });
    }

    // 2. Determinar el evento basado en la información entrante
    const event = determineCandidatoEvent({
      privacidad,
      currentState,
      es_cv,
      cv_manual,
      cita_creada,
      fecha_entrevista,
      cita_cancelada,
      resumen,
    });

    // 3. Evaluar Máquina de Estados
    const actor = createActor(candidatoMachine, {
      snapshot: candidatoMachine.resolveState({ value: currentState, context }),
    });
    actor.start();
    actor.send(event);
    const newState = actor.getSnapshot();

    // 4. Upsert Candidato
    let parsedCvManual = cv_manual;
    if (typeof cv_manual === 'string') {
      try { parsedCvManual = JSON.parse(cv_manual); } catch { parsedCvManual = null; }
    }

    const finalNombre = extractCandidatoNombre(nombre, resumen, nombre_wpp, telefono);
    const finalLugarResidencia = extractLugarResidencia(lugar_residencia, resumen);
    const esNombreConfirmado = esVerdadero(nombre_confirmado) || (finalNombre !== '' && finalNombre !== 'Candidato');
    const finalVacante = extractIncomingVacante(vacante, resumen);
    const { veredicto, motivo_analisis } = parseFiltrosVeredicto(filtros);

    // Determinar si escalar por rechazo previo
    let esEscalado = newState.value === 'ESCALADO';
    let motivoEscalamiento = null;
    if (fueRechazadoGlobalmente && currentState === 'NUEVO') {
      esEscalado = true;
      motivoEscalamiento = `ALERTA GLOBAL: Este candidato fue RECHAZADO previamente en la nave: ${naveRechazo || 'Desconocida'}.`;
    }

    // Resolver empresa_id real a partir del número que recibió el mensaje (telefono_destino),
    // vía grupos_reclutamiento. Fallback de una sola empresa mientras n8n no lo mande.
    const { empresa_id: empresaId } = await resolveEmpresaYGrupo(telefono_destino, 'n8n-incoming');

    const upsertQuery = String.raw`
      INSERT INTO candidatos (
        telefono, nombre, estado, ultima_interaccion, vacante_interes,
        resumen_ia, filtros_tecnicos, cv_manual, fecha_entrevista, privacidad_aceptada,
        nombre_chat, nombre_solicitud, edad, correo, experiencia, nave_interes, mensajes_bot_enviados,
        veredicto, motivo_analisis, empresa_id, escalado, escalation_reason,
        experiencia_actividades, lugar_residencia, nombre_confirmado
      )
      VALUES (
        $1, $9, $2, NOW(), $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, 1,
        $15, $16, $17, $18, $19,
        NULLIF($20, ''),
        NULLIF($21, ''),
        $22
      )
      ON CONFLICT (telefono, empresa_id) DO UPDATE SET
        nombre = CASE
          WHEN EXCLUDED.nombre IS NOT NULL AND EXCLUDED.nombre != 'Candidato' AND EXCLUDED.nombre != '' AND EXCLUDED.nombre !~ '^[^\w\s]+$' THEN EXCLUDED.nombre
          WHEN candidatos.nombre IS NULL OR candidatos.nombre = '' OR candidatos.nombre = 'Candidato' OR candidatos.nombre ~ '^[^\w\s]+$' THEN EXCLUDED.nombre
          ELSE candidatos.nombre
        END,
        nombre_chat = CASE
          WHEN EXCLUDED.nombre_chat IS NOT NULL AND EXCLUDED.nombre_chat != 'Candidato' AND EXCLUDED.nombre_chat != '' AND EXCLUDED.nombre_chat !~ '^[^\w\s]+$' THEN EXCLUDED.nombre_chat
          WHEN candidatos.nombre_chat IS NULL OR candidatos.nombre_chat = '' OR candidatos.nombre_chat = 'Candidato' OR candidatos.nombre_chat ~ '^[^\w\s]+$' THEN EXCLUDED.nombre_chat
          ELSE candidatos.nombre_chat
        END,
        nombre_confirmado = EXCLUDED.nombre_confirmado OR candidatos.nombre_confirmado,
        lugar_residencia = COALESCE(NULLIF(TRIM(EXCLUDED.lugar_residencia), ''), NULLIF(TRIM(candidatos.lugar_residencia), '')),
        estado = EXCLUDED.estado,
        ultima_interaccion = NOW(),
        mensajes_bot_enviados = candidatos.mensajes_bot_enviados + 1,
        vacante_interes = COALESCE(NULLIF(TRIM(EXCLUDED.vacante_interes), ''), NULLIF(TRIM(candidatos.vacante_interes), '')),
        resumen_ia = COALESCE(NULLIF(EXCLUDED.resumen_ia, ''), candidatos.resumen_ia),
        filtros_tecnicos = COALESCE(NULLIF(EXCLUDED.filtros_tecnicos, ''), candidatos.filtros_tecnicos),
        -- Solo se pregunta una vez, al mostrar las actividades: si el turno no
        -- la trae, se conserva la respuesta anterior.
        experiencia_actividades = COALESCE(NULLIF($20, ''), candidatos.experiencia_actividades),
        cv_manual = CASE WHEN EXCLUDED.cv_manual IS NOT NULL THEN EXCLUDED.cv_manual ELSE candidatos.cv_manual END,
        fecha_entrevista = COALESCE(NULLIF(EXCLUDED.fecha_entrevista, ''), candidatos.fecha_entrevista),
        privacidad_aceptada = EXCLUDED.privacidad_aceptada OR candidatos.privacidad_aceptada,
        nombre_solicitud = CASE WHEN EXCLUDED.cv_manual IS NOT NULL AND (EXCLUDED.cv_manual->>'nombre') IS NOT NULL THEN (EXCLUDED.cv_manual->>'nombre') ELSE candidatos.nombre_solicitud END,
        edad = CASE WHEN EXCLUDED.cv_manual IS NOT NULL AND (EXCLUDED.cv_manual->>'edad') IS NOT NULL THEN (EXCLUDED.cv_manual->>'edad') ELSE candidatos.edad END,
        correo = CASE WHEN EXCLUDED.cv_manual IS NOT NULL AND (EXCLUDED.cv_manual->>'correo') IS NOT NULL THEN (EXCLUDED.cv_manual->>'correo') ELSE candidatos.correo END,
        experiencia = CASE WHEN EXCLUDED.cv_manual IS NOT NULL AND (EXCLUDED.cv_manual->>'experiencia') IS NOT NULL THEN (EXCLUDED.cv_manual->>'experiencia') ELSE candidatos.experiencia END,
        nave_interes = COALESCE(NULLIF(TRIM(EXCLUDED.nave_interes), ''), NULLIF(TRIM(candidatos.nave_interes), '')),
        escalado = EXCLUDED.escalado,
        escalation_reason = COALESCE(NULLIF(EXCLUDED.escalation_reason, ''), candidatos.escalation_reason),
        veredicto = COALESCE(NULLIF(EXCLUDED.veredicto, ''), candidatos.veredicto),
        motivo_analisis = COALESCE(NULLIF(EXCLUDED.motivo_analisis, ''), candidatos.motivo_analisis)
      RETURNING id
    `;

    const upsertRes = await pool.query(upsertQuery, [
      telefono,
      newState.value,
      finalVacante,
      resumen,
      filtros,
      parsedCvManual ? JSON.stringify(parsedCvManual) : null,
      fecha_entrevista,
      esVerdadero(privacidad) || newState.context.privacidad_aceptada,
      finalNombre,
      parsedCvManual?.nombre || null,
      parsedCvManual?.edad || null,
      parsedCvManual?.correo || null,
      parsedCvManual?.experiencia || null,
      nave,
      veredicto,
      motivo_analisis,
      empresaId,
      esEscalado,
      motivoEscalamiento,
      experiencia_actividades || '',   // $20
      finalLugarResidencia || '',      // $21
      esNombreConfirmado               // $22
    ]);

    const candidatoId = upsertRes.rows[0].id;

    // Asignación al reclutador dueño de la vacante elegida. Se intenta en cada
    // mensaje (no solo "la primera vez que llega vacante") porque la IA no siempre
    // etiqueta la vacante en el mismo turno en que la menciona en el chat — el
    // helper es idempotente, solo asigna si `asignado_a_id` sigue en NULL.
    await asignarReclutadorPorVacante(candidatoId, finalVacante, nave, empresaId);

    // 5. El historial de mensajes (conversation_history) ya NO se inserta
    // aquí: el backend de Python (agente.py) lo guarda directo apenas pasa
    // cada evento real (mensaje del usuario al llegar, cada respuesta del
    // bot justo cuando se manda por WAHA). Insertarlo aquí -- al final de
    // la totalidad del pipeline -- causaba que el orden en la plataforma no
    // coincidiera con el de WhatsApp cuando un turno tardaba más que el
    // siguiente, y además solo se guardaba el primer mensaje de una
    // respuesta partida ([SPLIT]).

    // 6. Actualizar bandeja compartida (mensajes_bandeja)
    await actualizarBandejaCompartida(candidatoId, telefono, mensaje_ia, mensaje_candidato);

    return NextResponse.json({ success: true, estado: newState.value });
  } catch (err) {
    console.error('Error procesando webhook de n8n:', err);
    return NextResponse.json({ error: 'Error procesando webhook' }, { status: 500 });
  }
}
