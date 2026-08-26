import { describe, it, expect } from "vitest";
import moveDate from "react-big-calendar/lib/utils/move";
import { Views } from "react-big-calendar";
import { addMonths, subMonths, addWeeks, subWeeks, addDays, subDays } from "date-fns";
import { dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { es } from "date-fns/locale";

// La barra de navegación del calendario calcula ella misma la fecha destino y
// se la pasa a react-big-calendar con la acción "DATE". Estas pruebas fijan el
// contrato del que depende esa decisión: que "DATE" respete la fecha recibida
// sin volver a desplazarla.
//
// Antes se mandaba "prev"/"next" (en minúscula, fuera del tipo NavigateAction).
// Funcionaba de rebote, y estas pruebas dejan constancia de por qué no se podía
// simplemente pasar a mayúsculas: "PREV" aplica un salto propio ENCIMA del ya
// calculado, y el calendario avanzaría el doble.

const localizer = dateFnsLocalizer({
  format, parse, startOfWeek, getDay, locales: { es },
});

const base = new Date(2026, 7, 26); // 26 de agosto de 2026
const mover = (vista: string, action: string, date: Date) =>
  moveDate(vista, { action, date, today: base, localizer });

describe("navegación del calendario", () => {
  it('"DATE" usa la fecha calculada tal cual, en cualquier vista', () => {
    expect(mover(Views.MONTH, "DATE", subMonths(base, 1))).toEqual(subMonths(base, 1));
    expect(mover(Views.MONTH, "DATE", addMonths(base, 1))).toEqual(addMonths(base, 1));
    expect(mover(Views.WEEK, "DATE", subWeeks(base, 1))).toEqual(subWeeks(base, 1));
    expect(mover(Views.WEEK, "DATE", addWeeks(base, 1))).toEqual(addWeeks(base, 1));
    expect(mover(Views.DAY, "DATE", subDays(base, 1))).toEqual(subDays(base, 1));
    expect(mover(Views.DAY, "DATE", addDays(base, 1))).toEqual(addDays(base, 1));
  });

  it('"TODAY" vuelve a hoy sin que haya que pasarle fecha', () => {
    expect(mover(Views.MONTH, "TODAY", subMonths(base, 6))).toEqual(base);
  });

  it('"PREV" desplaza por su cuenta: por eso no valía pasar la fecha ya calculada', () => {
    // Si el toolbar mandara "PREV" con la fecha que él mismo restó, el salto se
    // aplicaría dos veces: dos meses en lugar de uno.
    expect(mover(Views.MONTH, "PREV", subMonths(base, 1))).toEqual(subMonths(base, 2));
    expect(mover(Views.MONTH, "NEXT", addMonths(base, 1))).toEqual(addMonths(base, 2));
  });

  it('el "prev" en minúscula de antes daba el mismo resultado que "DATE"', () => {
    // Documenta la equivalencia en la que se apoyaba el código anterior y que
    // permite hacer el cambio sin alterar lo que ve el usuario.
    for (const vista of [Views.MONTH, Views.WEEK, Views.DAY]) {
      const destino = subMonths(base, 1);
      expect(mover(vista, "prev", destino)).toEqual(mover(vista, "DATE", destino));
    }
  });
});
