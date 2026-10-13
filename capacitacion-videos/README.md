# Videos de Capacitación

Fuentes de los videos del módulo `/capacitacion`. Todo se genera con **un comando** usando el kit
de capacitación (`C:\Users\PC-801\Desktop\Vid`, CLI `training`).

```bash
node C:/Users/PC-801/Desktop/Vid/tools/training-cli/dist/cli.js build --input capacitacion-videos
```

`training build` hace, en orden:

1. Levanta la base **demo** (`setup`) y el frontend demo en http://127.0.0.1:3101 (`server`), si no están corriendo.
2. Por cada lección, recrea la base demo (`beforeLesson`) y reproduce el procedimiento en la app real. Así
   toma las capturas y mide la posición de cada botón.
3. Compara cada captura con la anterior. Si casi no cambió (por ejemplo, la hora), conserva la anterior.
4. Genera la voz (Microsoft Sabina, local) solo de las escenas cuyo texto cambió.
5. Valida y **renderiza solo los videos cuyas entradas cambiaron** (capturas, textos, voz o plantillas).
6. Escribe `frontend/src/lib/capacitacion-videos.json`, que `capacitacion.ts` importa solo: URL, miniatura,
   subtítulos, duración y capítulos.

Opciones:

- `--only mensajes,expedientes`: solo esas lecciones.
- `--force`: vuelve a renderizar aunque nada cambie.
- `--no-capture`: usa las capturas existentes.

Al terminar, el servidor que se haya iniciado se apaga. La base demo queda encendida; se apaga con:

```bash
docker compose -f capacitacion-videos/demo/docker-compose.yml down -v
```

## Archivos

| Ruta | Qué es |
|---|---|
| `training.config.json` | Configuración: URL de la demo, servidor, reset, macros (`login`, `cerrar-avisos`), voz, salida. |
| `<slug>/<slug>.script.json` | **La lección completa**: pasos de captura (`capture`) y escenas del video (`scenes`). El `id` debe ser igual al `slug` de la lección en `capacitacion.ts`. |
| `<slug>/captures/` | Capturas reales y `regions.json`, generados. |
| `<slug>/audio/` | Voz generada, con caché en `narration.json`. Fuera de git; se regenera. |
| `demo/docker-compose.yml`, `demo/seed.sql` | Base demo aislada (puerto 5440) con datos 100 % ficticios. Las cuentas y su contraseña están en el encabezado de `seed.sql`. |
| `demo/dev.mjs` | Frontend contra la base demo, con un WAHA simulado. No usa los secretos de `.env.local` ni toca WhatsApp, el backend ni la base real. |
| `demo/reset.mjs` | Recrea la base demo entre lecciones. |

## Agregar una lección

1. Copia una carpeta existente, por ejemplo `mensajes/`, con el `slug` de la lección (por ejemplo `vacantes/`).
   Cambia `id` y `title`.
2. En `capture`, escribe el procedimiento con pasos:
   - `{ "use": "login" }` inicia sesión con la reclutadora demo.
   - `{ "goto": "/vacantes", "wait": 3000 }`
   - `{ "click": "text=Nueva vacante" }`; los selectores aceptan CSS, `text=…` o `js=…`.
   - `{ "fill": "#campo", "value": "…" }`, `{ "waitFor": "…" }`, `{ "sleep": 1000 }`
   - `{ "eval": "…" }` ejecuta JS en la página; `{ "run": "…" }` ejecuta un comando, por ejemplo SQL en la demo.
   - `{ "shot": "01-listado", "regions": { "nueva": "text=Nueva vacante" } }` toma una captura y mide regiones.
3. En `scenes`, arma el video con las plantillas `intro`, `demo`, `steps`, `result` y `outro`. Los resaltados
   se piden por nombre: `{ "region": "nueva", "label": "Nueva vacante" }`.
4. Si la pantalla necesita más datos ficticios, agrégalos a `demo/seed.sql`.
5. Ejecuta `training build --only vacantes`, revisa el video y corrige lo necesario.
6. Ejecuta `npm run typecheck`, `npm run lint` y `npm test` en `frontend/`.

El editor autocompleta los dos JSON gracias a su `$schema`.

## Marca «BORRADOR»

Con `"status": "draft"` el video lleva la marca «BORRADOR · procedimiento no verificado». Cuando una persona
haya revisado el video contra la app de producción, cambia `status` a `"verified"` y ejecuta `training build`.
