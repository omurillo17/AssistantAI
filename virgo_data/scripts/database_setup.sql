-- ============================================
-- ASSISTANT AI - DATABASE SETUP (COMPLETO)
-- Plataforma SaaS Multi-tenant de Reclutamiento
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TRIGGER FUNCTION (reutilizada por varias tablas)
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TABLA: empresas
-- Tenants del sistema SaaS
-- ============================================

CREATE TABLE IF NOT EXISTS empresas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre VARCHAR(255) NOT NULL,
    prompt_ia TEXT DEFAULT '',
    retencion_archivos_dias INTEGER DEFAULT 30,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLA: naves
-- Sucursales/plantas por empresa
-- ============================================

CREATE TABLE IF NOT EXISTS naves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre VARCHAR(255) NOT NULL,
    rfc VARCHAR(50) DEFAULT '',
    ubicacion_maps TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_naves_empresa ON naves(empresa_id);

-- ============================================
-- TABLA: grupos_reclutamiento
-- Grupos de reclutadores con naves asignadas.
-- Cada grupo es dueño de su propio numero/linea de WhatsApp
-- (en vez de tener un unico numero a nivel empresa).
-- ============================================

CREATE TABLE IF NOT EXISTS grupos_reclutamiento (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre VARCHAR(255) NOT NULL,
    naves_asignadas JSONB DEFAULT '[]',
    telefono_whatsapp VARCHAR(50) DEFAULT '',
    whatsapp_phone_number_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grupos_empresa ON grupos_reclutamiento(empresa_id);
CREATE INDEX IF NOT EXISTS idx_grupos_telefono ON grupos_reclutamiento(telefono_whatsapp) WHERE telefono_whatsapp <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_grupos_phone_number_id ON grupos_reclutamiento(whatsapp_phone_number_id) WHERE whatsapp_phone_number_id IS NOT NULL;

-- ============================================
-- TABLA: reclutadores
-- ============================================

CREATE TABLE IF NOT EXISTS reclutadores (
    id VARCHAR(100) PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    telefono VARCHAR(50) DEFAULT '',
    calendar_id VARCHAR(255) DEFAULT '',
    color VARCHAR(20) DEFAULT '#6366f1',
    empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    naves JSONB
);

CREATE INDEX IF NOT EXISTS idx_reclutadores_empresa ON reclutadores(empresa_id);

CREATE TRIGGER update_reclutadores_updated_at
    BEFORE UPDATE ON reclutadores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- TABLA: google_calendar_credentials
-- Refresh tokens OAuth de Google Calendar por cuenta de reclutador
-- (calendar_id = reclutadores.calendar_id), usados por el servicio
-- backend/ que reemplaza progresivamente los workflows de n8n. Se llena
-- con backend/scripts/authorize_recruiter.py (flujo manual, una vez por
-- reclutador), no de forma programática.
-- ============================================

CREATE TABLE IF NOT EXISTS google_calendar_credentials (
    calendar_id VARCHAR(255) PRIMARY KEY,
    refresh_token_encrypted TEXT NOT NULL,
    scopes VARCHAR(500) NOT NULL DEFAULT 'https://www.googleapis.com/auth/calendar',
    authorized_by VARCHAR(255) DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TRIGGER update_google_calendar_credentials_updated_at
    BEFORE UPDATE ON google_calendar_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- TABLA: vacantes_def
-- Definicion de vacantes por reclutador
-- ============================================

CREATE TABLE IF NOT EXISTS vacantes_def (
    id VARCHAR(100) PRIMARY KEY,
    reclutador_id VARCHAR(100) NOT NULL REFERENCES reclutadores(id) ON DELETE CASCADE,
    nombre VARCHAR(255) NOT NULL,
    naves TEXT DEFAULT '[]',
    detalles TEXT DEFAULT '',
    -- Actividades/funciones del puesto que Sofia le muestra al candidato en un
    -- segundo mensaje, aparte de los detalles (sueldo/horario), para que sepa
    -- qué va a hacer antes de invertir tiempo en el proceso.
    funciones TEXT DEFAULT '',
    -- Sinónimos con los que el candidato puede referirse a la vacante
    -- ("chofer" -> OPERADOR DE VEHÍCULO). Se le pasan a la IA en el catálogo.
    palabras_clave TEXT DEFAULT '',
    filtros JSONB DEFAULT '[]',
    activa BOOLEAN DEFAULT TRUE,
    orden INTEGER DEFAULT 0,
    empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    nave_id UUID REFERENCES naves(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vacantes_reclutador ON vacantes_def(reclutador_id);
CREATE INDEX IF NOT EXISTS idx_vacantes_empresa ON vacantes_def(empresa_id);
CREATE INDEX IF NOT EXISTS idx_vacantes_nave ON vacantes_def(nave_id);

CREATE TRIGGER update_vacantes_def_updated_at
    BEFORE UPDATE ON vacantes_def
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- TABLA: usuarios
-- Usuarios del CRM/panel de administracion
-- ============================================

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    -- `usuario` es la credencial de inicio de sesion (sin acentos ni espacios,
    -- ver normalizeUsername); `nombre` es como se le llama a la persona en toda
    -- la interfaz. Separarlos permite renombrar a alguien en pantalla sin
    -- romperle el login.
    usuario VARCHAR(100) UNIQUE NOT NULL,
    nombre VARCHAR(255) DEFAULT '',
    password_hash TEXT NOT NULL,
    actual_password VARCHAR(255),
    rol VARCHAR(50) DEFAULT 'USER',
    reclutador_id VARCHAR(100) REFERENCES reclutadores(id) ON DELETE SET NULL,
    grupo_id UUID REFERENCES grupos_reclutamiento(id) ON DELETE SET NULL,
    empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    -- Superusuario del sistema: invisible en el módulo de usuarios (ni para
    -- otros ROOT), imborrable, y el único que puede otorgar el rol ROOT. Es la
    -- cuenta de último recurso para recuperar el control de la plataforma, así
    -- que no debe poder quedarse fuera ni por error ni por un ROOT hostil.
    protegido BOOLEAN DEFAULT FALSE,
    CONSTRAINT valid_rol CHECK (rol IN ('ROOT', 'ADMIN', 'USER', 'RECLUTADOR', 'ENCARGADO'))
);

CREATE INDEX IF NOT EXISTS idx_usuarios_empresa ON usuarios(empresa_id);

-- Solo puede haber un superusuario protegido.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_protegido ON usuarios(protegido) WHERE protegido;

-- Defensa en profundidad: la API ya bloquea borrar o degradar al superusuario,
-- pero esto cubre el acceso directo por SQL (psql, un script de migración, una
-- restauración a medias). Perder esta cuenta deja al sistema sin nadie capaz de
-- repartir el rol ROOT.
CREATE OR REPLACE FUNCTION proteger_superusuario()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.protegido THEN
            RAISE EXCEPTION 'El superusuario % no se puede eliminar', OLD.usuario;
        END IF;
        RETURN OLD;
    END IF;

    -- UPDATE: no se le puede quitar la marca ni degradar el rol.
    IF OLD.protegido AND NOT NEW.protegido THEN
        RAISE EXCEPTION 'No se puede quitar la proteccion al superusuario %', OLD.usuario;
    END IF;
    IF OLD.protegido AND NEW.rol <> 'ROOT' THEN
        RAISE EXCEPTION 'El superusuario % debe conservar el rol ROOT', OLD.usuario;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proteger_superusuario ON usuarios;
CREATE TRIGGER trg_proteger_superusuario
    BEFORE UPDATE OR DELETE ON usuarios
    FOR EACH ROW
    EXECUTE FUNCTION proteger_superusuario();

-- ============================================
-- TABLA: candidatos
-- Tabla principal de candidatos
-- ============================================

CREATE TABLE IF NOT EXISTS candidatos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telefono VARCHAR(20) NOT NULL,
    nombre VARCHAR(255),
    nombre_confirmado BOOLEAN DEFAULT FALSE,
    nombre_chat VARCHAR(255),
    nombre_solicitud VARCHAR(255),
    nombre_ine VARCHAR(255),
    nombre_constancia VARCHAR(255),
    edad VARCHAR(50),
    correo VARCHAR(255),

    -- Municipio/ciudad que declara el candidato. Sofia la usa para decidir si
    -- esta dentro de la cobertura (ZMG) antes de ofrecerle vacantes; si no lo
    -- esta, el expediente se cierra con estado OTRA_CIUDAD conservando aqui la
    -- ciudad, para saber por que se descarto.
    lugar_residencia VARCHAR(255),

    estado VARCHAR(50) DEFAULT 'NUEVO',
    vacante_interes VARCHAR(100),
    nave_interes VARCHAR(100),
    tiene_cv BOOLEAN DEFAULT FALSE,
    cv_manual JSONB,
    datos_ine JSONB,
    datos_rfc TEXT,
    curp_ine VARCHAR(50),
    curp_rfc VARCHAR(50),
    alerta_identidad_estado VARCHAR(20),
    alerta_identidad_motivo TEXT,
    link_cv TEXT,

    experiencia TEXT,
    -- Lo que el candidato contesta cuando Sofia le lee las actividades del
    -- puesto y le pregunta en cuáles tiene experiencia. Se guarda aparte de
    -- `experiencia` (que sale del CV) porque es su respuesta textual sobre
    -- ESTA vacante, y es lo que el reclutador quiere leer antes de la cita.
    experiencia_actividades TEXT,
    veredicto VARCHAR(50),
    vacante_solicitada VARCHAR(100),
    vacante_sugerida VARCHAR(100),
    motivo_analisis TEXT,
    filtros_tecnicos TEXT,

    resumen_ia TEXT,
    ultima_actualizacion TIMESTAMP DEFAULT NOW(),
    ultima_interaccion TIMESTAMP DEFAULT NOW(),

    ultima_cita TIMESTAMP,
    total_citas INTEGER DEFAULT 0,
    cancelaciones INTEGER DEFAULT 0,
    fecha_entrevista VARCHAR(255),
    event_id VARCHAR(255),

    escalado BOOLEAN DEFAULT FALSE,
    escalation_reason TEXT,
    escalated_at TIMESTAMP,

    asignado_a_id VARCHAR(100) REFERENCES reclutadores(id) ON DELETE SET NULL,
    mensajes_bot_enviados INTEGER DEFAULT 0,
    privacidad_aceptada BOOLEAN DEFAULT FALSE,
    ultima_ejecucion_id VARCHAR(255),

    empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL,
    nave_id UUID REFERENCES naves(id) ON DELETE SET NULL,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    source VARCHAR(50) DEFAULT 'whatsapp',

    CONSTRAINT uq_candidato_telefono_empresa UNIQUE (telefono, empresa_id),

    CONSTRAINT valid_estado CHECK (estado IN (
        'NUEVO', 'INTERESADO', 'CV_RECIBIDO', 'CV_MANUAL',
        'FILTROS_COMPLETADOS', 'INE_VALIDADA',
        'CITA_AGENDADA', 'CITA_CANCELADA', 'RECORDATORIO_ENVIADO',
        'ESCALADO', 'DOCUMENTOS_NO_COINCIDEN',
        'ENTREVISTADO', 'CONTRATADO',
        'RECHAZADO', 'CARTERA_GENERAL', 'INACTIVO', 'OTRA_CIUDAD'
    )),

    CONSTRAINT valid_veredicto CHECK (veredicto IS NULL OR veredicto IN (
        'VIABLE', 'NO VIABLE', 'REUBICACION', 'CARTERA_GENERAL', 'RECHAZADO'
    )),

    CONSTRAINT valid_alerta_identidad_estado CHECK (alerta_identidad_estado IS NULL OR alerta_identidad_estado IN (
        'PENDIENTE', 'VALIDADO', 'RECHAZADO'
    ))
);

CREATE INDEX IF NOT EXISTS idx_candidatos_telefono ON candidatos(telefono);
CREATE INDEX IF NOT EXISTS idx_candidatos_estado ON candidatos(estado);
CREATE INDEX IF NOT EXISTS idx_candidatos_vacante ON candidatos(vacante_interes);
CREATE INDEX IF NOT EXISTS idx_candidatos_created ON candidatos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidatos_escalado ON candidatos(escalado) WHERE escalado = TRUE;
CREATE INDEX IF NOT EXISTS idx_candidatos_empresa ON candidatos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_candidatos_asignado_a ON candidatos(asignado_a_id);

CREATE TRIGGER update_candidatos_updated_at
    BEFORE UPDATE ON candidatos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- TABLA: conversation_history
-- Historial completo de mensajes
-- ============================================

CREATE TABLE IF NOT EXISTS conversation_history (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT NOW(),
    candidato_id UUID REFERENCES candidatos(id) ON DELETE CASCADE,
    telefono VARCHAR(50) NOT NULL,
    role VARCHAR(50) NOT NULL,
    message_type VARCHAR(20),
    content TEXT,
    media_url TEXT,
    detected_codes JSONB,
    ai_model VARCHAR(50),
    tokens_used INTEGER,
    response_time_ms INTEGER,
    CONSTRAINT valid_role CHECK (role IN ('user', 'assistant', 'system', 'user_temp'))
);

CREATE INDEX IF NOT EXISTS idx_conversation_candidato ON conversation_history(candidato_id);
CREATE INDEX IF NOT EXISTS idx_conversation_telefono ON conversation_history(telefono);
CREATE INDEX IF NOT EXISTS idx_conversation_timestamp ON conversation_history(timestamp DESC);

-- ============================================
-- TABLA: mensajes_bandeja
-- Bandeja de mensajes del CRM (inbox)
-- ============================================

CREATE TABLE IF NOT EXISTS mensajes_bandeja (
    id SERIAL PRIMARY KEY,
    candidato_id UUID UNIQUE NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
    telefono VARCHAR(50),
    ultimo_mensaje TEXT,
    ultimo_mensaje_rol VARCHAR(50) DEFAULT 'user',
    ultimo_mensaje_at TIMESTAMP DEFAULT NOW(),
    asignado_a_id VARCHAR(100) REFERENCES reclutadores(id) ON DELETE SET NULL,
    mensajes_no_leidos INTEGER DEFAULT 0,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bandeja_candidato ON mensajes_bandeja(candidato_id);
CREATE INDEX IF NOT EXISTS idx_bandeja_activo ON mensajes_bandeja(activo) WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_bandeja_asignado_a ON mensajes_bandeja(asignado_a_id);

CREATE TRIGGER update_bandeja_updated_at
    BEFORE UPDATE ON mensajes_bandeja
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- TABLA: notificaciones
-- Notificaciones para reclutadores en el CRM
-- ============================================

CREATE TABLE IF NOT EXISTS notificaciones (
    id SERIAL PRIMARY KEY,
    reclutador_id VARCHAR(100) REFERENCES reclutadores(id) ON DELETE CASCADE,
    mensaje TEXT NOT NULL,
    leida BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_reclutador ON notificaciones(reclutador_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_no_leidas ON notificaciones(leida) WHERE leida = FALSE;

-- ============================================
-- TABLA: cola_mensajes
-- Outbox de mensajes pendientes de enviar via WAHA
-- ============================================

CREATE TABLE IF NOT EXISTS cola_mensajes (
    id SERIAL PRIMARY KEY,
    telefono VARCHAR(50) NOT NULL,
    texto TEXT NOT NULL,
    asignado_a VARCHAR(255),
    estado VARCHAR(20) DEFAULT 'PENDIENTE',
    reintentos INTEGER DEFAULT 0,
    error_detalle TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cola_pendiente ON cola_mensajes(estado) WHERE estado = 'PENDIENTE';

CREATE TRIGGER update_cola_updated_at
    BEFORE UPDATE ON cola_mensajes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- TABLA: reclutadores_turno
-- Round-robin de asignacion entre reclutadores
-- ============================================

CREATE TABLE IF NOT EXISTS reclutadores_turno (
    grupo VARCHAR(100) PRIMARY KEY,
    ultimo_index INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLA: n8n_chat_histories
-- Memoria de conversación del agente de IA (backend/app/chat/memoria.py).
-- Mismo nombre/esquema que usaba el nodo Postgres Chat Memory de n8n
-- (formato jsonb compatible con LangChain) para no perder continuidad
-- si algún día hay que revertir esa pieza a n8n.
-- ============================================

CREATE TABLE IF NOT EXISTS n8n_chat_histories (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    message JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_histories_session ON n8n_chat_histories(session_id);

-- ============================================
-- TABLA: system_logs
-- ============================================

CREATE TABLE IF NOT EXISTS system_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP DEFAULT NOW(),
    severity VARCHAR(20) NOT NULL,
    node_name VARCHAR(100),
    execution_id VARCHAR(100),
    error_message TEXT,
    error_details JSONB,
    error_code VARCHAR(50),
    user_phone VARCHAR(15),
    user_name VARCHAR(100),
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP,
    resolved_by VARCHAR(100),
    resolution_notes TEXT,
    environment VARCHAR(50) DEFAULT 'production',
    CONSTRAINT valid_severity CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON system_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_severity ON system_logs(severity);
CREATE INDEX IF NOT EXISTS idx_logs_resolved ON system_logs(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_logs_user ON system_logs(user_phone);
CREATE INDEX IF NOT EXISTS idx_logs_execution ON system_logs(execution_id);

-- ============================================
-- TABLA: notifications_log
-- ============================================

CREATE TABLE IF NOT EXISTS notifications_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP DEFAULT NOW(),
    notification_type VARCHAR(50) NOT NULL,
    recipient VARCHAR(50) NOT NULL,
    recipient_type VARCHAR(20),
    candidate_phone VARCHAR(15),
    candidate_name VARCHAR(100),
    vacante VARCHAR(50),
    sent_at TIMESTAMP,
    delivered BOOLEAN DEFAULT FALSE,
    delivery_status VARCHAR(50),
    error_message TEXT,
    priority VARCHAR(20) DEFAULT 'normal',
    CONSTRAINT valid_notification_type CHECK (notification_type IN (
        'NEW_APPOINTMENT', 'NEW_CV', 'MANUAL_PROFILE', 'ESCALATION',
        'GENERAL_POOL', 'GENERAL_UPDATE', 'ERROR'
    )),
    CONSTRAINT valid_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_timestamp ON notifications_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications_log(notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_candidate ON notifications_log(candidate_phone);
CREATE INDEX IF NOT EXISTS idx_notifications_delivered ON notifications_log(delivered);

-- ============================================
-- TABLA: metrics
-- ============================================

CREATE TABLE IF NOT EXISTS metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP DEFAULT NOW(),
    metric_type VARCHAR(50) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value NUMERIC,
    metric_unit VARCHAR(20),
    vacante VARCHAR(50),
    periodo VARCHAR(20),
    metadata JSONB,
    CONSTRAINT valid_metric_type CHECK (metric_type IN (
        'conversation', 'conversion', 'response_time', 'error_rate',
        'escalation_rate', 'appointment_rate', 'cv_submission_rate'
    ))
);

CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_type ON metrics(metric_type, metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_vacante ON metrics(vacante);

-- ============================================
-- TABLA: rate_limiting
-- ============================================

CREATE TABLE IF NOT EXISTS rate_limiting (
    id UUID UNIQUE DEFAULT uuid_generate_v4(),
    telefono VARCHAR(50) PRIMARY KEY,
    messages_last_hour INTEGER DEFAULT 0,
    messages_last_day INTEGER DEFAULT 0,
    window_hour_start TIMESTAMP DEFAULT NOW(),
    window_day_start TIMESTAMP DEFAULT NOW(),
    is_blocked BOOLEAN DEFAULT FALSE,
    blocked_until TIMESTAMP,
    block_reason TEXT,
    last_message_at TIMESTAMP DEFAULT NOW(),
    total_messages INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ratelimit_telefono ON rate_limiting(telefono);
CREATE INDEX IF NOT EXISTS idx_ratelimit_blocked ON rate_limiting(is_blocked) WHERE is_blocked = TRUE;

-- ============================================
-- TABLA: processed_webhooks
-- Deduplicacion de mensajes entrantes
-- ============================================

CREATE TABLE IF NOT EXISTS processed_webhooks (
    message_id VARCHAR(255) PRIMARY KEY,
    processed_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLA: numeros_ignorados
-- Lista negra: numeros a los que Sofia NO debe contestar
-- ============================================
-- Reclutadoras, jefes, proveedores y demas gente interna que le escribe al
-- WhatsApp del bot. Sin esta lista el pipeline los trata como un candidato
-- mas: les crea expediente, gasta llamadas a Gemini y les manda el aviso de
-- privacidad. `_es_reclutador()` en ingesta.py ya cubre al equipo dado de
-- alta en `reclutadores`, pero no a nadie mas -- esta tabla es la manija
-- manual para el resto.
--
-- `telefono` se guarda normalizado a los ULTIMOS 10 DIGITOS a proposito: el
-- mismo numero llega de WhatsApp como 5213312345678, 523312345678 o
-- 3312345678 segun el dispositivo y la version de WAHA, asi que comparar la
-- cadena completa fallaria justo con quien se quiere silenciar.
--
-- `activo` en vez de borrar el renglon: quitar a alguien de la lista es
-- reversible y queda el motivo por el que se puso.

CREATE TABLE IF NOT EXISTS numeros_ignorados (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telefono VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(255),
    motivo TEXT,
    activo BOOLEAN DEFAULT TRUE,
    creado_por VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    CONSTRAINT telefono_normalizado_10_digitos CHECK (telefono ~ '^[0-9]{10}$')
);

CREATE INDEX IF NOT EXISTS idx_numeros_ignorados_activos
    ON numeros_ignorados(telefono) WHERE activo = TRUE;

-- La normalizacion vive en la BD y no en quien inserta: esta tabla se
-- administra a mano con psql, y pegar el numero como viene de WhatsApp
-- (+52 1 33 1234 5678, 5213312345678, 3312345678@c.us) es justo lo que se va
-- a hacer. El trigger lo recorta a los ultimos 10 digitos; la CHECK de arriba
-- sigue rechazando lo que ni asi queda como telefono (un numero incompleto,
-- texto suelto), para que un renglon invalido truene al insertarse en vez de
-- quedarse callado sin silenciar a nadie.
CREATE OR REPLACE FUNCTION normalizar_numero_ignorado() RETURNS trigger AS $$
BEGIN
    NEW.telefono := RIGHT(regexp_replace(COALESCE(NEW.telefono, ''), '[^0-9]', '', 'g'), 10);
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalizar_numero_ignorado ON numeros_ignorados;
CREATE TRIGGER trg_normalizar_numero_ignorado
    BEFORE INSERT OR UPDATE ON numeros_ignorados
    FOR EACH ROW EXECUTE FUNCTION normalizar_numero_ignorado();

-- ============================================
-- TABLA: lid_telefono
-- Mapeo del LID de WhatsApp al telefono real
-- ============================================
-- WhatsApp entrega el remitente a veces como LID (identificador opaco) en vez
-- del numero. La resolucion se hacia solo contra WAHA, que OLVIDA los LID
-- viejos: de 33 sesiones huerfanas encontradas el 19/08/2026, 17 ya no existian
-- en WAHA y su mapeo se perdio para siempre. Aqui queda persistido.
--
-- La PK es el lid y no el telefono: WhatsApp rota los LID, asi que un mismo
-- candidato puede acumular varios a lo largo del tiempo.

CREATE TABLE IF NOT EXISTS lid_telefono (
    lid VARCHAR(50) PRIMARY KEY,
    telefono VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lid_telefono_telefono ON lid_telefono(telefono);

-- ============================================
-- VISTAS
-- ============================================

CREATE OR REPLACE VIEW candidatos_activos_por_vacante AS
SELECT
    vacante_interes,
    COUNT(*) as total,
    COUNT(CASE WHEN estado = 'CITA_AGENDADA' THEN 1 END) as con_cita,
    COUNT(CASE WHEN tiene_cv = TRUE THEN 1 END) as con_cv,
    COUNT(CASE WHEN escalado = TRUE THEN 1 END) as escalados
FROM candidatos
WHERE estado NOT IN ('RECHAZADO', 'INACTIVO')
GROUP BY vacante_interes;

CREATE OR REPLACE VIEW errores_pendientes AS
SELECT
    severity,
    node_name,
    COUNT(*) as total,
    MIN(timestamp) as primer_error,
    MAX(timestamp) as ultimo_error
FROM system_logs
WHERE resolved = FALSE
GROUP BY severity, node_name
ORDER BY
    CASE severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
    END,
    total DESC;

CREATE OR REPLACE VIEW metricas_diarias AS
SELECT
    DATE(timestamp) as fecha,
    metric_type,
    metric_name,
    AVG(metric_value) as promedio,
    MIN(metric_value) as minimo,
    MAX(metric_value) as maximo,
    COUNT(*) as mediciones
FROM metrics
GROUP BY DATE(timestamp), metric_type, metric_name
ORDER BY fecha DESC, metric_type;

-- ============================================
-- FUNCIONES
-- ============================================

CREATE OR REPLACE FUNCTION get_or_create_candidato(p_telefono VARCHAR)
RETURNS UUID AS $$
DECLARE
    v_candidato_id UUID;
BEGIN
    SELECT id INTO v_candidato_id FROM candidatos WHERE telefono = p_telefono;
    IF v_candidato_id IS NULL THEN
        INSERT INTO candidatos (telefono, estado) VALUES (p_telefono, 'NUEVO')
        RETURNING id INTO v_candidato_id;
    END IF;
    RETURN v_candidato_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_rate_limit(
    p_telefono VARCHAR,
    p_limit_hour INTEGER DEFAULT 30,
    p_limit_day INTEGER DEFAULT 100
)
RETURNS BOOLEAN AS $$
DECLARE
    v_messages_hour INTEGER;
    v_messages_day INTEGER;
    v_is_blocked BOOLEAN;
    v_blocked_until TIMESTAMP;
BEGIN
    SELECT is_blocked, blocked_until INTO v_is_blocked, v_blocked_until
    FROM rate_limiting WHERE telefono = p_telefono;

    IF v_is_blocked AND v_blocked_until > NOW() THEN RETURN FALSE; END IF;

    SELECT messages_last_hour, messages_last_day INTO v_messages_hour, v_messages_day
    FROM rate_limiting WHERE telefono = p_telefono;

    IF v_messages_hour IS NULL THEN
        INSERT INTO rate_limiting (telefono, messages_last_hour, messages_last_day)
        VALUES (p_telefono, 1, 1);
        RETURN TRUE;
    END IF;

    IF v_messages_hour >= p_limit_hour OR v_messages_day >= p_limit_day THEN
        UPDATE rate_limiting SET is_blocked = TRUE, blocked_until = NOW() + INTERVAL '1 hour', block_reason = 'Rate limit exceeded'
        WHERE telefono = p_telefono;
        RETURN FALSE;
    END IF;

    UPDATE rate_limiting
    SET messages_last_hour = messages_last_hour + 1,
        messages_last_day = messages_last_day + 1,
        last_message_at = NOW(),
        total_messages = total_messages + 1
    WHERE telefono = p_telefono;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_rate_limit()
RETURNS void AS $$
BEGIN
    UPDATE rate_limiting SET messages_last_hour = 0, window_hour_start = NOW()
    WHERE window_hour_start < NOW() - INTERVAL '1 hour';
    UPDATE rate_limiting SET messages_last_day = 0, window_day_start = NOW()
    WHERE window_day_start < NOW() - INTERVAL '1 day';
    UPDATE rate_limiting SET is_blocked = FALSE, blocked_until = NULL, block_reason = NULL
    WHERE is_blocked = TRUE AND blocked_until < NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- DATOS INICIALES
-- ============================================

INSERT INTO metrics (metric_type, metric_name, metric_value, metric_unit, periodo)
VALUES
    ('conversation', 'total_conversations', 0, 'count', 'daily'),
    ('conversion', 'cv_to_appointment_rate', 0, 'percentage', 'daily'),
    ('response_time', 'avg_response_time', 0, 'milliseconds', 'hourly'),
    ('error_rate', 'total_errors', 0, 'count', 'hourly')
ON CONFLICT DO NOTHING;

-- Usuario ROOT (administrador global de la plataforma SaaS).
-- Hash bcrypt (costo 10) precalculado para la contraseña; NO se genera en SQL
-- para no depender de la extension pgcrypto.
INSERT INTO usuarios (usuario, password_hash, actual_password, rol)
VALUES (
    'omurillo17',
    '$2b$10$WSjKYnyEbq0nyUWmtSQTQOSwCh4LDG4wCzE2e.V1wcl8vnbUSSojG',
    'Gg172125',
    'ROOT'
)
ON CONFLICT (usuario) DO NOTHING;

-- ============================================
-- MIGRACIONES SOBRE BASES YA EXISTENTES
-- ============================================
-- Los CREATE TABLE de arriba son IF NOT EXISTS, asi que NO agregan columnas
-- nuevas a una base que ya fue creada. Toda columna que se agregue despues del
-- primer despliegue necesita ademas su ALTER TABLE idempotente aqui.

-- Permitir a ROOT y ADMIN consultar contraseñas en el módulo de usuarios.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS actual_password VARCHAR(255);

-- Actividades del puesto que Sofia manda al candidato tras los detalles.
ALTER TABLE vacantes_def ADD COLUMN IF NOT EXISTS funciones TEXT DEFAULT '';

-- Sinonimos con los que el candidato puede referirse a la vacante.
ALTER TABLE vacantes_def ADD COLUMN IF NOT EXISTS palabras_clave TEXT DEFAULT '';

-- Ciudad/municipio declarado por el candidato (filtro de cobertura de Sofia).
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS lugar_residencia VARCHAR(255);

-- Candidatos fuera de la zona de cobertura: analizador.py y parser.py escriben
-- estado = 'OTRA_CIUDAD', asi que la CHECK tiene que aceptarlo o el UPDATE
-- truena y el expediente se queda a medias. En una base ya creada la CHECK
-- vieja sigue viva, hay que reemplazarla.
ALTER TABLE candidatos DROP CONSTRAINT IF EXISTS valid_estado;
ALTER TABLE candidatos ADD CONSTRAINT valid_estado CHECK (estado IN (
    'NUEVO', 'INTERESADO', 'CV_RECIBIDO', 'CV_MANUAL',
    'FILTROS_COMPLETADOS', 'INE_VALIDADA',
    'CITA_AGENDADA', 'CITA_CANCELADA', 'RECORDATORIO_ENVIADO',
    'ESCALADO', 'DOCUMENTOS_NO_COINCIDEN',
    'ENTREVISTADO', 'CONTRATADO',
    'RECHAZADO', 'CARTERA_GENERAL', 'INACTIVO', 'OTRA_CIUDAD'
));

-- Notificaciones en tiempo real (LISTEN/NOTIFY) para el modulo de Mensajes del
-- frontend: reemplaza el polling de 4s por un push cuando de verdad se
-- inserta un mensaje o cambia la bandeja, sin importar que servicio escribio
-- (Python via asyncpg o Next.js via pg) -- el trigger vive en la BD, no en
-- el codigo de cada servicio, para no depender de acordarse de notificar en
-- cada punto de insercion.
CREATE OR REPLACE FUNCTION notify_conversation_history_insert() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('conversation_history_insert', json_build_object(
        'telefono', NEW.telefono,
        'role', NEW.role,
        'id', NEW.id
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversation_history_notify ON conversation_history;
CREATE TRIGGER trg_conversation_history_notify
    AFTER INSERT ON conversation_history
    FOR EACH ROW EXECUTE FUNCTION notify_conversation_history_insert();

-- Solo se notifica si cambio algo que la bandeja pinta. Sin este filtro
-- cualquier UPDATE que reescribiera la fila con los mismos valores (p.ej.
-- marcar como leido una conversacion que ya estaba leida) despertaba a todos
-- los clientes SSE, que recargaban el chat, lo que volvia a marcar como leido:
-- un lazo de realimentacion que se sostenia a ~20 UPDATE/s.
CREATE OR REPLACE FUNCTION notify_mensajes_bandeja_change() RETURNS trigger AS $$
BEGIN
    IF (TG_OP = 'INSERT') OR (
        NEW.mensajes_no_leidos IS DISTINCT FROM OLD.mensajes_no_leidos
        OR NEW.ultimo_mensaje IS DISTINCT FROM OLD.ultimo_mensaje
        OR NEW.ultimo_mensaje_at IS DISTINCT FROM OLD.ultimo_mensaje_at
        OR NEW.asignado_a_id IS DISTINCT FROM OLD.asignado_a_id
        OR NEW.activo IS DISTINCT FROM OLD.activo
    ) THEN
        PERFORM pg_notify('mensajes_bandeja_change', json_build_object(
            'telefono', NEW.telefono,
            'candidato_id', NEW.candidato_id
        )::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mensajes_bandeja_notify ON mensajes_bandeja;
CREATE TRIGGER trg_mensajes_bandeja_notify
    AFTER INSERT OR UPDATE ON mensajes_bandeja
    FOR EACH ROW EXECUTE FUNCTION notify_mensajes_bandeja_change();

-- Mismo puente para la campana de notificaciones del TopNavbar, que sondeaba
-- cada 10s, y para los cambios de candidato (tablero de Expedientes y las
-- alertas de identidad, que sondeaban cada 20s y 10s respectivamente).
CREATE OR REPLACE FUNCTION notify_notificacion_insert() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('notificacion_change', json_build_object(
        'reclutador_id', NEW.reclutador_id
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notificacion_notify ON notificaciones;
CREATE TRIGGER trg_notificacion_notify
    AFTER INSERT OR UPDATE ON notificaciones
    FOR EACH ROW EXECUTE FUNCTION notify_notificacion_insert();

-- Solo se avisa cuando cambia algo que el CRM pinta. Sin este filtro, cada
-- UPDATE de candidatos (los hace el pipeline de Python en cada mensaje)
-- despertaria a todas las pestanas abiertas para nada.
CREATE OR REPLACE FUNCTION notify_candidato_change() RETURNS trigger AS $$
BEGIN
    IF (TG_OP = 'INSERT') OR (
        NEW.estado IS DISTINCT FROM OLD.estado
        OR NEW.alerta_identidad_estado IS DISTINCT FROM OLD.alerta_identidad_estado
        OR NEW.escalado IS DISTINCT FROM OLD.escalado
        OR NEW.veredicto IS DISTINCT FROM OLD.veredicto
        OR NEW.asignado_a_id IS DISTINCT FROM OLD.asignado_a_id
        OR NEW.vacante_interes IS DISTINCT FROM OLD.vacante_interes
        OR NEW.nave_interes IS DISTINCT FROM OLD.nave_interes
        OR NEW.fecha_entrevista IS DISTINCT FROM OLD.fecha_entrevista
    ) THEN
        PERFORM pg_notify('candidato_change', json_build_object(
            'telefono', NEW.telefono,
            'alerta', (NEW.alerta_identidad_estado IS DISTINCT FROM
                       CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.alerta_identidad_estado END)
        )::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_candidato_notify ON candidatos;
CREATE TRIGGER trg_candidato_notify
    AFTER INSERT OR UPDATE ON candidatos
    FOR EACH ROW EXECUTE FUNCTION notify_candidato_change();

-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Database setup completado - 21 tablas, 3 vistas, 8 funciones';
END $$;
