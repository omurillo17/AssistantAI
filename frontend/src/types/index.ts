// ─── Shared Types ──────────────────────────────────────────

export type TipoFiltro = "booleano" | "opcion" | "rango_edad" | "texto" | "numero" | "si_no";

export type Filtro = {
  id: string;
  clave: string;
  etiqueta: string;
  tipo: TipoFiltro;
  pregunta: string;
  opciones?: string[];
  valor_requerido?: string;
  edad_min?: number;
  edad_max?: number;
  requiere_si?: boolean;
  activo: boolean;
  es_pregunta_base?: boolean;
};

export type Vacante = {
  id: string;
  nombre: string;
  naves: string[];
  detalles: string;
  activa: boolean;
  funciones?: string;
  palabras_clave?: string;
  filtros?: Filtro[];
};

export type Recruiter = {
  reclutador_id: string;
  nombre: string;
  activo: boolean;
  telefono: string;
  calendar_id: string;
  color: string;
  usuario?: string;
  password?: string;
  vacantes: Vacante[];
};

export type Conversacion = {
  candidato_id: string;
  telefono: string;
  nombre: string;
  estado: string;
  escalado: boolean;
  escalation_reason?: string | null;
  vacante_interes?: string | null;
  nave_interes?: string | null;
  lugar_residencia?: string | null;
  asignado_a_id?: string | null;
  asignado_a_nombre?: string | null;
  mensajes_no_leidos?: number;
  ultimo_mensaje?: string | null;
  ultimo_mensaje_rol?: string;
  ultimo_mensaje_at?: string | null;
  bandeja_activa?: boolean;
};

export type Candidato = {
  id?: string;
  telefono: string;
  nombre: string | null;
  nombre_chat?: string | null;
  nombre_solicitud?: string | null;
  nombre_ine?: string | null;
  nombre_constancia?: string | null;
  estado: string;
  escalado: boolean;
  escalation_reason?: string | null;
  vacante_interes?: string | null;
  nave_interes?: string | null;
  lugar_residencia?: string | null;
  nave_id?: string | null;
  asignado_a_id?: string | null;
  asignado_a_nombre?: string | null;
  correo?: string | null;
  respuestas_filtro?: Record<string, string>;
  fecha_entrevista?: string | null;
  resumen_ia?: string | null;
  motivo_analisis?: string | null;
  veredicto?: string | null;
  tiene_cv?: boolean;
  datos_ine?: Record<string, string> | object | null;
  datos_rfc?: string | null;
  curp_ine?: string | null;
  curp_rfc?: string | null;
  alerta_identidad_estado?: 'PENDIENTE' | 'VALIDADO' | 'RECHAZADO' | null;
  alerta_identidad_motivo?: string | null;
  cv_manual?: Record<string, string> | object | null;
  ultima_interaccion?: string;
  updated_at?: string;
  created_at?: string;
  edad?: string | null;
  privacidad_aceptada?: boolean;
  nombre_confirmado?: boolean;
  link_cv?: string | null;
  filtros_tecnicos?: string | null;
  experiencia?: string | null;
  creator_email?: string;
  es_google_calendar?: boolean;
  reclutador_nombre?: string;
  event_id?: string;
};

export type Mensaje = {
  id?: number;
  role: "user" | "assistant" | "system" | "user_temp" | string;
  content: string;
  message_type?: string | null;
  media_url?: string | null;
  timestamp: string;
};

export type ChatMessage = {
  role: string;
  content: string;
  timestamp: string;
};

export type Toast = {
  msg: string;
  isError: boolean;
};

// ─── Multi-tenant ──────────────────────────────────────────
// Estos tipos describen lo que devuelven /api/db/empresas, /api/db/grupos y
// /api/db/usuarios. Los campos opcionales lo son porque cada endpoint proyecta
// un subconjunto distinto (p.ej. las naves solo vienen anidadas en empresas).

export type Nave = {
  id: string;
  nombre: string;
  rfc?: string;
  ubicacion_maps?: string;
  empresa_id?: string;
  created_at?: string;
};

export type Grupo = {
  id: string;
  nombre: string;
  empresa_id?: string;
  naves_asignadas?: string[];
  telefono_whatsapp?: string;
  created_at?: string;
};

export type Empresa = {
  id: string;
  nombre: string;
  prompt_ia?: string;
  retencion_archivos_dias?: number;
  naves?: Nave[];
  grupos?: Grupo[];
  created_at?: string;
};

export type Usuario = {
  id: number;
  usuario: string;
  rol: string;
  correo?: string | null;
  telefono?: string | null;
  reclutador_id?: string | null;
  grupo_id?: string | null;
  empresa_id?: string | null;
  created_at?: string;
};

export type Notificacion = {
  id: number | string;
  tipo?: string;
  mensaje?: string;
  telefono?: string | null;
  leida?: boolean;
  created_at?: string;
};

/** Reclutadores agrupados que devuelve /api/db/reclutadores?grouped=true */
export type GrupoReclutadores = {
  grupo_nombre?: string;
  empresa_nombre?: string;
  reclutadores?: { id?: string; nombre: string; rol?: string }[];
};

// ─── Constants ─────────────────────────────────────────────

export const COUNTRY_CODES = [
  { code: "52", label: "🇲🇽 +52" }, { code: "1", label: "🇺🇸/🇨🇦 +1" }, { code: "34", label: "🇪🇸 +34" },
  { code: "57", label: "🇨🇴 +57" }, { code: "54", label: "🇦🇷 +54" }, { code: "56", label: "🇨🇱 +56" },
  { code: "93", label: "🇦🇫 +93" }, { code: "355", label: "🇦🇱 +355" }, { code: "213", label: "🇩🇿 +213" },
  { code: "376", label: "🇦🇩 +376" }, { code: "244", label: "🇦🇴 +244" }, { code: "374", label: "🇦🇲 +374" },
  { code: "61", label: "🇦🇺 +61" }, { code: "43", label: "🇦🇹 +43" }, { code: "994", label: "🇦🇿 +994" },
  { code: "973", label: "🇧🇭 +973" }, { code: "880", label: "🇧🇩 +880" }, { code: "375", label: "🇧🇾 +375" },
  { code: "32", label: "🇧🇪 +32" }, { code: "501", label: "🇧🇿 +501" }, { code: "229", label: "🇧🇯 +229" },
  { code: "975", label: "🇧🇹 +975" }, { code: "591", label: "🇧🇴 +591" }, { code: "387", label: "🇧🇦 +387" },
  { code: "267", label: "🇧🇼 +267" }, { code: "55", label: "🇧🇷 +55" }, { code: "673", label: "🇧🇳 +673" },
  { code: "359", label: "🇧🇬 +359" }, { code: "226", label: "🇧🇫 +226" }, { code: "257", label: "🇧🇮 +257" },
  { code: "855", label: "🇰🇭 +855" }, { code: "237", label: "🇨🇲 +237" }, { code: "238", label: "🇨🇻 +238" },
  { code: "236", label: "🇨🇫 +236" }, { code: "235", label: "🇹🇩 +235" }, { code: "86", label: "🇨🇳 +86" },
  { code: "269", label: "🇰🇲 +269" }, { code: "242", label: "🇨🇬 +242" }, { code: "506", label: "🇨🇷 +506" },
  { code: "385", label: "🇭🇷 +385" }, { code: "53", label: "🇨🇺 +53" }, { code: "357", label: "🇨🇾 +357" },
  { code: "420", label: "🇨🇿 +420" }, { code: "45", label: "🇩🇰 +45" }, { code: "253", label: "🇩🇯 +253" },
  { code: "1809", label: "🇩🇴 +1" }, { code: "593", label: "🇪🇨 +593" }, { code: "20", label: "🇪🇬 +20" },
  { code: "503", label: "🇸🇻 +503" }, { code: "240", label: "🇬🇶 +240" }, { code: "291", label: "🇪🇷 +291" },
  { code: "372", label: "🇪🇪 +372" }, { code: "251", label: "🇪🇹 +251" }, { code: "679", label: "🇫🇯 +679" },
  { code: "358", label: "🇫🇮 +358" }, { code: "33", label: "🇫🇷 +33" }, { code: "241", label: "🇬🇦 +241" },
  { code: "220", label: "🇬🇲 +220" }, { code: "995", label: "🇬🇪 +995" }, { code: "49", label: "🇩🇪 +49" },
  { code: "233", label: "🇬🇭 +233" }, { code: "30", label: "🇬🇷 +30" }, { code: "502", label: "🇬🇹 +502" },
  { code: "224", label: "🇬🇳 +224" }, { code: "245", label: "🇬🇼 +245" }, { code: "592", label: "🇬🇾 +592" },
  { code: "509", label: "🇭🇹 +509" }, { code: "504", label: "🇭🇳 +504" }, { code: "36", label: "🇭🇺 +36" },
  { code: "354", label: "🇮🇸 +354" }, { code: "91", label: "🇮🇳 +91" }, { code: "62", label: "🇮🇩 +62" },
  { code: "98", label: "🇮🇷 +98" }, { code: "964", label: "🇮🇶 +964" }, { code: "353", label: "🇮🇪 +353" },
  { code: "972", label: "🇮🇱 +972" }, { code: "39", label: "🇮🇹 +39" }, { code: "225", label: "🇨🇮 +225" },
  { code: "1876", label: "🇯🇲 +1" }, { code: "81", label: "🇯🇵 +81" }, { code: "962", label: "🇯🇴 +962" },
  { code: "7", label: "🇰🇿/🇷🇺 +7" }, { code: "254", label: "🇰🇪 +254" }, { code: "686", label: "🇰🇮 +686" },
  { code: "965", label: "🇰🇼 +965" }, { code: "996", label: "🇰🇬 +996" }, { code: "856", label: "🇱🇦 +856" },
  { code: "371", label: "🇱🇻 +371" }, { code: "961", label: "🇱🇧 +961" }, { code: "266", label: "🇱🇸 +266" },
  { code: "231", label: "🇱🇷 +231" }, { code: "218", label: "🇱🇾 +218" }, { code: "423", label: "🇱🇮 +423" },
  { code: "370", label: "🇱🇹 +370" }, { code: "352", label: "🇱🇺 +352" }, { code: "261", label: "🇲🇬 +261" },
  { code: "265", label: "🇲🇼 +265" }, { code: "60", label: "🇲🇾 +60" }, { code: "960", label: "🇲🇻 +960" },
  { code: "223", label: "🇲🇱 +223" }, { code: "356", label: "🇲🇹 +356" }, { code: "692", label: "🇲🇭 +692" },
  { code: "222", label: "🇲🇷 +222" }, { code: "230", label: "🇲🇺 +230" }, { code: "691", label: "🇫🇲 +691" },
  { code: "373", label: "🇲🇩 +373" }, { code: "377", label: "🇲🇨 +377" }, { code: "976", label: "🇲🇳 +976" },
  { code: "382", label: "🇲🇪 +382" }, { code: "212", label: "🇲🇦 +212" }, { code: "258", label: "🇲🇿 +258" },
  { code: "95", label: "🇲🇲 +95" }, { code: "264", label: "🇳🇦 +264" }, { code: "674", label: "🇳🇷 +674" },
  { code: "977", label: "🇳🇵 +977" }, { code: "31", label: "🇳🇱 +31" }, { code: "64", label: "🇳🇿 +64" },
  { code: "505", label: "🇳🇮 +505" }, { code: "227", label: "🇳🇪 +227" }, { code: "234", label: "🇳🇬 +234" },
  { code: "850", label: "🇰🇵 +850" }, { code: "47", label: "🇳🇴 +47" }, { code: "968", label: "🇴🇲 +968" },
  { code: "92", label: "🇵🇰 +92" }, { code: "680", label: "🇵🇼 +680" }, { code: "507", label: "🇵🇦 +507" },
  { code: "675", label: "🇵🇬 +675" }, { code: "595", label: "🇵🇾 +595" }, { code: "51", label: "🇵🇪 +51" },
  { code: "63", label: "🇵🇭 +63" }, { code: "48", label: "🇵🇱 +48" }, { code: "351", label: "🇵🇹 +351" },
  { code: "974", label: "🇶🇦 +974" }, { code: "40", label: "🇷🇴 +40" }, { code: "250", label: "🇷🇼 +250" },
  { code: "378", label: "🇸🇲 +378" }, { code: "239", label: "🇸🇹 +239" }, { code: "966", label: "🇸🇦 +966" },
  { code: "221", label: "🇸🇳 +221" }, { code: "381", label: "🇷🇸 +381" }, { code: "248", label: "🇸🇨 +248" },
  { code: "232", label: "🇸🇱 +232" }, { code: "65", label: "🇸🇬 +65" }, { code: "421", label: "🇸🇰 +421" },
  { code: "386", label: "🇸🇮 +386" }, { code: "677", label: "🇸🇧 +677" }, { code: "252", label: "🇸🇴 +252" },
  { code: "27", label: "🇿🇦 +27" }, { code: "82", label: "🇰🇷 +82" }, { code: "211", label: "🇸🇸 +211" },
  { code: "94", label: "🇱🇰 +94" }, { code: "249", label: "🇸🇩 +249" }, { code: "597", label: "🇸🇷 +597" },
  { code: "268", label: "🇸🇿 +268" }, { code: "46", label: "🇸🇪 +46" }, { code: "41", label: "🇨🇭 +41" },
  { code: "963", label: "🇸🇾 +963" }, { code: "886", label: "🇹🇼 +886" }, { code: "992", label: "🇹🇯 +992" },
  { code: "255", label: "🇹🇿 +255" }, { code: "66", label: "🇹🇭 +66" }, { code: "228", label: "🇹🇬 +228" },
  { code: "676", label: "🇹🇴 +676" }, { code: "1868", label: "🇹🇹 +1" }, { code: "216", label: "🇹🇳 +216" },
  { code: "90", label: "🇹🇷 +90" }, { code: "993", label: "🇹🇲 +993" }, { code: "688", label: "🇹🇻 +688" },
  { code: "256", label: "🇺🇬 +256" }, { code: "380", label: "🇺🇦 +380" }, { code: "971", label: "🇦🇪 +971" },
  { code: "44", label: "🇬🇧 +44" }, { code: "598", label: "🇺🇾 +598" }, { code: "998", label: "🇺🇿 +998" },
  { code: "678", label: "🇻🇺 +678" }, { code: "58", label: "🇻🇪 +58" }, { code: "84", label: "🇻🇳 +84" },
  { code: "967", label: "🇾🇪 +967" }, { code: "260", label: "🇿🇲 +260" }, { code: "263", label: "🇿🇼 +263" }
];

export const NAVES = ["1", "2", "3"];
