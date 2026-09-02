import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { candidatoMachine } from '@/lib/stateMachine';
import { createActor } from 'xstate';
import { verifyInternalApiKey } from '@/lib/auth';
import { enviarNotificacionReclutador } from '@/lib/messagingService';
import { resolveEmpresaYGrupo } from '@/lib/empresaResolution';
import { asignarReclutadorPorVacante } from '@/lib/asignacionReclutador';
import { esPlaceholderVacante, limpiarVacante } from '@/lib/vacantes';
import type { CandidatoEvent, CandidatoContext } from "@/lib/stateMachine";

export async function POST(request: Request) {
  if (!verifyInternalApiKey(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

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
      identidad_alerta,
      identidad_motivo,
      curp_ine,
      curp_rfc,
      nombre_reclutador,
      telefono_reclutador,
      telefono_destino
    } = data;

    // Se guarda la CURP tal cual la leyó la IA (recortada a 50 chars como tope de
    // seguridad) aunque no tenga el formato de 18 caracteres esperado, para que la
    // reclutadora la valide visualmente desde el modal de alerta de identidad en vez
    // de perder el dato. curp_ine/curp_rfc son VARCHAR(50) para dar margen.
    const normalizeCurp = (value: unknown): string | null => {
      if (typeof value !== 'string') return null;
      const clean = value.trim().toUpperCase().slice(0, 50);
      return clean || null;
    };
    const CURP_REGEX = /^[A-Z0-9]{18}$/;
    // RFC de persona física: 4 letras + AAMMDD + 3 de homoclave. Sus primeros 10
    // caracteres coinciden por construcción con los de la CURP del mismo titular.
    const RFC_PERSONA_FISICA_REGEX = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
    const safe_curp_ine = normalizeCurp(curp_ine);
    const safe_curp_rfc = normalizeCurp(curp_rfc);
    // La Constancia de Situación Fiscal trae RFC y CURP juntos y Gemini a veces
    // copia el RFC en `curp_rfc`. Un RFC de 13 caracteres cuya raíz es la misma
    // que la de la CURP del INE es la MISMA persona, no un documento ajeno: no
    // debe mandar al candidato a DOCUMENTOS_NO_COINCIDEN (que además bloquea
    // crear_evento en agente.py y lo deja sin poder agendar). Si la raíz NO
    // coincide sí se sigue mandando a revisión manual.
    const rfcCoincideConCurpIne = !!safe_curp_rfc && !!safe_curp_ine
      && RFC_PERSONA_FISICA_REGEX.test(safe_curp_rfc)
      && CURP_REGEX.test(safe_curp_ine)
      && safe_curp_rfc.slice(0, 10) === safe_curp_ine.slice(0, 10);
    const curpIneFormatoInvalido = !!safe_curp_ine && !CURP_REGEX.test(safe_curp_ine);
    const curpRfcFormatoInvalido = !!safe_curp_rfc && !CURP_REGEX.test(safe_curp_rfc) && !rfcCoincideConCurpIne;

    let safe_nombre_chat = (nombre_chat || '').replace(/[\uFE0F\u200B-\u200D\u200E\u200F\uFEFF]/g, '').trim();
    if (!safe_nombre_chat || safe_nombre_chat === telefono || safe_nombre_chat === 'Candidato' || /^\+?\d+$/.test(safe_nombre_chat)) {
      safe_nombre_chat = '';
    }

    if (!telefono) {
      return NextResponse.json({ error: 'Falta telefono' }, { status: 400 });
    }

    // 1. Obtener estado actual
    const res = await pool.query('SELECT estado, tiene_cv, cv_manual as db_cv_manual, fecha_entrevista as db_fecha, privacidad_aceptada, escalado, datos_ine, datos_rfc, nombre_ine, nombre_constancia, curp_ine, curp_rfc, alerta_identidad_estado, alerta_identidad_motivo, asignado_a_id, vacante_interes FROM candidatos WHERE telefono = $1', [telefono]);
    let currentState = 'NUEVO';
    // La fila que trae el SELECT de arriba: lo que la máquina de estados
    // necesita como contexto, más las columnas que se leen luego aquí.
    let dbCandidato: CandidatoContext & {
      resumen_ia?: string | null;
      datos_ine?: unknown;
      datos_rfc?: unknown;
      nombre_constancia?: string | null;
      curp_ine?: string | null;
      curp_rfc?: string | null;
      alerta_identidad_estado?: string | null;
      alerta_identidad_motivo?: string | null;
      asignado_a_id?: string | null;
      db_cv_manual?: boolean;
      db_fecha?: string | null;
      // nombre_ine y vacante_interes se leían más abajo pero faltaban en el
      // SELECT, así que llegaban siempre en undefined: tieneIne perdía uno de
      // sus tres criterios y la rama que conserva la vacante ya guardada nunca
      // se ejecutaba (esPlaceholderVacante(undefined) es true), de modo que la
      // vacante se vaciaba en vez de mantenerse.
      nombre_ine?: string | null;
      vacante_interes?: string | null;
    } = {
      // Sin fila en la BD el contexto iba vacío y la máquina leía undefined en
      // cada guarda; estos valores dicen lo mismo, pero explícitamente.
      telefono,
      tiene_cv: false,
      cv_manual: false,
      fecha_entrevista: null,
      privacidad_aceptada: false,
      escalado: false,
    };

    if (res.rowCount && res.rowCount > 0) {
      currentState = res.rows[0].estado;
      dbCandidato = res.rows[0];
    }

    // 2. Determinar evento para la máquina de estados
    let event: CandidatoEvent | null = null;
    const esBloqueado = identidad_bloqueada === 'true';
    // Discrepancia MENOR de CURP (1-2 caracteres, típico de OCR): a diferencia de
    // esBloqueado, NO detiene el agendamiento -- solo deja la alerta pendiente en
    // el modal del reclutador. chat_prompt.md ya distingue esto ("1-2 caracteres
    // → PERMITIDO AGENDAR"); antes backend forzaba DOCUMENTOS_NO_COINCIDEN también
    // en este caso, bloqueando algo que el propio prompt permitía.
    const esAlertaIdentidad = identidad_alerta === 'true';
    const esCV = tipo_origen === 'CV' || tipo_origen === 'SOLICITUD';
    const esINE = tipo_origen === 'INE';
    const esConstancia = ['CONSTANCIA', 'CSF', 'RFC', 'SAT'].includes((tipo_origen || '').toUpperCase());
    const esAmbos = (tipo_origen || '').toUpperCase() === 'AMBOS_DOCS';

    if (esBloqueado) {
      event = { type: 'BLOQUEO_IDENTIDAD' };
    } else if (esCV) {
      event = { type: 'RECIBE_CV' };
    } else if (esINE || esConstancia || esAmbos) {
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

    // --- Alerta de verificación de identidad (discrepancia de CURP) ---
    // No bloquea de forma permanente: el candidato se queda en DOCUMENTOS_NO_COINCIDEN
    // hasta que un reclutador valide o rechace desde la plataforma (bandeja + modal urgente),
    // o hasta que un reenvío del documento ya no muestre discrepancia.
    let alertaIdentidadEstadoFinal: string | null = dbCandidato.alerta_identidad_estado ?? null;
    let alertaIdentidadMotivoFinal: string | null = dbCandidato.alerta_identidad_motivo ?? null;
    let debeNotificarReclutador = false;

    if (esCV) {
      estado_final = 'CV_RECIBIDO';
      resumen_ia_final = 'CV Recibido y Analizado por Gemini';
    } else if (esINE || esConstancia || esAmbos || esBloqueado) {
      const curpMalFormada = (esINE && curpIneFormatoInvalido) || (esConstancia && curpRfcFormatoInvalido) || (esAmbos && (curpIneFormatoInvalido || curpRfcFormatoInvalido));

      const tieneIne = esINE || esAmbos || !!dbCandidato.datos_ine || !!dbCandidato.curp_ine || !!dbCandidato.nombre_ine;
      const tieneRfc = esConstancia || esAmbos || !!dbCandidato.datos_rfc || !!dbCandidato.curp_rfc || !!dbCandidato.nombre_constancia;

      if (esBloqueado || curpMalFormada || esAlertaIdentidad) {
        // Discrepancia o formato: queda pendiente de revisión para el reclutador en el AlertModal,
        // pero el candidato NO se bloquea y avanza normalmente si ya entregó ambos documentos.
        alertaIdentidadMotivoFinal = identidad_motivo || (curpMalFormada ? `CURP con formato irregular en ${tipo_origen}. Verifica el documento manualmente.` : alertaIdentidadMotivoFinal);
        if (dbCandidato.alerta_identidad_estado !== 'PENDIENTE') {
          debeNotificarReclutador = true;
        }
        alertaIdentidadEstadoFinal = 'PENDIENTE';
        if (tieneIne && tieneRfc) {
          estado_final = 'INE_VALIDADA';
          resumen_ia_final = 'El candidato completó su INE y RFC (alerta de verificación de identidad pendiente en plataforma). El siguiente paso es agendar la cita.';
        } else {
          resumen_ia_final = `Candidato entregó documento parcial (${tipo_origen}). Esperando el faltante.`;
        }
      } else {
        // La CURP recién comparada ya no muestra discrepancia (o no había una previa): se limpia la alerta.
        alertaIdentidadEstadoFinal = null;
        alertaIdentidadMotivoFinal = null;
        if (tieneIne && tieneRfc) {
          estado_final = 'INE_VALIDADA';
          resumen_ia_final = 'El candidato completó su INE y RFC. El siguiente paso es agendar la cita.';
        } else {
          resumen_ia_final = `Candidato entregó documento parcial (${tipo_origen}). Esperando el faltante.`;
        }
      }
    }

    // Extraer vacante con fallbacks inteligentes.
    // 'General'/'Ninguna' son PLACEHOLDERS, no vacantes: el analizador manda
    // "General" por defecto cuando el documento no revela ninguna
    // (analizador.py -> vacante_anuncio). Si tras los fallbacks seguimos con el
    // placeholder hay que dejarlo VACÍO para que el UPSERT conserve lo que ya
    // hubiera; si se guarda literal, definir_agenda lo lee como "vacante
    // desconocida" y manda la cita al reclutador de respaldo (pasó en
    // producción: se agendó "vacante de General" con el Equipo de Reclutamiento
    // en vez de con la reclutadora dueña de la vacante).
    // esPlaceholderVacante vive en @/lib/vacantes: la copia local comparaba
    // el string crudo, así que '{NINGUNA}' (con las llaves que dejaba el
    // prompt) no coincidía con 'NINGUNA' y pasaba como vacante real.
    let safe_vacante = limpiarVacante(vacante);
    if (esPlaceholderVacante(safe_vacante)) {
      const matchVacanteResumen = (resumen_ia_final || '').match(/Vacante:\s*([^.\n]+)/i);
      if (matchVacanteResumen && !esPlaceholderVacante(matchVacanteResumen[1])) {
        safe_vacante = limpiarVacante(matchVacanteResumen[1]);
      } else if (!esPlaceholderVacante(dbCandidato.vacante_interes)) {
        safe_vacante = limpiarVacante(dbCandidato.vacante_interes);
      } else {
        safe_vacante = '';
      }
    }

    // Parseo seguro
    // El JSON del documento: la IA decide qué campos trae, así que solo se
    // nombran los que este handler lee.
    let parsedDatos: { nombre_completo?: string; nombre?: string; url?: string; [k: string]: unknown } = {};
    if (typeof datos_documento === 'string') {
      try { parsedDatos = JSON.parse(datos_documento); } catch { parsedDatos = {}; }
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

    // Obtener empresa_id si viene en el payload o resolverlo por el número que recibió el mensaje
    let targetEmpresaId = data.empresa_id || null;
    if (!targetEmpresaId) {
      const resuelto = await resolveEmpresaYGrupo(telefono_destino, 'webhook/expediente');
      targetEmpresaId = resuelto.empresa_id;
    }

    // Resolver nombre_reclutador (nombre de texto que manda n8n) -> reclutador_id real,
    // para asignar por FK en vez de por nombre.
    let reclutadorAsignadoId: string | null = null;
    if (nombre_reclutador) {
      const recRes = await pool.query(
        `SELECT id FROM reclutadores WHERE UPPER(nombre) = UPPER($1) AND activo = true LIMIT 1`,
        [nombre_reclutador]
      );
      if (recRes.rowCount && recRes.rowCount > 0) {
        reclutadorAsignadoId = recRes.rows[0].id;
      }
    }

    // Construcción del upsert gigante pero ahora en backend
    const upsertQuery = `
      INSERT INTO candidatos (
        telefono, nombre, vacante_interes, experiencia, resumen_ia, tiene_cv, estado,
        ultima_interaccion, datos_ine, datos_rfc, cv_manual, nombre_confirmado,
        veredicto, motivo_analisis, link_cv, nombre_chat, edad, correo,
        filtros_tecnicos, nombre_ine, nombre_constancia, nombre_solicitud, empresa_id, vacante_solicitada,
        curp_ine, curp_rfc, alerta_identidad_estado, alerta_identidad_motivo, asignado_a_id
      ) VALUES (
        $1,
        CAST($2 AS text),
        -- NULL (no 'General') cuando el candidato aún no ha elegido vacante:
        -- ver la nota del UPDATE de más abajo.
        NULLIF($3, ''),
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN $5 ELSE NULL END,
        $6, -- resumen ia final
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN TRUE ELSE FALSE END,
        $7, -- estado final
        NOW(),
        CASE WHEN $4 IN ('INE', 'AMBOS_DOCS') THEN CAST($8 AS jsonb) ELSE NULL END,
        CASE WHEN $4 IN ('CONSTANCIA', 'CSF', 'RFC', 'SAT', 'AMBOS_DOCS') THEN CAST($18 AS text) ELSE NULL END,
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN CAST($8 AS jsonb) ELSE NULL END,
        CASE WHEN $15 = 'true' THEN FALSE WHEN $4 IN ('INE', 'CONSTANCIA', 'CSF', 'RFC', 'SAT', 'AMBOS_DOCS') THEN TRUE ELSE FALSE END,
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN COALESCE($9, 'VIABLE') ELSE NULL END,
        CASE
            WHEN $15 = 'true' THEN COALESCE(NULLIF($16, ''), $10)
            WHEN $4 IN ('CV', 'SOLICITUD') THEN $10
            ELSE NULL
        END,
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN $11 ELSE NULL END,
        NULLIF($12, ''),
        NULLIF($13, ''),
        NULLIF($14, ''),
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN $17 ELSE NULL END,
        CASE WHEN $4 IN ('INE', 'AMBOS_DOCS') THEN CAST($2 AS text) ELSE NULL END,
        CASE WHEN $4 IN ('CONSTANCIA', 'CSF', 'RFC', 'SAT', 'AMBOS_DOCS') THEN CAST($2 AS text) ELSE NULL END,
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN CAST($2 AS text) ELSE NULL END,
        $19,
        NULLIF($3, ''),
        CASE WHEN $4 IN ('INE', 'AMBOS_DOCS') THEN NULLIF($20, '') ELSE NULL END,
        CASE WHEN $4 IN ('CONSTANCIA', 'CSF', 'RFC', 'SAT', 'AMBOS_DOCS') THEN NULLIF($21, '') ELSE NULL END,
        $22,
        $23,
        CASE WHEN $15 = 'true' THEN $24 ELSE NULL END
      )
      ON CONFLICT (telefono, empresa_id) DO UPDATE SET
        ultima_interaccion = NOW(),
        nombre = CASE
          WHEN $4 IN ('CONSTANCIA', 'CSF', 'RFC', 'SAT', 'AMBOS_DOCS') AND $2 IS NOT NULL AND $2 NOT IN ('', 'Candidato') THEN CAST($2 AS text)
          WHEN $4 = 'INE' AND (candidatos.nombre_constancia IS NULL OR candidatos.nombre_constancia = '') AND $2 IS NOT NULL AND $2 NOT IN ('', 'Candidato') THEN CAST($2 AS text)
          WHEN candidatos.nombre IS NULL OR candidatos.nombre = '' OR candidatos.nombre = 'Candidato' THEN CAST($2 AS text)
          ELSE candidatos.nombre
        END,
        -- Sin 'General' como último recurso: escribirlo aquí anulaba el filtro
        -- de placeholders de arriba (safe_vacante ya llega vacío cuando no se
        -- conoce la vacante) y dejaba 'General' guardado como si fuera una
        -- vacante real. definir_agenda lo leía como "vacante desconocida" y
        -- mandaba la cita al reclutador de respaldo; el bot además le decía al
        -- candidato "tu entrevista para la vacante de General".
        -- NULL es la respuesta honesta: todavía no eligió vacante.
        vacante_interes = COALESCE(NULLIF($3, ''), candidatos.vacante_interes),
        vacante_solicitada = COALESCE(NULLIF($3, ''), candidatos.vacante_solicitada, candidatos.vacante_interes),
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
        nombre_confirmado = CASE WHEN $15 = 'true' THEN FALSE WHEN $4 IN ('INE', 'CONSTANCIA', 'CSF', 'RFC', 'SAT', 'AMBOS_DOCS') THEN TRUE ELSE candidatos.nombre_confirmado END,
        datos_ine = CASE WHEN $4 IN ('INE', 'AMBOS_DOCS') THEN CAST($8 AS jsonb) ELSE candidatos.datos_ine END,
        datos_rfc = CASE WHEN $4 IN ('CONSTANCIA', 'CSF', 'RFC', 'SAT', 'AMBOS_DOCS') THEN CAST($18 AS text) ELSE candidatos.datos_rfc END,
        nombre_ine = CASE WHEN $4 IN ('INE', 'AMBOS_DOCS') THEN CAST($2 AS text) ELSE candidatos.nombre_ine END,
        nombre_constancia = CASE WHEN $4 IN ('CONSTANCIA', 'CSF', 'RFC', 'SAT', 'AMBOS_DOCS') THEN CAST($2 AS text) ELSE candidatos.nombre_constancia END,
        nombre_solicitud = CASE WHEN $4 IN ('CV', 'SOLICITUD') AND candidatos.nombre_solicitud IS NULL THEN CAST($2 AS text) ELSE candidatos.nombre_solicitud END,
        nombre_chat = COALESCE(NULLIF($12, ''), candidatos.nombre_chat),
        edad = COALESCE(NULLIF($13, ''), candidatos.edad),
        correo = COALESCE(NULLIF($14, ''), candidatos.correo),
        curp_ine = CASE WHEN $4 IN ('INE', 'AMBOS_DOCS') THEN COALESCE(NULLIF($20, ''), candidatos.curp_ine) ELSE candidatos.curp_ine END,
        curp_rfc = CASE WHEN $4 IN ('CONSTANCIA', 'CSF', 'RFC', 'SAT', 'AMBOS_DOCS') THEN COALESCE(NULLIF($21, ''), candidatos.curp_rfc) ELSE candidatos.curp_rfc END,
        alerta_identidad_estado = $22,
        alerta_identidad_motivo = $23,
        asignado_a_id = CASE WHEN $15 = 'true' THEN COALESCE(candidatos.asignado_a_id, $24) ELSE candidatos.asignado_a_id END,
        estado = $7,
        resumen_ia = $6
      RETURNING id
    `;

    const upsertRes = await pool.query(upsertQuery, [
      telefono,                 // $1
      safe_nombre,              // $2
      // safe_vacante, NO `vacante`: el valor crudo trae el placeholder
      // 'General' que manda el analizador cuando el documento no revela
      // ninguna vacante. Se calculaba la versión limpia arriba pero la query
      // seguía recibiendo la cruda, así que el filtro de placeholders no
      // servía de nada y 'General' acababa guardado como vacante real.
      safe_vacante,             // $3
      tipo_origen,              // $4
      experiencia,               // $5
      resumen_ia_final,         // $6
      estado_final,              // $7
      datos_documento ? JSON.stringify(parsedDatos) : null, // $8
      veredicto,                 // $9
      motivo,                    // $10
      link_cv,                   // $11
      safe_nombre_chat,          // $12
      edad,                       // $13
      correo,                     // $14
      identidad_bloqueada,        // $15
      identidad_motivo,           // $16
      filtros_tecnicos,           // $17
      datos_documento ? JSON.stringify(parsedDatos) : null, // $18
      targetEmpresaId,            // $19
      safe_curp_ine,               // $20
      safe_curp_rfc,               // $21
      alertaIdentidadEstadoFinal, // $22
      alertaIdentidadMotivoFinal, // $23
      reclutadorAsignadoId        // $24
    ]);

    // Asignación al reclutador dueño de la vacante elegida. Un candidato puede subir
    // documentos (este endpoint) antes de que la IA etiquete la vacante en el chat
    // (n8n-incoming) — el helper es idempotente, solo asigna si sigue sin reclutador.
    const candidatoIdExpediente = upsertRes.rows[0]?.id;
    if (candidatoIdExpediente) {
      await asignarReclutadorPorVacante(candidatoIdExpediente, safe_vacante, null, targetEmpresaId);
    }

    // Insertar el mensaje del usuario (usualmente un archivo adjunto enviado por WhatsApp)
    if (mensaje_usuario) {
       await pool.query(`INSERT INTO conversation_history (telefono, role, content, message_type) VALUES ($1, 'user', $2, 'text')`,
        [telefono, mensaje_usuario]
      );
    }

    // Alertar al reclutador (campana en plataforma + WhatsApp + Toast) solo cuando se detecta
    // una discrepancia de CURP nueva (no en cada reenvío mientras sigue pendiente).
    if (debeNotificarReclutador) {
      const mensajeAlerta = `⚠️ *Verificación de identidad requerida*\n\nCandidato: ${safe_nombre}\nTel: wa.me/${telefono}\nVacante: ${safe_vacante || 'Sin vacante'}\n\n${alertaIdentidadMotivoFinal || 'La CURP del INE y del RFC no coinciden.'}\n\nRevisa el candidato en la plataforma para validar o rechazar.`;
      if (telefono_reclutador) {
        await enviarNotificacionReclutador(String(telefono_reclutador), mensajeAlerta, reclutadorAsignadoId || null);
      }
    }

    return NextResponse.json({ success: true, estado: estado_final });
  } catch (err) {
    console.error('Error procesando webhook de expediente n8n:', err);
    return NextResponse.json({ error: 'Error procesando webhook de expediente' }, { status: 500 });
  }
}
