#!/bin/bash
# Atlas database backup script
# Usage: bash scripts/backup-db.sh
# Schedule with cron: 0 */6 * * * cd /Users/chao/Documents/Projects/atlas && bash scripts/backup-db.sh

BACKUP_DIR="/Users/chao/Documents/Projects/atlas/backups"
DB_NAME="atlas"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup..."
/opt/homebrew/Cellar/postgresql@17/17.9/bin/pg_dump "$DB_NAME" | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
  echo "[$(date)] Backup complete: $BACKUP_FILE ($SIZE)"

  # Keep only last 7 backups (7 days)
  ls -t "$BACKUP_DIR"/${DB_NAME}_*.sql.gz 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null

  TOTAL=$(ls "$BACKUP_DIR"/${DB_NAME}_*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
  echo "[$(date)] Total backups: $TOTAL"
else
  echo "[$(date)] Backup FAILED!"
  exit 1
fi
