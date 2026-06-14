#!/bin/bash
# =====================================================================
# BizOpease — PostgreSQL WAL-G Base Backup Script
# Nightly base backups to Cloudflare R2
# =====================================================================

set -e

# Path to the backup configuration directory
BACKUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$BACKUP_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "[ERROR] .env file not found at $ENV_FILE. Please create it from .env.example."
    exit 1
fi

# Load variables
export $(grep -v '^#' "$ENV_FILE" | xargs)

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting PostgreSQL base backup..."

# Ensure wal-g is installed
if ! command -v wal-g &> /dev/null; then
    echo "[ERROR] wal-g command not found. Please install it on the server."
    exit 1
fi

# Run the base backup push
# This points WAL-G to the PostgreSQL data directory
# Default for Ubuntu/Odoo is /var/lib/postgresql/18/main or /var/lib/postgresql/16/main
PG_DATA_DIR="/var/lib/postgresql/18/main"
if [ ! -d "$PG_DATA_DIR" ]; then
    PG_DATA_DIR="/var/lib/postgresql/16/main"
fi

if [ ! -d "$PG_DATA_DIR" ]; then
    echo "[WARNING] Default PostgreSQL data directory not found. Letting PostgreSQL locate it..."
    wal-g backup-push
else
    wal-g backup-push "$PG_DATA_DIR"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Base backup pushed successfully."

# Clean up older backups: keep the last 7 days of base backups
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pruning old backups (keeping last 7 base backups)..."
wal-g delete before FIND_FULL $(date -d "7 days ago" +%Y-%m-%dT%H:%M:%S) --confirm

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup process complete."
