// ============================================================
// SISTEMA UNIFICADO DE ESTADOS — Assistant AI / Grupo Virgo
// Fuente única de verdad para todos los estados del candidato
// ============================================================

export type EstadoKey =
  | 'NUEVO'
  | 'INTERESADO'
  | 'CV_RECIBIDO'
  | 'CV_MANUAL'
  | 'FILTROS_COMPLETADOS'
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
  | 'INACTIVO'
  | 'OTRA_CIUDAD';

export type EstadoDef = {
  label: string;
  labelCorto: string;
  color: string;       // text-* tailwind
  bg: string;          // bg-* tailwind
  border: string;      // border-* tailwind
  hex: string;         // Color hexadecimal para gráficos y semaforización
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
    hex: '#6366f1',
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
    hex: '#0ea5e9', // Azul cielo
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
    hex: '#22c55e', // Verde
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
    hex: '#f97316',
    emoji: '📝',
    grupo: 'pipeline',
    asignadoPor: 'bot',
    activo: false, // Feature desactivada — solo histórico
    descripcion: '[Legacy] El bot armó el CV del candidato vía conversación',
  },
  FILTROS_COMPLETADOS: {
    label: 'Filtros Completados',
    labelCorto: 'Filtros ✓',
    color: 'text-teal-600',
    bg: 'bg-teal-100',
    border: 'border-teal-200',
    hex: '#14b8a6',
    emoji: '✅',
    grupo: 'pipeline',
    asignadoPor: 'bot',
    activo: true,
    descripcion: 'El candidato respondió a los filtros obligatorios',
  },
  INE_VALIDADA: {
    label: 'INE Validada',
    labelCorto: 'INE ✓',
    color: 'text-violet-600',
    bg: 'bg-violet-100',
    border: 'border-violet-200',
    hex: '#10b981', // Verde
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
    hex: '#f59e0b',
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
    hex: '#f43f5e',
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
    hex: '#64748b', // Gris
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
    hex: '#d946ef',
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
    hex: '#eab308', // Amarillo
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
    hex: '#059669',
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
    hex: '#15803d',
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
    hex: '#ef4444', // Rojo
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
    hex: '#818cf8',
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
    hex: '#9ca3af',
    emoji: '😴',
    grupo: 'descartado',
    asignadoPor: 'crm',
    activo: true,
    descripcion: 'Candidato abandonó el proceso sin completarlo',
  },
  OTRA_CIUDAD: {
    label: 'Otra Ciudad',
    labelCorto: 'Otra Ciudad',
    color: 'text-purple-700',
    bg: 'bg-purple-100',
    border: 'border-purple-200',
    hex: '#8b5cf6', // Morado
    emoji: '🌆',
    grupo: 'descartado',
    asignadoPor: 'bot',
    activo: true,
    descripcion: 'Candidato descalificado por radicar fuera de Jalisco / ZMG',
  },
};

// ============================================================
// HELPERS
// ============================================================

/** Todos los estados en orden de proceso */
export const ESTADOS_ORDENADOS: EstadoKey[] = [
  'NUEVO', 'INTERESADO', 'CV_RECIBIDO', 'CV_MANUAL', 'FILTROS_COMPLETADOS', 'INE_VALIDADA',
  'CITA_AGENDADA', 'CITA_CANCELADA', 'RECORDATORIO_ENVIADO', 'ESCALADO',
  'DOCUMENTOS_NO_COINCIDEN', 'ENTREVISTADO', 'CONTRATADO',
  'RECHAZADO', 'OTRA_CIUDAD', 'CARTERA_GENERAL', 'INACTIVO',
];

/** Estados que el CRM puede asignar manualmente */
export const ESTADOS_CRM: EstadoKey[] = [
  'CITA_AGENDADA', 'ENTREVISTADO', 'CONTRATADO', 'RECHAZADO', 'OTRA_CIUDAD', 'CARTERA_GENERAL', 'CITA_CANCELADA', 'INACTIVO',
  'INTERESADO', 'ESCALADO', // Para de-escalar manualmente
];

/** Agrupaciones para el embudo de conversión */
export const GRUPOS: Record<GrupoEstado, { label: string; color: string; estados: EstadoKey[] }> = {
  alerta: {
    label: 'Requieren Atención',
    color: 'text-red-500',
    estados: ['ESCALADO', 'DOCUMENTOS_NO_COINCIDEN', 'CITA_CANCELADA'],
  },
  pipeline: {
    label: 'En Proceso',
    color: 'text-blue-600',
    estados: ['NUEVO', 'INTERESADO', 'CV_RECIBIDO', 'CV_MANUAL', 'FILTROS_COMPLETADOS', 'INE_VALIDADA', 'CITA_AGENDADA', 'RECORDATORIO_ENVIADO'],
  },
  exitoso: {
    label: 'Exitosos',
    color: 'text-emerald-600',
    estados: ['ENTREVISTADO', 'CONTRATADO'],
  },
  descartado: {
    label: 'Descartados',
    color: 'text-gray-500',
    estados: ['RECHAZADO', 'OTRA_CIUDAD', 'INACTIVO'],
  },
  pool: {
    label: 'Cartera General',
    color: 'text-indigo-600',
    estados: ['CARTERA_GENERAL'],
  },
};

/** Columnas del Kanban (Alertas y Escalados al Inicio) */
export const KANBAN_COLUMNAS = [
  { key: 'alerta', estados: ['ESCALADO', 'DOCUMENTOS_NO_COINCIDEN', 'CITA_CANCELADA'] as EstadoKey[], label: '🆘 Escalados / Alertas', color: 'border-purple-400' },
  { key: 'pipeline', estados: ['NUEVO', 'INTERESADO'] as EstadoKey[], label: 'Nuevos / Interesados', color: 'border-blue-300' },
  { key: 'cv', estados: ['CV_RECIBIDO', 'CV_MANUAL', 'FILTROS_COMPLETADOS'] as EstadoKey[], label: 'CV / Filtros', color: 'border-cyan-300' },
  { key: 'docs', estados: ['INE_VALIDADA'] as EstadoKey[], label: 'Docs Validados', color: 'border-violet-300' },
  { key: 'cita', estados: ['CITA_AGENDADA'] as EstadoKey[], label: '📅 Cita Agendada', color: 'border-amber-300' },
  { key: 'recordatorio', estados: ['RECORDATORIO_ENVIADO'] as EstadoKey[], label: '🔔 Recordatorio Enviado', color: 'border-yellow-300' },
  { key: 'final', estados: ['ENTREVISTADO', 'CONTRATADO'] as EstadoKey[], label: 'Finalizados / Entrevistados', color: 'border-emerald-300' },
  { key: 'otra_ciudad', estados: ['OTRA_CIUDAD'] as EstadoKey[], label: '🌆 Otra Ciudad', color: 'border-purple-500' },
  { key: 'pool', estados: ['CARTERA_GENERAL', 'RECHAZADO', 'INACTIVO'] as EstadoKey[], label: 'Pool / Cerrados', color: 'border-gray-300' },
];

// ─── ESTADOS PERSONALIZADOS ─────────────────────────────────
// Los crea RH a mano (tabla estados_personalizados, migrations/004). El bot
// no los asigna ni los quita. useEstadosPersonalizados() los carga y los
// registra aquí, para que getEstado/getEstadoColor/columnaKanban los conozcan.

export type EstadoPersonalizado = {
  clave: string;
  nombre: string;
  color: string;
  grupo: GrupoEstado;
  activo: boolean;
};

const personalizados = new Map<string, EstadoPersonalizado>();

export function registrarEstadosPersonalizados(lista: EstadoPersonalizado[]) {
  personalizados.clear();
  lista.forEach((e) => personalizados.set(e.clave, e));
}

/** Los que se pueden asignar (los archivados solo se muestran). */
export function estadosPersonalizadosActivos(): EstadoPersonalizado[] {
  return [...personalizados.values()].filter((e) => e.activo);
}

/** Columna del kanban de un estado; los personalizados van según su grupo. */
export function columnaKanban(estado: string): string | undefined {
  const fija = KANBAN_COLUMNAS.find((col) => col.estados.includes(estado as EstadoKey));
  if (fija) return fija.key;
  const grupo = personalizados.get(estado)?.grupo;
  if (!grupo) return undefined;
  return { alerta: 'alerta', pipeline: 'pipeline', exitoso: 'final', descartado: 'pool', pool: 'pool' }[grupo];
}

/** Obtener definición de un estado (con fallback seguro) */
export function getEstado(key: string): EstadoDef {
  const manual = personalizados.get(key);
  if (manual) {
    return {
      label: manual.nombre,
      labelCorto: manual.nombre,
      color: 'text-slate-700',
      bg: 'bg-slate-100',
      border: 'border-slate-200',
      hex: manual.color,
      emoji: '✋',
      grupo: manual.grupo,
      asignadoPor: 'crm',
      activo: manual.activo,
      descripcion: 'Estado manual: lo asigna una persona; el bot no lo cambia',
    };
  }
  return ESTADOS[key as EstadoKey] ?? {
    label: key,
    labelCorto: key,
    color: 'text-slate-500',
    bg: 'bg-slate-100',
    border: 'border-slate-200',
    hex: '#94a3b8',
    emoji: '❓',
    grupo: 'pipeline',
    asignadoPor: 'bot',
    activo: false,
    descripcion: 'Estado desconocido',
  };
}

/** Obtener el color hexadecimal del estado para gráficos y semaforización */
export function getEstadoColor(keyOrLabel: string): string {
  if (!keyOrLabel) return '#94a3b8';
  const manual = personalizados.get(keyOrLabel);
  if (manual) return manual.color;
  if (ESTADOS[keyOrLabel as EstadoKey]?.hex) {
    return ESTADOS[keyOrLabel as EstadoKey].hex;
  }
  const upper = keyOrLabel.toUpperCase().trim().replace(/\s+/g, '_');
  if (ESTADOS[upper as EstadoKey]?.hex) {
    return ESTADOS[upper as EstadoKey].hex;
  }

  // Búsqueda por coincidencia semántica de texto
  if (upper.includes('DESCART') || upper.includes('RECHAZ')) return '#ef4444'; // descartado = rojo
  if (upper.includes('NO_COINCIDE') || upper.includes('DOC')) return '#eab308'; // docs no coincide = amarillo
  if (upper.includes('INE')) return '#10b981'; // ine validada = verde
  if (upper.includes('RECORDATORIO')) return '#64748b'; // recordatorio = gris
  if (upper.includes('CV')) return '#22c55e'; // cv recibido = verde
  if (upper.includes('INTERES')) return '#0ea5e9'; // interesado = azul cielo
  if (upper.includes('CIUDAD')) return '#8b5cf6'; // otra ciudad = morado
  if (upper.includes('CONTRAT')) return '#15803d';
  if (upper.includes('ENTREVIST')) return '#059669';
  if (upper.includes('CITA')) return '#f59e0b';
  if (upper.includes('FILTRO')) return '#14b8a6';
  if (upper.includes('NUEVO')) return '#6366f1';

  return '#94a3b8';
}

