import { NextResponse } from 'next/server';

import { pool } from '@/lib/db';

const WAHA_BASE = process.env.WAHA_BASE_URL || 'http://localhost:3000';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'virgo_secret_key';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

export async function GET() {
  try {
    // 1. Obtener mensajes pendientes (máximo 50 por lote para no saturar)
    // Solo intentar los que tienen reintentos < 5
    const res = await pool.query(`
      SELECT id, telefono, texto
      FROM cola_mensajes
      WHERE estado = 'PENDIENTE' AND reintentos < 5
      ORDER BY created_at ASC
      LIMIT 50
    `);

    const mensajes = res.rows;
    if (mensajes.length === 0) {
      return NextResponse.json({ ok: true, msg: 'No hay mensajes pendientes' });
    }

    let enviados = 0;
    let errores = 0;

    for (const msg of mensajes) {
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
      } catch (fetchErr: any) {
        await pool.query(`UPDATE cola_mensajes SET reintentos = reintentos + 1, error_detalle = $1, updated_at = NOW() WHERE id = $2`, [fetchErr.message, msg.id]);
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
