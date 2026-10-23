#!/usr/bin/env bash
# ==============================================================================
# Script de Restauración - AssistantAI (Virgo)
# ==============================================================================
# Uso:
#   ./scripts/restore.sh /ruta/al/db_virgo_db_YYYY-MM-DD.sql.gz
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROYECTO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <archivo_backup.sql.gz>"
  echo "Ejemplo: $0 /home/sdvirgo/backups/assistantai/db_virgo_db_2026-10-09_124201.sql.gz"
  exit 1
fi

BACKUP_FILE="$1"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "ERROR: El archivo $BACKUP_FILE no existe."
  exit 1
fi

if [[ -f "$PROYECTO_DIR/.env" ]]; then
  DB_USER="$(grep '^DB_POSTGRESDB_USER=' "$PROYECTO_DIR/.env" | cut -d '=' -f2- | tr -d '"'\''\r ')"
  DB_NAME="$(grep '^DB_POSTGRESDB_DATABASE=' "$PROYECTO_DIR/.env" | cut -d '=' -f2- | tr -d '"'\''\r ')"
else
  echo "ERROR: No se encontró .env"
  exit 1
fi

PG_CONTAINER="assistantai-postgres-1"

echo "=========================================================="
echo "⚠️  ADVERTENCIA DE PRODUCCIÓN"
echo "Se restaurará el archivo: $BACKUP_FILE"
echo "En la base de datos: $DB_NAME ($PG_CONTAINER)"
echo "Esto sobrescribirá los datos actuales."
echo "=========================================================="
read -r -p "¿Estás 100% seguro de continuar? (escribe 'RESTAURAR' para confirmar): " CONFIRMACION

if [[ "$CONFIRMACION" != "RESTAURAR" ]]; then
  echo "Operación cancelada."
  exit 0
fi

echo "Verificando integridad del archivo..."
gzip -t "$BACKUP_FILE"

echo "Restaurando base de datos..."
# Todo o nada: al primer error psql se detiene y la transacción se deshace, en
# vez de dejar la base a medio restaurar. Los dumps de backup.sh llevan
# --clean --if-exists y cargan sobre la base existente; uno anterior (sin
# DROPs) choca con las tablas que ya existen: restáuralo en una base VACÍA.
gunzip -c "$BACKUP_FILE" | docker exec -i "$PG_CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 --single-transaction -q

echo "✅ Restauración completada exitosamente."
