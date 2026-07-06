// ============================================================
// SISTEMA UNIFICADO DE ESTADOS — Assistant AI / Grupo Virgo
// Fuente única de verdad para todos los estados del candidato
// ============================================================

export type EstadoKey =
  | 'NUEVO'
  | 'INTERESADO'
  | 'CV_RECIBIDO'
  | 'CV_MANUAL'
  | 'INE_VALIDADA'
  | 'CITA_AGENDADA'
  | 'RECORDATORIO_ENVIADO'
  | 'ESCALADO'
  | 'DOCUMENTOS_NO_COINCIDEN'
  | 'ENTREVISTADO'
  | 'CONTRATADO'
  | 'RECHAZADO'
  | 'CARTERA_GENERAL'
  | 'CITA_CANCELADA'
  | 'INACTIVO';

export type EstadoDef = {
  label: string;
  labelCorto: string;
  color: string;       // text-* tailwind
  bg: string;          // bg-* tailwind
  border: string;      // border-* tailwind
  emoji: string;
  grupo: GrupoEstado;
  asignadoPor: 'bot' | 'crm' | 'ambos';
  activo: boolean;     // false = legacy/histórico
  descripcion: string;
};

export type GrupoEstado = 'pipeline' | 'alerta' | 'exitoso' | 'descartado' | 'pool';

export const ESTADOS: Record<EstadoKey, EstadoDef> = {
  NUEVO: {
    label: 'Nuevo',
    labelCorto: 'Nuevo',
    color: 'text-slate-600',
    bg: 'bg-slate-100',
    border: 'border-slate-200',
    emoji: '🆕',
    grupo: 'pipeline',
    asignadoPor: 'bot',
    activo: true,
    descripcion: 'Primera vez que el candidato escribe al bot',
  },
  INTERESADO: {
    label: 'Interesado',
    labelCorto: 'Interesado',
    color: 'text-blue-600',
    bg: 'bg-blue-100',
    border: 'border-blue-200',
    emoji: '💬',
    grupo: 'pipeline',
    asignadoPor: 'bot',
    activo: true,
    descripcion: 'Aceptó aviso de privacidad o mostró interés en una vacante',
  },
  CV_RECIBIDO: {
    label: 'CV Recibido',
    labelCorto: 'CV',
    color: 'text-cyan-600',
    bg: 'bg-cyan-100',
    border: 'border-cyan-200',
    emoji: '📄',
    grupo: 'pipeline',
    asignadoPor: 'bot',
    activo: true,
    descripcion: 'Envió su CV o solicitud de empleo',
  },
  CV_MANUAL: {
    label: 'Perfil Manual',
    labelCorto: 'Manual',
    color: 'text-orange-600',
    bg: 'bg-orange-100',
    border: 'border-orange-200',
    emoji: '📝',
    grupo: 'pipeline',
    asignadoPor: 'bot',
    activo: false, // Feature desactivada — solo histórico
    descripcion: '[Legacy] El bot armó el CV del candidato vía conversación',
  },
  INE_VALIDADA: {
    label: 'INE Validada',
    labelCorto: 'INE ✓',
    color: 'text-violet-600',
    bg: 'bg-violet-100',
    border: 'border-violet-200',
    emoji: '🪪',
    grupo: 'pipeline',
    asignadoPor: 'bot',
    activo: true,
    descripcion: 'Entregó INE + Constancia Fiscal completos',
  },
  CITA_AGENDADA: {
    label: 'Cita Agendada',
    labelCorto: 'Cita',
    color: 'text-amber-600',
    bg: 'bg-amber-100',
    border: 'border-amber-200',
    emoji: '📅',
    grupo: 'pipeline',
    asignadoPor: 'bot',
    activo: true,
    descripcion: 'Fecha de entrevista confirmada y agendada',
  },
  CITA_CANCELADA: {
    label: 'Cita Cancelada',
    labelCorto: 'Cancelada',
    color: 'text-red-500',
    bg: 'bg-red-50',
    border: 'border-red-200',
    emoji: '🚫',
    grupo: 'alerta',
    asignadoPor: 'ambos',
    activo: true,
    descripcion: 'La entrevista fue cancelada (por el candidato o el reclutador)',
  },
  RECORDATORIO_ENVIADO: {
    label: 'Recordatorio',
    labelCorto: 'Recordatorio',
    color: 'text-yellow-600',
    bg: 'bg-yellow-100',
    border: 'border-yellow-200',
    emoji: '🔔',
    grupo: 'pipeline',
    asignadoPor: 'bot',
    activo: true,
    descripcion: 'Se envió recordatorio de la cita al candidato',
  },
  ESCALADO: {
    label: 'Escalado',
    labelCorto: 'Escalado',
    color: 'text-purple-600',
    bg: 'bg-purple-100',
    border: 'border-purple-200',
    emoji: '🆘',
    grupo: 'alerta',
    asignadoPor: 'bot',
    activo: true,
    descripcion: 'Candidato solicitó hablar con un reclutador humano',
  },
  DOCUMENTOS_NO_COINCIDEN: {
    label: 'Docs No Coinciden',
    labelCorto: 'Doc ⚠',
    color: 'text-red-600',
    bg: 'bg-red-100',
    border: 'border-red-200',
    emoji: '⚠️',
    grupo: 'alerta',
    asignadoPor: 'bot',
    activo: true,
    descripcion: 'INE y Constancia no pertenecen a la misma persona',
  },
  ENTREVISTADO: {
    label: 'Entrevistado',
    labelCorto: 'Entrevistado',
    color: 'text-emerald-600',
    bg: 'bg-emerald-100',
    border: 'border-emerald-200',
    emoji: '🤝',
    grupo: 'exitoso',
    asignadoPor: 'crm',
    activo: true,
    descripcion: 'El reclutador confirma que el candidato asistió a la entrevista',
  },
  CONTRATADO: {
    label: 'Contratado',
    labelCorto: 'Contratado',
    color: 'text-green-700',
    bg: 'bg-green-100',
    border: 'border-green-200',
    emoji: '🎉',
    grupo: 'exitoso',
    asignadoPor: 'crm',
    activo: true,
    descripcion: 'Candidato fue contratado exitosamente',
  },
  RECHAZADO: {
    label: 'Descartado',
    labelCorto: 'Descartado',
    color: 'text-red-700',
    bg: 'bg-red-100',
    border: 'border-red-200',
    emoji: '❌',
    grupo: 'descartado',
    asignadoPor: 'crm',
    activo: true,
    descripcion: 'Candidato descartado del proceso de selección',
  },
  CARTERA_GENERAL: {
    label: 'Cartera General',
    labelCorto: 'Cartera',
    color: 'text-indigo-600',
    bg: 'bg-indigo-100',
    border: 'border-indigo-200',
    emoji: '🗂️',
    grupo: 'pool',
    asignadoPor: 'crm',
    activo: true,
    descripcion: 'Reclutamiento lo mueve al banco de talento para otra vacante',
  },
  INACTIVO: {
    label: 'Inactivo',
    labelCorto: 'Inactivo',
    color: 'text-gray-500',
    bg: 'bg-gray-100',
    border: 'border-gray-200',
    emoji: '😴',
    grupo: 'descartado',
    asignadoPor: 'crm',
    activo: true,
    descripcion: 'Candidato abandonó el proceso sin completarlo',
  },
};

// ============================================================
// HELPERS
// ============================================================

/** Todos los estados en orden de proceso */
export const ESTADOS_ORDENADOS: EstadoKey[] = [
  'NUEVO', 'INTERESADO', 'CV_RECIBIDO', 'CV_MANUAL', 'INE_VALIDADA',
  'CITA_AGENDADA', 'CITA_CANCELADA', 'RECORDATORIO_ENVIADO', 'ESCALADO',
  'DOCUMENTOS_NO_COINCIDEN', 'ENTREVISTADO', 'CONTRATADO',
  'RECHAZADO', 'CARTERA_GENERAL', 'INACTIVO',
];

/** Estados que el CRM puede asignar manualmente */
export const ESTADOS_CRM: EstadoKey[] = [
  'ENTREVISTADO', 'CONTRATADO', 'RECHAZADO', 'CARTERA_GENERAL', 'CITA_CANCELADA', 'INACTIVO',
  'INTERESADO', 'ESCALADO', // Para de-escalar manualmente
];

/** Agrupaciones para el embudo de conversión */
export const GRUPOS: Record<GrupoEstado, { label: string; color: string; estados: EstadoKey[] }> = {
  pipeline: {
    label: 'En Proceso',
    color: 'text-blue-600',
    estados: ['NUEVO', 'INTERESADO', 'CV_RECIBIDO', 'CV_MANUAL', 'INE_VALIDADA', 'CITA_AGENDADA', 'RECORDATORIO_ENVIADO'],
  },
  alerta: {
    label: 'Requieren Atención',
    color: 'text-red-500',
    estados: ['ESCALADO', 'DOCUMENTOS_NO_COINCIDEN', 'CITA_CANCELADA'],
  },
  exitoso: {
    label: 'Exitosos',
    color: 'text-emerald-600',
    estados: ['ENTREVISTADO', 'CONTRATADO'],
  },
  descartado: {
    label: 'Descartados',
    color: 'text-gray-500',
    estados: ['RECHAZADO', 'INACTIVO'],
  },
  pool: {
    label: 'Cartera General',
    color: 'text-indigo-600',
    estados: ['CARTERA_GENERAL'],
  },
};

/** Columnas del Kanban */
export const KANBAN_COLUMNAS = [
  { key: 'pipeline', estados: ['NUEVO', 'INTERESADO'] as EstadoKey[], label: 'Nuevos / Interesados', color: 'border-blue-300' },
  { key: 'cv', estados: ['CV_RECIBIDO', 'CV_MANUAL'] as EstadoKey[], label: 'CV / Perfil', color: 'border-cyan-300' },
  { key: 'docs', estados: ['INE_VALIDADA', 'DOCUMENTOS_NO_COINCIDEN'] as EstadoKey[], label: 'Documentos', color: 'border-violet-300' },
  { key: 'cita', estados: ['CITA_AGENDADA', 'RECORDATORIO_ENVIADO'] as EstadoKey[], label: 'Cita Agendada', color: 'border-amber-300' },
  { key: 'alerta', estados: ['ESCALADO', 'CITA_CANCELADA'] as EstadoKey[], label: 'Escalados / Alertas', color: 'border-purple-300' },
  { key: 'final', estados: ['ENTREVISTADO', 'CONTRATADO'] as EstadoKey[], label: 'Finalizados', color: 'border-emerald-300' },
  { key: 'pool', estados: ['CARTERA_GENERAL', 'RECHAZADO', 'INACTIVO'] as EstadoKey[], label: 'Pool / Cerrados', color: 'border-gray-300' },
];

/** Obtener definición de un estado (con fallback seguro) */
export function getEstado(key: string): EstadoDef {
  return ESTADOS[key as EstadoKey] ?? {
    label: key,
    labelCorto: key,
    color: 'text-slate-500',
    bg: 'bg-slate-100',
    border: 'border-slate-200',
    emoji: '❓',
    grupo: 'pipeline',
    asignadoPor: 'bot',
    activo: false,
    descripcion: 'Estado desconocido',
  };
}
