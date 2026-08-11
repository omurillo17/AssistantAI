# Contexto y Memoria del Proyecto - AssistantAI (Virgo)

Este archivo sirve como referencia de contexto, arquitectura, comandos y convenciones para **Claude** y otros asistentes de IA que trabajen en este repositorio.

---

## 1. Visión General del Proyecto
**AssistantAI (Proyecto Virgo)** es un sistema de automatización e interfaz multicanal (WhatsApp/Web) que consta de:
- **Frontend**: Dashboard administrativo en Next.js (App Router), React 19, TypeScript, TailwindCSS v4, Lucide React y XState.
- **Backend / Servicios (Docker)**:
  - **PostgreSQL**: Base de datos principal (`virgo_db`).
  - **backend (FastAPI + Python)**: Pipeline completo de WhatsApp (ingesta, análisis de CV/INE/RFC con Gemini, agente de chat, agendamiento en Google Calendar) y el scheduler de tareas periódicas.
  - **WAHA (WhatsApp HTTP API)**: API para integraciones con WhatsApp Web.
- **Data / Virgo Assets (`/virgo_data`)**: Scripts de base de datos SQL (`database_setup.sql`), prompts y el catálogo generado para la IA.

> n8n fue retirado del proyecto (agosto 2026). No agregues dependencias nuevas hacia él: todo el flujo corre en `backend/`.

---

## 2. Comandos Frecuentes

### Frontend (`/frontend`)
```bash
# Desarrollo
cd frontend
npm run dev

# Compilación y Construcción
npm run build

# Verificación de Tipos TypeScript
npm run typecheck

# Linter (ESLint)
npm run lint

# Auditoría de dependencias
npm run audit
```

### Servicios Docker (`/`)
```bash
# Iniciar todos los servicios (Postgres, backend, WAHA) en segundo plano
docker compose up -d

# Reconstruir el backend tras cambiar codigo Python (no esta montado como volumen)
docker compose up -d --build backend

# Ver logs de servicios
docker compose logs -f

# Detener los servicios
docker compose down
```

---

## 3. Estructura de Directorios

- `frontend/`: Aplicación web Next.js
  - `src/app/`: Rutas y páginas del App Router
  - `src/components/`: Componentes UI modulares
  - `src/lib/`: Utilidades, conexión a base de datos (`pg`), autenticación (`jose`, `bcryptjs`), validaciones (`zod`)
- `backend/`: Servicio FastAPI (pipeline de WhatsApp)
  - `app/chat/`: ingesta, analizador (CV/INE/RFC), agente de chat y parser
  - `app/routers/`: webhooks entrantes (WAHA, calendario, citas)
  - `app/scheduler.py`: jobs periodicos (outbox, limpieza, recordatorios)
- `virgo_data/`: Recursos de datos y automatización
  - `scripts/database_setup.sql`: Esquema e inicialización de PostgreSQL
  - `prompts/`: Prompts y configuraciones para agentes/IA
  - `data/prompt_context.json`: Catálogo de vacantes generado desde la BD
- `docker-compose.yml`: Orquestación de Postgres, backend y WAHA
- `.env.example`: Plantilla de variables de entorno

---

## 4. Convenciones de Código y Arquitectura

### TypeScript & Next.js
- Utilizar **TypeScript** estricto. Siempre verificar que `npm run typecheck` no devuelva errores.
- Mantener la separación de responsabilidades (UI en `src/components`, rutas en `src/app`, utilidades en `src/lib`).
- Utilizar **Tailwind CSS v4** para estilos visuales.
- Validar las entradas de datos con **Zod**.
- Manejar tokens JWT con `jose` y hashing de contraseñas con `bcryptjs`.

### Base de Datos (PostgreSQL)
- Conexión directa mediante `pg`.
- Los cambios estructurales en tablas deben actualizarse en `virgo_data/scripts/database_setup.sql`.
- Ajustar zona horaria predeterminada a `America/Mexico_City` donde corresponda.

---

## 5. Reglas de Memoria y Manejo del Repositorio

1. **Variables de Entorno y Seguridad**:
   - **NUNCA** commitear contraseñas reales ni API Keys en el repositorio.
   - Las variables en `docker-compose.yml` deben corresponderse con las de `.env` y `.env.example`.

2. **Verificación de Cambios**:
   - Antes de dar por concluida una tarea en el frontend, ejecutar `npm run typecheck` y `npm run lint`.

3. **Idioma y Comunicación**:
   - Toda interacción y documentación en el código deben mantener consistencia y claridad.
