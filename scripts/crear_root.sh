#!/usr/bin/env bash
# ==============================================================================
# Crea el usuario ROOT o le cambia la contraseña - AssistantAI (Virgo)
# ==============================================================================
# database_setup.sql ya no siembra al ROOT: el hash de su contraseña estaba
# versionado en git. Este script lo crea (o lo actualiza si ya existe) sin que
# la contraseña toque el repo, la línea de comandos ni el historial del shell.
#
#   ./scripts/crear_root.sh                    pide usuario y contraseña
#   ROOT_USUARIO=x ROOT_PASSWORD=y ./scripts/crear_root.sh   sin preguntar
#
# Requiere los contenedores postgres y frontend corriendo. El hash bcrypt lo
# calcula bcryptjs dentro del contenedor frontend (o, si la imagen es anterior
# a este script, el node_modules de frontend/ en el host). Al actualizar se
# sube token_version: las sesiones abiertas de esa cuenta se cierran.
# ==============================================================================

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

[[ -f .env ]] || { echo "ERROR: no hay .env en $RAIZ"; exit 1; }
leer_env() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '"'\''\r '; }
DB_USER="$(leer_env DB_POSTGRESDB_USER)"
DB_NAME="$(leer_env DB_POSTGRESDB_DATABASE)"
[[ -n "$DB_USER" && -n "$DB_NAME" ]] || { echo "ERROR: falta DB_POSTGRESDB_USER o DB_POSTGRESDB_DATABASE en .env"; exit 1; }

ROOT_USUARIO="${ROOT_USUARIO:-}"
if [[ -z "$ROOT_USUARIO" ]]; then
  read -r -p "Usuario ROOT: " ROOT_USUARIO
fi
# Misma regla que normalizeUsername() del frontend, sin acentos: solo ASCII.
ROOT_USUARIO="$(printf '%s' "$ROOT_USUARIO" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
[[ "$ROOT_USUARIO" =~ ^[a-z0-9._-]{3,100}$ ]] \
  || { echo "ERROR: usuario inválido (a-z, 0-9, punto, guion; 3 a 100 caracteres)"; exit 1; }

ROOT_PASSWORD="${ROOT_PASSWORD:-}"
if [[ -z "$ROOT_PASSWORD" ]]; then
  read -r -s -p "Contraseña (mínimo 10 caracteres): " ROOT_PASSWORD; echo
  read -r -s -p "Repítela: " CONFIRMACION; echo
  [[ "$ROOT_PASSWORD" == "$CONFIRMACION" ]] || { echo "ERROR: no coinciden"; exit 1; }
fi
[[ ${#ROOT_PASSWORD} -ge 10 ]] || { echo "ERROR: la contraseña debe tener al menos 10 caracteres"; exit 1; }
export ROOT_USUARIO ROOT_PASSWORD

# La contraseña viaja por variable de entorno, nunca como argumento (se vería en ps).
HASH_JS='process.stdout.write(require("bcryptjs").hashSync(process.env.ROOT_PASSWORD, 12))'
ROOT_HASH="$(docker compose exec -T -e ROOT_PASSWORD frontend node -e "$HASH_JS" 2>/dev/null \
  || (cd frontend && node -e "$HASH_JS"))"
[[ "$ROOT_HASH" == \$2* ]] || { echo "ERROR: no se pudo calcular el hash bcrypt"; exit 1; }
export ROOT_HASH
unset ROOT_PASSWORD

# \getenv + :'var' citan los valores como literales: nada de interpolar en el SQL.
# Solo se marca `protegido` si aún no hay superusuario protegido (puede haber uno).
docker compose exec -T -e ROOT_USUARIO -e ROOT_HASH postgres \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q <<'SQL'
\getenv usuario ROOT_USUARIO
\getenv hash ROOT_HASH
INSERT INTO usuarios (usuario, nombre, password_hash, rol, protegido)
VALUES (:'usuario', :'usuario', :'hash', 'ROOT',
        NOT EXISTS (SELECT 1 FROM usuarios WHERE protegido))
ON CONFLICT (usuario) DO UPDATE
   SET password_hash = EXCLUDED.password_hash,
       rol = 'ROOT',
       token_version = usuarios.token_version + 1;
SQL

echo "✅ Usuario ROOT '$ROOT_USUARIO' listo."
