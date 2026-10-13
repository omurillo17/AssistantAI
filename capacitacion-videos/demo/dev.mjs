// Arranca el frontend contra la base DEMO, aislado de todo servicio real:
//  - DATABASE_URL → Postgres demo (127.0.0.1:5440)
//  - WAHA → simulador local que responde "WORKING" y acepta envíos sin mandar nada
//  - backend Python → dirección inalcanzable (ningún botón de la grabación lo necesita)
// Las variables del proceso tienen prioridad sobre frontend/.env.local, así que
// los secretos reales de ese archivo no se usan.
//
//   node capacitacion-videos/demo/dev.mjs      → http://localhost:3101
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const WAHA_PORT = 3199;
const APP_PORT = 3101;

// Si existe demo/.waha-caida la sesión aparece caída (para capturar el aviso rojo de WhatsApp).
const CAIDA = fileURLToPath(new URL('./.waha-caida', import.meta.url));

createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  // /api/sessions → sesión conectada; cualquier otro endpoint (sendText, avatar…) → OK vacío.
  const status = existsSync(CAIDA) ? 'FAILED' : 'WORKING';
  res.end(req.url?.startsWith('/api/sessions') ? `[{"name":"default","status":"${status}"}]` : '{}');
}).listen(WAHA_PORT, '127.0.0.1');

const env = {
  ...process.env,
  DATABASE_URL: 'postgres://demo:demo-solo-local@127.0.0.1:5440/virgo_demo',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5440',
  DB_NAME: 'virgo_demo',
  DB_USER: 'demo',
  DB_PASSWORD: 'demo-solo-local',
  JWT_SECRET: 'jwt-demo-capacitacion-solo-local-no-secreto',
  APP_PASSWORD: 'demo',
  WAHA_BASE_URL: `http://127.0.0.1:${WAHA_PORT}`,
  WAHA_URL: `http://127.0.0.1:${WAHA_PORT}`,
  WAHA_API_KEY: 'demo',
  WAHA_SESSION: 'default',
  BACKEND_API_BASE: 'http://127.0.0.1:9',
  PYTHON_SERVICE_API_KEY: 'demo',
  INTERNAL_API_KEY: 'demo',
  N8N_SECRET: 'demo',
  N8N_API_KEY: 'demo',
};

const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url));
const next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(APP_PORT), '-H', '127.0.0.1'], {
  cwd: frontend,
  env,
  stdio: 'inherit',
});
next.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => next.kill(sig));
