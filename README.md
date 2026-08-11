# Instalación — Proyecto Virgo (AssistantAI)

Guía completa para levantar la plataforma desde cero. Cubre dos escenarios:

- **Desarrollo local (Windows/Mac)** — para programar y probar.
- **Producción (Debian 13)** — para poner el sistema en línea con usuarios reales.

La plataforma tiene 4 componentes: **PostgreSQL**, **backend Python** (FastAPI),
**WAHA** (WhatsApp) y el **frontend Next.js**. Los tres primeros siempre corren
en Docker. El frontend corre con `npm run dev` en desarrollo y como servicio de
systemd en producción (deliberadamente fuera de Docker — ver sección 7).

---

## Índice

0. [Arquitectura del flujo de WhatsApp](#0-arquitectura-del-flujo-de-whatsapp)
1. [Instalación virgen — Desarrollo local (Windows)](#1-instalación-virgen--desarrollo-local-windows)
2. [Instalación virgen — Producción (Debian 13)](#2-instalación-virgen--producción-debian-13)
3. [Clonar el repositorio y configurar variables de entorno](#3-clonar-el-repositorio-y-configurar-variables-de-entorno)
4. [Levantar Postgres, backend y WAHA (Docker)](#4-levantar-postgres-backend-y-waha-docker)
5. [Levantar el Frontend (Next.js) — desarrollo](#5-levantar-el-frontend-nextjs--desarrollo)
6. [Inicialización de la base de datos y usuario ROOT](#6-inicialización-de-la-base-de-datos-y-usuario-root)
7. [Levantar el Frontend — producción con systemd](#7-levantar-el-frontend--producción-con-systemd)
8. [Vincular WhatsApp y probar el flujo](#8-vincular-whatsapp-y-probar-el-flujo)
9. [Nota sobre el calendario — OAuth por reclutador](#9-nota-sobre-el-calendario--oauth-por-reclutador)
10. [Resiliencia ante cortes de luz o reinicios](#10-resiliencia-ante-cortes-de-luz-o-reinicios)
11. [WAHA — el dashboard y el reverse proxy](#11-waha--el-dashboard-y-el-reverse-proxy)
12. [Checklist final](#12-checklist-final)

---

## 0. Arquitectura del flujo de WhatsApp

Todo el pipeline de conversación vive en el **backend Python** (`backend/app`).
n8n fue retirado del proyecto: ya no hay workflows que importar ni activar.

```
WhatsApp -> WAHA -> POST /webhook/messages (backend)
                     |
                     +-> ingesta.py    debounce y agrupado de mensajes rapidos
                     +-> analizador.py CV / INE / RFC / audio (Gemini)
                     +-> agente.py     LLM del chat y etiquetas internas
                     +-> parser.py     extrae etiquetas y limpia la respuesta
                     |
                     +-> frontend Next.js (x-api-key = INTERNAL_API_KEY)
                          /api/webhook/n8n-incoming  guarda mensaje y estado
                          /api/webhook/expediente    actualiza el expediente
                          /api/upload-cv             guarda el archivo
                          /api/prompt-context        catalogo de vacantes
                          /api/cron/*                outbox y limpieza
```

| Módulo | Función |
|---|---|
| `routers/whatsapp.py` | Recibe el webhook de WAHA (`/webhook/messages`) |
| `chat/ingesta.py` | Debounce de mensajes consecutivos y ruteo por tipo |
| `chat/analizador.py` | Procesa CV/INE/RFC/audio y arma el expediente |
| `chat/agente.py` | Llama a Gemini y ejecuta las etiquetas internas |
| `scheduler.py` | Cron interno: outbox cada 2 min, limpieza semanal, recordatorios |
| `google_calendar.py` | Crear/borrar eventos con el OAuth de cada reclutador |

> El nombre `/api/webhook/n8n-incoming` se conserva por compatibilidad: es la
> ruta que ya existía y renombrarla obligaría a tocar el frontend sin ganancia.

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
| Docker Desktop | Correr PostgreSQL, el backend Python y WAHA en contenedores |

Con esto instalado, salta a la **sección 3** para clonar el repo y configurar
las variables de entorno.

---

## 2. Instalación virgen — Producción (Debian 13)

Empezando desde un servidor Debian 13 (trixie) recién instalado, sin nada
excepto el sistema operativo base y acceso SSH.

> **Nota si instalaste Debian 13 con entorno de escritorio (GNOME):** todos los
> pasos de esta sección son los mismos que en un Debian 13 mínimo/headless — el
> escritorio no interfiere con Docker, Node ni systemd. La única diferencia
> práctica es que, al tener un navegador disponible en la propia máquina, puedes
> abrir `http://localhost:3000` (WAHA) y `http://localhost:3001` (frontend)
> directamente en Firefox del escritorio para escanear el QR de WhatsApp
> (sección 8) y autorizar los calendarios de Google (sección 9), sin necesitar
> el túnel SSH (`ssh -L 3000:localhost:3000 ...`) que sí hace falta en un
> servidor sin GUI.

### 2.1 Paquetes base y firewall

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git ufw

# Firewall: permitir SSH y los puertos que vamos a usar
sudo ufw allow OpenSSH
sudo ufw allow 3001/tcp   # Frontend Next.js
sudo ufw enable
```

No abras los puertos 3000 (WAHA) ni 8000 (backend) al exterior: solo se llaman
desde la red de Docker y desde el propio host. Si vas a usar un reverse proxy
(Caddy/Nginx) para TLS, tampoco expongas el 3001 — en ese caso solo permite 80
y 443.

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

### 3.2 Archivo `.env` de la raíz (para Docker)

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
| `INTERNAL_API_KEY` | Header `x-api-key` que el backend envía al frontend | Debe coincidir en ambos `.env` |
| `PYTHON_SERVICE_API_KEY` | Header `x-api-key` que el frontend envía al backend | Obligatoria: el backend responde 401 a todo si falta |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Cifra los refresh tokens de Google Calendar | Genérala UNA vez y **nunca la cambies** |
| `GEMINI_API_KEY` | API key de Google Gemini | aistudio.google.com/apikey |
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
BACKEND_API_BASE=http://localhost:8000
INTERNAL_API_KEY=<mismo valor que en la raíz>
PYTHON_SERVICE_API_KEY=<mismo valor que en la raíz>
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
| 3001 | Frontend Next.js | Navegador del usuario, backend via `host.docker.internal` |
| 5432 | PostgreSQL (red interna Docker) | Backend y WAHA dentro de Docker |
| 5433 | PostgreSQL (publicado al host) | Frontend desde el host |
| 8000 | Backend Python (FastAPI) | WAHA y el frontend |

---

## 4. Levantar Postgres, backend y WAHA (Docker)

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

Los tres servicios (`postgres`, `backend`, `waha`) deben aparecer con estado
`Up` o `healthy`. Comprueba el backend con `curl http://localhost:8000/health`.

> Si cambias código de `backend/`, recuerda reconstruir la imagen:
> `docker compose up -d --build backend`. El código no está montado como
> volumen, va dentro de la imagen.

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
docker compose logs backend
docker compose logs waha

# Destruir y recrear todo (BORRA todos los datos)
docker compose down -v
docker compose up -d
```

**Cuidado:** `docker compose down -v` borra los volúmenes (toda la base de
datos y la sesión de WhatsApp). Solo úsalo si realmente quieres empezar de
cero.

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

El script `database_setup.sql` ya siembra automáticamente el usuario ROOT
(`omurillo17`) con un hash bcrypt precalculado.

> ⚠️ Esa contraseña semilla está en el historial de git y es pública para
> cualquiera que tenga acceso al repositorio. **Cámbiala en cuanto entres**
> (sección 6.3); en un despliegue nuevo, cámbiala antes de exponer el
> frontend a internet.

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

## 8. Vincular WhatsApp y probar el flujo

No hay workflows que importar: el pipeline completo corre en el backend Python
(sección 0).

1. Abre `http://localhost:3000` (dashboard de WAHA), entra con
   `WAHA_DASHBOARD_USERNAME` / `WAHA_DASHBOARD_PASSWORD` y **escanea el QR**
   con el WhatsApp del número que atenderá a los candidatos.

2. Verifica que la sesión entrega los mensajes al backend:

   ```bash
   curl -H "X-Api-Key: TU_WAHA_API_KEY" http://localhost:3000/api/sessions
   ```

   El campo `config.webhooks[0].url` debe ser
   `http://backend:8000/webhook/messages`. Si apunta a otro lado (por ejemplo a
   un n8n viejo), corrígelo:

   ```bash
   curl -X PUT http://localhost:3000/api/sessions/default \
     -H "X-Api-Key: TU_WAHA_API_KEY" -H "Content-Type: application/json" \
     -d '{"config":{"webhooks":[{"url":"http://backend:8000/webhook/messages","events":["message"]}]}}'
   ```

   > `WAHA_WEBHOOK_URL` en `docker-compose.yml` solo se aplica a sesiones
   > **nuevas**; una sesión ya creada guarda su webhook en el volumen.

3. Da de alta al menos una empresa, una nave y una vacante desde el CRM. El
   catálogo que ve la IA se regenera al guardar una vacante
   (`frontend/src/lib/syncPromptContext.ts`).

### 8.1 Prueba rápida

Envía un mensaje de prueba por WhatsApp al número vinculado. Si todo está
bien configurado, Sofía responderá con el catálogo de vacantes.

Si no responde, revisa en orden:

1. `docker compose logs waha` → ¿Hay sesión de WhatsApp activa? (Si no, escanea el QR)
2. `docker compose logs backend` → ¿Llegó el webhook? ¿Hay excepciones?
3. ¿El frontend está corriendo en el 3001? El backend le escribe el expediente
   y la respuesta se encola ahí.

---

## 9. Nota sobre el calendario — OAuth por reclutador

El calendario del CRM (`/calendario`) y el agendamiento de Sofía leen las
credenciales de Google Calendar desde la tabla `google_calendar_credentials`,
una por reclutador, con el refresh token cifrado con
`GOOGLE_TOKEN_ENCRYPTION_KEY`.

Para dar de alta un reclutador nuevo que necesite calendario:

1. Asegúrate de que tenga su `calendar_id` (correo de Google) en la tabla
   `reclutadores`.
2. Corre el script de autorización y sigue el flujo OAuth en el navegador:

   ```bash
   cd backend
   python scripts/authorize_recruiter.py
   ```

3. Verifica que quedó guardado:

   ```bash
   docker compose exec postgres psql -U virgo_user -d virgo_db \
     -c "SELECT calendar_id FROM google_calendar_credentials;"
   ```

> Un reclutador sin credenciales no puede recibir citas: al agendar, el backend
> solo considera reclutadores con OAuth guardado (ver `definir_agenda` en
> `backend/app/chat/analizador.py`).

---

## 10. Resiliencia ante cortes de luz o reinicios

| Componente | Cómo se recupera | Requiere acción manual |
|---|---|---|
| Postgres / backend / WAHA | `restart: always` en `docker-compose.yml` + Docker habilitado en systemd | No |
| Frontend (producción) | `systemctl enable virgo-frontend.service` (sección 7) | No, una vez habilitado |
| Sesión de WhatsApp | El volumen `waha_data_final` persiste la sesión, no hay que re-escanear el QR | No, salvo que WhatsApp cierre la sesión |
| Mensajes salientes | Quedan en `cola_mensajes` (`estado='PENDIENTE'`), el scheduler del backend los reintenta cada 2 min (hasta 5 intentos) | No |

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

- [ ] Docker corriendo (`docker compose ps` → postgres/backend/waha en `Up`)
- [ ] `npm run dev` en `frontend/` → responde en `http://localhost:3001`
- [ ] Login con el usuario ROOT funciona
- [ ] `/saas` carga sin errores
- [ ] Al menos una empresa, una nave y una vacante dadas de alta

### Completo para producción

- [ ] `docker compose ps` → postgres/backend/waha en estado `Up`/`healthy`
- [ ] `systemctl status virgo-frontend` → `active (running)`, responde en `http://<servidor>:3001`
- [ ] Login con el usuario ROOT funciona → `/saas` carga
- [ ] Contraseña del usuario ROOT cambiada desde la UI
- [ ] `curl http://localhost:8000/health` responde OK
- [ ] `docker compose logs backend | grep scheduler` → los 5 jobs programados
- [ ] `process_outbox` corre cada 2 min sin `ConnectError` (necesita el frontend arriba)
- [ ] `INTERNAL_API_KEY` definida con el MISMO valor en `.env` y `frontend/.env.local`
      (si falta, los logs del frontend avisan que las rutas internas quedan abiertas)
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

### El backend no puede llamar al frontend (`ConnectError`)

Síntoma típico en `docker compose logs backend`:
`process_outbox falló al llamar http://host.docker.internal:3001/api/cron/process-outbox`.

- Lo más común: **el frontend no está corriendo**. Levanta `npm run dev` (o el
  servicio de systemd en producción).
- **Windows**: Docker Desktop ya resuelve `host.docker.internal` automáticamente.
- **Linux**: el `docker-compose.yml` ya incluye `extra_hosts: host.docker.internal:host-gateway`.
  Verifica con: `docker compose exec backend ping -c 1 host.docker.internal`
- El frontend debe escuchar en `0.0.0.0:3001` (no solo `127.0.0.1`). En
  desarrollo, `npm run dev` ya usa `-H 0.0.0.0` en `package.json`.

### El frontend responde 401 a las llamadas del backend

`INTERNAL_API_KEY` no coincide entre `.env` (raíz, la lee el contenedor del
backend) y `frontend/.env.local`. Deben ser idénticas. Tras cambiarlas:
`docker compose up -d --build backend` y reinicia el frontend.

### WAHA no recibe mensajes de WhatsApp

1. Verifica la sesión: `curl http://localhost:3000/api/sessions` (con tu API key)
2. Si no hay sesión, abre `http://localhost:3000` en el navegador y escanea el QR
3. Verifica que el webhook de la sesión apunta al backend (sección 8, paso 2)

### "No hay vacantes disponibles" cuando sí las hay

- Verifica que `TCI_EMPRESA_ID` en `.env` coincide con el UUID de tu empresa en
  la tabla `empresas`
- Verifica que las vacantes tienen `activa = true`
- Verifica que el endpoint `/api/prompt-context` responde correctamente:
  `curl http://localhost:3001/api/prompt-context`

### Quiero empezar TODO de cero (nuclear option)

Esto borra la base de datos y la sesión de WhatsApp:

```bash
docker compose down -v
docker compose up -d --build
```

Después tendrás que re-escanear el QR de WhatsApp (sección 8), volver a
autorizar los calendarios de los reclutadores (sección 9) y dar de alta
empresas/naves/vacantes desde cero.
