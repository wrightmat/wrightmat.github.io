#!/usr/bin/env bash
# Back up Undercroft: a consistent copy of the database plus the data folder, and (separately) the secrets.
#
#   sudo deploy/backup.sh [destination] [keep]      defaults: /srv/backups/undercroft, keep 14
#
# The secrets archive holds the key that decrypts stored credentials; keep it somewhere other than
# where the data archives go (a different disk or machine), or a leaked data backup can be read.
set -euo pipefail

BASE=/srv/containers/undercroft
DEST=${1:-/srv/backups/undercroft}
KEEP=${2:-14}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

mkdir -p "$DEST/data" "$DEST/secrets"
chmod 700 "$DEST" "$DEST/data" "$DEST/secrets"

# SQLite's online backup API gives a consistent snapshot while the server is running.
podman exec undercroft python -c "
import sqlite3
source = sqlite3.connect('/data/database.sqlite')
target = sqlite3.connect('/data/.backup-snapshot.sqlite')
source.backup(target)
target.close()
source.close()
"
mv "$BASE/data/.backup-snapshot.sqlite" "$DEST/data/database-$STAMP.sqlite"

tar -czf "$DEST/data/content-$STAMP.tar.gz" -C "$BASE/data" \
    --exclude='database.sqlite*' --exclude='.backup-snapshot.sqlite' .
tar -czf "$DEST/secrets/secrets-$STAMP.tar.gz" -C "$BASE/secrets" .
chmod 600 "$DEST"/data/*"$STAMP"* "$DEST"/secrets/*"$STAMP"*

# Keep the newest $KEEP of each kind.
for pattern in "data/database-*.sqlite" "data/content-*.tar.gz" "secrets/secrets-*.tar.gz"; do
    ls -1t "$DEST"/$pattern 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
done

echo "Backed up to $DEST (stamp $STAMP)"
