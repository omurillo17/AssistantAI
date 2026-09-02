/**
 * Capa de compatibilidad retrocompatible.
 * Re-exporta las funciones centralizadas de `messagingService.ts`.
 */

export {
  WAHA_BASE,
  WAHA_API_KEY,
  WAHA_SESSION,
  enviarMensajeDirecto,
  enviarImagenDirecta,
  enviarNotificacionReclutador,
  enviarMensajeCandidato,
  enviarImagenCandidato,
} from '@/lib/messagingService';
