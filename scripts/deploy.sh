#!/usr/bin/env bash
#
# Despliegue a producción.
#
# El desarrollo ocurre en otra máquina: allí se commitea y se empuja a GitHub.
# Esta máquina es producción -- los contenedores de docker compose, con
# cloudflared publicando el frontend -- y aquí solo se despliega. Por eso el
# script trae el código en vez de empujarlo.
#
#   ./scripts/deploy.sh              trae la rama de producción y despliega
#   ./scripts/deploy.sh --dry-run    enseña qué haría, sin tocar nada
#   ./scripts/deploy.sh --si         no pide confirmación (para automatizar)
#   ./scripts/deploy.sh --rama X     despliega otra rama en vez de la de por defecto
#
# El orden importa: primero se trae el código y se comprueba, luego la base, y
# solo entonces se tocan los contenedores. Si algo falla antes del build, la
# máquina se queda como estaba. Si falla después, el frontend vuelve a la
# imagen anterior.

set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

# Rama que corre en producción. Se despliega lo que haya en su punta remota.
RAMA_PRODUCCION="${RAMA_PRODUCCION:-develop}"

DRY_RUN=0
SIN_CONFIRMAR=0
for ((i=1; i<=$#; i++)); do
  arg="${!i}"
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --si|--yes)  SIN_CONFIRMAR=1 ;;
    --rama)      i=$((i+1)); RAMA_PRODUCCION="${!i}" ;;
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
paso "1/7 · Comprobaciones previas"

[[ -f .env ]] || fallo "No hay .env en la raíz."
docker compose version >/dev/null 2>&1 || fallo "docker compose no está disponible."

gris "   rama de producción: $RAMA_PRODUCCION"

# El árbol de esta máquina no es sitio para editar: cualquier cambio local
# haría que el checkout falle o que lo desplegado no sea lo que hay en GitHub.
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  rojo "✗ Esta máquina tiene cambios sin commitear:"
  git status --short --untracked-files=no | sed 's/^/     /'
  echo
  echo "   Producción solo debe correr lo que está en GitHub. Descarta esos"
  echo "   cambios (git checkout -- <archivo>) o llévatelos a tu equipo antes"
  echo "   de desplegar."
  exit 1
fi

COMMIT_ACTUAL="$(git rev-parse HEAD)"

# ─────────────────────────────────────────────────────────────
paso "2/7 · Traer el código de GitHub"

ejecutar git fetch --quiet origin "$RAMA_PRODUCCION"
git rev-parse --verify --quiet "origin/$RAMA_PRODUCCION" >/dev/null \
  || fallo "No existe origin/$RAMA_PRODUCCION."

DESTINO="$(git rev-parse "origin/$RAMA_PRODUCCION")"

if [[ "$DESTINO" == "$COMMIT_ACTUAL" ]]; then
  gris "   ya está en el último commit de $RAMA_PRODUCCION ($(git log -1 --format=%s | cut -c1-50))"
else
  # Lo que importa no es si la rama "va por detrás" en línea recta, sino si hay
  # commits corriendo ahora mismo que no estén en ella. Comprobar la ancestría
  # no basta: en cuanto la rama de producción acumula merges de PR, las dos
  # historias divergen y un retroceso deja de parecerlo.
  SE_PERDERIAN="$(git rev-list --count "$DESTINO..$COMMIT_ACTUAL")"
  if [[ "$SE_PERDERIAN" -gt 0 ]]; then
    rojo "✗ origin/$RAMA_PRODUCCION no contiene lo que corre ahora mismo."
    echo
    echo "   Desplegarla desharía $SE_PERDERIAN commit(s) que ya están en producción:"
    git log --oneline "$DESTINO..$COMMIT_ACTUAL" | head -12 | sed 's/^/     /'
    [[ "$SE_PERDERIAN" -gt 12 ]] && gris "     ... y $((SE_PERDERIAN - 12)) más"
    echo
    echo "   Lleva primero esos commits a $RAMA_PRODUCCION (merge o PR) y"
    echo "   vuelve a intentarlo."
    exit 1
  fi

  echo "   se van a desplegar:"
  git log --oneline "$COMMIT_ACTUAL..$DESTINO" | head -15 | sed 's/^/     /'

  # --ff-only: si esta máquina tuviera commits propios, mejor que falle a que
  # se invente un merge en producción.
  ejecutar git checkout --quiet "$RAMA_PRODUCCION"
  ejecutar git merge --ff-only --quiet "origin/$RAMA_PRODUCCION" \
    || fallo "No se pudo avanzar a origin/$RAMA_PRODUCCION sin merge. Revisa el estado del repo aquí."
  verde "   ✓ en $(git rev-parse --short HEAD)"
fi

# ─────────────────────────────────────────────────────────────
paso "3/7 · Verificar el código"

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
paso "4/7 · Migraciones de la base"

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
paso "5/7 · Construir la imagen"

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
paso "6/7 · Recrear los contenedores"

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
paso "7/7 · Resumen"

# Aquí no se empuja nada: los commits se hacen en el equipo de desarrollo y
# esta máquina solo los consume. Lo que queda es dejar por escrito qué versión
# está sirviendo, para poder mirarlo luego sin adivinar.
gris "   rama:   $RAMA_PRODUCCION"
gris "   commit: $(git rev-parse --short HEAD) · $(git log -1 --format=%s | cut -c1-60)"
gris "   fecha:  $(git log -1 --format=%ad --date=format:'%Y-%m-%d %H:%M')"

echo
verde "✓ Despliegue terminado."
[[ $DRY_RUN -eq 1 ]] && gris "  (era un dry-run: no se cambió nada)"
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
