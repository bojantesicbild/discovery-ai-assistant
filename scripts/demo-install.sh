#!/usr/bin/env bash
# Demo install — Mac laptop, end-to-end.
#
# Idempotent. Re-running is safe; each step checks before it acts.
# What this does, in order:
#   1. Verify macOS + Homebrew (offers to install Homebrew if missing)
#   2. Install brew packages (node@20, python@3.12, jq, git)
#   3. Verify Docker Desktop is running (you launch the GUI; the
#      script waits with a clear instruction)
#   4. Install uv (Astral, Python pkg manager)
#   5. Install Claude Code CLI (npm global)
#   6. Capture ANTHROPIC_API_KEY (prompts if not in env)
#   7. Write .env at repo root (preserves any existing one)
#   8. Verify frontend/.env.local
#   9. Backend uv venv + uv sync
#  10. Frontend npm install + npm run build (sanity)
#  11. Stop conflicting Homebrew Postgres if present
#  12. scripts/dev-up.sh — pg+redis containers + alembic upgrade head
#
# What this does NOT do:
#   - Start uvicorn / arq / next dev. Those need three terminals
#     (or scripts/demo-up.sh — separate file).
#   - Log into Claude. ANTHROPIC_API_KEY covers both backend and the
#     CLI subprocess; subscription login (`claude login`) is optional
#     and out of scope.
#   - Create users/projects. Use the UI after the app is up.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Output helpers ─────────────────────────────────────────────────
say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }
skip() { printf '\033[1;30m==>\033[0m %s\n' "$*"; }

# ── 1. macOS + Homebrew ────────────────────────────────────────────
[[ "$(uname)" == "Darwin" ]] || die "This installer targets macOS. Detected: $(uname)."

if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew not found."
  read -r -p "Install Homebrew now? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || die "Aborting — Homebrew is required."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon installs to /opt/homebrew; Intel to /usr/local. Make sure
  # the just-installed brew is on PATH for the rest of this run.
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
else
  skip "Homebrew already installed."
fi

# ── 2. Core packages via brew ─────────────────────────────────────
brew_install_if_missing() {
  local pkg="$1"
  if brew list --formula --versions "$pkg" >/dev/null 2>&1; then
    skip "$pkg already installed."
  else
    say "Installing $pkg..."
    brew install "$pkg"
  fi
}
brew_cask_install_if_missing() {
  local cask="$1"
  if brew list --cask --versions "$cask" >/dev/null 2>&1; then
    skip "$cask already installed."
  else
    say "Installing $cask (cask)..."
    brew install --cask "$cask"
  fi
}

brew_install_if_missing "node@20"
brew_install_if_missing "python@3.12"
brew_install_if_missing "jq"
brew_install_if_missing "git"
brew_cask_install_if_missing "docker"

# Make node@20 / python@3.12 visible if brew didn't auto-link.
if ! command -v node >/dev/null 2>&1; then
  warn "node not on PATH. Linking node@20..."
  brew link --overwrite --force node@20 || warn "brew link failed; you may need to add /opt/homebrew/opt/node@20/bin to PATH."
fi

# ── 3. Wait for Docker Desktop ─────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  warn "Docker Desktop is installed but not running."
  warn "Open Docker.app from /Applications, wait for the whale icon to settle (green dot)."
  read -r -p "Press Enter once Docker is running..." _
  for _ in $(seq 1 30); do
    if docker info >/dev/null 2>&1; then break; fi
    sleep 2
  done
  docker info >/dev/null 2>&1 || die "Docker is still not responding. Aborting."
fi
skip "Docker daemon responding."

# ── 4. uv ──────────────────────────────────────────────────────────
if ! command -v uv >/dev/null 2>&1; then
  say "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  # uv installs to ~/.local/bin by default; surface it for this run.
  export PATH="$HOME/.local/bin:$PATH"
else
  skip "uv already installed."
fi

# ── 5. Claude Code CLI ─────────────────────────────────────────────
if ! command -v claude >/dev/null 2>&1; then
  say "Installing Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code
else
  skip "Claude Code CLI already installed: $(claude --version 2>&1 | head -1)"
fi

# ── 6. ANTHROPIC_API_KEY (or skip for `claude login` / Keychain) ─
#
# Two auth paths supported:
#   1. API key  — covers backend SDK calls (Discovery extraction
#      pipeline) AND the Claude Code CLI subprocess (agent runs).
#      One secret, both layers work.
#   2. claude login — caches an OAuth token in the macOS Keychain.
#      The Claude CLI subprocess auths via Keychain on every run.
#      Backend SDK calls (document upload → extraction) WILL FAIL
#      with this path; agents driven from chat work fine.
USE_KEYCHAIN=0
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  warn "ANTHROPIC_API_KEY is not set in your shell."
  echo "  1) Paste an API key   (full pipeline + agents work)"
  echo "  2) Use 'claude login' (agents only — no document upload)"
  read -r -p "Pick auth path [1/2, default=1]: " AUTH_CHOICE
  if [[ "$AUTH_CHOICE" == "2" ]]; then
    USE_KEYCHAIN=1
    ANTHROPIC_API_KEY=""
    say "Skipping API key — you'll run 'claude login' after this script."
  else
    read -r -s -p "Paste your Anthropic API key (input hidden): " ANTHROPIC_API_KEY
    echo
    [[ -n "$ANTHROPIC_API_KEY" ]] || die "No key provided. Aborting."
  fi
fi
if [[ -n "$ANTHROPIC_API_KEY" ]]; then
  # Echo masked so the user knows what was captured.
  say "Using ANTHROPIC_API_KEY ${ANTHROPIC_API_KEY:0:10}… (length=${#ANTHROPIC_API_KEY})"
fi

# ── 7. Write .env at repo root ────────────────────────────────────
ENV_FILE="$REPO_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  skip ".env already exists — leaving it alone (delete it first to regenerate)."
else
  JWT_SECRET="$(/usr/bin/python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  cat > "$ENV_FILE" <<EOF
DB_PASSWORD=discovery_pass
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
JWT_SECRET=$JWT_SECRET
INTEGRATION_SECRET_KEY=
EOF
  say "Wrote .env (DB_PASSWORD, ANTHROPIC_API_KEY, JWT_SECRET, INTEGRATION_SECRET_KEY)."
fi

# ── 8. Frontend env ────────────────────────────────────────────────
FE_ENV="$REPO_ROOT/frontend/.env.local"
if [[ ! -f "$FE_ENV" ]]; then
  echo "NEXT_PUBLIC_API_URL=http://localhost:8008" > "$FE_ENV"
  say "Wrote frontend/.env.local."
else
  skip "frontend/.env.local already exists."
fi

# ── 9. Backend deps ───────────────────────────────────────────────
say "Setting up backend Python env..."
cd "$REPO_ROOT/backend"
if [[ ! -d .venv ]]; then
  uv venv
fi
# shellcheck source=/dev/null
source .venv/bin/activate
uv sync
python -c "import app.main" || die "Backend imports failed — see error above."
deactivate
cd "$REPO_ROOT"

# ── 10. Frontend deps + build sanity ──────────────────────────────
say "Setting up frontend node_modules..."
cd "$REPO_ROOT/frontend"
if [[ ! -d node_modules ]]; then
  npm install
else
  skip "node_modules present — running npm install --no-audit anyway to catch lockfile drift."
  npm install --no-audit --prefer-offline
fi
say "Running 'npm run build' as a TS/strict-mode sanity check..."
npm run build
cd "$REPO_ROOT"

# ── 11. Stop Homebrew Postgres if running ─────────────────────────
# Local Postgres on 127.0.0.1:5432 will shadow the Docker container.
# Detect any locally-running brew service and stop it before dev-up.
if brew services list 2>/dev/null | grep -qE '^postgresql.* started '; then
  warn "Local Homebrew Postgres is running and will conflict with Docker on 5432."
  read -r -p "Stop it now? [Y/n] " ans
  [[ "$ans" =~ ^[Nn]$ ]] || brew services stop postgresql || warn "Couldn't stop Homebrew postgres — you may hit port conflicts."
fi

# ── 12. Bring DB up + run migrations ──────────────────────────────
say "Starting Postgres + Redis containers and running alembic upgrade head..."
bash "$REPO_ROOT/scripts/dev-up.sh"

# ── Done ──────────────────────────────────────────────────────────
say "Install complete."
if [[ "$USE_KEYCHAIN" == "1" ]]; then
  cat <<'EOF'

You picked the Keychain auth path. Before starting the backend:

  1) claude login
     # Opens a browser. Sign in to your Anthropic Console account.
     # The OAuth token is cached in macOS Keychain.
     # Verify with: claude --print "say ok"

Then start the app in three terminals:

  Backend     cd backend && source .venv/bin/activate
              uvicorn app.main:app --host :: --port 8008 --reload

  Worker      cd backend && source .venv/bin/activate
              arq app.pipeline.worker.WorkerSettings

  Frontend    cd frontend && npm run dev

After login, OPEN http://localhost:3000 and:
  - Register a user, create a project.
  - Skip document upload — it needs the backend SDK auth this path
    doesn't have. Use chat to ask the assistant to extract BRs from
    a description, then ask for the tech doc + stories.
EOF
else
  cat <<'EOF'

Start the app in three terminals:

  Backend     cd backend && source .venv/bin/activate
              uvicorn app.main:app --host :: --port 8008 --reload

  Worker      cd backend && source .venv/bin/activate
              arq app.pipeline.worker.WorkerSettings

  Frontend    cd frontend && npm run dev

Then open http://localhost:3000 — register a user, create a project,
and follow DEMO_SETUP.md §10 for the demo flow.
EOF
fi
echo
