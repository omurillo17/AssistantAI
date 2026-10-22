-- Migración 003: dejar de guardar contraseñas en claro.
-- El código ya no lee ni escribe `actual_password`; aquí se borran las que
-- quedaron guardadas. La columna se conserva por ahora para que la versión
-- anterior del frontend pueda seguir arrancando si hay que volver atrás; se
-- elimina en una migración posterior (ver migrations/README.md).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usuarios' AND column_name = 'actual_password'
  ) THEN
    UPDATE usuarios SET actual_password = NULL WHERE actual_password IS NOT NULL;
  END IF;
END $$;
