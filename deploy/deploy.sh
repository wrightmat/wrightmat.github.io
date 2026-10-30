#!/usr/bin/env bash
# Update a running Undercroft: back up, pull the new code, restart, and check it came back healthy.
#
#   sudo deploy/deploy.sh [git-ref]        default: the tracked branch's newest commit
#
# The code lives in /srv/containers/undercroft/app (a git checkout mounted read-only into the
# container). Rebuild the image separately only for base-image patches or dependency changes:
#   sudo podman build -t localhost/undercroft -f deploy/Containerfile deploy && sudo systemctl restart undercroft
set -euo pipefail

APP=/srv/containers/undercroft/app
HEALTH=http://127.0.0.1:8100/undercroft/api/healthz
REF=${1:-}

cd "$APP"
PREVIOUS=$(git rev-parse HEAD)
"$APP/deploy/backup.sh"

git fetch --quiet
if [ -n "$REF" ]; then git checkout --quiet "$REF"; else git pull --quiet --ff-only; fi
NEW=$(git rev-parse HEAD)
echo "Code: $PREVIOUS -> $NEW"

systemctl restart undercroft
# A first start seeds and indexes the content folders, which can take a few minutes; later starts take seconds.
for _ in $(seq 1 120); do
    if curl -fsS --max-time 3 "$HEALTH" >/dev/null 2>&1; then
        echo "Healthy."
        exit 0
    fi
    sleep 2
done

echo "Not healthy after 4 minutes. Roll back with:" >&2
echo "  cd $APP && git checkout $PREVIOUS && sudo systemctl restart undercroft" >&2
echo "(and restore the database from the backup just taken if the new version changed it)" >&2
exit 1
