#!/usr/bin/env bash
# Rebuild the compose server from this checkout and start it on a fresh, seeded workspace. Every
# run deletes the compose data volume: this is for dev testing, so no data is kept or backed up.
#
#   npm run docker:dev
#   BASELINE_DEV_PASSWORD=something-else npm run docker:dev
#
# The owner signs in with BASELINE_OWNER_EMAIL from .env (default parth@local) and
# BASELINE_DEV_PASSWORD (default baseline-dev). The server listens on BASELINE_PUBLISH from .env.
set -euo pipefail
cd "$(dirname "$0")/.."

env_value() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -1 | tr -d '"' || true; }
EMAIL="${BASELINE_OWNER_EMAIL:-$(env_value BASELINE_OWNER_EMAIL)}"; EMAIL="${EMAIL:-parth@local}"
PASSWORD="${BASELINE_DEV_PASSWORD:-baseline-dev}"
PORT="${BASELINE_PUBLISH:-$(env_value BASELINE_PUBLISH)}"
URL="$(env_value BASELINE_PUBLIC_URL)"; URL="${URL:-http://localhost:${PORT:-7770}}"

echo "== removing the old server and its data"
docker compose down --volumes --remove-orphans

echo "== building the image"
docker compose build

echo "== seeding the sample workspace"
docker compose run --rm --no-deps -T baseline \
  baseline seed --reset --db /data/baseline.db --email "$EMAIL" --password "$PASSWORD"

echo "== starting the server"
docker compose up -d
container="$(docker compose ps -q baseline)"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$container")"
  [ "$status" = healthy ] && break
  [ "$(docker inspect -f '{{.State.Running}}' "$container")" = true ] || break
  sleep 1
done
if [ "$status" != healthy ]; then
  echo "The server didn't become healthy ($status). Last log lines:" >&2
  docker compose logs --tail 20 baseline >&2
  exit 1
fi

echo
echo "Baseline is up at $URL"
echo "  sign in: $EMAIL / $PASSWORD"
