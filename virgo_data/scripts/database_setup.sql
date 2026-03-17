-- ============================================
-- ASSISTANT AI - DATABASE SETUP
-- Grupo Virgo
-- ============================================

-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLA: candidatos
-- Almacena información de todos los candidatos
-- ============================================

CREATE TABLE IF NOT EXISTS candidatos (
    -- Identificadores
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telefono VARCHAR(15) UNIQUE NOT NULL,
    nombre VARCHAR(100),
    nombre_confirmado BOOLEAN DEFAULT FALSE,
    nombre_chat VARCHAR(255),
    nombre_solicitud VARCHAR(255),
    nombre_ine VARCHAR(255),
    nombre_constancia VARCHAR(255),
    edad VARCHAR(50),
    correo VARCHAR(255),
    
    -- Estado del proceso
    estado VARCHAR(50) DEFAULT 'NUEVO',
    vacante_interes VARCHAR(50),
    tiene_cv BOOLEAN DEFAULT FALSE,
    cv_manual JSONB,
    datos_ine JSONB,
    datos_rfc TEXT,
    link_cv TEXT,
    
    -- Análisis de CV (si aplica)
    experiencia TEXT,
    veredicto VARCHAR(50),
    vacante_solicitada VARCHAR(50),
    vacante_sugerida VARCHAR(50),
    motivo_analisis TEXT,
    filtros_tecnicos TEXT,
    
    -- Memoria conversacional
    resumen_ia TEXT,
    ultima_actualizacion TIMESTAMP DEFAULT NOW(),
    ultima_interaccion TIMESTAMP DEFAULT NOW(),
    
    -- Citas
    ultima_cita TIMESTAMP,
    total_citas INTEGER DEFAULT 0,
    fecha_entrevista VARCHAR(255),
    
    -- Escalaciones
    escalado BOOLEAN DEFAULT FALSE,
    escalation_reason TEXT,
    escalated_at TIMESTAMP,
    
    -- Metadata
    privacidad_aceptada BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    source VARCHAR(50) DEFAULT 'whatsapp',
    
    -- Constraints
    CONSTRAINT valid_estado CHECK (estado IN (
        'NUEVO',
        'INTERESADO',
        'CV_RECIBIDO',
        'CV_MANUAL',
        'CITA_AGENDADA',
        'ESCALADO',
        'CARTERA_GENERAL',
        'ENTREVISTADO',
        'CONTRATADO',
        'RECHAZADO',
        'INACTIVO',
        'INE_VALIDADA',
        'RECORDATORIO_ENVIADO'
    )),
    
    CONSTRAINT valid_veredicto CHECK (veredicto IN (
        'VIABLE',
        'REUBICACION',
        'CARTERA_GENERAL',
        NULL
    ))
);

-- Índices para optimizar consultas
CREATE INDEX idx_candidatos_telefono ON candidatos(telefono);
CREATE INDEX idx_candidatos_estado ON candidatos(estado);
CREATE INDEX idx_candidatos_vacante ON candidatos(vacante_interes);
CREATE INDEX idx_candidatos_created ON candidatos(created_at DESC);
CREATE INDEX idx_candidatos_escalado ON candidatos(escalado) WHERE escalado = TRUE;

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_candidatos_updated_at
    BEFORE UPDATE ON candidatos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

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

CREATE INDEX idx_logs_timestamp ON system_logs(timestamp DESC);
CREATE INDEX idx_logs_severity ON system_logs(severity);
CREATE INDEX idx_logs_resolved ON system_logs(resolved) WHERE resolved = FALSE;
CREATE INDEX idx_logs_user ON system_logs(user_phone);
CREATE INDEX idx_logs_execution ON system_logs(execution_id);

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

CREATE INDEX idx_notifications_timestamp ON notifications_log(timestamp DESC);
CREATE INDEX idx_notifications_type ON notifications_log(notification_type);
CREATE INDEX idx_notifications_candidate ON notifications_log(candidate_phone);
CREATE INDEX idx_notifications_delivered ON notifications_log(delivered);

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

CREATE INDEX idx_metrics_timestamp ON metrics(timestamp DESC);
CREATE INDEX idx_metrics_type ON metrics(metric_type, metric_name);
CREATE INDEX idx_metrics_vacante ON metrics(vacante);

-- ============================================
-- TABLA: conversation_history
-- ============================================

CREATE TABLE IF NOT EXISTS conversation_history (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT NOW(),
    candidato_id UUID REFERENCES candidatos(id) ON DELETE CASCADE,
    telefono VARCHAR(50) NOT NULL,
    role VARCHAR(50) NOT NULL, 
    message_type VARCHAR(20), 
    content TEXT,
    detected_codes JSONB,
    ai_model VARCHAR(50),
    tokens_used INTEGER,
    response_time_ms INTEGER,
    CONSTRAINT valid_role CHECK (role IN ('user', 'assistant', 'system', 'user_temp'))
);

CREATE INDEX idx_conversation_candidato ON conversation_history(candidato_id);
CREATE INDEX idx_conversation_telefono ON conversation_history(telefono);
CREATE INDEX idx_conversation_timestamp ON conversation_history(timestamp DESC);

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

CREATE INDEX idx_ratelimit_telefono ON rate_limiting(telefono);
CREATE INDEX idx_ratelimit_blocked ON rate_limiting(is_blocked) WHERE is_blocked = TRUE;

-- ============================================
-- TABLA: processed_webhooks (NUEVA)
-- ============================================

CREATE TABLE IF NOT EXISTS processed_webhooks (
    message_id VARCHAR(255) PRIMARY KEY,
    processed_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- VISTAS ÚTILES
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
-- FUNCIONES ÚTILES
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
    SET messages_last_hour = messages_last_hour + 1, messages_last_day = messages_last_day + 1, last_message_at = NOW(), total_messages = total_messages + 1
    WHERE telefono = p_telefono;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_rate_limit()
RETURNS void AS $$
BEGIN
    UPDATE rate_limiting SET messages_last_hour = 0, window_hour_start = NOW() WHERE window_hour_start < NOW() - INTERVAL '1 hour';
    UPDATE rate_limiting SET messages_last_day = 0, window_day_start = NOW() WHERE window_day_start < NOW() - INTERVAL '1 day';
    UPDATE rate_limiting SET is_blocked = FALSE, blocked_until = NULL, block_reason = NULL WHERE is_blocked = TRUE AND blocked_until < NOW();
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

-- ============================================
-- FINALIZACIÓN
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '✅ Database setup actualizado exitosamente';
END $$;