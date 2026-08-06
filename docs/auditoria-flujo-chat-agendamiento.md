# Auditoría: Flujo completo de WhatsApp hasta agendar entrevista

**Fecha:** 2026-08-04
**Alcance:** Desde que WAHA recibe un mensaje de WhatsApp hasta que Sofía agenda la entrevista en Google Calendar. Incluye los 4 workflows de n8n del camino principal (`1_Sofia - Inicio`, `2_Sofia - Analizador CV-Audio`, `3_Sofia - Flujo de Chat`, `EventosCalendario`), los endpoints del backend que tocan, `chat_prompt.md` y el módulo de filtros de vacante.

> Nota metodológica: los workflows de n8n se auditaron desde los archivos exportados en `virgo_data/workflows/`. Ya se ha confirmado en sesiones anteriores que el n8n **vivo** puede desincronizarse de estos exports (ej. el workflow "Orquestador" duplicado). Los hallazgos de código están verificados contra estos archivos; los que requieren corrección en n8n deben aplicarse **manualmente en la UI de n8n**, no editando el JSON.

---

## 1. Mapa del flujo

```
WhatsApp candidato
   │
   ▼
WAHA ──POST /webhook/messages──▶ 1_Sofia - Inicio
   │  · Filtra eco de mensajes propios y de reclutadores (IgnorarEquipo)
   │  · Dedup por message_id (DeduplicarMensaje)
   │  · Comando debug /reset_sofia (⚠️ ver Hallazgo #1)
   │  · Migra LID→teléfono real (MigrarLID)
   │  · Debounce "esperar a que termine de escribir" (⚠️ ver Hallazgo #6, no funciona)
   │  · Bloqueo por 3 inasistencias (¿Tiene3Faltas?)
   ▼
2_Sofia - Analizador CV-Audio
   │  · Rama audio → transcribe con Gemini
   │  · Rama imagen/documento → Analyze document (Gemini) clasifica INE/CV/CONSTANCIA/ANUNCIO/INVALIDO
   │  · SepararJSON: arma mensaje de sistema para la IA + valida CURP cruzada INE↔RFC
   │  · Actualizar_Expediente → POST /api/webhook/expediente (guarda documento, CURP, estado)
   │  · DefinirAgenda: resuelve qué reclutador(es) atienden la vacante (round-robin si hay varios)
   │  · Vacantes: trae catálogo vía GET /api/prompt-context (✅ ya incluye reglas de filtros)
   │  · CargarPrompt: arma el system prompt final (⚠️ ver Hallazgo #3 y #8)
   │  · PrepararDatosFlujoChat: arma `_agenda` (⚠️ ver Hallazgo #4, ya diagnosticado antes)
   ▼
3_Sofia - Flujo de Chat
   │  · AI Agent (Gemini) con tools: RevisarCalendario, CrearCita (→ EventosCalendario),
   │    CancelarCita/ReagendarCita
   │  · ResolverReclutador: decide a cuál de los reclutadores del round-robin le toca
   │    (⚠️ su resultado depende de que `_agenda` no esté vacío — Hallazgo #4)
   │  · Leer: parsea la respuesta JSON de la IA, extrae etiquetas (ACTUALIZAR_VACANTE,
   │    CITA_CONFIRMADA, HUMAN_ALERT, etc.)
   │  · AlmacenarMensajes → POST /api/webhook/n8n-incoming (persiste estado, vacante,
   │    máquina de estados, asignación de reclutador)
   │  · AlertaCandidato: WhatsApp al reclutador cuando se agenda con éxito
   ▼
EventosCalendario (sub-workflow)
   │  · Crear en Google Calendar (⚠️ Hallazgo #7: sin invitar al candidato)
   │  · Guardar ID en Base de Datos (⚠️ Hallazgo #9: sin filtrar por empresa)
   │  · Borrar en Google Calendar → Actualizar DB a Cancelado (⚠️ Hallazgo #2: estado inválido)
   ▼
Candidato recibe confirmación de cita
```

---

## 2. Hallazgos — de mayor a menor severidad

### 🔴 CRÍTICO

#### #1 — Comando de debug `/reset_sofia` sigue activo en producción, con teléfono hardcodeado
**Dónde:** `1_Sofia - Inicio.json` → nodos `If2`, `Execute a SQL query`, `Borrado`

Si **cualquier persona** manda el texto exacto `/reset_sofia` por WhatsApp, el workflow:
1. Borra por completo el expediente del teléfono `5213323379399` (conversación, candidato, logs, rate limiting) — un número hardcodeado, **no el del remitente**.
2. Le manda un WhatsApp de confirmación ("Resteo listo") a ese mismo número hardcodeado.

Esto significa que **cualquier candidato en WhatsApp puede borrar el expediente de otra persona específica** sin autorización, con solo escribir ese comando — es evidentemente código de pruebas del desarrollo que nunca debió llegar a producción.

**Impacto:** Pérdida de datos no autorizada, disparable por cualquier usuario externo.
**Recomendación:** Eliminar esta rama del workflow por completo (en n8n UI). Si se quiere mantener un "reset" para pruebas, debe:
- Operar sobre el teléfono del remitente real (`$json.body.payload.from`), no uno hardcodeado.
- Estar protegido detrás de una validación de que el remitente es un número de staff/admin autorizado (reutilizar la misma lista de `reclutadores.telefono` que ya usa `IgnorarEquipo`).

---

#### #2 — `estado = 'Cancelado'` viola el CHECK constraint de la BD
**Dónde:** `EventosCalendario.json` → nodo `Actualizar DB a Cancelado`
```sql
UPDATE candidatos SET estado = 'Cancelado', event_id = NULL WHERE telefono = $1
```
La constraint `valid_estado` de `candidatos` **no incluye** `'Cancelado'` — el valor válido es `'CITA_CANCELADA'`. Cualquier cancelación de cita (por la IA o por el candidato) hace que este UPDATE truene con un error de Postgres, y la ejecución de n8n falla en ese paso.

*(Ya diagnosticado en una sesión anterior de este proyecto; instrucciones de fix ya entregadas mano a mano pero no confirmadas como aplicadas en n8n — se reconfirma aquí porque sigue presente en el export actual.)*

**Fix (aplicar en n8n UI, nodo `Actualizar DB a Cancelado`):**
```sql
UPDATE candidatos SET estado = 'CITA_CANCELADA', event_id = NULL WHERE telefono = $1
```

---

#### #3 — Las reglas de evaluación (filtros) son estructuralmente invisibles para la IA en el momento exacto en que se necesitan
**Dónde:** `2_Sofia - Analizador CV-Audio.json` → nodo `CargarPrompt`
```js
const estadosSinCatalogo = ['CITA_AGENDADA', 'DOCUMENTOS_NO_COINCIDEN', 'CV_RECIBIDO', 'INE_VALIDADA'];
const necesitaCatalogo = !estadosSinCatalogo.includes(estadoActual);
// si !necesitaCatalogo → detalleTxt = '[Catalogo omitido: no aplica en esta etapa del proceso]'
```
`chat_prompt.md` sección 5.2 dice textualmente: *"Una vez que el candidato entregó su CV... revisa si la vacante incluye la sección `[REGLAS DE EVALUACIÓN OBLIGATORIAS PARA ESTA VACANTE]` en `{{DETALLE_VACANTES}}`."* — pero `CV_RECIBIDO` está en la lista de estados donde `{{DETALLE_VACANTES}}` se reemplaza por el texto `[Catalogo omitido...]`. Es decir: **exactamente en el turno donde la IA debería leer y hacer las preguntas de filtro, el texto que las contiene ya no está en el prompt.**

Esto significa que el sistema de filtros — tanto el que ya existía (texto manual con `[REGLAS DE EVALUACIÓN...]`) como el que se acaba de conectar hoy desde `/vacantes/[id]` — **nunca llega a dispararse**, sin importar cómo se configure, porque el candado de "ahorro de tokens" se lo come antes de que la IA lo vea.

**Impacto:** El módulo de filtros de vacante (`/vacantes/[id]`) sigue sin tener efecto real en la conversación, a pesar del fix de hoy que sí conecta los datos hasta el texto del prompt — este es el eslabón que faltaba.

**Fix (aplicar en n8n UI, nodo `CargarPrompt`):** quitar `'CV_RECIBIDO'` del array `estadosSinCatalogo`:
```js
const estadosSinCatalogo = ['CITA_AGENDADA', 'DOCUMENTOS_NO_COINCIDEN', 'INE_VALIDADA'];
```
(`INE_VALIDADA` y `CITA_AGENDADA` sí pueden quedarse excluidos — en esas etapas ya no se necesita mostrar el catálogo, la vacante y sus filtros ya se resolvieron.)

---

#### #4 — `_agenda` se sobreescribe cuando el candidato sube un documento → `RECLUTADOR_ASIGNADO` puede salir literalmente como "undefined"
**Dónde:** `2_Sofia - Analizador CV-Audio.json` → nodo `PrepararDatosFlujoChat`, campo `_agenda: {{ $json }}`

*(Diagnosticado en una sesión anterior de este proyecto a raíz de un error 404 de Google Calendar; instrucciones de fix ya entregadas, se reconfirma y se documenta el impacto completo aquí.)*

`$json` en ese Set node es "lo que traiga el nodo inmediatamente anterior", que **cambia según el camino**: si el mensaje trae un documento (CV/INE/RFC), pasa por `Actualizar_Expediente` (la llamada HTTP a `/api/webhook/expediente`) justo antes, y `_agenda` termina siendo la respuesta de esa API (`{success:true, estado:"..."}`) en vez de la agenda real calculada por `DefinirAgenda`.

**Impacto ya confirmado en esta auditoría** (no solo el 404 de calendario ya conocido): en `3_Sofia - Flujo de Chat.json` línea 102, el `systemMessage` del AI Agent hace:
```js
.replace(/\{\{RECLUTADOR_ASIGNADO\}\}/g, $('ResolverReclutador').first().json.nombre_reclutador)
```
Si `_agenda` está vacío, `ResolverReclutador.nombre_reclutador` es `undefined`, y el mensaje de confirmación de cita que ve el candidato (sección 6.6 de `chat_prompt.md`, *"Preguntar en recepción por {{RECLUTADOR_ASIGNADO}}"*) puede terminar diciendo literalmente **"Preguntar en recepción por undefined"**.

**Fix (aplicar en n8n UI, nodo `PrepararDatosFlujoChat`, campo `_agenda`):**
```
={{ $('DefinirAgenda').first().json }}
```
en vez de `={{ $json }}`.

---

### 🟠 ALTO

#### #5 — `RevisarCalendario` sin el mismo fallback defensivo que sus nodos hermanos
**Dónde:** `3_Sofia - Flujo de Chat.json` línea 633
```
"value": "={{ $('ResolverReclutador').first().json.calendar_id }}"
```
`CrearCita` y `CancelarCita` ya tienen `?.calendar_id || ''` (aunque `''` tampoco es un calendario válido — ver Hallazgo #4, que es la causa real). Es consistencia menor una vez arreglado el #4, pero conviene igualarlo:
```
={{ $('ResolverReclutador').first().json?.calendar_id || 'talreclutamiento01@gmail.com' }}
```

#### #6 — El debounce "esperar a que el candidato termine de escribir" nunca se activa
**Dónde:** `1_Sofia - Inicio.json` → nodos `ChecarMensajes` / `If4`

```sql
SELECT COALESCE(
    (SELECT EXTRACT(EPOCH FROM (NOW() - last_message_at)) FROM rate_limiting WHERE telefono = $1),
    9999
) AS segundos_inactivo;
```
Se confirmó contra la BD viva: **la tabla `rate_limiting` tiene 0 filas** y **ningún workflow ni endpoint del backend escribe `last_message_at` jamás** (`grep` de todo el repo no encontró ni un solo `INSERT`/`UPDATE` a esa columna). El `COALESCE` siempre cae en `9999`, `segundos_inactivo > 4.5` siempre es verdadero, y el mecanismo de "agrupar mensajes rápidos en un solo turno" está muerto desde que se implementó: **cada mensaje se procesa de inmediato**, incluso si el candidato manda 3 mensajes seguidos en 2 segundos — puede generar respuestas de la IA fragmentadas o encimadas.

**Recomendación:** o se implementa el `UPDATE rate_limiting SET last_message_at = NOW() ...` en el punto donde llega cada mensaje (ej. en `AlmacenarMensajes`/`n8n-incoming`), o si ya no se quiere este comportamiento, se elimina el nodo muerto para no confundir a futuro.

#### #7 — El candidato nunca es invitado al evento de Google Calendar al crear la cita
**Dónde:** `EventosCalendario.json` → nodo `Crear en Google Calendar`

`additionalFields` no tiene `attendees`. El evento se crea solo en el calendario del reclutador; el candidato no recibe invitación/recordatorio nativo de Google Calendar, a pesar de que el mensaje de confirmación (sección 6.6 de `chat_prompt.md`) da a entender una cita formal agendada.

*(En una sesión anterior se agregó este fix ya para el flujo de **reagendar** en `Orquestador.json`, a pedido explícito del usuario — pero se dejó pendiente/no solicitado para el flujo de **creación**, que es justo el que cubre este alcance "hasta agendar entrevista".)*

**Fix (aplicar en n8n UI, nodo `Crear en Google Calendar` → Additional Fields):** agregar `Attendees` = `{{ $json.correo }}` (requiere que el correo del candidato llegue en el payload del tool `CrearCita`, verificar que `EventosCalendario`'s trigger schema lo reciba).

#### #8 — Catálogo de vacantes cargado desde un archivo estático en disco, duplicado del endpoint en vivo
**Dónde:** `2_Sofia - Analizador CV-Audio.json` → nodo `CargarPrompt`, lee `/home/node/virgo_files/data/prompt_context.json`

Esta ruta es un archivo que se regenera solo cuando alguien guarda cambios en `/naves` o `/vacantes` (vía `syncPromptContextDisk`). Antes de esta auditoría, esa función tenía su **propia copia independiente** de la lógica que arma `detalle_vacantes`, separada del endpoint `/api/prompt-context` — lo que significaba que el fix de filtros de hoy solo llegaba a la mitad del sistema (el nodo `Vacantes`, que sí llama al endpoint en vivo) pero **no** a `CargarPrompt` (que es el que arma el prompt principal del chat).

**✅ Ya corregido en este mismo trabajo de auditoría:** se extrajo la lógica compartida a `frontend/src/lib/promptContext.ts` (`buildPromptContext()`), y tanto `/api/prompt-context/route.ts` como `syncPromptContext.ts` ahora la usan — ya no hay dos implementaciones que puedan desincronizarse. Se regeneró el archivo en disco (`virgo_data/data/prompt_context.json`) con la lógica corregida.

Sigue pendiente el Hallazgo #3 para que este contenido corregido realmente llegue a la IA en el estado `CV_RECIBIDO`.

---

### 🟡 MEDIO

#### #9 — `UPDATE candidatos SET event_id = ...` no filtra por empresa
**Dónde:** `EventosCalendario.json` → nodo `Guardar ID en Base de Datos`
```sql
UPDATE candidatos SET event_id = $1 WHERE telefono = $2
```
Con el modelo multi-empresa ya implementado (un mismo teléfono puede tener una fila por empresa, `UNIQUE (telefono, empresa_id)`), este UPDATE tocaría **todas** las filas de ese teléfono sin importar la empresa. Hoy no es un problema porque solo hay una empresa activa, pero quedará roto en cuanto haya una segunda.

**Recomendación:** filtrar también por `empresa_id`, o mejor, pasar el `candidato_id` (UUID único) directo desde el tool en vez de resolver por teléfono.

#### #10 — Nodos de Google Calendar sin `retryOnFail`
**Dónde:** `EventosCalendario.json` → `Crear en Google Calendar`, `Borrar en Google Calendar`

A diferencia de `Analyze document` (que sí tiene `retryOnFail: true, waitBetweenTries: 3000`), estos nodos no reintentan ante un error transitorio de la API de Google (rate limit, timeout). Una falla momentánea tumba todo el intento de agendar.

**Recomendación:** activar `Retry On Fail` con 2-3 intentos en ambos nodos.

#### #11 — Workflow `1_Sofia - Inicio` exportado con `"active": false`
No se puede confirmar desde el JSON si esto refleja la realidad en el n8n vivo (ya se ha visto en este proyecto que el flag de export no siempre coincide con el estado real). **Verificar manualmente en la UI de n8n** que el workflow esté activo.

#### #12 — Workflow "Orquestador" duplicado en n8n vivo
Pendiente de una sesión anterior, no re-verificado en esta auditoría por no tener acceso directo a la API de n8n. Sigue recomendándose investigar y eliminar el duplicado.

---

## 3. Lo que ya funciona bien (validado en esta auditoría)

- **Deduplicación de mensajes** (`processed_webhooks`, `ON CONFLICT DO NOTHING`) — sólida.
- **Filtro de mensajes de staff** (`IgnorarEquipo`) — evita que Sofía responda a los propios reclutadores.
- **Migración de LID a teléfono real** (`MigrarLID`) — maneja bien un problema conocido de WAHA.
- **Validación cruzada de CURP INE↔RFC** (`SepararJSON`, distancia de Levenshtein) — tolera errores menores de OCR y bloquea discrepancias graves, con ruta de resolución manual ya construida (modal de alerta de identidad).
- **Reconciliación de citas huérfanas** y **filtro de eventos fantasma** (construidos en sesión anterior) — cubren bien el caso donde `Crear en Google Calendar` triunfa pero el estado en BD nunca se actualiza.
- **Asignación de CURP/documento inválido a revisión manual** en vez de descartarlo silenciosamente (fix de esta sesión) — el reclutador ve el dato crudo y decide.
- **Auto-asignación de reclutador por vacante**, ahora disparada desde ambos webhooks relevantes (fix de esta sesión) — deja de depender de una ventana frágil de "primera vez que llega la vacante".

---

## 4. Checklist de acciones pendientes

### En n8n (editar manualmente en la UI, no el JSON exportado)
- [ ] **#1** — Eliminar o asegurar el comando `/reset_sofia` (`1_Sofia - Inicio`)
- [ ] **#2** — `Actualizar DB a Cancelado`: `'Cancelado'` → `'CITA_CANCELADA'` (`EventosCalendario`)
- [ ] **#3** — Quitar `'CV_RECIBIDO'` de `estadosSinCatalogo` (`CargarPrompt`, `2_Sofia`)
- [ ] **#4** — `_agenda: {{ $('DefinirAgenda').first().json }}` (`PrepararDatosFlujoChat`, `2_Sofia`)
- [ ] **#5** — Fallback defensivo en `RevisarCalendario` (`3_Sofia`)
- [ ] **#7** — Agregar `Attendees` en `Crear en Google Calendar` (`EventosCalendario`)
- [ ] **#9** — Filtrar `Guardar ID en Base de Datos` también por `empresa_id`
- [ ] **#10** — Activar `Retry On Fail` en los nodos de Google Calendar
- [ ] **#11** — Confirmar que `1_Sofia - Inicio` esté realmente activo
- [ ] **#12** — Investigar/eliminar el workflow "Orquestador" duplicado

### Decisión pendiente (no bloqueante)
- [ ] **#6** — Decidir si se implementa `rate_limiting.last_message_at` de verdad, o se elimina el debounce muerto

### Ya resuelto en esta sesión (código)
- [x] **#8** — Deduplicada la lógica de `detalle_vacantes` en `frontend/src/lib/promptContext.ts`, usada por `/api/prompt-context` y `syncPromptContext.ts`
- [x] Archivo `virgo_data/data/prompt_context.json` regenerado con la lógica corregida
