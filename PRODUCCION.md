# Guía de puesta en producción — AssistantAI (Virgo)

Pasos **manuales** que no se pueden automatizar desde el repo. Hazlos en orden;
el bloque 1 es el más importante y el que más silenciosamente rompe todo.

> **Para desplegar cambios de código no hace falta nada de esto.** El flujo es:
> desarrollas en tu equipo, commiteas y empujas a GitHub; aquí, en la máquina de
> producción, ejecutas `./scripts/deploy.sh`. El script trae la rama de
> producción (`develop`), verifica el código, aplica las migraciones pendientes,
> reconstruye, y comprueba que todo arranca — si no, devuelve el frontend a la
> imagen anterior. Lo de abajo son los ajustes de servicios externos (Google,
> Cloudflare, WhatsApp) que se hacen una vez.

---

## 1. Publicar la app de Google (⚠️ crítico)

**Por qué:** mientras la pantalla de consentimiento OAuth siga en modo
*Testing*, Google **caduca los refresh tokens a los 7 días**. Cuando eso pasa,
`revisar_calendario` y `crear_evento` empiezan a fallar para **todos** los
reclutadores a la vez y ningún candidato puede agendar. No hay aviso previo:
un lunes simplemente deja de funcionar.

### Pasos

1. Entra a <https://console.cloud.google.com/> con la cuenta dueña del proyecto.
2. Arriba a la izquierda, selecciona el proyecto correcto (el que tiene el
   OAuth Client ID que está en `GOOGLE_OAUTH_CLIENT_ID` del `.env`).
3. Menú ☰ → **APIs y servicios** → **Pantalla de consentimiento de OAuth**.
4. Mira **Estado de publicación**:
   - Si dice **"En producción"** → ya está, salta al bloque 2.
   - Si dice **"Prueba" / "Testing"** → continúa.
5. Revisa que estos campos estén completos (Google los exige para publicar):
   - Nombre de la aplicación (ej. `Virgo Reclutamiento`)
   - Correo de asistencia al usuario
   - Correo de contacto del desarrollador
   - Dominio de la app (si tienes uno)
6. Pulsa **PUBLICAR APLICACIÓN** y confirma.

### ¿Me va a pedir verificación de Google?

Depende del scope. El proyecto usa `https://www.googleapis.com/auth/calendar`,
que Google clasifica como **sensible**. Dos escenarios:

- **Uso interno de la organización:** si las cuentas de los reclutadores son de
  Google Workspace del mismo dominio, en el paso 3 elige **Tipo de usuario:
  Interno**. No requiere verificación y los tokens no caducan. Es la mejor
  opción si aplica.
- **Cuentas Gmail normales** (es tu caso hoy: `@gmail.com`): el tipo es
  **Externo**. Al publicar te aparecerá el aviso de verificación pendiente.
  Puedes publicar igual: la app queda usable, mostrando una pantalla de
  "Google no ha verificado esta aplicación" en la que el reclutador debe pulsar
  **Configuración avanzada → Ir a (app)**. Con eso el token deja de caducar
  cada 7 días. La verificación formal solo hace falta para quitar esa pantalla.

> Recomendación: si puedes mover los calendarios a cuentas de Google Workspace
> del dominio de la empresa, hazlo — evita la pantalla de advertencia y el
> trámite de verificación por completo.

### Cómo confirmar que quedó bien

Una semana después, si el agendamiento sigue funcionando sin volver a
autorizar, quedó bien. Para no esperar a ciegas, el sistema ahora te avisa
solo: si un token se revoca, el reclutador recibe un WhatsApp de alerta
(*"Google revocó el permiso del calendario..."*).

---

## 2. Autorizar los calendarios de los reclutadores

Uno por reclutador, **una sola vez** (salvo que revoquen el acceso).

```bash
cd backend
python -m scripts.authorize_recruiter --email CORREO_DEL_RECLUTADOR
```

Requiere en el `.env` de la raíz: `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`.

Se abre el navegador: hay que iniciar sesión **con la cuenta de ese
reclutador** y aceptar. El refresh token queda cifrado en la tabla
`google_calendar_credentials`.

### Pendiente ahora mismo

`rhumanossdvirgo@gmail.com` (**SRA PATY**) nunca se autorizó. Está
**desactivada** en la tabla `reclutadores` para que el sistema no le asigne
candidatos que luego no podría agendar. Cuando tengas acceso a ese correo:

```bash
cd backend
python -m scripts.authorize_recruiter --email rhumanossdvirgo@gmail.com
```

y luego reactívala desde el panel de usuarios, o directo en la base:

```sql
UPDATE reclutadores SET activo = true
WHERE calendar_id = 'rhumanossdvirgo@gmail.com';
```

### Verificar quién está autorizado

```sql
SELECT calendar_id, authorized_by, updated_at FROM google_calendar_credentials;
```

---

## 3. Backups de PostgreSQL

Hoy **no hay ninguno configurado**. Toda la operación (candidatos, expedientes,
credenciales de calendario) vive en un solo contenedor.

### Respaldo y Restauración Automatizados

El proyecto cuenta con scripts automáticos en `scripts/`:

1. **Ejecutar respaldo manual**:
   ```bash
   ./scripts/backup.sh
   ```
   Genera dump comprimido de PostgreSQL (`db_virgo_db_*.sql.gz`) y copia de archivos de candidatos (`uploads_*.tar.gz`) en `/home/sdvirgo/backups/assistantai/`, verifica la integridad (`gzip -t`) y rota respaldos con más de 14 días.

2. **Automatización en producción (Crontab Linux)**:
   Programado diariamente a las 03:00 AM en el usuario `sdvirgo`:
   ```bash
   0 3 * * * /home/sdvirgo/proyectos/AssistantAI/scripts/backup.sh >/dev/null 2>&1
   ```

3. **Restaurar respaldo**:
   ```bash
   ./scripts/restore.sh /home/sdvirgo/backups/assistantai/db_virgo_db_YYYY-MM-DD_HHMMSS.sql.gz
   ```
   El script solicita confirmación explícita escribiendo `RESTAURAR` para evitar accidentes en producción.

> Guarda periódicamente una copia **fuera** de este equipo (disco externo, nube, otro servidor) para proteger contra desastres a nivel de hardware.

---

## 4. Antes de exponer el servidor a internet

Ya se cerraron los puertos en `docker-compose.yml`: Postgres, WAHA y el backend
solo escuchan en `127.0.0.1`. Aplica el cambio con:

```bash
docker compose up -d
```

Verifica que quedaron en loopback (deben decir `127.0.0.1:...`, no `0.0.0.0:...`):

```bash
docker ps --format "{{.Names}}\t{{.Ports}}"
```

Lo único que debe quedar accesible desde fuera es el frontend Next.js, y de
preferencia detrás de un proxy inverso con HTTPS (Nginx, Caddy o Cloudflare
Tunnel). **No publiques el puerto 3000 de WAHA**: ahí vive la sesión de
WhatsApp y quien llegue a ese panel puede secuestrarla. Si necesitas abrir el
dashboard de WAHA desde otra máquina, usa un túnel SSH:

```bash
ssh -L 3000:localhost:3000 usuario@servidor
```

### Variables que deben estar puestas en el servidor

| Variable | Dónde | Para qué |
| --- | --- | --- |
| `INTERNAL_API_KEY` | `.env` y `frontend/.env.local` | Autentica backend → frontend. **Si falta, los webhooks quedan abiertos.** |
| `JWT_SECRET` | `frontend/.env.local` | Sesiones del CRM. Debe ser largo y aleatorio. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | `.env` | Cifra los refresh tokens. **Si se pierde, hay que volver a autorizar a todos.** |
| `WAHA_API_KEY` | `.env` | Protege la API de WhatsApp. |
| `GEMINI_API_KEY` | `.env` | Modelo de IA. |

Genera secretos así:

```bash
# JWT_SECRET / INTERNAL_API_KEY
python -c "import secrets; print(secrets.token_urlsafe(48))"

# GOOGLE_TOKEN_ENCRYPTION_KEY (formato Fernet, 44 chars)
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

> Guarda `GOOGLE_TOKEN_ENCRYPTION_KEY` en un gestor de contraseñas. Sin ella los
> tokens guardados son irrecuperables.

---

## 5. Desplegar cambios

```bash
git pull
docker compose up -d --build          # reconstruye backend con el código nuevo
cd frontend && npm ci && npm run build && npm start
```

Si el esquema cambió, aplica lo nuevo de `virgo_data/scripts/database_setup.sql`
sobre la base existente. Las sentencias usan `IF NOT EXISTS`, pero las columnas
agregadas después hay que añadirlas a mano, por ejemplo:

```sql
ALTER TABLE vacantes_def ADD COLUMN IF NOT EXISTS funciones TEXT DEFAULT '';
```

### Correr los tests antes de desplegar

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
pytest
```

```bash
cd frontend
npm run typecheck
```

---

## 6. Revisión rápida cuando algo falla

| Síntoma | Dónde mirar |
| --- | --- |
| El bot no contesta | `docker logs assistantai-backend-1 --tail 100` |
| "Tuvimos un inconveniente técnico" al agendar | Busca `_ejecutar_tool: fallo en` en los logs. El reclutador también recibió un WhatsApp con la causa. |
| El bot no ve una vacante nueva | Guarda la vacante otra vez en el panel: eso regenera `virgo_data/data/prompt_context.json`. |
| Un cambio del prompt no surte efecto | Igual que arriba; el bot lee `prompt_context.json`, no el `.md` directo. |
| WhatsApp desconectado | Abre el panel de WAHA por túnel SSH y reescanea el QR. |

---

## Estado conocido al momento de escribir esta guía

- ✅ Contraseñas en texto plano eliminadas de `usuarios`
- ✅ `INTERNAL_API_KEY` configurada — webhooks autenticados
- ✅ Puertos de Postgres/WAHA/backend en loopback
- ✅ Alertas por WhatsApp cuando falla una herramienta del agente
- ✅ 29 tests de regresión del flujo de agendamiento
- ✅ Prompt de Sofía (`chat_prompt.md`): ya no manda "Actividades a realizar"
  en vacantes sin ese bloque, ya no infiere respuestas de filtros (Sí/No)
  a partir del CV sin preguntarlas, y ya no deja un turno sin mensaje tras
  la última pregunta de filtro
- ✅ Módulo de mensajes: se corrigió el botón "Transferir" (asignaba un id
  equivocado y el chat quedaba huérfano), la Bandeja General ya no muestra
  chats que otro reclutador ya tomó, el orden del historial ya no se
  desordena entre polls, y la vista previa del chat ya refleja el último
  mensaje real (bot o candidato)
- ✅ Reagendar/Cancelar cita: el motivo escrito en el modal del CRM y el
  teléfono del reclutador ahora sí llegan al candidato por WhatsApp
  (antes el backend los descartaba en silencio)
- ⏳ **Pendiente tuyo:** publicar la app OAuth (bloque 1)
- ⏳ **Pendiente tuyo:** autorizar `rhumanossdvirgo@gmail.com` (bloque 2)
- ✅ **Backups configurados:** automatizados en Linux (`scripts/backup.sh` + crontab diario a las 03:00 AM)
- ⏳ **Pendiente tuyo:** probar en el servidor Debian 13 (GNOME) antes de
  darlo por definitivo — es la primera vez que corre fuera de desarrollo
