import { getSession } from '@/lib/auth';
import { conversationEvents, asegurarListener, type ConversationEvent } from '@/lib/realtime';
import { candidatoVisible } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

// ─── GET /api/db/mensajes/stream ──────────────────────────
// Server-Sent Events: reemplaza el polling de 4s del módulo de Mensajes.
// Empuja un evento { tipo, telefono } cada vez que la BD notifica un
// INSERT en conversation_history o un cambio en mensajes_bandeja (ver
// triggers en database_setup.sql + lib/realtime.ts). El cliente decide qué
// refrescar según el teléfono activo -- este endpoint no filtra por
// conversación porque la lista completa (sidebar) también necesita
// enterarse de cualquier cambio.
export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) {
    return new Response('No autorizado', { status: 401 });
  }
  if (session.rol !== 'ROOT' && !session.empresa_id) {
    return new Response('No autorizado', { status: 403 });
  }

  // Solo se reenvían eventos de candidatos de la empresa de la sesión (ROOT ve
  // todos). Los eventos sin teléfono (p. ej. "notificacion") no traen datos,
  // solo avisan que hay que refrescar, así que pasan tal cual.
  // ponytail: cache solo de positivos por conexión; cada evento de otra
  // empresa cuesta un SELECT. Si el tráfico crece, meter empresa_id en el
  // payload del NOTIFY (database_setup.sql) y filtrar sin ir a la BD.
  const visibles = new Set<string>();
  const debeEnviar = async (ev: ConversationEvent): Promise<boolean> => {
    if (session.rol === 'ROOT' || !ev.telefono) return true;
    if (visibles.has(ev.telefono)) return true;
    try {
      if (await candidatoVisible(session, ev.telefono)) {
        visibles.add(ev.telefono);
        return true;
      }
    } catch {
      // ante un error de BD se descarta el evento (falla cerrado)
    }
    return false;
  };

  asegurarListener();

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval>;
  let onEvent: (ev: ConversationEvent) => void;

  const stream = new ReadableStream({
    start(controller) {
      const enviar = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // el stream ya se cerró (cliente se desconectó justo en este instante)
        }
      };

      enviar(': conectado\n\n');

      onEvent = (ev) => {
        void debeEnviar(ev).then((ok) => {
          if (ok) enviar(`data: ${JSON.stringify(ev)}\n\n`);
        });
      };
      conversationEvents.on('event', onEvent);

      // Comentario SSE cada 20s para mantener viva la conexión a través de
      // proxies/balanceadores que cierran conexiones HTTP idle.
      heartbeat = setInterval(() => enviar(': ping\n\n'), 20000);
    },
    cancel() {
      clearInterval(heartbeat);
      conversationEvents.off('event', onEvent);
    },
  });

  request.signal.addEventListener('abort', () => {
    clearInterval(heartbeat);
    if (onEvent) conversationEvents.off('event', onEvent);
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
