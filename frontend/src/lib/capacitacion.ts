/**
 * Contenido del módulo de Capacitación.
 *
 * Todo el material vive aquí como datos planos para que ampliar el curso sea
 * editar este archivo y no tocar componentes: agregar una lección es agregar un
 * objeto al arreglo `CONTENIDO`.
 *
 * Los videos se generan con `training build` (ver capacitacion-videos/README.md):
 * cada guion cuyo id coincide con el `slug` de una lección escribe en
 * `capacitacion-videos.json` la URL, la miniatura, los subtítulos y los
 * capítulos, y `LECCIONES` los incorpora solo. Una lección sin video generado
 * conserva su `video` de aquí (`url: null` → marcador "video en producción"),
 * o puede apuntar a mano a un mp4 o a un `embed` de YouTube.
 */

import generados from "./capacitacion-videos.json";
import { formatoTiempo } from "./vtt";

export type Rol = "USER" | "ENCARGADO" | "ADMIN" | "ROOT";

export type Bloque =
  | { tipo: "parrafo"; texto: string }
  | { tipo: "lista"; items: string[] }
  | { tipo: "pasos"; items: string[] }
  | { tipo: "nota"; texto: string }
  | { tipo: "aviso"; texto: string }
  /** Tabla de estados generada desde `@/lib/estados` (fuente única de verdad). */
  | { tipo: "estados" }
  | { tipo: "imagen"; src: string | null; titulo: string; pie?: string };

export type Seccion = {
  id: string;
  titulo: string;
  bloques: Bloque[];
};

export type Video = {
  /** Ruta a un mp4 en /public o null mientras no esté grabado. */
  url: string | null;
  /** Alternativa: URL de incrustación (YouTube/Vimeo). Tiene prioridad sobre `url`. */
  embed?: string | null;
  titulo: string;
  duracion?: string;
  /** Miniatura que se muestra antes de reproducir. */
  poster?: string;
  /** Subtítulos WebVTT; la transcripción de la lección se arma con este mismo archivo. */
  subtitulos?: string;
  /** Capítulos navegables: segundo de inicio y título. */
  capitulos?: { inicio: number; titulo: string }[];
};

export type Leccion = {
  slug: string;
  titulo: string;
  resumen: string;
  categoria: Categoria;
  icono: string;
  /** Clase de fondo Tailwind para la portada de la tarjeta. */
  color: string;
  /** Ruta del módulo dentro de la plataforma, si la lección documenta una pantalla. */
  ruta?: string;
  lectura: string;
  /** Si se define, la lección solo se muestra a estos roles. */
  roles?: Rol[];
  video: Video;
  secciones: Seccion[];
};

export type Categoria =
  | "Primeros pasos"
  | "Operación diaria"
  | "Administración"
  | "Referencia";

export const CATEGORIAS: Categoria[] = [
  "Primeros pasos",
  "Operación diaria",
  "Administración",
  "Referencia",
];

const CONTENIDO: Leccion[] = [
  // ─── Primeros pasos ───────────────────────────────────────────────────────
  {
    slug: "primeros-pasos",
    titulo: "Primeros pasos en la plataforma",
    resumen:
      "Cómo iniciar sesión, para qué sirve cada parte de la pantalla y cómo cambiar entre empresas, naves y grupos.",
    categoria: "Primeros pasos",
    icono: "🚀",
    color: "bg-primary",
    lectura: "5 min",
    video: { url: null, titulo: "Recorrido general de la plataforma", duracion: "Próximamente" },
    secciones: [
      {
        id: "acceso",
        titulo: "Iniciar sesión",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Entras con el usuario y la contraseña que te entregó tu encargado. La sesión queda guardada en tu navegador, así que normalmente solo tienes que iniciar sesión una vez al día.",
          },
          {
            tipo: "pasos",
            items: [
              "Abre la dirección de la plataforma que te compartieron.",
              "Escribe tu usuario y contraseña y presiona Entrar.",
              "Si es tu primer ingreso, cambia tu contraseña desde tu nombre en la esquina superior derecha → Cambiar Contraseña.",
            ],
          },
          {
            tipo: "aviso",
            texto:
              "Nunca compartas tu usuario. Todo lo que se hace en la plataforma (tomar un chat, agendar, rechazar a un candidato) queda registrado con el nombre de quien lo hizo.",
          },
        ],
      },
      {
        id: "pantalla",
        titulo: "Las tres zonas de la pantalla",
        bloques: [
          {
            tipo: "lista",
            items: [
              "Barra lateral izquierda: el menú de módulos. Está colapsada por defecto; con la flecha del borde la expandes para ver los nombres.",
              "Barra superior azul: el título de la pantalla en la que estás, el botón Atrás, el selector de empresa/nave, la campana de notificaciones y tu usuario.",
              "Área central: el contenido del módulo, que es donde trabajas.",
            ],
          },
          {
            tipo: "imagen",
            src: null,
            titulo: "Mapa de la pantalla principal",
            pie: "Captura pendiente: barra lateral, barra superior y área de trabajo señaladas.",
          },
        ],
      },
      {
        id: "selector",
        titulo: "El selector de empresa y nave",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Es el botón con el ícono de edificio en la barra superior y es la pieza que más confusión causa al principio: define qué información ves en TODOS los módulos. Si tu bandeja aparece vacía o no encuentras a un candidato, casi siempre es porque estás parado en otra empresa o en otra nave.",
          },
          {
            tipo: "lista",
            items: [
              "Empresa (Todo): ves los candidatos de todas las naves de esa empresa.",
              "Nave: acotas la vista a una sola sucursal o planta.",
              "Grupo: los ADMIN pueden alternar el selector entre Nave y Grupo para ver por grupo de reclutamiento.",
              "Vista Global: solo para ROOT, muestra todas las empresas a la vez.",
            ],
          },
          {
            tipo: "nota",
            texto:
              "El Calendario es la excepción: ahí no aparece el selector, porque cada quien ve automáticamente las citas de su propio grupo.",
          },
        ],
      },
      {
        id: "notificaciones",
        titulo: "Notificaciones",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "La campana se actualiza sola cada pocos segundos. Al hacer clic en una notificación te lleva directo al expediente del candidato relacionado; las de verificación de identidad abren además la ventana de validación de documentos.",
          },
          {
            tipo: "lista",
            items: [
              "El número rojo son las notificaciones sin leer.",
              "Abrir la campana las marca como leídas.",
              "Puedes borrar una con el bote de basura o vaciar todas con Limpiar todas.",
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "como-funciona-virgo",
    titulo: "Cómo funciona el asistente (Sofía)",
    resumen:
      "Qué hace la IA sola por WhatsApp, en qué punto te toca intervenir a ti y qué significa que un chat esté 'escalado'.",
    categoria: "Primeros pasos",
    icono: "🤖",
    color: "bg-info",
    lectura: "6 min",
    video: { url: null, titulo: "El flujo completo: del primer mensaje a la contratación", duracion: "Próximamente" },
    secciones: [
      {
        id: "flujo",
        titulo: "El recorrido de un candidato",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Todo empieza cuando una persona escribe al WhatsApp de reclutamiento. A partir de ahí el asistente trabaja solo hasta donde puede, y la plataforma es tu ventana para ver ese trabajo y tomar el control cuando hace falta.",
          },
          {
            tipo: "pasos",
            items: [
              "El candidato escribe por WhatsApp, el asistente le da la bienvenida, le presenta el aviso de privacidad y le muestra las vacantes disponibles.",
              "Le hace las preguntas de filtro de la vacante que le interesó (edad, licencia, experiencia, disponibilidad, escolaridad).",
              "Le pide sus documentos: CV, INE y constancia de situación fiscal. Los lee automáticamente y extrae los datos.",
              "Compara la CURP del INE contra la de la constancia. Si no coinciden, levanta una alerta de identidad para que un humano la revise.",
              "Si el perfil es viable, le ofrece horarios y agenda la entrevista en el calendario.",
              "Envía el recordatorio de la cita y registra el resultado de la entrevista.",
            ],
          },
        ],
      },
      {
        id: "escalado",
        titulo: "Cuándo entra el humano",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Un chat 'escalado' es un chat donde el bot se calló y espera que respondas tú. Mientras un chat esté escalado el asistente NO contesta nada, aunque el candidato siga escribiendo.",
          },
          {
            tipo: "lista",
            items: [
              "El propio candidato pide hablar con una persona.",
              "El asistente detecta una situación que no sabe resolver.",
              "Tú pulsas Control en la bandeja de Mensajes.",
            ],
          },
          {
            tipo: "aviso",
            texto:
              "Un chat escalado y olvidado es un candidato perdido: nadie le va a contestar automáticamente. Revisa a diario los chats marcados como Humano.",
          },
        ],
      },
      {
        id: "que-no-hace",
        titulo: "Lo que el asistente NO hace",
        bloques: [
          {
            tipo: "lista",
            items: [
              "No contrata: el cambio a CONTRATADO lo haces tú desde el expediente.",
              "No inventa vacantes: solo ofrece las que están activas y con plazas disponibles en el módulo de Vacantes.",
              "No responde en chats escalados hasta que se libere el control.",
              "No valida identidades dudosas por su cuenta: te las manda como alerta.",
            ],
          },
        ],
      },
    ],
  },

  // ─── Operación diaria ─────────────────────────────────────────────────────
  {
    slug: "panel-de-control",
    titulo: "Panel de Control (Inicio)",
    resumen:
      "La pantalla de entrada: accesos a cada módulo y el contador de chats sin leer.",
    categoria: "Operación diaria",
    icono: "🏠",
    color: "bg-slate-600",
    ruta: "/",
    lectura: "2 min",
    video: { url: null, titulo: "Recorrido del Panel de Control", duracion: "Próximamente" },
    secciones: [
      {
        id: "que-es",
        titulo: "Para qué sirve",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Es el tablero de acceso. Cada tarjeta de color abre un módulo, y la tarjeta de Mensajes trae una etiqueta roja con la cantidad de conversaciones activas que tienen mensajes sin leer: es el primer número que deberías mirar al empezar tu turno.",
          },
          {
            tipo: "nota",
            texto:
              "Ese contador ignora los chats descartados (rechazados, inactivos o de otra ciudad), así que solo cuenta trabajo real pendiente.",
          },
        ],
      },
      {
        id: "administracion",
        titulo: "Bloque de administración",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Debajo de las tarjetas de color, los perfiles ADMIN y ROOT ven un segundo bloque con Usuarios (ROOT además ve SaaS Admin). Si no lo ves, es porque tu rol no tiene esos permisos y es normal.",
          },
        ],
      },
    ],
  },
  {
    slug: "mensajes",
    titulo: "Bandeja de Mensajes",
    resumen:
      "La conversación de WhatsApp compartida con la IA: cómo tomar un chat, responder manualmente y devolverle el control al bot.",
    categoria: "Operación diaria",
    icono: "💬",
    color: "bg-success",
    ruta: "/mensajes",
    lectura: "8 min",
    video: { url: null, titulo: "Atender un chat de principio a fin", duracion: "Próximamente" },
    secciones: [
      {
        id: "estructura",
        titulo: "Cómo está organizada",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "A la izquierda la lista de conversaciones y a la derecha el chat. Es la misma conversación real de WhatsApp: lo que escribes aquí le llega a la persona a su teléfono.",
          },
          {
            tipo: "lista",
            items: [
              "Las pestañas de arriba separan Mis Chats (los asignados a ti), General (los que aún no tienen dueño) y Descartados.",
              "En cada conversación de la lista, el prefijo 'Bot:' o 'Tú:' te dice quién mandó el último mensaje.",
              "Los filtros te permiten acotar por vacante y por nave.",
              "El botón Perfil, en el encabezado del chat, abre el expediente completo del candidato.",
            ],
          },
          {
            tipo: "imagen",
            src: "/capacitacion/capturas/mensajes-bandeja.png",
            titulo: "Las dos columnas de la bandeja",
            pie: "Lista de conversaciones a la izquierda y chat a la derecha (datos de demostración).",
          },
        ],
      },
      {
        id: "tomar-control",
        titulo: "Control y Tomar Chat",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Son dos botones distintos y conviene no confundirlos.",
          },
          {
            tipo: "lista",
            items: [
              "Control (botón rojo en el encabezado del chat): silencia al bot en esa conversación y habilita la caja de texto para que escribas tú. El chat pasa a estado Humano.",
              "Tomar Chat (en la franja azul de arriba): te asigna la conversación cuando está en la Bandeja General, es decir, cuando todavía no tiene dueño.",
            ],
          },
          {
            tipo: "pasos",
            items: [
              "Abre la conversación en la lista de la izquierda.",
              "Pulsa Control. La etiqueta cambia de 'Bot' a 'Humano'.",
              "Escribe y envía tus mensajes con normalidad.",
              "Cuando termines, pulsa Al Bot para que el asistente retome el proceso automático.",
            ],
          },
          {
            tipo: "aviso",
            texto:
              "Mientras el chat esté en Humano el asistente no responde. Si dejas el chat tomado y te vas, el candidato se queda sin respuesta.",
          },
        ],
      },
      {
        id: "multimedia",
        titulo: "Audios, fotos y documentos",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Las notas de voz se reproducen dentro del chat y las imágenes y documentos se muestran o se descargan desde ahí mismo. Si aparece el aviso de 'Multimedia recibida', el archivo no se pudo traer y hay que revisarlo directamente en la app de WhatsApp.",
          },
        ],
      },
      {
        id: "buenas-practicas",
        titulo: "Buenas prácticas",
        bloques: [
          {
            tipo: "lista",
            items: [
              "Antes de escribir, lee el historial: la IA probablemente ya preguntó lo que ibas a preguntar.",
              "Si el candidato no aplica, márcalo en su expediente (Descartado o Cartera General) en lugar de solo dejar de responder.",
              "No tomes chats que ya está atendiendo otro reclutador; la plataforma te avisa con el nombre de quien lo tiene.",
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "expedientes",
    titulo: "Expedientes",
    resumen:
      "La base de candidatos: buscar, filtrar, revisar documentos, resolver alertas de identidad y mover el estado.",
    categoria: "Operación diaria",
    icono: "🗂️",
    color: "bg-info",
    ruta: "/expedientes",
    lectura: "7 min",
    video: { url: null, titulo: "Revisar y depurar un expediente", duracion: "Próximamente" },
    secciones: [
      {
        id: "tabla",
        titulo: "La tabla de candidatos",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Cada renglón es una persona que escribió al WhatsApp. Las columnas te muestran el nombre, el teléfono, la vacante y nave a la que aspira, su estado dentro del proceso y qué documentos ya entregó.",
          },
          {
            tipo: "lista",
            items: [
              "Filtros por nave, por vacante y por estado, combinables entre sí.",
              "Los contadores de arriba resumen los chats pendientes y las entrevistas del día.",
              "Al hacer clic en un candidato se abre su expediente completo con CV, INE, RFC y su historial.",
            ],
          },
        ],
      },
      {
        id: "documentos",
        titulo: "Documentos y alertas de identidad",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "El asistente lee automáticamente el CV, la INE y la constancia de situación fiscal. Para verificar que se trata de la misma persona compara la CURP que trae el INE contra la CURP de la constancia; el CV no entra en esa comparación.",
          },
          {
            tipo: "lista",
            items: [
              "Diferencia menor: las CURP se parecen pero no son idénticas, normalmente por la calidad de la foto. Se levanta la alerta, pero el candidato NO se bloquea y puede seguir agendando su entrevista.",
              "CURP totalmente distinta: probablemente son documentos de dos personas. El expediente pasa a Docs No Coinciden, el candidato queda detenido y se le avisa que un reclutador va a revisar.",
            ],
          },
          {
            tipo: "pasos",
            items: [
              "Abre la alerta desde la campana de notificaciones o desde el expediente.",
              "Lee el motivo que muestra la ventana: ahí te dice cuál de los dos casos es y qué CURP leyó de cada documento.",
              "Compara con tus propios ojos los documentos.",
              "Pulsa Validar si es la misma persona, No validar si no lo es, o Revisar después para dejarla pendiente.",
            ],
          },
          {
            tipo: "aviso",
            texto:
              "Validar una identidad es una decisión con consecuencias: desbloquea a esa persona para el resto del proceso. Ante la duda, consulta con tu encargado antes de validar.",
          },
        ],
      },
      {
        id: "estados",
        titulo: "Mover el estado del candidato",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "La IA mueve el estado sola durante la conversación (interesado, CV recibido, cita agendada…), pero los estados del final del proceso los pones tú: ENTREVISTADO, CONTRATADO o RECHAZADO. Consulta el listado completo en la lección de Estados del candidato.",
          },
        ],
      },
    ],
  },
  {
    slug: "vacantes",
    titulo: "Vacantes",
    resumen:
      "Dar de alta plazas, definir los filtros que la IA preguntará y asignar reclutadores.",
    categoria: "Operación diaria",
    icono: "💼",
    color: "bg-secondary",
    ruta: "/vacantes",
    lectura: "6 min",
    video: { url: null, titulo: "Crear una vacante con sus filtros", duracion: "Próximamente" },
    secciones: [
      {
        id: "concepto",
        titulo: "Por qué las vacantes son la pieza clave",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "El asistente solo ofrece vacantes que existan aquí, estén activas y tengan plazas disponibles. Si una vacante no está bien capturada, sencillamente no se le ofrece a nadie por WhatsApp.",
          },
        ],
      },
      {
        id: "filtros",
        titulo: "Los filtros",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Cada filtro es una pregunta que la IA le hará al candidato, con la respuesta que se espera. Si el candidato no cumple, el asistente lo descarta o lo manda a cartera general sin gastarte tiempo.",
          },
          {
            tipo: "lista",
            items: [
              "Género, cuando la plaza lo justifica.",
              "Rango de edad, con mínimo y máximo.",
              "Licencia de chofer vigente (sí / no).",
              "Experiencia previa en el puesto (sí / no).",
              "Disponibilidad de horario, por ejemplo sábados.",
              "Escolaridad mínima.",
            ],
          },
          {
            tipo: "nota",
            texto:
              "Escribe las preguntas como se las dirías a la persona por WhatsApp: el asistente las usa casi tal cual.",
          },
        ],
      },
      {
        id: "reclutadores",
        titulo: "Reclutadores y keywords",
        bloques: [
          {
            tipo: "lista",
            items: [
              "Asigna reclutadores a la vacante para que sus candidatos les lleguen y aparezcan en su vista 'Tus Vacantes'.",
              "Las keywords ayudan al asistente a reconocer cuando alguien pregunta por esa vacante con otras palabras.",
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "calendario",
    titulo: "Calendario de Entrevistas",
    resumen:
      "Ver las citas agendadas por la IA, reagendar, cancelar y bloquear horarios en los que no puedes atender.",
    categoria: "Operación diaria",
    icono: "📅",
    color: "bg-indigo-500",
    ruta: "/calendario",
    lectura: "5 min",
    video: { url: null, titulo: "Reagendar y bloquear horarios", duracion: "Próximamente" },
    secciones: [
      {
        id: "vista",
        titulo: "Qué ves aquí",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Las entrevistas que el asistente agendó por WhatsApp, sincronizadas con Google Calendar. El panel de Próximas Citas es tu agenda inmediata.",
          },
          {
            tipo: "nota",
            texto:
              "Este módulo no tiene selector de empresa: ves automáticamente el calendario de tu grupo. Si no perteneces a ningún grupo, ves todo.",
          },
        ],
      },
      {
        id: "acciones",
        titulo: "Reagendar, cancelar y bloquear",
        bloques: [
          {
            tipo: "lista",
            items: [
              "Reagendar Entrevista: eliges nueva fecha y hora, y al candidato se le avisa por WhatsApp.",
              "Cancelar Entrevista: libera el espacio y notifica la cancelación.",
              "Bloquear Rango de Horario: marcas un rango con un motivo y la IA deja de ofrecer esos huecos. Es la forma correcta de proteger juntas, comidas o días de asueto.",
            ],
          },
          {
            tipo: "aviso",
            texto:
              "Si no bloqueas tus horarios ocupados, la IA los seguirá ofreciendo y te va a agendar candidatos encima.",
          },
        ],
      },
      {
        id: "resumen",
        titulo: "Resumen IA",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Antes de recibir a un candidato puedes leer el resumen que generó el asistente con lo relevante de su conversación y su perfil, para no llegar a la entrevista en frío.",
          },
        ],
      },
    ],
  },
  {
    slug: "dashboards",
    titulo: "Dashboards",
    resumen:
      "Los números del reclutamiento: candidatos, conversión, embudo por estados y actividad por hora.",
    categoria: "Operación diaria",
    icono: "📊",
    color: "bg-primary",
    ruta: "/dashboards",
    lectura: "4 min",
    video: { url: null, titulo: "Leer los indicadores sin perderse", duracion: "Próximamente" },
    secciones: [
      {
        id: "indicadores",
        titulo: "Las tarjetas de arriba",
        bloques: [
          {
            tipo: "lista",
            items: [
              "Candidatos Totales y Nuevos (Hoy): el tamaño del embudo y cuánto entró en el día.",
              "Contratados: los cierres del periodo.",
              "Chats Activos: conversaciones vivas en este momento.",
              "La tasa de conversión (contratados entre candidatos asignados) aparece más abajo, por reclutador y por vacante.",
            ],
          },
        ],
      },
      {
        id: "graficas",
        titulo: "Las gráficas",
        bloques: [
          {
            tipo: "lista",
            items: [
              "Embudo de Reclutamiento y Distribución de Estados: en qué etapa está cada candidato. Al hacer clic en una etapa se listan los candidatos que están ahí.",
              "Pestaña IA Sofía: qué porcentaje de candidatos se atendió sin intervención humana y cuántos chats se escalaron, un buen termómetro de qué tan bien está respondiendo la IA.",
              "Actividad horaria: en qué horas escribe la gente, útil para acomodar turnos.",
            ],
          },
          {
            tipo: "nota",
            texto:
              "Todos los números respetan el selector de empresa/nave de la barra superior. Si un número te parece raro, revisa primero en qué vista estás parado.",
          },
        ],
      },
    ],
  },

  // ─── Administración ───────────────────────────────────────────────────────
  {
    slug: "usuarios",
    titulo: "Gestión de Usuarios",
    resumen:
      "Alta de reclutadores, asignación de naves y grupos, y qué puede hacer cada rol.",
    categoria: "Administración",
    icono: "🔐",
    color: "bg-indigo-500",
    ruta: "/usuarios",
    lectura: "5 min",
    roles: ["ROOT", "ADMIN", "ENCARGADO"],
    video: { url: null, titulo: "Dar de alta a un reclutador", duracion: "Próximamente" },
    secciones: [
      {
        id: "alta",
        titulo: "Crear un usuario",
        bloques: [
          {
            tipo: "pasos",
            items: [
              "Pulsa Nuevo Usuario y captura nombre, usuario y contraseña temporal.",
              "Asígnale su rol.",
              "Asígnale su grupo de reclutamiento: el grupo define qué naves podrá ver.",
              "Entrégale sus datos y pídele que cambie la contraseña en su primer ingreso.",
            ],
          },
          {
            tipo: "aviso",
            texto:
              "El grupo determina qué naves y candidatos puede ver. Un usuario sin grupo puede entrar a una plataforma vacía.",
          },
        ],
      },
      {
        id: "roles",
        titulo: "Los roles",
        bloques: [
          {
            tipo: "lista",
            items: [
              "USER (reclutador): trabaja sus chats, expedientes, vacantes asignadas y calendario.",
              "ENCARGADO: además administra usuarios de su alcance.",
              "ADMIN: administra usuarios y puede filtrar la vista por nave o por grupo.",
              "ROOT: acceso total, incluidos SaaS Admin y el editor del prompt de la IA.",
            ],
          },
        ],
      },
    ],
  },

  // ─── Referencia ───────────────────────────────────────────────────────────
  {
    slug: "estados-candidato",
    titulo: "Estados del candidato",
    resumen:
      "Qué significa cada etiqueta de estado y quién la pone: la IA o tú.",
    categoria: "Referencia",
    icono: "🏷️",
    color: "bg-slate-600",
    lectura: "4 min",
    video: { url: null, titulo: "El embudo explicado", duracion: "Próximamente" },
    secciones: [
      {
        id: "catalogo",
        titulo: "Catálogo completo",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Están en el orden en que ocurren dentro del proceso. La etiqueta de la derecha te dice quién mueve cada uno: la IA sola, tú desde el expediente, o ambos.",
          },
          { tipo: "estados" },
          {
            tipo: "nota",
            texto:
              "Esta tabla se genera desde el catálogo de estados del sistema, así que siempre coincide con lo que ves en Expedientes y Dashboards. Los marcados como Histórico ya no se asignan; solo aparecen en candidatos viejos.",
          },
        ],
      },
      {
        id: "por-que-importa",
        titulo: "Por qué importa mantenerlos al día",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Los estados que pones tú al final del proceso (entrevistado, contratado, descartado) son los que alimentan el embudo y la conversión de los Dashboards. Un candidato que contrataste pero quedó marcado como Cita Agendada hace que tus números se vean peor de lo que son.",
          },
        ],
      },
    ],
  },
  {
    slug: "portal-candidato",
    titulo: "Portal del Candidato",
    resumen:
      "La página pública donde los candidatos suben sus documentos cuando WhatsApp no alcanza.",
    categoria: "Referencia",
    icono: "📤",
    color: "bg-info",
    ruta: "/portal",
    lectura: "3 min",
    video: { url: null, titulo: "Cómo se ve del lado del candidato", duracion: "Próximamente" },
    secciones: [
      {
        id: "que-es",
        titulo: "Para qué existe",
        bloques: [
          {
            tipo: "parrafo",
            texto:
              "Es una página aparte, sin sesión, pensada para el candidato. Se identifica con su teléfono, elige la sucursal y sube su CV, su INE y su constancia de RFC. Los documentos caen directo en su expediente igual que si los hubiera mandado por WhatsApp.",
          },
          {
            tipo: "lista",
            items: [
              "Útil cuando el archivo pesa demasiado para WhatsApp o el envío falló.",
              "Útil cuando el candidato llegó por otro canal y quieres su expediente completo.",
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "problemas-comunes",
    titulo: "Problemas comunes",
    resumen:
      "Lo que más se pregunta: bandejas vacías, chats que no responden y candidatos que no aparecen.",
    categoria: "Referencia",
    icono: "🛟",
    color: "bg-danger",
    lectura: "5 min",
    video: { url: null, titulo: "Diagnóstico rápido en 5 minutos", duracion: "Próximamente" },
    secciones: [
      {
        id: "faq",
        titulo: "Preguntas frecuentes",
        bloques: [
          {
            tipo: "lista",
            items: [
              "No veo ningún candidato: revisa el selector de empresa/nave de la barra superior y quita los filtros de la tabla.",
              "El bot dejó de responderle a un candidato: probablemente el chat está escalado (etiqueta Humano). Contesta tú o devuelve el control al bot.",
              "No puedo escribir en un chat: te falta pulsar Control, o el chat lo está atendiendo otro reclutador.",
              "La IA no ofrece una vacante: verifica que esté activa, con plazas disponibles y asignada a la nave correcta.",
              "La IA agendó encima de mi junta: bloquea ese rango de horario en el Calendario.",
              "No aparecen los mensajes nuevos: recarga la página; si sigue igual, revisa el aviso de conexión de WhatsApp en la parte superior.",
            ],
          },
          {
            tipo: "nota",
            texto:
              "Si el aviso rojo de conexión de WhatsApp aparece en la parte de arriba, ningún mensaje entra ni sale hasta que se restablezca. Avisa a soporte en lugar de seguir intentando.",
          },
        ],
      },
    ],
  },
];

type VideoGenerado = (typeof generados.videos)[keyof typeof generados.videos];
const VIDEOS: Record<string, VideoGenerado | undefined> = generados.videos;

/** Completa la lección con su video generado por `training build`, si existe. */
function conVideo(l: Leccion): Leccion {
  const v = VIDEOS[l.slug];
  if (!v) return l;
  return {
    ...l,
    video: {
      ...l.video,
      url: v.src,
      poster: v.poster,
      subtitulos: v.captions[0]?.src,
      duracion: formatoTiempo(v.durationSec),
      capitulos: v.chapters.map((c) => ({ inicio: c.startSec, titulo: c.title })),
    },
  };
}

export const LECCIONES: Leccion[] = CONTENIDO.map(conVideo);

export function getLeccion(slug: string): Leccion | undefined {
  return LECCIONES.find((l) => l.slug === slug);
}

/** Lecciones visibles para un rol; las que no declaran `roles` son públicas. */
export function leccionesPorRol(rol: string | null): Leccion[] {
  return LECCIONES.filter((l) => !l.roles || l.roles.includes((rol || "USER") as Rol));
}
