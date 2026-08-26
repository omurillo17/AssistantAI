// react-big-calendar no publica tipos de sus módulos internos. Solo se importa
// desde las pruebas de navegación del calendario, para comprobar contra la
// librería real cómo trata cada acción (ver calendarioNavegacion.test.ts).
declare module "react-big-calendar/lib/utils/move" {
  import type { NavigateAction, View } from "react-big-calendar";

  export default function moveDate(
    view: View | string,
    opciones: {
      action: NavigateAction | string;
      date: Date;
      today: Date;
      [k: string]: unknown;
    },
  ): Date;
}
