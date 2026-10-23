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

const CURP_REGEX = /^[A-Z0-9]{18}$/;
const RFC_PERSONA_FISICA_REGEX = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;

function normalizeCurp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toUpperCase().slice(0, 50);
  return clean || null;
}

function validateCurps(curp_ine: unknown, curp_rfc: unknown) {
  const safe_curp_ine = normalizeCurp(curp_ine);
  const safe_curp_rfc = normalizeCurp(curp_rfc);

  const rfcCoincideConCurpIne = !!safe_curp_rfc && !!safe_curp_ine
    && RFC_PERSONA_FISICA_REGEX.test(safe_curp_rfc)
    && CURP_REGEX.test(safe_curp_ine)
    && safe_curp_rfc.slice(0, 10) === safe_curp_ine.slice(0, 10);

  const curpIneFormatoInvalido = !!safe_curp_ine && !CURP_REGEX.test(safe_curp_ine);
  const curpRfcFormatoInvalido = !!safe_curp_rfc && !CURP_REGEX.test(safe_curp_rfc) && !rfcCoincideConCurpIne;

  return { safe_curp_ine, safe_curp_rfc, curpIneFormatoInvalido, curpRfcFormatoInvalido };
}

function checkCurpMalFormada(esINE: boolean, esConstancia: boolean, esAmbos: boolean, curpIneFormatoInvalido: boolean, curpRfcFormatoInvalido: boolean): boolean {
  if (esINE && curpIneFormatoInvalido) return true;
  if (esConstancia && curpRfcFormatoInvalido) return true;
  if (esAmbos && (curpIneFormatoInvalido || curpRfcFormatoInvalido)) return true;
  return false;
}

/** Estado actual del candidato leído de la BD antes de aplicar el webhook. */
type DbCandidato = CandidatoContext & {
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
  nombre_ine?: string | null;
  vacante_interes?: string | null;
};

function resolveIdAlertState(
  isAlert: boolean,
  curpMalFormada: boolean,
  identidad_motivo: string | undefined,
  tipo_origen: string,
  dbCandidato: DbCandidato
) {
  if (isAlert) {
    const motivo = identidad_motivo || (curpMalFormada ? `CURP con formato irregular en ${tipo_origen}. Verifica el documento manualmente.` : (dbCandidato.alerta_identidad_motivo ?? null));
    const notificar = dbCandidato.alerta_identidad_estado !== 'PENDIENTE';
    return { alertaEstado: 'PENDIENTE', alertaMotivo: motivo, notificar };
  }
  return { alertaEstado: null, alertaMotivo: null, notificar: false };
}

function resolveIdDocsProgress(
  tieneIne: boolean,
  tieneRfc: boolean,
  isAlert: boolean,
  tipo_origen: string
) {
  if (tieneIne && tieneRfc) {
    const resumen = isAlert
      ? 'El candidato completó su INE y RFC (alerta de verificación de identidad pendiente en plataforma). El siguiente paso es agendar la cita.'
      : 'El candidato completó su INE y RFC. El siguiente paso es agendar la cita.';
    return { estado: 'INE_VALIDADA', resumen };
  }
  return {
    estado: undefined,
    resumen: `Candidato entregó documento parcial (${tipo_origen}). Esperando el faltante.`
  };
}

function resolveDocumentStateAndAlerts({
  esCV,
  esINE,
  esConstancia,
  esAmbos,
  esBloqueado,
  esAlertaIdentidad,
  curpIneFormatoInvalido,
  curpRfcFormatoInvalido,
  tipo_origen,
  identidad_motivo,
  newStateValue,
  dbCandidato,
}: {
  esCV: boolean;
  esINE: boolean;
  esConstancia: boolean;
  esAmbos: boolean;
  esBloqueado: boolean;
  esAlertaIdentidad: boolean;
  curpIneFormatoInvalido: boolean;
  curpRfcFormatoInvalido: boolean;
  tipo_origen: string;
  identidad_motivo?: string;
  newStateValue: string;
  dbCandidato: DbCandidato;
}) {
  if (esCV) {
    return {
      // Lo decide la máquina (evento RECIBE_CV): un CV que llega después de los
      // documentos o de la cita ya no regresa al candidato a CV_RECIBIDO.
      estado_final: newStateValue,
      resumen_ia_final: 'CV Recibido y Analizado por Gemini',
      alertaIdentidadEstadoFinal: dbCandidato.alerta_identidad_estado ?? null,
      alertaIdentidadMotivoFinal: dbCandidato.alerta_identidad_motivo ?? null,
      debeNotificarReclutador: false,
    };
  }

  if (esINE || esConstancia || esAmbos || esBloqueado) {
    const curpMalFormada = checkCurpMalFormada(esINE, esConstancia, esAmbos, curpIneFormatoInvalido, curpRfcFormatoInvalido);
    const tieneIne = esINE || esAmbos || !!dbCandidato.datos_ine || !!dbCandidato.curp_ine || !!dbCandidato.nombre_ine;
    const tieneRfc = esConstancia || esAmbos || !!dbCandidato.datos_rfc || !!dbCandidato.curp_rfc || !!dbCandidato.nombre_constancia;
    const isAlert = esBloqueado || curpMalFormada || esAlertaIdentidad;

    const { alertaEstado, alertaMotivo, notificar } = resolveIdAlertState(isAlert, curpMalFormada, identidad_motivo, tipo_origen, dbCandidato);
    const progress = resolveIdDocsProgress(tieneIne, tieneRfc, isAlert, tipo_origen);

    return {
      estado_final: progress.estado || newStateValue,
      resumen_ia_final: progress.resumen,
      alertaIdentidadEstadoFinal: alertaEstado,
      alertaIdentidadMotivoFinal: alertaMotivo,
      debeNotificarReclutador: notificar,
    };
  }

  return {
    estado_final: newStateValue,
    resumen_ia_final: dbCandidato.resumen_ia ?? null,
    alertaIdentidadEstadoFinal: dbCandidato.alerta_identidad_estado ?? null,
    alertaIdentidadMotivoFinal: dbCandidato.alerta_identidad_motivo ?? null,
    debeNotificarReclutador: false,
  };
}

function resolveSafeVacante(vacante: string | undefined, resumen_ia_final: string | null, dbVacanteInteres?: string | null): string {
  const safe_vacante = limpiarVacante(vacante);
  if (esPlaceholderVacante(safe_vacante)) {
    const matchVacanteResumen = /Vacante:\s*([^.\n]+)/i.exec(resumen_ia_final || '');
    if (matchVacanteResumen && !esPlaceholderVacante(matchVacanteResumen[1])) {
      return limpiarVacante(matchVacanteResumen[1]);
    }
    if (!esPlaceholderVacante(dbVacanteInteres)) {
      return limpiarVacante(dbVacanteInteres);
    }
    return '';
  }
  return safe_vacante;
}

function parseDocumentData(datos_documento: unknown, link_cv?: string) {
  let parsedDatos: { nombre_completo?: string; nombre?: string; url?: string; [k: string]: unknown } = {};
  if (typeof datos_documento === 'string') {
    try { parsedDatos = JSON.parse(datos_documento); } catch { parsedDatos = {}; }
  } else if (datos_documento && typeof datos_documento === 'object') {
    parsedDatos = datos_documento as Record<string, unknown>;
  }
  if (parsedDatos && typeof parsedDatos === 'object' && link_cv) {
    parsedDatos.url = link_cv;
  }
  const nombreDocExtrahido = (parsedDatos?.nombre_completo || parsedDatos?.nombre || '').replace(/[\uFE0F\u200B-\u200D\u200E\u200F\uFEFF]/g, '').trim();
  return { parsedDatos, nombreDocExtrahido };
}

function cleanName(nombre: string | undefined, nombreDocExtrahido: string): string {
  const safe_nombre = (nombre || '').replace(/[\uFE0F\u200B-\u200D\u200E\u200F\uFEFF]/g, '').trim();
  if (!safe_nombre || safe_nombre === 'Candidato' || safe_nombre === 'No registrado' || /^\+?\d+$/.test(safe_nombre)) {
    return nombreDocExtrahido || 'Candidato';
  }
  return safe_nombre;
}

function runCandidatoMachine(
  currentState: string,
  dbCandidato: DbCandidato,
  flags: { esBloqueado: boolean; esCV: boolean; esINE: boolean; esConstancia: boolean; esAmbos: boolean }
): string {
  let event: CandidatoEvent | null = null;
  if (flags.esBloqueado) {
    event = { type: 'BLOQUEO_IDENTIDAD' };
  } else if (flags.esCV) {
    event = { type: 'RECIBE_CV' };
  } else if (flags.esINE || flags.esConstancia || flags.esAmbos) {
    event = { type: 'ENTREGA_DOCS' };
  }

  if (!event) return currentState;

  const actor = createActor(candidatoMachine, {
    snapshot: candidatoMachine.resolveState({ value: currentState, context: { ...dbCandidato } }),
  });
  actor.start();
  actor.send(event);
  const snapshot = actor.getSnapshot();
  return snapshot.value as string;
}

async function resolveReclutadorAsignadoId(nombre_reclutador?: string): Promise<string | null> {
  if (!nombre_reclutador) return null;
  const recRes = await pool.query(
    `SELECT id FROM reclutadores WHERE UPPER(nombre) = UPPER($1) AND activo = true LIMIT 1`,
    [nombre_reclutador]
  );
  if (recRes.rowCount && recRes.rowCount > 0) {
    return recRes.rows[0].id;
  }
  return null;
}

/**
 * Aviso por WhatsApp (y campana del CRM) al reclutador cuando la CURP de la
 * INE y la de la Constancia no coinciden. Solo se manda cuando la alerta pasa
 * a PENDIENTE (ver resolveIdAlertState), así que no se repite.
 *
 * Destino: el teléfono que mande el backend, si lo manda; si no, el
 * reclutador asignado al candidato. Sin reclutador con teléfono no hay
 * WhatsApp: la alerta queda en el modal de alertas del CRM.
 */
async function notificarDiscrepanciaIdentidad({
  debeNotificar,
  candidatoId,
  telefono,
  telefono_reclutador,
  alertaIdentidadMotivoFinal,
}: {
  debeNotificar: boolean;
  candidatoId: string | undefined;
  telefono: string;
  telefono_reclutador?: string;
  alertaIdentidadMotivoFinal: string | null;
}) {
  if (!debeNotificar || !candidatoId) return;

  const res = await pool.query(
    `SELECT c.nombre, c.nombre_chat, c.nombre_ine, c.nombre_constancia, c.curp_ine, c.curp_rfc,
            c.vacante_interes, c.nave_interes, r.id AS reclutador_id, r.telefono AS reclutador_telefono
       FROM candidatos c
       LEFT JOIN reclutadores r ON r.id = c.asignado_a_id AND r.activo = TRUE
      WHERE c.id = $1`,
    [candidatoId]
  );
  const c = res.rows[0];
  if (!c) return;
  const destino = telefono_reclutador || c.reclutador_telefono;
  if (!destino) return;

  const digitos = telefono.replace(/\D/g, '');
  const linkPlataforma = process.env.APP_PUBLIC_URL
    ? `\n\n👉 Valídalo o recházalo aquí: ${process.env.APP_PUBLIC_URL.replace(/\/$/, '')}/expedientes?tel=${digitos}`
    : '\n\n👉 Valídalo o recházalo en la plataforma (Expedientes o el aviso de alertas).';

  const mensajeAlerta =
    `⚠️ *Verificación de identidad requerida*\n\n` +
    `👤 *Candidato:* ${c.nombre || c.nombre_chat || 'Sin nombre'}\n` +
    `📱 *WhatsApp:* https://wa.me/${digitos}\n` +
    `💼 *Vacante:* ${c.vacante_interes || 'Sin vacante'}${c.nave_interes ? ` · ${c.nave_interes}` : ''}\n\n` +
    `🪪 *INE:* ${c.nombre_ine || '—'}\n    CURP: ${c.curp_ine || '—'}\n` +
    `🧾 *Constancia:* ${c.nombre_constancia || '—'}\n    CURP: ${c.curp_rfc || '—'}\n\n` +
    `📝 ${alertaIdentidadMotivoFinal || 'La CURP de la INE y la de la Constancia no coinciden.'}` +
    linkPlataforma;

  await enviarNotificacionReclutador(String(destino), mensajeAlerta, c.reclutador_id || null);
}

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

    const { safe_curp_ine, safe_curp_rfc, curpIneFormatoInvalido, curpRfcFormatoInvalido } = validateCurps(curp_ine, curp_rfc);

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
    let dbCandidato: DbCandidato = {
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
    const esBloqueado = identidad_bloqueada === 'true';
    const esAlertaIdentidad = identidad_alerta === 'true';
    const esCV = tipo_origen === 'CV' || tipo_origen === 'SOLICITUD';
    const esINE = tipo_origen === 'INE';
    const esConstancia = ['CONSTANCIA', 'CSF', 'RFC', 'SAT'].includes((tipo_origen || '').toUpperCase());
    const esAmbos = (tipo_origen || '').toUpperCase() === 'AMBOS_DOCS';

    const newStateValue = runCandidatoMachine(currentState, dbCandidato, {
      esBloqueado,
      esCV,
      esINE,
      esConstancia,
      esAmbos,
    });

    const {
      estado_final,
      resumen_ia_final,
      alertaIdentidadEstadoFinal,
      alertaIdentidadMotivoFinal,
      debeNotificarReclutador,
    } = resolveDocumentStateAndAlerts({
      esCV,
      esINE,
      esConstancia,
      esAmbos,
      esBloqueado,
      esAlertaIdentidad,
      curpIneFormatoInvalido,
      curpRfcFormatoInvalido,
      tipo_origen,
      identidad_motivo,
      newStateValue,
      dbCandidato,
    });

    const safe_vacante = resolveSafeVacante(vacante, resumen_ia_final, dbCandidato.vacante_interes);
    const { parsedDatos, nombreDocExtrahido } = parseDocumentData(datos_documento, link_cv);
    const safe_nombre = cleanName(nombre, nombreDocExtrahido);

    // Obtener empresa_id si viene en el payload o resolverlo por el número que recibió el mensaje
    let targetEmpresaId = data.empresa_id || null;
    if (!targetEmpresaId) {
      const resuelto = await resolveEmpresaYGrupo(telefono_destino, 'webhook/expediente');
      targetEmpresaId = resuelto.empresa_id;
    }

    // Resolver reclutador asignado por FK
    const reclutadorAsignadoId = await resolveReclutadorAsignadoId(nombre_reclutador);

    // Construcción del upsert
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
        NULLIF($3, ''),
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN $5 ELSE NULL END,
        $6,
        CASE WHEN $4 IN ('CV', 'SOLICITUD') THEN TRUE ELSE FALSE END,
        $7,
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

    const candidatoIdExpediente = upsertRes.rows[0]?.id;
    if (candidatoIdExpediente) {
      await asignarReclutadorPorVacante(candidatoIdExpediente, safe_vacante, null, targetEmpresaId);
    }

    // `mensaje_usuario` NO se guarda en conversation_history: es una indicación
    // del analizador para el bot ("El candidato acaba de enviar su solicitud…"),
    // no algo que escribió el candidato. Guardarla como role='user' la mostraba
    // en el chat del CRM. El texto real del candidato ya lo guarda el agente.

    // Va después del upsert y de asignarReclutadorPorVacante: lee de la BD
    // las dos CURP y el reclutador ya asignado.
    await notificarDiscrepanciaIdentidad({
      debeNotificar: debeNotificarReclutador,
      candidatoId: candidatoIdExpediente,
      telefono,
      telefono_reclutador,
      alertaIdentidadMotivoFinal,
    });

    return NextResponse.json({ success: true, estado: estado_final });
  } catch (err) {
    console.error('Error procesando webhook de expediente n8n:', err);
    return NextResponse.json({ error: 'Error procesando webhook de expediente' }, { status: 500 });
  }
}
