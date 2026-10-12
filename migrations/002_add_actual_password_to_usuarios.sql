-- Migración 002: Agregar columna actual_password a la tabla usuarios
-- Permite que los roles ROOT y ADMIN puedan visualizar las contraseñas en el módulo de usuarios.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS actual_password VARCHAR(255);
