#!/usr/bin/env bash
#
# Despliegue a producción.
#
# Producción corre en esta misma máquina: los contenedores de docker compose,
# con cloudflared publicando el frontend a internet. Así que "desplegar" es
# reconstruir la imagen y recrear los contenedores con el código que tienes
# ahora en el árbol de trabajo.
#
#   ./scripts/deploy.sh              despliega
#   ./scripts/deploy.sh --dry-run    enseña qué haría, sin tocar nada
#   ./scripts/deploy.sh --si         no pide confirmación (para automatizar)
#   ./scripts/deploy.sh --sin-push   despliega pero no empuja a GitHub
#
# El orden importa: primero se comprueba el código, luego la base, y solo
# entonces se toca producción. Si algo falla antes del build, no se ha tocado
# nada. Si falla después, el frontend vuelve a la imagen anterior.

set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

DRY_RUN=0
SIN_CONFIRMAR=0
HACER_PUSH=1
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --si|--yes)  SIN_CONFIRMAR=1 ;;
    --sin-push)  HACER_PUSH=0 ;;
    -h|--help)   sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $arg (prueba --help)"; exit 2 ;;
  esac
done

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }
paso()  { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

fallo() { rojo "✗ $*"; exit 1; }

ejecutar() {
  if [[ $DRY_RUN -eq 1 ]]; then gris "   [dry-run] $*"; else "$@"; fi
}

trap 'rojo "\n✗ El despliegue se detuvo en la línea $LINENO."' ERR

# ─────────────────────────────────────────────────────────────
paso "1/6 · Comprobaciones previas"

[[ -f .env ]] || fallo "No hay .env en la raíz."
docker compose version >/dev/null 2>&1 || fallo "docker compose no está disponible."

RAMA="$(git rev-parse --abbrev-ref HEAD)"
gris "   rama: $RAMA"

# Se despliega lo que hay en el árbol, y luego se empuja: si quedara algo sin
# commitear, GitHub no reflejaría lo que de verdad está corriendo.
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  rojo "✗ Hay cambios sin commitear:"
  git status --short --untracked-files=no | sed 's/^/     /'
  echo
  echo "   Commitea antes de desplegar, o usa --sin-push si de verdad quieres"
  echo "   desplegar algo que no va a quedar registrado en el repo."
  [[ $HACER_PUSH -eq 1 ]] && exit 1
fi

SIN_TRACKEAR="$(git ls-files --others --exclude-standard | head -5)"
if [[ -n "$SIN_TRACKEAR" ]]; then
  gris "   (archivos sin trackear, no se despliegan ni se empujan):"
  echo "$SIN_TRACKEAR" | sed 's/^/     /' | while read -r l; do gris "$l"; done
fi

# ─────────────────────────────────────────────────────────────
paso "2/6 · Verificar el código"

gris "   backend · pytest"
if [[ -x backend/.venv/bin/python ]]; then
  ( cd backend && ./.venv/bin/python -m pytest -q ) || fallo "Fallan los tests del backend."
else
  gris "   (sin backend/.venv, se omite pytest)"
fi

gris "   frontend · typecheck, lint y tests"
( cd frontend && npm run typecheck --silent ) || fallo "El typecheck del frontend falla."
( cd frontend && npm run lint --silent )      || fallo "El lint del frontend falla."
( cd frontend && npm test --silent )          || fallo "Fallan los tests del frontend."

verde "   ✓ código verificado"

# ─────────────────────────────────────────────────────────────
paso "3/6 · Migraciones de la base"

# database_setup.sql solo se ejecuta cuando Postgres arranca con el volumen
# vacío, así que sobre una base que ya existe no aplica nada. Los cambios de
# esquema van en migrations/*.sql y se registran aquí para no repetirlos.
DB_USER="$(grep -E '^DB_POSTGRESDB_USER=' .env | cut -d= -f2-)"
DB_NAME="$(grep -E '^DB_POSTGRESDB_DATABASE=' .env | cut -d= -f2-)"
[[ -n "$DB_USER" && -n "$DB_NAME" ]] || fallo "Falta DB_POSTGRESDB_USER o DB_POSTGRESDB_DATABASE en .env"

psql_prod() { docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" "$@"; }

docker compose ps --status running --services 2>/dev/null | grep -qx postgres \
  || fallo "El contenedor de postgres no está corriendo; levanta los servicios primero."

# En dry-run no se crea nada: si la tabla aún no existe se listan todas las
# migraciones como pendientes, que es justo lo que pasaría al ejecutar de veras.
if [[ $DRY_RUN -eq 0 ]]; then
  psql_prod -v ON_ERROR_STOP=1 -q -c "
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      aplicada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );" >/dev/null || fallo "No se pudo preparar schema_migrations."
fi

PENDIENTES=()
for f in migrations/*.sql; do
  [[ -e "$f" ]] || continue
  v="$(basename "$f" .sql)"
  ya="$(psql_prod -t -A -c "SELECT 1 FROM schema_migrations WHERE version = '$v';" 2>/dev/null || true)"
  [[ "$ya" == "1" ]] || PENDIENTES+=("$f")
done

if [[ ${#PENDIENTES[@]} -eq 0 ]]; then
  gris "   sin migraciones pendientes"
else
  echo "   pendientes:"
  printf '     %s\n' "${PENDIENTES[@]}"
  for f in "${PENDIENTES[@]}"; do
    v="$(basename "$f" .sql)"
    if [[ $DRY_RUN -eq 1 ]]; then
      gris "   [dry-run] aplicaría $v"
      continue
    fi
    # Cada migración va en una transacción: si falla a medias, no deja la base
    # en un estado intermedio y el despliegue se detiene aquí, antes de tocar
    # los contenedores.
    if { echo "BEGIN;"; cat "$f";
         echo "INSERT INTO schema_migrations (version) VALUES ('$v');";
         echo "COMMIT;"; } | psql_prod -v ON_ERROR_STOP=1 -q; then
      verde "   ✓ aplicada $v"
    else
      fallo "La migración $v falló. La base quedó como estaba; no se desplegó nada."
    fi
  done
fi

# ─────────────────────────────────────────────────────────────
paso "4/6 · Construir la imagen"

if [[ $SIN_CONFIRMAR -eq 0 && $DRY_RUN -eq 0 ]]; then
  echo
  echo "   Se va a reconstruir el frontend y recrear los contenedores."
  echo "   El CRM queda inaccesible entre 1 y 2 minutos."
  read -r -p "   ¿Seguimos? [s/N] " r
  [[ "$r" =~ ^[sSyY]$ ]] || { echo "   Cancelado."; exit 0; }
fi

# Se anota la imagen actual para poder volver si el arranque sale mal.
IMAGEN_PREVIA="$(docker compose images -q frontend 2>/dev/null || true)"
gris "   imagen previa: ${IMAGEN_PREVIA:0:12}"

# El build ocurre antes de tocar nada: mientras compila, producción sigue
# sirviendo la versión anterior.
ejecutar docker compose build frontend

# ─────────────────────────────────────────────────────────────
paso "5/6 · Recrear los contenedores"

ejecutar docker compose up -d

if [[ $DRY_RUN -eq 0 ]]; then
  gris "   esperando a que los servicios respondan..."
  SANO=0
  for _ in $(seq 1 30); do
    sleep 2
    ENFERMOS="$(docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null \
                | awk '$2 != "" && $2 != "healthy" {print $1}' || true)"
    if [[ -z "$ENFERMOS" ]] && curl -sf --max-time 5 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
      SANO=1; break
    fi
  done

  if [[ $SANO -eq 0 ]]; then
    rojo "✗ Los servicios no llegaron a estar sanos."
    docker compose ps
    if [[ -n "$IMAGEN_PREVIA" ]]; then
      rojo "   Volviendo a la imagen anterior..."
      docker tag "$IMAGEN_PREVIA" assistantai-frontend:latest
      docker compose up -d --no-build frontend
      rojo "   Revertido el frontend. OJO: las migraciones de base ya aplicadas NO se revierten."
    fi
    exit 1
  fi
  verde "   ✓ servicios sanos"
fi

# ─────────────────────────────────────────────────────────────
paso "6/6 · Publicar en GitHub"

if [[ $HACER_PUSH -eq 0 ]]; then
  gris "   omitido (--sin-push)"
elif [[ $DRY_RUN -eq 1 ]]; then
  gris "   [dry-run] haría: git push origin $RAMA"
else
  # Va al final a propósito: solo se publica lo que ya se comprobó que arranca.
  ejecutar git push origin "$RAMA"
  verde "   ✓ empujado a origin/$RAMA"
fi

echo
verde "✓ Despliegue terminado."
[[ $DRY_RUN -eq 1 ]] && gris "  (era un dry-run: no se cambió nada)"
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
