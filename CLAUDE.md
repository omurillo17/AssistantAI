# Contexto y Memoria del Proyecto - AssistantAI (Virgo)

Este archivo sirve como referencia de contexto, arquitectura, comandos y convenciones para **Claude** y otros asistentes de IA que trabajen en este repositorio.

---

## 1. Visión General del Proyecto
**AssistantAI (Proyecto Virgo)** es un sistema de automatización e interfaz multicanal (WhatsApp/Web) que consta de:
- **Frontend**: Dashboard administrativo en Next.js 16 (App Router), React 19, TypeScript, TailwindCSS v4, Lucide React y XState.
- **Servicios (Docker, 5 contenedores)**:
  - **postgres**: Base de datos principal (`virgo_db`). Publicado en `127.0.0.1:5433`.
  - **backend (FastAPI + Python)**: Pipeline completo de WhatsApp (ingesta, análisis de CV/INE/RFC con Gemini 2.5 Flash, agente de chat, agendamiento en Google Calendar) y el scheduler de tareas periódicas. Publicado en `127.0.0.1:8002` (interno `backend:8000`).
  - **waha (WhatsApp HTTP API)**: API para integraciones con WhatsApp Web. Publicado en `127.0.0.1:3000`. La sesión vive en el volumen `waha_sessions_final`.
  - **frontend (Next.js)**: El dashboard, servido como contenedor. Publicado en `127.0.0.1:3001`.
  - **cloudflared**: Túnel de Cloudflare que expone el frontend a internet. Alcanza a `frontend:3001` por la red Docker interna.
- **Data / Virgo Assets (`/virgo_data`)**: Scripts de base de datos SQL (`database_setup.sql`), prompts y el catálogo generado para la IA.

> Todos los puertos se publican solo en loopback (`127.0.0.1`); el único acceso público es vía el túnel de Cloudflare.

> 🚨 **REGLA DE PRODUCCIÓN**: Este repositorio está en producción real. Prohibido ejecutar comandos destructivos en la BD. Cambios deben ser probados previamente y desplegados con rebuild de docker. Ver `GEMINI.md`.

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

# Pruebas (Vitest)
npm test

# Auditoría de dependencias
npm run audit
```

### Backend (`/backend`)
```bash
# Pruebas (pytest) -- requiere requirements-dev.txt
cd backend
pytest
```

### Servicios Docker (`/`)
```bash
# Iniciar todos los servicios en segundo plano
docker compose up -d

# Reconstruir el backend tras cambiar codigo Python (no esta montado como volumen)
docker compose up -d --build backend

# Reconstruir el frontend tras cambiar codigo Next.js
docker compose build --no-cache frontend && docker compose up -d frontend

# Ver logs de servicios
docker compose logs -f

# Detener los servicios
docker compose down
```

---

## 3. Estructura de Directorios

- `frontend/`: Aplicación web Next.js
  - `src/app/`: Rutas y páginas del App Router. Módulos: `expedientes` (CRM/Kanban), `mensajes` (bandeja), `vacantes`, `calendario`, `capacitacion`, `dashboards`, `usuarios`, `prompt`, `saas`, `portal`, `login`
  - `src/app/api/`: Route handlers (webhooks internos, CRUD, auth)
  - `src/components/`: Componentes UI modulares
  - `src/lib/`: Utilidades, conexión a base de datos (`pg`), autenticación (`jose`, `bcryptjs`), validaciones (`zod`), estados (`estados.ts`) y máquina de estados (`stateMachine.ts`)
- `backend/`: Servicio FastAPI (pipeline de WhatsApp)
  - `app/chat/`: ingesta, analizador (CV/INE/RFC), agente de chat y parser
  - `app/routers/`: webhooks entrantes (WAHA, calendario, citas)
  - `app/scheduler.py`: jobs periodicos (outbox, limpieza, recordatorios a las 20:00 CDMX)
  - `tests/`: suite de pytest (agente, analizador, ingesta, parser, calendario, throttle)
- `virgo_data/`: Recursos de datos y automatización
  - `scripts/database_setup.sql`: Esquema e inicialización de PostgreSQL
  - `prompts/`: Prompts y configuraciones para agentes/IA
  - `data/prompt_context.json`: Catálogo de vacantes generado desde la BD
- `docker-compose.yml`: Orquestación de los 5 servicios
- `GUIA_DETALLADA_PROYECTO.md`: Guía del pipeline conversacional (flujo de 10 pasos, 17 estados, casos de uso y blindajes anti-alucinación)
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
   - Antes de dar por concluida una tarea en el frontend, ejecutar `npm run typecheck`, `npm run lint` y `npm test`.
   - Antes de dar por concluida una tarea en el backend, ejecutar `pytest` desde `/backend`.

3. **Idioma y Comunicación**:
   - Toda interacción y documentación en el código deben mantener consistencia y claridad.
