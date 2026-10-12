#!/usr/bin/env bash
# ==============================================================================
# Script de Respaldo Automatizado - AssistantAI (Virgo)
# ==============================================================================
# Realiza respaldo comprimido de:
#   1. Base de datos PostgreSQL (virgo_db) vía docker exec + pg_dump + gzip
#   2. Carpeta de archivos multimedia de candidatos (virgo_data/uploads)
# Aplica rotación automática (retención de 14 días) y verificación de integridad.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROYECTO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/home/sdvirgo/backups/assistantai}"
RETENTION_DAYS=14
TIMESTAMP="$(date +'%Y-%m-%d_%H%M%S')"
LOG_FILE="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

log() {
  local msg="[$(date +'%Y-%m-%d %H:%M:%S')] $1"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
}

log "=== INICIO DE RESPALDO ==="

# 1. Cargar variables de entorno
if [[ -f "$PROYECTO_DIR/.env" ]]; then
  # Leer usuario y base sin exportar todas las variables
  DB_USER="$(grep '^DB_POSTGRESDB_USER=' "$PROYECTO_DIR/.env" | cut -d '=' -f2- | tr -d '"'\'' ')"
  DB_NAME="$(grep '^DB_POSTGRESDB_DATABASE=' "$PROYECTO_DIR/.env" | cut -d '=' -f2- | tr -d '"'\'' ')"
else
  log "ERROR: Archivo .env no encontrado en $PROYECTO_DIR"
  exit 1
fi

DB_USER="${DB_USER:-omurillo17}"
DB_NAME="${DB_NAME:-virgo_db}"

# 2. Localizar contenedor de Postgres
PG_CONTAINER="assistantai-postgres-1"
if ! docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
  # Intentar buscar por servicio de compose
  PG_CONTAINER="$(cd "$PROYECTO_DIR" && docker compose ps -q postgres 2>/dev/null || true)"
  if [[ -z "$PG_CONTAINER" ]]; then
    log "ERROR: Contenedor de PostgreSQL no está en ejecución."
    exit 1
  fi
fi

# 3. Respaldo de Base de Datos
DB_BACKUP_FILE="$BACKUP_DIR/db_${DB_NAME}_${TIMESTAMP}.sql.gz"
log "Ejecutando pg_dump para $DB_NAME desde $PG_CONTAINER..."

docker exec "$PG_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges | gzip -9 > "$DB_BACKUP_FILE"

# 4. Verificación de integridad de DB
if ! gzip -t "$DB_BACKUP_FILE"; then
  log "ERROR: La verificación de integridad (gzip -t) falló para $DB_BACKUP_FILE"
  rm -f "$DB_BACKUP_FILE"
  exit 1
fi

DB_SIZE="$(du -h "$DB_BACKUP_FILE" | cut -f1)"
log "Base de datos respaldada con éxito: $DB_BACKUP_FILE ($DB_SIZE)"

# 5. Respaldo de Archivos Multimedia (Uploads de Candidatos)
UPLOADS_DIR="$PROYECTO_DIR/virgo_data/uploads"
UPLOADS_BACKUP_FILE="$BACKUP_DIR/uploads_${TIMESTAMP}.tar.gz"

if [[ -d "$UPLOADS_DIR" ]]; then
  log "Comprimiendo carpeta de uploads ($UPLOADS_DIR)..."
  tar -czf "$UPLOADS_BACKUP_FILE" -C "$PROYECTO_DIR/virgo_data" uploads
  if gzip -t "$UPLOADS_BACKUP_FILE"; then
    UPLOADS_SIZE="$(du -h "$UPLOADS_BACKUP_FILE" | cut -f1)"
    log "Uploads respaldados con éxito: $UPLOADS_BACKUP_FILE ($UPLOADS_SIZE)"
  else
    log "ADVERTENCIA: Integridad de $UPLOADS_BACKUP_FILE falló."
    rm -f "$UPLOADS_BACKUP_FILE"
  fi
else
  log "INFO: No se encontró directorio $UPLOADS_DIR, omitiendo respaldo de uploads."
fi

# 6. Rotación de respaldos antiguos (> RETENTION_DAYS días)
log "Limpiando respaldos con más de $RETENTION_DAYS días de antigüedad en $BACKUP_DIR..."
ELIMINADOS=$(find "$BACKUP_DIR" -type f \( -name "*.sql.gz" -o -name "*.tar.gz" \) -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
log "Respaldos obsoletos eliminados: $ELIMINADOS"

log "=== RESPALDO FINALIZADO EXITOSAMENTE ==="
