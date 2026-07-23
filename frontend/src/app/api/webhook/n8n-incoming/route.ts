import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { candidatoMachine } from '@/lib/stateMachine';
import { createActor } from 'xstate';

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const {
      telefono,
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

    // 1. Obtener estado actual (buscamos por telefono, asumiendo por ahora la primera empresa o la mas reciente si hay varias)
    // En el futuro, n8n debe enviar el empresa_id
    let res = await pool.query('SELECT id, estado, tiene_cv, cv_manual as db_cv_manual, fecha_entrevista as db_fecha, privacidad_aceptada, escalado FROM candidatos WHERE telefono = $1 ORDER BY updated_at DESC LIMIT 1', [telefono]);
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
    let fueRechazadoGlobalmente = resRechazados.rowCount ? (resRechazados.rowCount > 0) : false;
    let naveRechazo = fueRechazadoGlobalmente ? resRechazados.rows[0].nave_interes : null;

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
    const parsedCvManual = typeof cv_manual === 'string' ? JSON.parse(cv_manual) : cv_manual;
    
    let finalNombre = (nombre && nombre !== 'Candidato') ? nombre : (nombre_wpp || 'Candidato');
    finalNombre = finalNombre.trim();
    if (!finalNombre || finalNombre === telefono || /^\+?\d+$/.test(finalNombre)) {
      finalNombre = 'Candidato';
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
    let esEscalado = newState.value === 'ESCALADO' || context.escalado;
    let motivoEscalamiento = null;
    if (fueRechazadoGlobalmente && currentState === 'NUEVO') {
       esEscalado = true;
       motivoEscalamiento = `ALERTA GLOBAL: Este candidato fue RECHAZADO previamente en la nave: ${naveRechazo || 'Desconocida'}.`;
    }

    // Buscamos una empresa_id default para no romper el UNIQUE constraint
    const defaultEmpresaRes = await pool.query('SELECT id FROM empresas LIMIT 1');
    const empresaId = (defaultEmpresaRes.rowCount && defaultEmpresaRes.rowCount > 0) ? defaultEmpresaRes.rows[0].id : null;

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
        nombre = CASE WHEN candidatos.nombre IS NULL OR candidatos.nombre = '' OR candidatos.nombre = 'Candidato' THEN EXCLUDED.nombre ELSE candidatos.nombre END,
        estado = EXCLUDED.estado,
        ultima_interaccion = NOW(),
        mensajes_bot_enviados = candidatos.mensajes_bot_enviados + 1,
        vacante_interes = COALESCE(NULLIF(EXCLUDED.vacante_interes, ''), candidatos.vacante_interes),
        resumen_ia = COALESCE(NULLIF(EXCLUDED.resumen_ia, ''), candidatos.resumen_ia),
        filtros_tecnicos = COALESCE(NULLIF(EXCLUDED.filtros_tecnicos, ''), candidatos.filtros_tecnicos),
        cv_manual = CASE WHEN EXCLUDED.cv_manual IS NOT NULL THEN EXCLUDED.cv_manual ELSE candidatos.cv_manual END,
        fecha_entrevista = COALESCE(NULLIF(EXCLUDED.fecha_entrevista, ''), candidatos.fecha_entrevista),
        privacidad_aceptada = EXCLUDED.privacidad_aceptada OR candidatos.privacidad_aceptada,
        nombre_chat = CASE WHEN EXCLUDED.nombre_chat != 'Candidato' THEN EXCLUDED.nombre_chat ELSE COALESCE(candidatos.nombre_chat, NULLIF(EXCLUDED.nombre_chat, '')) END,
        nombre_solicitud = CASE WHEN EXCLUDED.cv_manual IS NOT NULL AND (EXCLUDED.cv_manual->>'nombre') IS NOT NULL THEN (EXCLUDED.cv_manual->>'nombre') ELSE candidatos.nombre_solicitud END,
        edad = CASE WHEN EXCLUDED.cv_manual IS NOT NULL AND (EXCLUDED.cv_manual->>'edad') IS NOT NULL THEN (EXCLUDED.cv_manual->>'edad') ELSE candidatos.edad END,
        correo = CASE WHEN EXCLUDED.cv_manual IS NOT NULL AND (EXCLUDED.cv_manual->>'correo') IS NOT NULL THEN (EXCLUDED.cv_manual->>'correo') ELSE candidatos.correo END,
        experiencia = CASE WHEN EXCLUDED.cv_manual IS NOT NULL AND (EXCLUDED.cv_manual->>'experiencia') IS NOT NULL THEN (EXCLUDED.cv_manual->>'experiencia') ELSE candidatos.experiencia END,
        nave_interes = COALESCE(NULLIF(EXCLUDED.nave_interes, ''), candidatos.nave_interes),
        escalado = EXCLUDED.escalado OR candidatos.escalado,
        escalation_reason = COALESCE(NULLIF(EXCLUDED.escalation_reason, ''), candidatos.escalation_reason),
        veredicto = COALESCE(NULLIF(EXCLUDED.veredicto, ''), candidatos.veredicto),
        motivo_analisis = COALESCE(NULLIF(EXCLUDED.motivo_analisis, ''), candidatos.motivo_analisis)
      RETURNING id
    `;
    
    const upsertRes = await pool.query(upsertQuery, [
      telefono, 
      newState.value, 
      vacante, 
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
    return NextResponse.json({ error: 'Error procesando webhook', details: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
