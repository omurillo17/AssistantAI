import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'virgo_user',
  password: process.env.DB_PASSWORD || 'virgo_password_secure',
  database: process.env.DB_NAME || 'virgo_db',
  port: parseInt(process.env.DB_PORT || '5432'),
});

export async function GET() {
  try {
    const result = await pool.query('SELECT nombre FROM reclutadores WHERE activo = true ORDER BY nombre ASC');
    return NextResponse.json(result.rows.map(row => row.nombre));
  } catch (error) {
    console.error('Error fetching reclutadores:', error);
    return NextResponse.json({ error: 'Failed to fetch reclutadores' }, { status: 500 });
  }
}
