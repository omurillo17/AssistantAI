import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { pool } from '@/lib/db';

// GET /api/portal/empresas
// Retorna las empresas y naves disponibles para que el candidato seleccione en el portal público.
export async function GET() {
  try {
    const empRes = await pool.query(`
      SELECT id, nombre 
      FROM empresas 
      ORDER BY nombre ASC
    `);

    const navesRes = await pool.query(`
      SELECT id, empresa_id, nombre 
      FROM naves 
      ORDER BY nombre ASC
    `);

    const empresas = empRes.rows.map(emp => ({
      ...emp,
      naves: navesRes.rows.filter(n => n.empresa_id === emp.id)
    }));

    return NextResponse.json({ success: true, empresas });
  } catch (err) {
    console.error('Error en /api/portal/empresas:', err);
    return NextResponse.json({ error: 'Error al consultar empresas' }, { status: 500 });
  }
}
