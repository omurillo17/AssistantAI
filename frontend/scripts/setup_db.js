const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'virgo_user',
  password: process.env.DB_PASSWORD || 'virgo_password_secure',
  database: process.env.DB_NAME || 'virgo_db',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function setup() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        usuario VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Check if admin exists
    const res = await pool.query('SELECT * FROM usuarios WHERE usuario = $1', ['admin']);
    if (res.rowCount === 0) {
      // Use fallback password or env app password
      const plainPassword = process.env.APP_PASSWORD || 'virgoadmin';
      const hash = await bcrypt.hash(plainPassword, 10);
      await pool.query('INSERT INTO usuarios (usuario, password_hash) VALUES ($1, $2)', ['admin', hash]);
      console.log('Usuario "admin" creado con exito.');
    } else {
      console.log('Usuario "admin" ya existe.');
    }
  } catch (error) {
    console.error('Error setup DB:', error);
  } finally {
    pool.end();
  }
}

setup();
