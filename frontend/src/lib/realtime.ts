import { EventEmitter } from "node:events";
import { pool } from "@/lib/db";

// ─── Puente LISTEN/NOTIFY -> SSE ──────────────────────────
// Una sola conexión de Postgres dedicada (por proceso de Next.js) escucha
// los canales que dispara la BD (ver triggers en database_setup.sql) y
// reparte los eventos a todos los clientes SSE conectados via este
// EventEmitter en memoria. Así, sin importar cuántas pestañas del CRM estén
// abiertas, solo se gasta UNA conexión extra al pool -- no una por pestaña,
// que era el riesgo real de dejar el LISTEN suelto en cada request SSE.
export type ConversationEvent = {
  tipo: "mensaje" | "bandeja" | "candidato" | "notificacion";
  telefono?: string;
  /** Solo en tipo "candidato": el cambio tocó alerta_identidad_estado. */
  alerta?: boolean;
};

const globalForRealtime = globalThis as unknown as {
  realtimeEmitter: EventEmitter | undefined;
  realtimeListening: boolean | undefined;
};

export const conversationEvents: EventEmitter =
  globalForRealtime.realtimeEmitter ?? new EventEmitter();
globalForRealtime.realtimeEmitter = conversationEvents;
conversationEvents.setMaxListeners(0);

async function iniciarListener() {
  if (globalForRealtime.realtimeListening) return;
  globalForRealtime.realtimeListening = true;

  const conectar = async () => {
    const client = await pool.connect();
    client.on("notification", (msg) => {
      if (!msg.payload) return;
      try {
        const data = JSON.parse(msg.payload);
        if (msg.channel === "conversation_history_insert" && data.telefono) {
          conversationEvents.emit("event", { tipo: "mensaje", telefono: String(data.telefono) } as ConversationEvent);
        } else if (msg.channel === "mensajes_bandeja_change" && data.telefono) {
          conversationEvents.emit("event", { tipo: "bandeja", telefono: String(data.telefono) } as ConversationEvent);
        } else if (msg.channel === "candidato_change") {
          conversationEvents.emit("event", {
            tipo: "candidato",
            telefono: data.telefono ? String(data.telefono) : undefined,
            alerta: Boolean(data.alerta),
          } as ConversationEvent);
        } else if (msg.channel === "notificacion_change") {
          conversationEvents.emit("event", { tipo: "notificacion" } as ConversationEvent);
        }
      } catch {
        // payload inesperado, se ignora
      }
    });
    client.on("error", () => {
      // Conexión de LISTEN caída (idle timeout, reinicio de Postgres, etc.):
      // se libera y se reintenta para no dejar el push muerto en silencio.
      client.release(true);
      globalForRealtime.realtimeListening = false;
      setTimeout(() => { iniciarListener(); }, 3000);
    });
    await client.query("LISTEN conversation_history_insert");
    await client.query("LISTEN mensajes_bandeja_change");
    // Estos dos canales sustituyen el sondeo de la campana de notificaciones,
    // del tablero de Expedientes y de las alertas de identidad. Si los
    // triggers todavía no están aplicados en la BD, el LISTEN simplemente no
    // recibe nada y cada pantalla sigue viva por su refresco de respaldo.
    await client.query("LISTEN candidato_change");
    await client.query("LISTEN notificacion_change");
  };

  try {
    await conectar();
  } catch {
    globalForRealtime.realtimeListening = false;
    setTimeout(() => { iniciarListener(); }, 3000);
  }
}

// Se arranca perezosamente en el primer suscriptor SSE (no al cargar el
// módulo) para no abrir la conexión si nadie tiene el dashboard abierto.
export function asegurarListener() {
  void iniciarListener();
}
