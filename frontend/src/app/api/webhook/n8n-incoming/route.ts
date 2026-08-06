import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { candidatoMachine } from '@/lib/stateMachine';
import { createActor } from 'xstate';
import { verifyWebhookApiKey } from '@/lib/auth';
import { resolveEmpresaYGrupo } from '@/lib/empresaResolution';
import { asignarReclutadorPorVacante } from '@/lib/asignacionReclutador';

export async function POST(request: Request) {
  if (!verifyWebhookApiKey(request)) {
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
      cv_manual,
      fecha_entrevista,
      privacidad,
      nombre_wpp,
      nave,
      es_cv,
      mensaje_ia,
      mensaje_candidato,
      message_type,
      media_url
    } = data;

    if (!telefono) {
      return NextResponse.json({ error: 'Falta telefono' }, { status: 400 });
    }

    // 1. Obtener estado actual (buscamos por telefono; puede haber una fila por empresa)
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

    // Verificación de Rechazo Global (Cross-Company/Nave)
    const resRechazados = await pool.query(`SELECT nave_interes FROM candidatos WHERE telefono = $1 AND estado = 'RECHAZADO' LIMIT 1`, [telefono]);
    const fueRechazadoGlobalmente = resRechazados.rowCount ? (resRechazados.rowCount > 0) : false;
    const naveRechazo = fueRechazadoGlobalmente ? resRechazados.rows[0].nave_interes : null;

    if (res.rowCount && res.rowCount > 0) {
      currentState = res.rows[0].estado;
      context = {
        telefono,
        tiene_cv: res.rows[0].tiene_cv || false,
        cv_manual: !!res.rows[0].db_cv_manual,
        fecha_entrevista: res.rows[0].db_fecha || null,
        privacidad_aceptada: res.rows[0].privacidad_aceptada || false,
        escalado: res.rows[0].escalado || false,
      };
    }

    // 2. Determinar el evento basado en la información entrante (emulando lo que hacía el CASE WHEN)
    let event: any = { type: 'INTERES' }; // default fallback

    if (privacidad === 'true' && currentState === 'NUEVO') {
      event = { type: 'INTERES' };
    }
    if (es_cv === 'true' || cv_manual) {
      event = { type: 'RECIBE_CV' };
    }
    if (cita_creada === 'true' || fecha_entrevista) {
      event = { type: 'AGENDA_CITA', fecha: fecha_entrevista || 'Por confirmar' };
    }
    // Si cancela la cita o hay escalamiento explícito en resumen (ej. HUMAN_ALERT)
    if (cita_cancelada === 'true' || (resumen && (resumen as string).includes('solicitó apoyo'))) {
      event = { type: 'ESCALA_HUMANO' };
    }

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

    let finalNombre = (nombre && nombre !== 'Candidato') ? nombre.trim() : '';

    // Intento 1: Extraer del resumen si Gemini detectó el nombre (ej. "Nombre: Oscar")
    if (!finalNombre || finalNombre === 'Candidato') {
      if (resumen && typeof resumen === 'string') {
        const nameMatch = resumen.match(/Nombre:\s*([^.\n|]+)/i);
        if (nameMatch && nameMatch[1]) {
          const extracted = nameMatch[1].trim();
          if (extracted && !['Candidato', 'Desconocido', 'No registrado', 'Pendiente'].includes(extracted) && !/^\+?\d+$/.test(extracted)) {
            finalNombre = extracted;
          }
        }
      }
    }

    // Intento 2: Usar nombre_wpp si es un nombre legible
    if (!finalNombre || finalNombre === 'Candidato') {
      if (nombre_wpp && nombre_wpp.trim() && nombre_wpp.trim() !== 'Candidato' && !/^[^\w\s]+$/.test(nombre_wpp.trim())) {
        finalNombre = nombre_wpp.trim();
      }
    }

    if (!finalNombre || finalNombre === telefono || /^\+?\d+$/.test(finalNombre)) {
      finalNombre = 'Candidato';
    }

    // Extraer Vacante desde Resumen si viene como 'General' o vacía
    let finalVacante = (vacante && vacante.trim() !== 'General') ? vacante.trim() : '';
    if (!finalVacante || finalVacante === 'General') {
      if (resumen && typeof resumen === 'string') {
        const vacMatch = resumen.match(/Vacante:\s*([^.\n|]+)/i);
        if (vacMatch && vacMatch[1]) {
          const extractedVac = vacMatch[1].trim();
          if (extractedVac && !['General', 'Ninguna', 'Pendiente', 'Desconocida', 'X'].includes(extractedVac)) {
            finalVacante = extractedVac;
          }
        }
      }
    }

    let veredicto = null;
    let motivo_analisis = null;
    if (filtros) {
      try {
        const parsed = JSON.parse(filtros);
        if (parsed && typeof parsed === 'object') {
          if (parsed.viable === true) veredicto = 'VIABLE';
          else if (parsed.viable === false) veredicto = 'NO VIABLE';
          if (parsed.motivo) motivo_analisis = parsed.motivo;
        }
      } catch (e) {
        // Ignorar si no es JSON válido
      }
    }

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

    const upsertQuery = `
      INSERT INTO candidatos (
        telefono, nombre, estado, ultima_interaccion, vacante_interes, 
        resumen_ia, filtros_tecnicos, cv_manual, fecha_entrevista, privacidad_aceptada, 
        nombre_chat, nombre_solicitud, edad, correo, experiencia, nave_interes, mensajes_bot_enviados,
        veredicto, motivo_analisis, empresa_id, escalado, escalation_reason
      )
      VALUES (
        $1, $9, $2, NOW(), $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, 1,
        $15, $16, $17, $18, $19
      )
      ON CONFLICT (telefono, empresa_id) DO UPDATE SET 
        nombre = CASE 
          WHEN EXCLUDED.nombre IS NOT NULL AND EXCLUDED.nombre != 'Candidato' AND EXCLUDED.nombre != '' AND EXCLUDED.nombre !~ '^[^\\w\\s]+$' THEN EXCLUDED.nombre
          WHEN candidatos.nombre IS NULL OR candidatos.nombre = '' OR candidatos.nombre = 'Candidato' OR candidatos.nombre ~ '^[^\\w\\s]+$' THEN EXCLUDED.nombre 
          ELSE candidatos.nombre 
        END,
        nombre_chat = CASE 
          WHEN EXCLUDED.nombre_chat IS NOT NULL AND EXCLUDED.nombre_chat != 'Candidato' AND EXCLUDED.nombre_chat != '' AND EXCLUDED.nombre_chat !~ '^[^\\w\\s]+$' THEN EXCLUDED.nombre_chat
          WHEN candidatos.nombre_chat IS NULL OR candidatos.nombre_chat = '' OR candidatos.nombre_chat = 'Candidato' OR candidatos.nombre_chat ~ '^[^\\w\\s]+$' THEN EXCLUDED.nombre_chat
          ELSE candidatos.nombre_chat 
        END,
        estado = EXCLUDED.estado,
        ultima_interaccion = NOW(),
        mensajes_bot_enviados = candidatos.mensajes_bot_enviados + 1,
        vacante_interes = COALESCE(NULLIF(TRIM(EXCLUDED.vacante_interes), ''), NULLIF(TRIM(candidatos.vacante_interes), '')),
        resumen_ia = COALESCE(NULLIF(EXCLUDED.resumen_ia, ''), candidatos.resumen_ia),
        filtros_tecnicos = COALESCE(NULLIF(EXCLUDED.filtros_tecnicos, ''), candidatos.filtros_tecnicos),
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
      privacidad === 'true' || newState.context.privacidad_aceptada,
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
      motivoEscalamiento
    ]);

    const candidatoId = upsertRes.rows[0].id;

    // Asignación al reclutador dueño de la vacante elegida. Se intenta en cada
    // mensaje (no solo "la primera vez que llega vacante") porque la IA no siempre
    // etiqueta la vacante en el mismo turno en que la menciona en el chat — el
    // helper es idempotente, solo asigna si `asignado_a_id` sigue en NULL.
    await asignarReclutadorPorVacante(candidatoId, finalVacante, nave, empresaId);

    // 5. Insertar historial de mensajes
    // Mensaje del usuario
    await pool.query(`INSERT INTO conversation_history (telefono, role, content, message_type, media_url) VALUES ($1, 'user', $2, $3, $4)`,
      [telefono, mensaje_candidato, message_type, media_url]
    );
    // Respuesta IA
    if (mensaje_ia) {
      await pool.query(`INSERT INTO conversation_history (telefono, role, content, message_type) VALUES ($1, 'assistant', $2, 'text')`,
        [telefono, mensaje_ia]
      );
    }

    // 6. Actualizar bandeja compartida (mensajes_bandeja)
    await pool.query(`
      INSERT INTO mensajes_bandeja (candidato_id, telefono, ultimo_mensaje, ultimo_mensaje_rol, mensajes_no_leidos, activo, ultimo_mensaje_at)
      VALUES ($1, $2, $3, 'user', 1, true, NOW())
      ON CONFLICT (candidato_id) DO UPDATE SET 
        ultimo_mensaje = EXCLUDED.ultimo_mensaje,
        ultimo_mensaje_at = NOW(),
        mensajes_no_leidos = mensajes_bandeja.mensajes_no_leidos + 1,
        activo = true
    `, [candidatoId, telefono, mensaje_candidato]);

    return NextResponse.json({ success: true, estado: newState.value });
  } catch (err) {
    console.error('Error procesando webhook de n8n:', err);
    return NextResponse.json({ error: 'Error procesando webhook' }, { status: 500 });
  }
}
