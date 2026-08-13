# REGLAS DE PRODUCCIÓN Y MEMORIA - ASSISTANTAI (VIRGO)

> 🚨 **ENTORNO DE PRODUCCIÓN REAL**: Este sistema cuenta con candidatos, vacantes, conversaciones e información real en funcionamiento. 

---

## 1. REGLAS FUNDAMENTALES DE PRODUCCIÓN

1. **PROHIBIDO BORRAR DATOS**: 
   - No ejecutar queries destructivas (`DROP`, `TRUNCATE`, `DELETE` masivos).
   - Preservar siempre la información de `candidatos`, `conversaciones`, `mensajes_bandeja`, `vacantes_def`, `naves` y `reclutadores`.

2. **DESPLIEGUE Y CAMBIOS MEDIDOS**:
   - Todo cambio debe analizarse previamente para evitar regresiones o comportamiento errático del bot.
   - Probar lógica en scripts aislados antes de reiniciar contenedores en vivo.

3. **SINCRONIZACIÓN DE PROMPTS**:
   - La fuente de verdad del agente de chat (Sofía) es `virgo_data/prompts/chat_prompt.md` y `empresas.prompt_ia` en PostgreSQL.
   - Nunca permitir que `prompt_base` devuelva texto de error o alucinaciones.

4. **RECONSTRUCCIÓN DE CONTENEDORES DOCKER**:
   - **Backend (Python/FastAPI)**: Código en `backend/app/`. Requiere reconstruir la imagen para tomar cambios:
     ```bash
     docker compose build backend && docker compose up -d backend
     ```
   - **Frontend (Next.js)**: Código en `frontend/src/`. Para asegurar que tome cambios sin caché:
     ```bash
     docker compose build --no-cache frontend && docker compose up -d frontend
     ```

---

## 2. ARQUITECTURA GENERAL
- **PostgreSQL**: Base `virgo_db` (Puerto 5433 local).
- **Backend**: FastAPI + Python (`http://backend:8000`).
- **Frontend**: Next.js App Router (`http://frontend:3001`).
- **WAHA**: WhatsApp Web Engine (`WEBJS`).
