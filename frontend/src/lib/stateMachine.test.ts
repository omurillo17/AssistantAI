import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { candidatoMachine } from "@/lib/stateMachine";

const CTX = { telefono: "1", tiene_cv: false, cv_manual: false, fecha_entrevista: null, privacidad_aceptada: true, escalado: false };

function recibeCv(desde: string): string {
  const actor = createActor(candidatoMachine, { snapshot: candidatoMachine.resolveState({ value: desde, context: CTX }) });
  actor.start();
  actor.send({ type: "RECIBE_CV" });
  return String(actor.getSnapshot().value);
}

describe("RECIBE_CV", () => {
  it("avanza a CV_RECIBIDO al inicio del proceso", () => {
    expect(recibeCv("INTERESADO")).toBe("CV_RECIBIDO");
  });

  it.each(["INE_VALIDADA", "CITA_AGENDADA", "CITA_CANCELADA", "DOCUMENTOS_NO_COINCIDEN"])(
    "no regresa a quien ya va en %s",
    (estado) => {
      expect(recibeCv(estado)).toBe(estado);
    }
  );
});
