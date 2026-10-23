import { createMachine, assign } from 'xstate';

// Definición del contexto que usará la máquina
export interface CandidatoContext {
  telefono: string;
  tiene_cv: boolean;
  cv_manual: boolean;
  fecha_entrevista: string | null;
  privacidad_aceptada: boolean;
  escalado: boolean;
}

// Eventos que pueden disparar transiciones
export type CandidatoEvent =
  | { type: 'INTERES' }
  | { type: 'RECIBE_CV' }
  | { type: 'LLENA_CV_MANUAL' }
  | { type: 'ENTREGA_DOCS' }
  | { type: 'BLOQUEO_IDENTIDAD' }
  | { type: 'AGENDA_CITA'; fecha: string }
  | { type: 'CANCELA_CITA' }
  | { type: 'ESCALA_HUMANO' }
  | { type: 'RECHAZA' }
  | { type: 'CONTRATA' }
  | { type: 'ASISTE_ENTREVISTA' };

export const candidatoMachine = createMachine(
  {
    id: 'candidato',
    initial: 'NUEVO',
    types: {} as {
      context: CandidatoContext;
      events: CandidatoEvent;
    },
    context: {
      telefono: '',
      tiene_cv: false,
      cv_manual: false,
      fecha_entrevista: null,
      privacidad_aceptada: false,
      escalado: false,
    },
    states: {
      NUEVO: {
        on: {
          INTERES: 'INTERESADO',
          RECIBE_CV: {
            target: 'CV_RECIBIDO',
            actions: 'setTieneCV',
          },
          LLENA_CV_MANUAL: {
            target: 'CV_MANUAL',
            actions: 'setCvManual',
          },
          ENTREGA_DOCS: 'INE_VALIDADA',
          AGENDA_CITA: {
            target: 'CITA_AGENDADA',
            actions: 'setFechaEntrevista',
          },
          ESCALA_HUMANO: {
            target: 'ESCALADO',
            actions: 'setEscalado',
          },
        },
      },
      INTERESADO: {
        on: {
          RECIBE_CV: {
            target: 'CV_RECIBIDO',
            actions: 'setTieneCV',
          },
          LLENA_CV_MANUAL: {
            target: 'CV_MANUAL',
            actions: 'setCvManual',
          },
          ENTREGA_DOCS: 'INE_VALIDADA',
          AGENDA_CITA: {
            target: 'CITA_AGENDADA',
            actions: 'setFechaEntrevista',
          },
          ESCALA_HUMANO: {
            target: 'ESCALADO',
            actions: 'setEscalado',
          },
        },
      },
      CV_RECIBIDO: {
        on: {
          ENTREGA_DOCS: 'INE_VALIDADA',
          AGENDA_CITA: {
            target: 'CITA_AGENDADA',
            actions: 'setFechaEntrevista',
          },
          ESCALA_HUMANO: {
            target: 'ESCALADO',
            actions: 'setEscalado',
          },
        },
      },
      CV_MANUAL: {
        on: {
          ENTREGA_DOCS: 'INE_VALIDADA',
          AGENDA_CITA: {
            target: 'CITA_AGENDADA',
            actions: 'setFechaEntrevista',
          },
          ESCALA_HUMANO: {
            target: 'ESCALADO',
            actions: 'setEscalado',
          },
        },
      },
      INE_VALIDADA: {
        on: {
          ENTREGA_DOCS: 'INE_VALIDADA',
          AGENDA_CITA: {
            target: 'CITA_AGENDADA',
            actions: 'setFechaEntrevista',
          },
          ESCALA_HUMANO: {
            target: 'ESCALADO',
            actions: 'setEscalado',
          },
        },
      },
      CITA_AGENDADA: {
        on: {
          ASISTE_ENTREVISTA: 'ENTREVISTADO',
          CANCELA_CITA: {
            target: 'CITA_CANCELADA',
            actions: 'limpiarFechaEntrevista',
          },
          ESCALA_HUMANO: {
            target: 'ESCALADO',
            actions: 'setEscalado',
          },
        },
      },
      // El backend ya escribía 'CITA_CANCELADA' en candidatos.estado al borrar
      // el evento (ver backend/app/routers/eventos_calendario.py), pero el
      // estado no existía aquí: `resolveState` reventaba con ese valor y TODOS
      // los mensajes siguientes de ese candidato devolvían HTTP 500 en
      // /api/webhook/n8n-incoming, dejando su expediente congelado. Cancelar
      // no es escalar: el candidato sigue conversando y puede reagendar.
      CITA_CANCELADA: {
        on: {
          AGENDA_CITA: {
            target: 'CITA_AGENDADA',
            actions: 'setFechaEntrevista',
          },
          ENTREGA_DOCS: 'INE_VALIDADA',
          // Sin RECIBE_CV: ya entregó documentos; un CV tardío no lo regresa.
          ESCALA_HUMANO: {
            target: 'ESCALADO',
            actions: 'setEscalado',
          },
        },
      },
      RECORDATORIO_ENVIADO: {
        on: {
          ASISTE_ENTREVISTA: 'ENTREVISTADO',
          AGENDA_CITA: {
            target: 'CITA_AGENDADA',
            actions: 'setFechaEntrevista',
          },
          CANCELA_CITA: {
            target: 'CITA_CANCELADA',
            actions: 'limpiarFechaEntrevista',
          },
          ESCALA_HUMANO: {
            target: 'ESCALADO',
            actions: 'setEscalado',
          },
        },
      },
      ENTREVISTADO: {
        on: {
          CONTRATA: 'CONTRATADO',
          RECHAZA: 'RECHAZADO',
          ESCALA_HUMANO: {
            target: 'ESCALADO',
            actions: 'setEscalado',
          },
        },
      },
      ESCALADO: {
        on: {
          // Desde escalado, el reclutador puede regresarlo a flujo normal
          AGENDA_CITA: {
            target: 'CITA_AGENDADA',
            actions: 'setFechaEntrevista',
          },
        },
      },
      DOCUMENTOS_NO_COINCIDEN: {
        on: {
          ENTREGA_DOCS: 'INE_VALIDADA',
          // Sin RECIBE_CV: debe reenviar documentos; mandar un CV no borra la discrepancia.
          ESCALA_HUMANO: {
            target: 'ESCALADO',
            actions: 'setEscalado',
          },
        },
      },
      CARTERA_GENERAL: {
        on: {
          RECIBE_CV: {
            target: 'CV_RECIBIDO',
            actions: 'setTieneCV',
          },
          AGENDA_CITA: {
            target: 'CITA_AGENDADA',
            actions: 'setFechaEntrevista',
          },
          ESCALA_HUMANO: {
            target: 'ESCALADO',
            actions: 'setEscalado',
          },
        },
      },
      INACTIVO: {
        on: {
          INTERES: 'INTERESADO',
          RECIBE_CV: {
            target: 'CV_RECIBIDO',
            actions: 'setTieneCV',
          },
        },
      },
      CONTRATADO: {
        type: 'final',
      },
      RECHAZADO: {
        type: 'final',
      },
    },
  },
  {
    actions: {
      setTieneCV: assign({ tiene_cv: true }),
      setCvManual: assign({ cv_manual: true }),
      setFechaEntrevista: assign({
        fecha_entrevista: ({ event }) => {
          if (event.type === 'AGENDA_CITA') return event.fecha;
          return null;
        },
      }),
      limpiarFechaEntrevista: assign({ fecha_entrevista: null }),
      setEscalado: assign({ escalado: true }),
    },
  }
);

/**
 * Nombres de estado que `candidatoMachine.resolveState` acepta. Se deriva de
 * la propia máquina a propósito: una lista escrita a mano se desincroniza al
 * agregar estados, y pasar un valor que no está aquí hace que resolveState
 * lance (ver el guard en /api/webhook/n8n-incoming).
 */
export const ESTADOS_VALIDOS: ReadonlySet<string> = new Set(
  Object.keys(candidatoMachine.states)
);
