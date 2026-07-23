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
      vacante,
      tipo_origen,
      experiencia,
      mensaje_usuario,
      datos_documento,
      veredicto,
      motivo,
      link_cv,
      nombre_chat,
      edad,
      correo,
      filtros_tecnicos,
      identidad_bloqueada,
      identidad_motivo
    } = data;
    
    let safe_nombre_chat = (nombre_chat || '').replace(/[\uFE0F\u200B-\u200D\u200E\u200F\uFEFF]/g, '').trim();
    if (!safe_nombre_chat || safe_nombre_chat === telefono || safe_nombre_chat === 'Candidato' || /^\+?\d+$/.test(safe_nombre_chat)) {
      safe_nombre_chat = '';
    }

    if (!telefono) {
      return NextResponse.json({ error: 'Falta telefono' }, { status: 400 });
    }

    // 1. Obtener estado actual
    let res = await pool.query('SELECT estado, tiene_cv, cv_manual as db_cv_manual, fecha_entrevista as db_fecha, privacidad_aceptada, escalado, datos_ine, datos_rfc FROM candidatos WHERE telefono = $1', [telefono]);
    let currentState = 'NUEVO';
    let dbCandidato: any = {};

    if (res.rowCount && res.rowCount > 0) {
      currentState = res.rows[0].estado;
      dbCandidato = res.rows[0];
    }

    // 2. Determinar evento para la máquina de estados
    let event: any = null;
    const esBloqueado = identidad_bloqueada === 'true';
    const esCV = tipo_origen === 'CV' || tipo_origen === 'SOLICITUD';
    const esINE = tipo_origen === 'INE';
    const esConstancia = ['CONSTANCIA', 'CSF', 'RFC', 'SAT'].includes((tipo_origen || '').toUpperCase());

    if (esBloqueado) {
      event = { type: 'BLOQUEO_IDENTIDAD' };
    } else if (esCV) {
      event = { type: 'RECIBE_CV' };
    } else if (esINE || esConstancia) {
      event = { type: 'ENTREGA_DOCS' };
    }

    // Ejecutar máquina de estados si hay evento aplicable
    let newStateValue = currentState;
    let newContext = { ...dbCandidato };

    if (event) {
      const actor = createActor(candidatoMachine, {
        snapshot: candidatoMachine.resolveState({ value: currentState, context: newContext }),
      });
      actor.start();
      actor.send(event);
      const snapshot = actor.getSnapshot();
      newStateValue = snapshot.value as string;
      newContext = snapshot.context;
    }

    // Lógica adicional del SQL original para forzar el estado de documentos y el resumen IA
    let resumen_ia_final = dbCandidato.resumen_ia;
    let estado_final = newStateValue;
    
    if (esBloqueado) {
      estado_final = 'DOCUMENTOS_NO_COINCIDEN';
      resumen_ia_final = identidad_motivo || 'Los documentos no coinciden. No se puede agendar hasta recibir el documento correcto.';
    } else if (esCV) {
      estado_final = 'CV_RECIBIDO';
      resumen_ia_final = 'CV Recibido y Analizado por Gemini';
    } else if (esINE || esConstancia) {
      const tieneIne = esINE || !!dbCandidato.datos_ine;
      const tieneRfc = esConstancia || !!dbCandidato.datos_rfc;
      if (tieneIne && tieneRfc) {
        estado_final = 'INE_VALIDADA';
        resumen_ia_final = 'El candidato completó su INE y RFC. El siguiente paso es agendar la cita.';
      } else {
        resumen_ia_final = `Candidato entregó documento parcial (${tipo_origen}). Esperando el faltante.`;
      }
    }

    // Extraer vacante con fallbacks inteligentes
    let safe_vacante = (vacante || '').trim();
    if (!safe_vacante || safe_vacante === 'General') {
      const matchVacanteResumen = (resumen_ia_final || '').match(/Vacante:\s*([^.\n]+)/i);
      if (matchVacanteResumen) {
        safe_vacante = matchVacanteResumen[1].trim();
      } else if (dbCandidato.vacante_interes && dbCandidato.vacante_interes !== 'General') {
        safe_vacante = dbCandidato.vacante_interes;
      }
    }

    // Parseo seguro
    let parsedDatos: any = {};
    if (typeof datos_documento === 'string') {
      try { parsedDatos = JSON.parse(datos_documento); } catch (e) { parsedDatos = {}; }
    } else if (datos_documento && typeof datos_documento === 'object') {
      parsedDatos = datos_documento;
    }
    if (parsedDatos && typeof parsedDatos === 'object' && link_cv) {
      parsedDatos.url = link_cv;
    }

    const nombreDocExtrahido = (parsedDatos?.nombre_completo || parsedDatos?.nombre || '').replace(/[\uFE0F\u200B-\u200D\u200E\u200F\uFEFF]/g, '').trim();

    let safe_nombre = (nombre || '').replace(/[\uFE0F\u200B-\u200D\u200E\u200F\uFEFF]/g, '').trim();
    if (!safe_nombre || safe_nombre === 'Candidato' || safe_nombre === 'No registrado' || /^\+?\d+$/.test(safe_nombre)) {
      safe_nombre = nombreDocExtrahido || 'Candidato';
    }

    // Obtener empresa_id si viene en el payload o usar la empresa por defecto de la BD
    let targetEmpresaId = data.empresa_id || null;
    if (!targetEmpresaId) {
      const defaultEmpresaRes = await pool.query('SELECT id FROM empresas ORDER BY created_at ASC LIMIT 1');
      if (defaultEmpresaRes.rowCount && defaultEmpresaRes.rowCount > 0) {
        targetEmpresaId = defaultEmpresaRes.rows[0].id;
      }
    }

    // Construcción del upsert gigante pero ahora en backend
    const upsertQuery = `
      INSERT INTO candidatos (
        telefono, nombre, vacante_interes, experiencia, resumen_ia, tiene_cv, estado, 
        ultima_interaccion, datos_ine, datos_rfc, cv_manual, nombre_confirmado, 
        veredicto, motivo_analisis, link_cv, nombre_chat, edad, correo, 
        filtros_tecnicos, nombre_ine, nombre_constancia, nombre_solicitud, empresa_id, vacante_solicitada
      ) VALUES (
        $1,
        CAST($2 AS text),
        COALESCE(NULLIF($3, ''), 'General'),
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN $5 ELSE NULL END,
        $6, -- resumen ia final
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN TRUE ELSE FALSE END,
        $7, -- estado final
        NOW(),
        CASE WHEN $15 = 'true' THEN NULL WHEN $4 = 'INE' THEN CAST($8 AS jsonb) ELSE NULL END,
        CASE WHEN $15 = 'true' THEN NULL WHEN $4 IN ('CONSTANCIA', 'CSF', 'RFC', 'SAT') THEN CAST($18 AS text) ELSE NULL END,
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN CAST($8 AS jsonb) ELSE NULL END,
        CASE WHEN $15 = 'true' THEN FALSE WHEN $4 IN ('INE', 'CONSTANCIA', 'CSF', 'RFC', 'SAT') THEN TRUE ELSE FALSE END,
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN COALESCE($9, 'VIABLE') ELSE NULL END,
        CASE 
            WHEN $15 = 'true' THEN COALESCE(NULLIF($16, ''), $10)
            WHEN $4 IN ('CV', 'SOLICITUD') THEN $10
            ELSE NULL
        END,
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN $11 ELSE NULL END,
        $12,
        $13,
        $14,
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN $17 ELSE NULL END,
        CASE WHEN $15 = 'true' THEN NULL WHEN $4 = 'INE' THEN CAST($2 AS text) ELSE NULL END,
        CASE WHEN $15 = 'true' THEN NULL WHEN $4 IN ('CONSTANCIA', 'CSF', 'RFC', 'SAT') THEN CAST($2 AS text) ELSE NULL END,
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN CAST($2 AS text) ELSE NULL END,
        $19,
        COALESCE(NULLIF($3, ''), 'General')
      )
      ON CONFLICT (telefono, empresa_id) DO UPDATE SET
        ultima_interaccion = NOW(),
        nombre = CASE WHEN candidatos.nombre IS NULL OR candidatos.nombre = '' OR candidatos.nombre = 'Candidato' THEN CAST($2 AS text) ELSE candidatos.nombre END,
        vacante_interes = COALESCE(NULLIF($3, ''), candidatos.vacante_interes, 'General'),
        vacante_solicitada = COALESCE(NULLIF($3, ''), candidatos.vacante_solicitada, candidatos.vacante_interes, 'General'),
        experiencia = CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN $5 ELSE candidatos.experiencia END,
        tiene_cv = CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN TRUE ELSE candidatos.tiene_cv END,
        cv_manual = CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN CAST($8 AS jsonb) ELSE candidatos.cv_manual END,
        veredicto = CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN COALESCE($9, 'VIABLE') ELSE candidatos.veredicto END,
        motivo_analisis = CASE 
            WHEN $15 = 'true' THEN COALESCE(NULLIF($16, ''), candidatos.motivo_analisis)
            WHEN $4 IN ('CV', 'SOLICITUD') THEN COALESCE($10, candidatos.motivo_analisis)
            ELSE candidatos.motivo_analisis
        END,
        link_cv = CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN COALESCE($11, candidatos.link_cv) ELSE candidatos.link_cv END,
        filtros_tecnicos = CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN COALESCE($17, candidatos.filtros_tecnicos) ELSE candidatos.filtros_tecnicos END,
        nombre_confirmado = CASE WHEN $15 = 'true' THEN FALSE WHEN $4 IN ('INE', 'CONSTANCIA', 'CSF', 'RFC', 'SAT') THEN TRUE ELSE candidatos.nombre_confirmado END,
        datos_ine = CASE WHEN $15 = 'true' THEN candidatos.datos_ine WHEN $4 = 'INE' THEN CAST($8 AS jsonb) ELSE candidatos.datos_ine END,
        datos_rfc = CASE WHEN $15 = 'true' THEN candidatos.datos_rfc WHEN $4 IN ('CONSTANCIA', 'CSF', 'RFC', 'SAT') THEN CAST($18 AS text) ELSE candidatos.datos_rfc END,
        nombre_ine = CASE WHEN $15 = 'true' THEN candidatos.nombre_ine WHEN $4 = 'INE' THEN CAST($2 AS text) ELSE candidatos.nombre_ine END,
        nombre_constancia = CASE WHEN $15 = 'true' THEN candidatos.nombre_constancia WHEN $4 IN ('CONSTANCIA', 'CSF', 'RFC', 'SAT') THEN CAST($2 AS text) ELSE candidatos.nombre_constancia END,
        nombre_solicitud = CASE WHEN $4 IN ('CV', 'SOLICITUD') AND candidatos.nombre_solicitud IS NULL THEN CAST($2 AS text) ELSE candidatos.nombre_solicitud END,
        nombre_chat = COALESCE(NULLIF($12, ''), candidatos.nombre_chat),
        edad = COALESCE(NULLIF($13, ''), candidatos.edad),
        correo = COALESCE(NULLIF($14, ''), candidatos.correo),
        estado = $7,
        resumen_ia = $6
    `;

    await pool.query(upsertQuery, [
      telefono,                 // $1
      safe_nombre,              // $2
      vacante,                  // $3
      tipo_origen,              // $4
      experiencia,              // $5
      resumen_ia_final,         // $6
      estado_final,             // $7
      datos_documento ? JSON.stringify(parsedDatos) : null, // $8
      veredicto,                // $9
      motivo,                   // $10
      link_cv,                  // $11
      safe_nombre_chat,         // $12
      edad,                     // $13
      correo,                   // $14
      identidad_bloqueada,      // $15
      identidad_motivo,         // $16
      filtros_tecnicos,         // $17
      datos_documento ? JSON.stringify(parsedDatos) : null, // $18
      targetEmpresaId           // $19
    ]);

    // Insertar el mensaje del usuario (usualmente un archivo adjunto enviado por WhatsApp)
    if (mensaje_usuario) {
       await pool.query(`INSERT INTO conversation_history (telefono, role, content, message_type) VALUES ($1, 'user', $2, 'text')`, 
        [telefono, mensaje_usuario]
      );
    }

    return NextResponse.json({ success: true, estado: estado_final });
  } catch (err: any) {
    console.error('Error procesando webhook de expediente n8n:', err);
    return NextResponse.json({ 
      error: 'Error procesando webhook de expediente',
      detail: err?.message || String(err),
      stack: err?.stack?.split('\n').slice(0, 5)
    }, { status: 500 });
  }
}
