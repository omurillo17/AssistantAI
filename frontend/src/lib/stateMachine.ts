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
          RECIBE_CV: {
            target: 'CV_RECIBIDO',
            actions: 'setTieneCV',
          },
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
      setEscalado: assign({ escalado: true }),
    },
  }
);
