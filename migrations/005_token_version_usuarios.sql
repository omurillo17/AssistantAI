-- Migración 005: versión de sesión por usuario.
--
-- El JWT de sesión dura 4 h y antes no había forma de anularlo: cerrar sesión
-- solo borraba la cookie de ese navegador, y cambiar la contraseña dejaba
-- vivas las sesiones robadas. Ahora el login firma `tv = token_version` y
-- cada petición lo compara con la base (lib/auth.ts); subir el número anula
-- de golpe todas las sesiones de ese usuario.
--
-- Aditiva: el valor por defecto 0 coincide con los JWT ya emitidos (sin `tv`
-- se toma 0), así que nadie pierde la sesión al desplegar.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
