-- Migración 004: historial de estados y estados personalizados.
--
-- 1. estados_personalizados: estados que RH agrega a mano (por empresa). El
--    bot no los conoce ni los asigna; cada uno cae en un grupo del embudo para
--    que kanban y gráficas lo puedan ubicar.
-- 2. historial_estados: cada cambio de candidatos.estado, venga de donde venga
--    (bot en Python, webhooks, CRM). Sirve para medir días en cada estado.
-- 3. Un trigger reemplaza la CHECK valid_estado (que no puede consultar otra
--    tabla) y, además, impide que un proceso automático saque a un candidato
--    de un estado personalizado. Solo el CRM puede, marcando su transacción
--    con  SELECT set_config('app.origen', 'crm', true).
--
-- Todo es aditivo salvo el DROP de la CHECK, que el trigger reemplaza con la
-- misma lista de estados del bot.

CREATE TABLE IF NOT EXISTS estados_personalizados (
    clave VARCHAR(50) PRIMARY KEY,
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#64748b',
    grupo VARCHAR(20) NOT NULL CHECK (grupo IN ('pipeline', 'alerta', 'exitoso', 'descartado', 'pool')),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_estado_personalizado_nombre UNIQUE (empresa_id, nombre)
);

CREATE TABLE IF NOT EXISTS historial_estados (
    id BIGSERIAL PRIMARY KEY,
    candidato_id UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
    empresa_id UUID,
    estado_anterior VARCHAR(50),
    estado_nuevo VARCHAR(50) NOT NULL,
    -- 'crm' (una persona desde la plataforma), 'sistema' (bot, webhooks,
    -- jobs) o 'migracion' (fila inicial de esta migración).
    origen VARCHAR(20) NOT NULL,
    usuario VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_historial_estados_candidato ON historial_estados (candidato_id, created_at);

-- Punto de partida para los candidatos que ya existen. No hay registro de
-- cuándo entraron a su estado actual; updated_at es la mejor aproximación.
INSERT INTO historial_estados (candidato_id, empresa_id, estado_anterior, estado_nuevo, origen, created_at)
SELECT c.id, c.empresa_id, NULL, c.estado, 'migracion', COALESCE(c.updated_at, c.created_at, NOW())
FROM candidatos c
WHERE c.estado IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM historial_estados h WHERE h.candidato_id = c.id);

CREATE OR REPLACE FUNCTION candidatos_estado_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
        RETURN NEW;
    END IF;

    -- Un estado personalizado solo lo cambia una persona desde el CRM. El bot
    -- y los procesos automáticos siguen escribiendo el resto de columnas.
    IF TG_OP = 'UPDATE'
       AND COALESCE(current_setting('app.origen', true), '') <> 'crm'
       AND EXISTS (SELECT 1 FROM estados_personalizados WHERE clave = OLD.estado) THEN
        NEW.estado := OLD.estado;
        RETURN NEW;
    END IF;

    IF NEW.estado NOT IN (
        'NUEVO', 'INTERESADO', 'CV_RECIBIDO', 'CV_MANUAL',
        'FILTROS_COMPLETADOS', 'INE_VALIDADA',
        'CITA_AGENDADA', 'CITA_CANCELADA', 'RECORDATORIO_ENVIADO',
        'ESCALADO', 'DOCUMENTOS_NO_COINCIDEN',
        'ENTREVISTADO', 'CONTRATADO',
        'RECHAZADO', 'CARTERA_GENERAL', 'INACTIVO', 'OTRA_CIUDAD'
    ) AND NOT EXISTS (
        SELECT 1 FROM estados_personalizados
        WHERE clave = NEW.estado AND activo AND empresa_id IS NOT DISTINCT FROM NEW.empresa_id
    ) THEN
        RAISE EXCEPTION 'Estado inválido para el candidato: %', NEW.estado
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION candidatos_estado_historial() RETURNS trigger AS $$
BEGIN
    IF NEW.estado IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.estado IS DISTINCT FROM OLD.estado) THEN
        INSERT INTO historial_estados (candidato_id, empresa_id, estado_anterior, estado_nuevo, origen, usuario)
        VALUES (
            NEW.id,
            NEW.empresa_id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado END,
            NEW.estado,
            COALESCE(NULLIF(current_setting('app.origen', true), ''), 'sistema'),
            NULLIF(current_setting('app.usuario', true), '')
        );
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE candidatos DROP CONSTRAINT IF EXISTS valid_estado;

DROP TRIGGER IF EXISTS trg_candidatos_estado_guard ON candidatos;
CREATE TRIGGER trg_candidatos_estado_guard
    BEFORE INSERT OR UPDATE OF estado ON candidatos
    FOR EACH ROW EXECUTE FUNCTION candidatos_estado_guard();

DROP TRIGGER IF EXISTS trg_candidatos_estado_historial ON candidatos;
CREATE TRIGGER trg_candidatos_estado_historial
    AFTER INSERT OR UPDATE OF estado ON candidatos
    FOR EACH ROW EXECUTE FUNCTION candidatos_estado_historial();
