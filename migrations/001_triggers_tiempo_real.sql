-- 001 · Triggers de tiempo real (LISTEN/NOTIFY)
--
-- Ya viven en database_setup.sql, que solo se ejecuta cuando Postgres arranca
-- con el volumen vacío. Esta migración es la que los lleva a una base que ya
-- estaba creada. Las sentencias son idempotentes (CREATE OR REPLACE +
-- DROP TRIGGER IF EXISTS), así que volver a aplicarla no rompe nada.

-- Solo se notifica si cambió algo que la bandeja pinta. Sin este filtro,
-- cualquier UPDATE que reescribiera la fila con los mismos valores despertaba
-- a todos los clientes SSE, que recargaban el chat, lo que volvía a marcarlo
-- como leído: un lazo que se sostenía a ~20 UPDATE/s.
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

-- Campana de notificaciones del TopNavbar.
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

-- Tablero de Expedientes y alertas de identidad. El filtro evita despertar a
-- todas las pestañas en cada UPDATE del pipeline de Python.
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
