#!/usr/bin/env bash
# ==============================================================================
# Crea (o actualiza) el rol de base de datos de la aplicación - AssistantAI
# ==============================================================================
# backend y frontend se conectaban con el superusuario de Postgres: una
# inyección SQL o una fuga de DATABASE_URL daba DROP, COPY ... PROGRAM, etc.
# Este rol solo puede leer y escribir filas (SELECT/INSERT/UPDATE/DELETE) y
# usar secuencias. El superusuario queda para migraciones, backups y restore.
#
#   APP_DB_USER y APP_DB_PASSWORD se leen del .env (o del entorno).
#   ./scripts/crear_rol_app.sh
#
# Es idempotente: re-ejecútalo tras una restauración o si cambias la contraseña.
# Después, recrea backend y frontend para que usen el rol (ver PRODUCCION.md).
# ==============================================================================

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

[[ -f .env ]] || { echo "ERROR: no hay .env en $RAIZ"; exit 1; }
leer_env() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '"'\''\r '; }
DB_USER="$(leer_env DB_POSTGRESDB_USER)"
DB_NAME="$(leer_env DB_POSTGRESDB_DATABASE)"
APP_DB_USER="${APP_DB_USER:-$(leer_env APP_DB_USER)}"
APP_DB_PASSWORD="${APP_DB_PASSWORD:-$(leer_env APP_DB_PASSWORD)}"

[[ -n "$DB_USER" && -n "$DB_NAME" ]] || { echo "ERROR: falta DB_POSTGRESDB_USER o DB_POSTGRESDB_DATABASE en .env"; exit 1; }
[[ "$APP_DB_USER" =~ ^[a-z_][a-z0-9_]{2,62}$ ]] || { echo "ERROR: APP_DB_USER vacío o inválido (ej. virgo_app)"; exit 1; }
[[ "$APP_DB_USER" != "$DB_USER" ]] || { echo "ERROR: APP_DB_USER no puede ser el superusuario"; exit 1; }
[[ ${#APP_DB_PASSWORD} -ge 16 ]] || { echo "ERROR: APP_DB_PASSWORD debe tener al menos 16 caracteres (openssl rand -hex 24)"; exit 1; }
export APP_DB_USER APP_DB_PASSWORD

# La contraseña entra por variable de entorno y \getenv: ni en argumentos (ps)
# ni interpolada en el SQL.
docker compose exec -T -e APP_DB_USER -e APP_DB_PASSWORD postgres \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q <<'SQL'
\getenv rol APP_DB_USER
\getenv clave APP_DB_PASSWORD
SELECT format('CREATE ROLE %I LOGIN', :'rol')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'rol') \gexec
ALTER ROLE :"rol" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'clave';

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'rol') \gexec
GRANT USAGE ON SCHEMA public TO :"rol";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"rol";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"rol";

-- Tablas y secuencias que creen después las migraciones (deploy.sh corre con
-- este mismo superusuario) o una restauración heredan los permisos solas.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"rol";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"rol";
SQL

echo "✅ Rol '$APP_DB_USER' listo con permisos DML en $DB_NAME."
