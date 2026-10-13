// Recrea la base DEMO (esquema + seed.sql) para que cada lección se capture desde los
// mismos datos: los clics de una toma (tomar control, validar) cambian registros.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const compose = fileURLToPath(new URL('./docker-compose.yml', import.meta.url));
const sh = (args) => execFileSync('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

sh(['compose', '-f', compose, 'down', '-v']);
sh(['compose', '-f', compose, 'up', '-d']);
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    // La última tabla que llena seed.sql: si ya tiene filas, el seed terminó.
    const n = sh(['exec', 'assistantai-demo-postgres-demo-1', 'psql', '-U', 'demo', '-d', 'virgo_demo', '-tAc', 'select count(*) from notificaciones']);
    if (n.trim() !== '0') process.exit(0);
  } catch {
    // todavía iniciando
  }
}
console.error('La base demo no terminó de iniciar');
process.exit(1);
