import { NextResponse } from 'next/server';

import { pool } from '@/lib/db';
import { verifyInternalApiKey } from '@/lib/auth';
import { WAHA_BASE, WAHA_API_KEY, WAHA_SESSION } from '@/lib/waha';

/**
 * GET /api/cron/process-outbox
 *
 * Reintenta el envio de mensajes atorados en cola_mensajes (outbox pattern).
 * Pensado para ser disparado periodicamente por un Schedule Trigger de n8n
 * (workflow "5_Sofia - Mantenimiento y Errores"), asi los mensajes que no
 * se pudieron enviar por una caida de WAHA/luz se reintentan solos al volver.
 *
 * Acceso publico con API key (header x-api-key) para consumo desde n8n,
 * mismo patron que /api/prompt-context.
 */
export async function GET(request: Request) {
  if (!verifyInternalApiKey(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    // Lote pequeño y espaciado: este endpoint corre cada 2 minutos y antes
    // vaciaba hasta 50 mensajes seguidos, sin pausa entre uno y otro. Esa
    // ráfaga es justo lo que hizo que Meta bloqueara el número de producción
    // -- sobre todo al volver la luz, cuando la cola trae todo lo acumulado.
    // Con 6 por lote y una pausa de ~10 s, salen ~6 mensajes cada 2 minutos.
    // El resto espera al siguiente ciclo: la cola no se pierde, solo se
    // drena despacio.
    const LOTE = Number(process.env.OUTBOX_LOTE || 6);
    const PAUSA_MS = Number(process.env.OUTBOX_PAUSA_MS || 10000);
    const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Solo intentar los que tienen reintentos < 5
    const res = await pool.query(`
      SELECT id, telefono, texto
      FROM cola_mensajes
      WHERE estado = 'PENDIENTE' AND reintentos < 5
      ORDER BY created_at ASC
      LIMIT $1
    `, [LOTE]);

    const mensajes = res.rows;
    if (mensajes.length === 0) {
      return NextResponse.json({ ok: true, msg: 'No hay mensajes pendientes' });
    }

    let enviados = 0;
    let errores = 0;

    for (const [i, msg] of mensajes.entries()) {
      // Pausa ANTES de cada envío salvo el primero, con algo de aleatoriedad:
      // un ritmo exacto delata al bot tanto como no esperar.
      if (i > 0) await dormir(PAUSA_MS + Math.random() * 3000);
      try {
        const wahaRes = await fetch(`${WAHA_BASE}/api/sendText`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': WAHA_API_KEY,
          },
          body: JSON.stringify({
            session: WAHA_SESSION,
            chatId: msg.telefono,
            text: msg.texto,
          }),
        });

        if (wahaRes.ok) {
          await pool.query(`UPDATE cola_mensajes SET estado = 'ENVIADO', updated_at = NOW() WHERE id = $1`, [msg.id]);
          enviados++;
        } else {
          const errText = await wahaRes.text();
          await pool.query(`UPDATE cola_mensajes SET reintentos = reintentos + 1, error_detalle = $1, updated_at = NOW() WHERE id = $2`, [errText, msg.id]);
          errores++;
        }
      } catch (fetchErr: unknown) {
        await pool.query(`UPDATE cola_mensajes SET reintentos = reintentos + 1, error_detalle = $1, updated_at = NOW() WHERE id = $2`, [fetchErr instanceof Error ? fetchErr.message : String(fetchErr), msg.id]);
        errores++;
      }
    }

    return NextResponse.json({
      ok: true,
      procesados: mensajes.length,
      enviados,
      errores
    });
  } catch (err) {
    console.error('Error procesando outbox:', err);
    return NextResponse.json({ error: 'Error procesando la cola de mensajes' }, { status: 500 });
  }
}
