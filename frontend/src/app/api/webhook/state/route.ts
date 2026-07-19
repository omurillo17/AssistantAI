import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { candidatoMachine } from '@/lib/stateMachine';
import { createActor } from 'xstate';

// Webhook endpoint que recibe el update de estado desde n8n
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { telefono, event, eventPayload } = body;

    if (!telefono || !event) {
      return NextResponse.json({ error: 'Falta telefono o event' }, { status: 400 });
    }

    // 1. Obtener estado actual del candidato
    const res = await pool.query('SELECT estado, tiene_cv, cv_manual, fecha_entrevista, privacidad_aceptada, escalado FROM candidatos WHERE telefono = $1', [telefono]);
    
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Candidato no encontrado' }, { status: 404 });
    }

    const candidato = res.rows[0];

    // 2. Inicializar la máquina de estados con el estado actual
    const actor = createActor(candidatoMachine, {
      state: candidato.estado, // Asume que el valor en DB coincide con el ID del estado en la máquina
    });
    actor.start();

    // 3. Enviar el evento
    actor.send({ type: event, ...eventPayload });
    
    const newState = actor.getSnapshot();

    // 4. Actualizar base de datos con el nuevo estado
    await pool.query(
      `UPDATE candidatos 
       SET estado = $1, 
           tiene_cv = $2, 
           cv_manual = $3, 
           fecha_entrevista = $4, 
           privacidad_aceptada = $5, 
           escalado = $6,
           updated_at = NOW()
       WHERE telefono = $7`,
      [
        newState.value, 
        newState.context.tiene_cv, 
        newState.context.cv_manual, 
        newState.context.fecha_entrevista, 
        newState.context.privacidad_aceptada, 
        newState.context.escalado, 
        telefono
      ]
    );

    return NextResponse.json({ success: true, estadoAnterior: candidato.estado, nuevoEstado: newState.value });
  } catch (err) {
    console.error('Error en webhook de estado:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
