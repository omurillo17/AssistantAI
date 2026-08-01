# Instalación — Proyecto Virgo (AssistantAI)

Guía completa para levantar la plataforma desde cero. Cubre dos escenarios:

- **Desarrollo local (Windows/Mac)** — para programar y probar.
- **Producción (Debian 13)** — para poner el sistema en línea con usuarios reales.

La plataforma tiene 4 componentes: **PostgreSQL**, **n8n**, **WAHA** (WhatsApp) y
el **frontend Next.js**. Los tres primeros siempre corren en Docker. El frontend
corre con `npm run dev` en desarrollo y como servicio de systemd en producción
(deliberadamente fuera de Docker — ver sección 7).

---

## Índice

0. [Contenido de la carpeta `virgo_data/workflows`](#0-contenido-de-la-carpeta-virgo_dataworkflows)
1. [Instalación virgen — Desarrollo local (Windows)](#1-instalación-virgen--desarrollo-local-windows)
2. [Instalación virgen — Producción (Debian 13)](#2-instalación-virgen--producción-debian-13)
3. [Clonar el repositorio y configurar variables de entorno](#3-clonar-el-repositorio-y-configurar-variables-de-entorno)
4. [Levantar Postgres, n8n y WAHA (Docker)](#4-levantar-postgres-n8n-y-waha-docker)
5. [Levantar el Frontend (Next.js) — desarrollo](#5-levantar-el-frontend-nextjs--desarrollo)
6. [Inicialización de la base de datos y usuario ROOT](#6-inicialización-de-la-base-de-datos-y-usuario-root)
7. [Levantar el Frontend — producción con systemd](#7-levantar-el-frontend--producción-con-systemd)
8. [Importar los workflows en n8n](#8-importar-los-workflows-en-n8n)
9. [Nota sobre el calendario — cuentas de Google Calendar fijas](#9-nota-sobre-el-calendario--cuentas-de-google-calendar-fijas)
10. [Resiliencia ante cortes de luz o reinicios](#10-resiliencia-ante-cortes-de-luz-o-reinicios)
11. [WAHA — el dashboard y el reverse proxy](#11-waha--el-dashboard-y-el-reverse-proxy)
12. [Checklist final](#12-checklist-final)

---

## 0. Contenido de la carpeta `virgo_data/workflows`

| Archivo | Workflow de n8n | Función |
|---|---|---|
| `Orquestador.json` | Orquestador | Webhooks del CRM: candidatos, historial, cancelar/reagendar/bloquear citas, listar eventos de Google Calendar |
| `1_Sofia - Inicio.json` | Sofia - Inicio | Punto de entrada del webhook de WhatsApp (WAHA), normaliza el mensaje entrante |
| `2_Sofia - Analizador CV-Audio.json` | Sofia - Analizador CV-Audio | Arma el prompt (via `/api/prompt-context`), procesa CV/INE/RFC/audio |
| `3_Sofia - Flujo de Chat.json` | Sofia - Flujo de Chat | Llama al LLM y ejecuta las etiquetas internas (agendar, escalar, etc.) |
| `4_Sofia - Recordatorios.json` | Sofia - Recordatorios | Envía recordatorios de citas próximas (cron) |
| `5_Sofia - Mantenimiento y Errores.json` | Sofia - Mantenimiento y Errores | Limpieza de rate-limiting, monitoreo de errores y reintento automático del outbox de WhatsApp (cron, cada 2 min) |
| `EventosCalendario.json` | EventosCalendario | Sub-workflow: crear/borrar eventos en Google Calendar |

---

## 1. Instalación virgen — Desarrollo local (Windows)

Si tu máquina no tiene nada instalado, instala estos programas en orden. Si ya
tienes alguno, sáltalo.

### 1.1 Git

Descarga e instala Git para Windows desde https://git-scm.com/download/win.
Durante la instalación, deja las opciones por defecto. Al terminar, abre una
terminal (PowerShell o Git Bash) y verifica:

```bash
git --version
# Debe mostrar algo como: git version 2.45.0.windows.1
```

### 1.2 Node.js 20 LTS

Descarga el instalador LTS desde https://nodejs.org (botón verde grande).
Ejecútalo con las opciones por defecto. Al terminar:

```bash
node --version
# Debe mostrar v20.x.x o superior

npm --version
# Debe mostrar 10.x.x o superior
```

### 1.3 Docker Desktop

Descarga Docker Desktop desde https://www.docker.com/products/docker-desktop/.
Ejecútalo. **Requisitos**:

- Windows 10/11 Pro o Home con WSL 2 activado.
- Si el instalador te pide activar WSL 2, acepta y reinicia la máquina.

Después de instalar, abre Docker Desktop y espera a que el ícono de la ballena
en la barra de tareas deje de moverse (indica que el motor está listo). Verifica:

```bash
docker --version
# Debe mostrar Docker version 2x.x.x

docker compose version
# Debe mostrar Docker Compose version v2.x.x
```

**Importante en Windows**: ve a Docker Desktop → Settings → General y activa
**"Start Docker Desktop when you sign in to Windows"**, de lo contrario cada vez
que reinicies la máquina tendrás que abrir Docker Desktop manualmente antes de
poder levantar los contenedores.

### 1.4 Editor de código (opcional pero recomendado)

Visual Studio Code: https://code.visualstudio.com/. Instala la extensión
"ESLint" para ver errores de lint en tiempo real.

### 1.5 Resumen de lo que acabas de instalar

| Herramienta | Para qué la usa el proyecto |
|---|---|
| Git | Clonar el repositorio y control de versiones |
| Node.js 20 | Correr el frontend Next.js (`npm run dev`, `npm run build`) |
| Docker Desktop | Correr PostgreSQL, n8n y WAHA en contenedores |

Con esto instalado, salta a la **sección 3** para clonar el repo y configurar
las variables de entorno.

---

## 2. Instalación virgen — Producción (Debian 13)

Empezando desde un servidor Debian 13 (trixie) recién instalado, sin nada
excepto el sistema operativo base y acceso SSH.

### 2.1 Paquetes base y firewall

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git ufw

# Firewall: permitir SSH y los puertos que vamos a usar
sudo ufw allow OpenSSH
sudo ufw allow 3001/tcp   # Frontend Next.js
sudo ufw allow 5678/tcp   # n8n (solo si necesitas acceder desde fuera)
sudo ufw enable
```

Si vas a usar un reverse proxy (Caddy/Nginx) para TLS, no expongas los puertos
3001 ni 5678 directamente — en ese caso solo permite 80 y 443.

### 2.2 Docker Engine (repo oficial, no `docker.io`)

**No uses el paquete `docker.io` del repo de Debian** — suele ir varias
versiones atrás.

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
```

Cierra sesión y vuelve a entrar para que el grupo `docker` aplique. Verifica:

```bash
docker --version
docker compose version
```

`systemctl enable docker` ya queda activado por el propio instalador de
`docker-ce` — Docker arranca solo al reiniciar el servidor.

### 2.3 Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

### 2.4 Resumen de lo instalado

| Paquete | Versión mínima | Cómo verificar |
|---|---|---|
| Git | 2.x | `git --version` |
| Docker Engine | 24.x | `docker --version` |
| Docker Compose plugin | 2.x | `docker compose version` |
| Node.js | 20.x | `node --version` |
| npm | 10.x | `npm --version` |
| ufw | cualquiera | `sudo ufw status` |

Con esto instalado, continúa a la **sección 3**.

---

## 3. Clonar el repositorio y configurar variables de entorno

### 3.1 Clonar

```bash
# En Windows: abre PowerShell o Git Bash donde quieras el proyecto
# En Linux: normalmente en /opt
git clone <url-del-repo> AssistantAI
cd AssistantAI
```

### 3.2 Archivo `.env` de la raíz (para Docker y n8n)

```bash
cp .env.example .env
```

Abre `.env` con tu editor y cambia todos los valores que dicen
`CAMBIA_ESTA_CONTRASENA` o `GENERA_UN_SECRETO_ALEATORIO`. Puedes generar
secretos con:

```bash
# Linux/Mac/Git Bash:
openssl rand -base64 32

# PowerShell:
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

**Variables críticas a revisar en `.env`:**

| Variable | Qué es | Ejemplo / Nota |
|---|---|---|
| `DB_POSTGRESDB_PASSWORD` | Contraseña de PostgreSQL | Usa una contraseña fuerte, nunca la de ejemplo |
| `JWT_SECRET` | Firma de los tokens de sesión del frontend | `openssl rand -base64 32` |
| `WAHA_API_KEY` | Autenticación contra la API de WAHA | Genera uno aleatorio |
| `WAHA_DASHBOARD_USERNAME` | Usuario del dashboard de WAHA | Lo que quieras, no dejar `admin` |
| `WAHA_DASHBOARD_PASSWORD` | Contraseña del dashboard de WAHA | Fuerte y distinta a las demás |
| `N8N_ENCRYPTION_KEY` | Cifrado de credenciales en n8n | Genéralo UNA vez y **nunca lo cambies** |
| `N8N_API_KEY` | Header `x-api-key` que n8n envía al frontend | Debe coincidir en ambos `.env` |
| `TCI_API_BASE` | URL del frontend vista desde n8n (Docker) | `http://host.docker.internal:3001` |
| `TCI_EMPRESA_ID` | UUID de la empresa activa (multi-tenant) | Déjalo vacío si solo hay una empresa |

### 3.3 Archivo `frontend/.env.local` (para Next.js)

**Next.js lee sus variables del directorio `frontend/`, no del `.env` de la
raíz.** Son dos archivos separados; varias claves deben tener el mismo valor en
ambos.

Crea `frontend/.env.local`:

```bash
# frontend/.env.local
DATABASE_URL=postgresql://virgo_user:TU_CONTRASENA@localhost:5433/virgo_db
JWT_SECRET=<mismo valor que en la raíz>
APP_PASSWORD=<contraseña de arranque, opcional>
WAHA_API_KEY=<mismo valor que en la raíz>
WAHA_BASE_URL=http://localhost:3000
WAHA_SESSION=default
N8N_SECRET=<mismo valor que en la raíz>
N8N_API_KEY=<mismo valor que en la raíz>
```

**¿Por qué `localhost:5433` y no `5432`?** Porque `docker-compose.yml` publica
Postgres en el puerto **5433** del host (para no chocar con una posible
instalación local de Postgres). Dentro de la red de Docker, los contenedores
sí se comunican por el puerto 5432 entre ellos.

**¿Por qué `localhost:3000` para WAHA?** Porque WAHA publica su API en el
puerto 3000 del host. El frontend Next.js corre en el puerto **3001**
(configurado en `frontend/package.json`) precisamente para no chocar con WAHA.

### 3.4 Relación de puertos

| Puerto | Servicio | Quién lo usa |
|---|---|---|
| 3000 | WAHA (WhatsApp API) | El frontend lo llama desde el servidor |
| 3001 | Frontend Next.js | Navegador del usuario, n8n via `host.docker.internal` |
| 5432 | PostgreSQL (red interna Docker) | n8n dentro de Docker |
| 5433 | PostgreSQL (publicado al host) | Frontend desde el host |
| 5678 | n8n | Navegador para administrar workflows |

---

## 4. Levantar Postgres, n8n y WAHA (Docker)

### 4.1 Windows (Docker Desktop)

Asegúrate de que Docker Desktop esté corriendo (ícono de ballena en la barra de
tareas). Luego, desde la raíz del proyecto:

```bash
docker compose up -d
docker compose ps
```

### 4.2 Linux (Docker Engine)

```bash
docker compose up -d
docker compose ps
```

Los tres servicios (`postgres`, `n8n`, `waha`) deben aparecer con estado `Up`
o `healthy`.

**La primera vez** que se crea el volumen de Postgres, se ejecuta
automáticamente `virgo_data/scripts/database_setup.sql`. Este script crea las
18 tablas, 3 vistas, 3 funciones y el usuario ROOT semilla. **Si el volumen ya
existía de una instalación previa, el script NO se ejecuta de nuevo** — en ese
caso ve la sección 6.2.

### 4.3 Verificar que Postgres está funcionando

```bash
docker compose exec postgres psql -U virgo_user -d virgo_db -c "\dt"
```

Debe listar las 18 tablas (candidatos, empresas, naves, reclutadores, etc.).

### 4.4 Si algo falla

```bash
# Ver logs de un servicio específico
docker compose logs postgres
docker compose logs n8n
docker compose logs waha

# Destruir y recrear todo (BORRA todos los datos)
docker compose down -v
docker compose up -d
```

**Cuidado:** `docker compose down -v` borra los volúmenes (toda la base de
datos, credenciales de n8n y sesión de WhatsApp). Solo úsalo si realmente
quieres empezar de cero.

---

## 5. Levantar el Frontend (Next.js) — desarrollo

```bash
cd frontend
npm install
npm run dev
```

El frontend arranca en `http://localhost:3001`. Abre esa URL en el navegador.

### Verificar que compila sin errores

```bash
npm run typecheck   # Debe terminar sin errores
npm run lint        # Debe terminar sin errores (o solo warnings preexistentes)
```

### Compilar para producción (prueba local)

```bash
npm run build       # Compila el proyecto optimizado
npm run start       # Sirve la versión compilada en localhost:3001
```

---

## 6. Inicialización de la base de datos y usuario ROOT

### 6.1 Instalación nueva (volumen de Postgres recién creado)

El script `database_setup.sql` ya siembra automáticamente el usuario ROOT:

- **Usuario:** `omurillo17`
- **Contraseña:** `Gg172125`
- **Rol:** `ROOT`

Entra a `http://localhost:3001/login`, inicia sesión y ve a `/saas` para dar
de alta empresas, naves y grupos.

### 6.2 Si el volumen ya existía

Si Postgres ya tenía datos de una instalación anterior, el `init.sql` no se
ejecuta. Para insertar el usuario ROOT manualmente:

```bash
docker compose exec -T postgres psql -U virgo_user -d virgo_db -c "
INSERT INTO usuarios (usuario, password_hash, rol)
VALUES ('omurillo17', '\$2b\$10\$WSjKYnyEbq0nyUWmtSQTQOSwCh4LDG4wCzE2e.V1wcl8vnbUSSojG', 'ROOT')
ON CONFLICT (usuario) DO NOTHING;
"
```

### 6.3 Cambiar la contraseña (recomendado)

Después del primer login, cambia la contraseña desde la UI en Gestión de
Usuarios. La contraseña se almacena solo como hash bcrypt.

### 6.4 Configuración mínima para que el bot funcione

Después de loguearte como ROOT, haz esto en orden desde la UI:

1. **`/saas`** → Crear una empresa (nombre, teléfono de WhatsApp).
2. **`/saas`** → Crear al menos una nave (sucursal/planta) para esa empresa.
3. **`/saas`** → Crear un grupo de reclutamiento y asignarle las naves.
4. **Gestión de Usuarios** → Crear un usuario con rol ADMIN o RECLUTADOR, asignarle la empresa y el grupo.
5. **`/vacantes`** → Crear al menos una vacante activa vinculada a una nave.
6. **`/reclutadores`** → Dar de alta al reclutador (nombre, teléfono, correo de Google Calendar si aplica).

Sin vacantes activas, el bot Sofía responderá "no hay vacantes disponibles" a
todos los candidatos.

---

## 7. Levantar el Frontend — producción con systemd

En producción, el frontend corre como servicio de systemd para que arranque
solo al iniciar el servidor y se reinicie si truena.

### 7.1 Compilar

```bash
cd /opt/AssistantAI/frontend   # o donde hayas clonado el repo
npm install
npm run build
```

### 7.2 Crear el servicio de systemd

Crea el archivo `/etc/systemd/system/virgo-frontend.service`:

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
permisos de lectura sobre `/opt/AssistantAI` y escritura sobre
`/opt/AssistantAI/frontend/public/uploads` (ahí se guardan los CV/INE/RFC).

### 7.3 Activar y arrancar

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now virgo-frontend.service
sudo systemctl status virgo-frontend.service
journalctl -u virgo-frontend.service -f   # logs en vivo
```

Con `enable`, el servicio arranca solo tras un reinicio del servidor.
`Restart=always` lo revive si el proceso de Node muere.

---

## 8. Importar los workflows en n8n

1. Entra a `http://localhost:5678` (o `http://<tu-servidor>:5678` en producción)
   y crea tu cuenta de owner de n8n (solo la primera vez).

2. **Configura credenciales primero** (Settings → Credentials):

   | Credencial | Tipo | Datos |
   |---|---|---|
   | Postgres | PostgreSQL | Host: `postgres`, puerto: `5432`, base: `virgo_db`, usuario/contraseña de tu `.env` |
   | WAHA | HTTP Header Auth | Nombre: `Authorization`, valor: `Bearer TU_WAHA_API_KEY` |
   | Google Calendar | OAuth2 | Una credencial por cada correo de reclutador que use calendario |

3. Importa cada archivo `.json` de `virgo_data/workflows/` (Workflows → Import
   from File). Importa los 7 archivos.

4. Abre **Orquestador** y en cada nodo de Google Calendar asigna la credencial
   OAuth correspondiente al correo del reclutador.

5. Abre cada workflow y verifica que los nodos de Postgres tienen la credencial
   correcta (a veces al importar se desvinculan).

6. **Activa** (toggle "Active") los 7 workflows.

7. Verifica el webhook de WAHA: la variable `WAHA_WEBHOOK_URL` en
   `docker-compose.yml` ya apunta a `http://n8n:5678/webhook/messages`, que
   corresponde al nodo webhook de `1_Sofia - Inicio`.

### 8.1 Prueba rápida

Envía un mensaje de prueba por WhatsApp al número vinculado. Si todo está
bien configurado, Sofía responderá con el catálogo de vacantes.

Si no responde, revisa en orden:

1. `docker compose logs waha` → ¿Hay sesión de WhatsApp activa? (Si no, escanea el QR)
2. n8n → Executions → ¿Llegó el webhook? ¿Hay errores?
3. `docker compose logs n8n` → Errores de conexión a Postgres o al frontend

---

## 9. Nota sobre el calendario — cuentas de Google Calendar fijas

El nodo `Webhook GCal` de `Orquestador` (usado por `/calendario` en el
frontend) **no lee dinámicamente la tabla `reclutadores`**: consulta cuentas
de Google Calendar cableadas a mano en los nodos de n8n.

Si agregas un reclutador nuevo que necesite aparecer en el calendario del CRM:

1. Abre el workflow `Orquestador` en n8n.
2. Agrega un nodo `Google Calendar (getAll)` con la credencial OAuth del nuevo correo.
3. Agrega un nodo `Code` que le ponga el `calendarId`.
4. Conéctalo a la cadena de `Merge` existente.
5. Guarda y reactiva el workflow.

---

## 10. Resiliencia ante cortes de luz o reinicios

| Componente | Cómo se recupera | Requiere acción manual |
|---|---|---|
| Postgres / n8n / WAHA | `restart: always` en `docker-compose.yml` + Docker habilitado en systemd | No |
| Frontend (producción) | `systemctl enable virgo-frontend.service` (sección 7) | No, una vez habilitado |
| Sesión de WhatsApp | El volumen `waha_data_final` persiste la sesión, no hay que re-escanear el QR | No, salvo que WhatsApp cierre la sesión |
| Mensajes salientes | Quedan en `cola_mensajes` (`estado='PENDIENTE'`), el workflow 5 los reintenta cada 2 min (hasta 5 intentos) | No |

### Diferencia Windows vs Linux

- **Windows (Docker Desktop)**: debes activar manualmente "Start Docker Desktop
  when you sign in to Windows" en Settings → General. Si no lo haces, Docker no
  arranca al reiniciar y los contenedores no se levantan.
- **Linux (Docker Engine)**: el daemon de Docker es un servicio de systemd y
  arranca solo. No hay paso extra.

### Verificar que todo está enganchado (Linux)

```bash
sudo systemctl is-enabled docker                  # debe decir "enabled"
sudo systemctl is-enabled virgo-frontend.service   # debe decir "enabled"
```

Prueba real: `sudo reboot`, espera a que el servidor vuelva, y confirma que
`docker compose ps` y `systemctl status virgo-frontend` muestran todo arriba
sin intervención manual.

---

## 11. WAHA — el dashboard y el reverse proxy

`WAHA_DASHBOARD_PASSWORD` en `docker-compose.yml` **puede no tener efecto real**
según la versión de WAHA que estés usando: la edición Core a veces genera una
contraseña aleatoria en cada arranque. Si necesitas entrar al dashboard, la
contraseña vigente siempre está en el log:

```bash
docker compose logs waha | grep WAHA_DASHBOARD_PASSWORD | tail -1
```

### Recomendación para producción

No expongas el puerto 3000 de WAHA a internet. Ponle un reverse proxy con su
propio Basic Auth delante. Caddy es el más simple (hace TLS automático):

```
# Caddyfile
waha.tu-dominio.com {
    basicauth {
        tu_usuario $2a$14$<hash generado con: caddy hash-password>
    }
    reverse_proxy waha:3000
}
```

En `docker-compose.yml` de producción, cambia el puerto de WAHA a
`"127.0.0.1:3000:3000"` para que solo sea alcanzable desde localhost / el proxy.

---

## 12. Checklist final

### Mínimo para que funcione (desarrollo)

- [ ] Docker corriendo (`docker compose ps` → postgres/n8n/waha en `Up`)
- [ ] `npm run dev` en `frontend/` → responde en `http://localhost:3001`
- [ ] Login con `omurillo17` / `Gg172125` funciona
- [ ] `/saas` carga sin errores
- [ ] Al menos una empresa, una nave y una vacante dadas de alta

### Completo para producción

- [ ] `docker compose ps` → postgres/n8n/waha en estado `Up`/`healthy`
- [ ] `systemctl status virgo-frontend` → `active (running)`, responde en `http://<servidor>:3001`
- [ ] Login con `omurillo17` / `Gg172125` funciona → `/saas` carga
- [ ] Contraseña del usuario ROOT cambiada desde la UI
- [ ] Los 7 workflows de n8n están **activos** y sin errores de credenciales
- [ ] `ReintentoOutbox` (workflow 5) corre cada 2 min sin error (revisar Executions en n8n)
- [ ] WAHA vinculado a un número de WhatsApp (QR escaneado)
- [ ] Puerto 3000 de WAHA NO expuesto públicamente sin reverse proxy
- [ ] `sudo reboot` de prueba: todos los servicios vuelven solos
- [ ] Empresa, naves, reclutador y vacantes dados de alta en la UI
- [ ] Mensaje de prueba por WhatsApp → Sofía responde con vacantes reales

---

## Apéndice A — Troubleshooting común

### "Error de conexión a la base de datos" en el frontend

- Verifica que Postgres está corriendo: `docker compose ps postgres`
- Verifica que `DATABASE_URL` en `frontend/.env.local` apunta a `localhost:5433`
  (no `5432` — ese es el puerto interno de Docker)
- Verifica que el usuario y contraseña coinciden con `DB_POSTGRESDB_USER` y
  `DB_POSTGRESDB_PASSWORD` del `.env` de la raíz

### n8n no puede llamar al frontend (`ECONNREFUSED`)

El contenedor de n8n accede al frontend vía `host.docker.internal:3001`. Si
falla:

- **Windows**: Docker Desktop ya resuelve `host.docker.internal` automáticamente.
- **Linux**: el `docker-compose.yml` ya incluye `extra_hosts: host.docker.internal:host-gateway`.
  Verifica con: `docker compose exec n8n ping -c 1 host.docker.internal`
- El frontend debe estar corriendo y escuchando en `0.0.0.0:3001` (no solo
  `127.0.0.1`). En desarrollo, `npm run dev` ya usa `-H 0.0.0.0` en `package.json`.

### WAHA no recibe mensajes de WhatsApp

1. Verifica la sesión: `curl http://localhost:3000/api/sessions` (con tu API key)
2. Si no hay sesión, abre `http://localhost:3000` en el navegador y escanea el QR
3. Verifica que `WAHA_WEBHOOK_URL` apunta a `http://n8n:5678/webhook/messages`

### "No hay vacantes disponibles" cuando sí las hay

- Verifica que `TCI_EMPRESA_ID` en `.env` coincide con el UUID de tu empresa en
  la tabla `empresas`
- Verifica que las vacantes tienen `activa = true`
- Verifica que el endpoint `/api/prompt-context` responde correctamente:
  `curl http://localhost:3001/api/prompt-context`

### Quiero empezar TODO de cero (nuclear option)

Esto borra la base de datos, credenciales de n8n y sesión de WhatsApp:

```bash
docker compose down -v
docker compose up -d
```

Después tendrás que reimportar los workflows en n8n (sección 8), re-escanear
el QR de WhatsApp, y dar de alta empresas/naves/vacantes desde cero.
