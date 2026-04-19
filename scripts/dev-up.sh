#!/usr/bin/env bash
# Bring up the local dev stack safely.
#
# What this does (in order):
#   1. Start docker compose services: postgres, redis
#   2. Wait for postgres to accept connections
#   3. If the DB already has tables, pg_dump it to scripts/backups/ as a
#      safety net. This is why `--reset` exists but `DROP SCHEMA` never
#      runs implicitly.
#   4. Run `alembic upgrade head`.
#
# Flags:
#   --reset    Drop + recreate the public schema after backing it up.
#              Use this only when you want a clean DB. Always makes a
#              timestamped pg_dump first.
#   --help     Show this.
#
# What this does NOT do:
#   - Start uvicorn / the arq worker / next dev. Run those yourself in
#     separate terminals (see README). We deliberately leave long-running
#     processes to the developer so they can tail the logs.
#
# Why this script exists:
#   During a session we hit `alembic upgrade head` failing mid-chain on
#   a fresh DB, manually ran `DROP SCHEMA public CASCADE` to unstick it,
#   and destroyed real data in the process. The backup step here makes
#   that impossible to repeat without an explicit flag + explicit dump.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RESET=0
for arg in "$@"; do
  case "$arg" in
    --reset)  RESET=1 ;;
    --help|-h)
      sed -n '1,28p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

PG_CONTAINER=discovery-ai-assistant-postgres-1
PG_USER=discovery_user
PG_DB=discovery_db
BACKUPS_DIR="$REPO_ROOT/scripts/backups"
mkdir -p "$BACKUPS_DIR"

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }

# ── 1. docker compose up -d postgres redis ──
if ! docker info >/dev/null 2>&1; then
  die "Docker daemon isn't running. Start Docker Desktop and retry."
fi

say "Starting postgres + redis containers..."
docker compose up -d postgres redis >/dev/null

# ── 2. Wait for postgres ──
say "Waiting for postgres to accept connections..."
for _ in $(seq 1 60); do
  if docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1 \
  || die "Postgres didn't become healthy within 60s."

# ── 3. Backup if the DB has data ──
# We consider "has data" == any table in the public schema. An alembic_version
# row alone counts too (partial state is still worth preserving).
TABLE_COUNT=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo 0)

if [ "${TABLE_COUNT:-0}" -gt 0 ]; then
  TS=$(date +%Y%m%d-%H%M%S)
  DUMP="$BACKUPS_DIR/$TS.sql"
  say "DB has $TABLE_COUNT tables. Dumping to $DUMP..."
  docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" > "$DUMP"
  say "Backup saved: $DUMP ($(du -h "$DUMP" | cut -f1))"
else
  say "DB is empty — no backup needed."
fi

# ── 4. Optional reset ──
if [ "$RESET" = "1" ]; then
  warn "RESET requested. The backup above is your only safety net."
  read -r -p "Type 'reset' to confirm dropping the public schema: " confirm
  if [ "$confirm" != "reset" ]; then
    die "Aborted — confirmation did not match."
  fi
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c \
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public; \
     GRANT ALL ON SCHEMA public TO $PG_USER; GRANT ALL ON SCHEMA public TO public;" \
    >/dev/null
  say "Schema reset."
fi

# ── 5. Run migrations ──
say "Running alembic upgrade head..."
cd "$REPO_ROOT/backend"
if [ ! -d .venv ]; then
  die ".venv not found in backend/. Run 'uv sync' or 'python -m venv .venv && pip install ...' first."
fi
# shellcheck source=/dev/null
source .venv/bin/activate
PYTHONPATH=. alembic upgrade head

say "Dev stack ready. Start the processes yourself:"
cat <<EOF
  backend:   cd backend && source .venv/bin/activate && uvicorn app.main:app --host :: --port 8008 --reload
  worker:    cd backend && source .venv/bin/activate && arq app.pipeline.worker.WorkerSettings
  frontend:  cd frontend && npm run dev
EOF
