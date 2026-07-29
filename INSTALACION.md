# Instalación en Linux — Proyecto Virgo (AssistantAI)

Guía para levantar la plataforma completa (Postgres + n8n + WAHA + Frontend) en un
servidor Linux desde cero, e importar los flujos de n8n de esta carpeta.

**Objetivo de despliegue: Debian 13 (trixie).** Postgres, n8n y WAHA corren en
Docker (igual que en desarrollo); el **frontend Next.js corre nativo con Node.js
+ systemd, sin dockerizar** (decisión deliberada — ver sección 4).

---

## 0. Contenido de esta carpeta

| Archivo | Workflow de n8n | Función |
|---|---|---|
| `Orquestador.json` | Orquestador | Webhooks del CRM: candidatos, historial, cancelar/reagendar/bloquear citas, listar eventos de Google Calendar |
| `1_Sofia - Inicio.json` | Sofia - Inicio | Punto de entrada del webhook de WhatsApp (WAHA), normaliza el mensaje entrante |
| `2_Sofia - Analizador CV-Audio.json` | Sofia - Analizador CV-Audio | Arma el prompt (via `/api/prompt-context`), procesa CV/INE/RFC/audio |
| `3_Sofia - Flujo de Chat.json` | Sofia - Flujo de Chat | Llama al LLM y ejecuta las etiquetas internas (agendar, escalar, etc.) |
| `4_Sofia - Recordatorios.json` | Sofia - Recordatorios | Envía recordatorios de citas próximas (cron) |
| `5_Sofia - Mantenimiento y Errores.json` | Sofia - Mantenimiento y Errores | Limpieza de rate-limiting, monitoreo de errores y **reintento automático del outbox de WhatsApp** (cron, cada 2 min) |
| `EventosCalendario.json` | EventosCalendario | Sub-workflow: crear/borrar eventos en Google Calendar |

---

## 1. Requisitos previos (Debian 13)

- Docker Engine + Docker Compose plugin (`docker compose version`)
- Node.js 20+ y npm (para correr el frontend nativo, sin Docker)
- Un dominio o IP pública si vas a recibir webhooks de WAHA/n8n desde fuera del servidor
- `ufw` (firewall) y, si vas a exponer el servidor a internet, `nginx` o `caddy`
  como reverse proxy (ver sección 9)

**No uses el paquete `docker.io` del repo de Debian** — suele ir varias
versiones atrás. Instala Docker desde el repo oficial:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git

# Repo oficial de Docker para Debian
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER   # cierra sesión y vuelve a entrar para aplicar

# Node.js 20 LTS (el de los repos de Debian 13 puede venir distinto)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

`systemctl enable docker` ya queda activado por el propio instalador de
`docker-ce` — a diferencia de Docker Desktop en Windows, en Debian **no hace
falta ningún ajuste manual** para que Docker arranque solo al reiniciar el
servidor; el `restart: always` de `docker-compose.yml` se encarga del resto
(ver sección 8).

---

## 2. Clonar el repo y configurar variables de entorno

```bash
git clone <url-del-repo> AssistantAI
cd AssistantAI
cp .env.example .env
nano .env   # ajusta contraseñas, JWT_SECRET, WAHA_API_KEY, etc.
```

**Variables críticas a revisar en `.env`:**

- `DB_POSTGRESDB_PASSWORD` / `DB_PASSWORD`: usa una contraseña real, no la de ejemplo.
- `JWT_SECRET`: genera uno propio (`openssl rand -base64 32`).
- `WAHA_API_KEY`: clave para autenticar contra la API de WAHA.
- `TCI_API_BASE=http://host.docker.internal:3001`: **el puerto 3000 lo ocupa el
  contenedor de WAHA** (ver `docker-compose.yml`), por eso el frontend Next.js
  corre fijo en el puerto **3001** (`frontend/package.json` ya lo fija con `-p 3001`).
  Si cambias el puerto del frontend, actualiza esta variable también.
- `TCI_EMPRESA_ID`: UUID de la empresa en la tabla `empresas` (déjalo vacío solo si
  vas a operar una única empresa y no te importa que `/api/prompt-context` devuelva
  el catálogo combinado de todas).
- `N8N_API_KEY`: clave que n8n manda como header `x-api-key` al llamar endpoints
  server-to-server del frontend (`/api/prompt-context`, `/api/cron/process-outbox`).
  **Debe ser idéntica** en el `.env` de la raíz (la lee el contenedor de n8n) y en
  `frontend/.env.local`/`.env` del frontend (la valida el propio endpoint).

En Linux, `host.docker.internal` requiere el `extra_hosts: host.docker.internal:host-gateway`
que ya está declarado en el servicio `n8n` de `docker-compose.yml` — no necesitas
tocar nada ahí, pero si agregas nuevos contenedores que también deban llamar al
frontend, recuerda añadir esa misma línea.

### 2.1 El frontend necesita SU PROPIO archivo de entorno

**Ojo:** Next.js lee variables de entorno del directorio donde corre (`frontend/`),
**no** del `.env` de la raíz que acabas de llenar — son dos archivos distintos.
Crea `frontend/.env.local` con (al menos) estas claves, con los mismos valores
reales que pusiste en el `.env` de la raíz para las que se comparten:

```bash
# frontend/.env.local
DATABASE_URL=postgresql://usuario:password@localhost:5433/virgo_db
JWT_SECRET=<mismo valor que en la raíz>
APP_PASSWORD=<contraseña de arranque, opcional>
WAHA_API_KEY=<mismo valor que en la raíz>
WAHA_BASE_URL=http://localhost:3000
WAHA_SESSION=default
N8N_SECRET=<mismo valor que en la raíz>
N8N_API_KEY=<mismo valor que en la raíz>
```

`DATABASE_URL` apunta a `localhost:5433` (el puerto que Postgres publica al
host, ver `docker-compose.yml`) porque el frontend corre nativo, fuera de la
red interna de Docker — no puede resolver el hostname `postgres`.

---

## 3. Levantar Postgres, n8n y WAHA

```bash
docker compose up -d
docker compose ps
```

La primera vez que se crea el volumen de Postgres, se ejecuta automáticamente
`virgo_data/scripts/database_setup.sql` (18 tablas, vistas, funciones, y el
usuario ROOT semilla — ver sección 6). **Si el volumen ya existía de una
instalación previa, ese script NO se vuelve a ejecutar**; en ese caso corre el
`INSERT` del usuario ROOT manualmente (sección 6.2).

---

## 4. Levantar el Frontend (Next.js) — nativo con systemd

El frontend se queda **fuera de Docker a propósito**. Corre como servicio de
systemd para que arranque solo al iniciar el servidor y se reinicie solo si
truena, sin depender de Docker Desktop ni de una sesión de terminal abierta.

```bash
cd /opt/AssistantAI/frontend   # o donde hayas clonado el repo
npm install
npm run build
```

Crea `/etc/systemd/system/virgo-frontend.service`:

```ini
[Unit]
Description=Virgo AssistantAI - Frontend Next.js
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/AssistantAI/frontend
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Ajusta `User=` a un usuario del sistema sin privilegios (no `root`) que tenga
permisos de lectura sobre `/opt/AssistantAI`. Luego:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now virgo-frontend.service
sudo systemctl status virgo-frontend.service
journalctl -u virgo-frontend.service -f   # logs en vivo
```

Con `enable`, el servicio arranca solo tras un reinicio del servidor (incluido
uno por corte de luz) — igual que Postgres/n8n/WAHA con `restart: always` en
Docker. `Restart=always` además lo revive si el proceso de Node muere por
cualquier otra razón.

Para desarrollo local seguís usando `npm run dev` normal, sin systemd.

---

## 5. Importar los workflows en n8n

1. Entra a `http://<tu-servidor>:5678` y crea tu cuenta de owner de n8n.
2. **Configura credenciales primero** (Settings → Credentials):
   - **Postgres**: host `postgres`, puerto `5432`, base `virgo_db`, usuario/contraseña de tu `.env`.
   - **Google Calendar OAuth2**: una credencial por cada correo de reclutador que
     use calendario (ver sección 7 — actualmente son 4 cuentas fijas).
   - **WAHA**: URL `http://waha:3000`, API key = `WAHA_API_KEY` de tu `.env`.
3. Importa cada archivo `.json` de esta carpeta (Workflows → Import from File).
4. Abre `Orquestador` y en cada nodo de Google Calendar (`GCal Elibeth`, `GCal
   Patricia`, `GCal Sra Paty`, `GCal Michelle`, más los de `Crear/Borrar/Reagendar/
   Bloquear en Google Calendar`) asigna la credencial OAuth correspondiente.
5. Activa (toggle "Active") los 7 workflows.
6. Verifica el webhook de WAHA: `WAHA_WEBHOOK_URL=http://n8n:5678/webhook/messages`
   ya viene configurado en `docker-compose.yml`, apuntando al nodo webhook de
   `1_Sofia - Inicio`.

---

## 6. Usuario ROOT (acceso a `/saas`)

### 6.1 Instalación nueva
Ya viene sembrado por `database_setup.sql`:

- **Usuario:** `omurillo17`
- **Contraseña:** `Gg172125`
- **Rol:** `ROOT`

### 6.2 Si el volumen de Postgres ya existía (el script de init no corre dos veces)
Ejecuta esto una sola vez:

```bash
docker compose exec -T postgres psql -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" -c "
INSERT INTO usuarios (usuario, password_hash, actual_password, rol)
VALUES ('omurillo17', '\$2b\$10\$WSjKYnyEbq0nyUWmtSQTQOSwCh4LDG4wCzE2e.V1wcl8vnbUSSojG', 'Gg172125', 'ROOT')
ON CONFLICT (usuario) DO NOTHING;
"
```

Inicia sesión en `http://<tu-servidor>:3001/login` y entra a `/saas` para dar de
alta empresas, naves y grupos.

**Recomendado:** cambia la contraseña desde la UI (Gestión de Usuarios) después
del primer login.

---

## 7. Nota sobre el calendario — cuentas de Google Calendar fijas

El nodo `Webhook GCal` de `Orquestador` (usado por el módulo `/calendario` del
frontend) **no lee dinámicamente la tabla `reclutadores`**: consulta 4 cuentas
de Google Calendar cableadas a mano —

- `GCal Elibeth` → talreclutamiento01@gmail.com
- `GCal Patricia` → reclutamientotcinnovacion@gmail.com (reclutadora dada de baja)
- `GCal Sra Paty` → rhumanossdvirgo@gmail.com
- `GCal Michelle` → jeferhsdvirgo@gmail.com

Si agregas un reclutador nuevo (o reemplazas uno) que necesite aparecer en el
calendario del CRM, hay que **agregar manualmente en n8n**: un nodo
`Google Calendar (getAll)` + un nodo `Code` que le ponga `calendarId`, y
conectarlo a la cadena de `Merge` existente. Por ejemplo, la reclutadora
`GABRIELA` (sistemasdulvirgo@gmail.com) ya está activa en la base de datos pero
**todavía no tiene nodo en este workflow**, así que sus citas no aparecerán en
`/calendario` hasta que se agregue.

---

## 8. Resiliencia ante cortes de luz o reinicios del servidor

Qué pasa si el servidor se reinicia (corte de luz, mantenimiento, crash):

| Componente | Cómo se recupera | Requiere acción manual |
|---|---|---|
| Postgres / n8n / WAHA | `restart: always` en `docker-compose.yml` + `systemctl enable docker` (ya viene activado por el instalador) | No |
| Frontend Next.js | `systemctl enable virgo-frontend.service` (sección 4) | No, una vez habilitado |
| Sesión de WhatsApp en WAHA | El volumen `waha_data_final` persiste la sesión — no hace falta re-escanear el QR | No, salvo que WhatsApp cierre la sesión por su cuenta |
| Mensajes salientes en curso | Quedan en `cola_mensajes` (`estado='PENDIENTE'`) y el workflow `5_Sofia - Mantenimiento y Errores` los reintenta solo, cada 2 min, hasta 5 intentos | No |

**A diferencia de Windows + Docker Desktop** (donde hay que activar a mano
"Start Docker Desktop when you log in"), en Debian el daemon de Docker es un
servicio de systemd normal y arranca solo — no hay paso extra que hacer ahí.

Verifica que todo quedó bien enganchado:

```bash
sudo systemctl is-enabled docker                  # debe decir "enabled"
sudo systemctl is-enabled virgo-frontend.service   # debe decir "enabled"
```

Prueba real: `sudo reboot`, espera a que el servidor vuelva, y confirma que
`docker compose ps` y `systemctl status virgo-frontend` muestran todo arriba
sin que hayas tocado nada.

---

## 9. WAHA — el dashboard NO respeta una contraseña fija (usa reverse proxy)

`WAHA_DASHBOARD_PASSWORD` y `WHATSAPP_SWAGGER_PASSWORD` en `docker-compose.yml`
**no tienen efecto real**: la imagen de WAHA (edición Core/gratuita) genera una
contraseña aleatoria distinta en cada arranque del contenedor y la imprime en
el log, sin importar el valor que le pongas. Confirmado corriendo
`docker compose exec waha printenv` (el valor fijo sí llega al contenedor) vs.
`docker compose logs waha | grep DASHBOARD_PASSWORD` (lo que realmente usa la
app para el login).

**No pierdas tiempo peleando con esa variable.** Si necesitas entrar al
dashboard puntualmente, la contraseña vigente siempre está en el log:

```bash
docker compose logs waha | grep WAHA_DASHBOARD_PASSWORD | tail -1
```

Para tener una contraseña fija de verdad, la forma correcta es **no exponer
el puerto 3000 de WAHA a internet** y ponerle un reverse proxy con su propio
Basic Auth delante (Caddy es el más simple, hace TLS automático):

```
# Caddyfile
waha.tu-dominio.com {
    basicauth {
        tu_usuario $2a$14$<hash generado con: caddy hash-password>
    }
    reverse_proxy waha:3000
}
```

Con eso el login interno de WAHA deja de importar: nadie llega a esa pantalla
sin pasar primero por tu Basic Auth. En `docker-compose.yml` de producción,
quita el `ports: "3000:3000"` de `waha` (o cámbialo a `"127.0.0.1:3000:3000"`)
para que solo sea alcanzable desde el propio servidor / el proxy.

---

## 10. Checklist final

- [ ] `docker compose ps` → postgres/n8n/waha en estado `Up`/`healthy`
- [ ] `systemctl status virgo-frontend` → `active (running)`, frontend responde en `http://<tu-servidor>:3001`
- [ ] Login con `omurillo17` / `Gg172125` funciona y `/saas` carga
- [ ] Los 7 workflows de n8n están **activos** y sin errores de credenciales
- [ ] `ReintentoOutbox` (dentro de `5_Sofia - Mantenimiento y Errores`) corre cada 2 min sin error (revisar Executions en n8n)
- [ ] WAHA vinculado a un número de WhatsApp (escanear QR, idealmente vía el reverse proxy, no directo al puerto 3000)
- [ ] Puerto 3000 de WAHA NO expuesto públicamente sin reverse proxy + Basic Auth
- [ ] `sudo reboot` de prueba: todos los servicios vuelven solos sin intervención manual
- [ ] Empresa, naves y al menos un reclutador con vacantes dados de alta en `/saas` y `/vacantes`
- [ ] Mensaje de prueba por WhatsApp responde con el catálogo de vacantes real (no "no hay vacantes")
