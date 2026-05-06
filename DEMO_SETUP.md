# Demo setup — Mac laptop

End-to-end install of the Discovery AI Assistant for a local demo. Plain Mac (Apple Silicon or Intel), zsh shell.

---

## Quick path — one script

```bash
git clone <your-origin-url> discovery-ai-assistant
cd discovery-ai-assistant
./scripts/demo-install.sh
```

The installer is idempotent — re-running is safe. It walks every step below (Homebrew, brew packages, Docker Desktop check, `uv`, Claude CLI, `.env`, backend `uv sync`, frontend `npm install`+`npm run build`, migrations) and prompts for `ANTHROPIC_API_KEY` if it isn't already in your shell.

When it finishes you still need three terminals to run the app — see §8 below.

The phase-by-phase guide that follows is the manual fallback if you want to run individual steps yourself.

---

## 1. Install prerequisites

Install Homebrew first if you don't have it:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then everything else:

```bash
brew install node@20 python@3.12 jq git
brew install --cask docker
curl -LsSf https://astral.sh/uv/install.sh | sh
npm install -g @anthropic-ai/claude-code
```

Launch **Docker Desktop** from Applications. Wait until the whale icon turns green-dot.

Verify:

```bash
node --version        # >= 20
python3 --version     # >= 3.11
uv --version
jq --version
docker info | head -3 # no errors
claude --version
```

---

## 2. Log in to Claude Code

Set the API key once. This covers both the Claude Code CLI (agents) and the backend Pydantic AI calls.

```bash
export ANTHROPIC_API_KEY="sk-ant-...your-key..."
echo 'export ANTHROPIC_API_KEY="sk-ant-...your-key..."' >> ~/.zshrc
```

Verify:

```bash
claude --print "say ok" --model claude-haiku-4-5-20251001
# Expect: ok
```

---

## 3. Get the code

```bash
git clone <your-origin-url> discovery-ai-assistant
cd discovery-ai-assistant
git log --oneline -5
# Expect the four newest commits to include "Phase 2 backend" and
# "Phase 2 frontend".
```

If the laptop already has the repo, just `git pull origin main`.

---

## 4. Configure environment

Create `.env` at the repo root:

```bash
cat > .env <<EOF
DB_PASSWORD=discovery_pass
ANTHROPIC_API_KEY=sk-ant-...your-key...
JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
INTEGRATION_SECRET_KEY=
EOF
```

Frontend env (already correct in repo, but verify):

```bash
cat frontend/.env.local
# Expect: NEXT_PUBLIC_API_URL=http://localhost:8008
```

---

## 5. Backend dependencies

```bash
cd backend
uv venv
source .venv/bin/activate
uv sync
python -c "import app.main; print('imports OK')"
deactivate
cd ..
```

---

## 6. Frontend dependencies

```bash
cd frontend
npm install
npm run build       # one-time prod build sanity check
cd ..
```

---

## 7. First-time database setup

If you have Homebrew Postgres running locally, stop it first — it will shadow Docker on port 5432:

```bash
brew services stop postgresql@16 || true
```

Run the dev-up script. It starts Postgres + Redis containers, takes a backup if data exists, and applies all Alembic migrations:

```bash
bash scripts/dev-up.sh
```

Look for `Running upgrade ... -> 045_tech_story_init` near the end.

Verify:

```bash
docker exec discovery-ai-assistant-postgres-1 \
  psql -U discovery_user -d discovery_db \
  -c "SELECT version_num FROM alembic_version;"
# Expect: 045_tech_story_init
```

---

## 8. Run the app — three terminals

**Terminal 1 — backend**

```bash
cd backend && source .venv/bin/activate
uvicorn app.main:app --host :: --port 8008 --reload
```

**Terminal 2 — worker** (needed only if you upload documents for ingestion)

```bash
cd backend && source .venv/bin/activate
arq app.pipeline.worker.WorkerSettings
```

**Terminal 3 — frontend**

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000` in your browser.

---

## 9. Create a user and a project

Either through the UI (register form on the landing page, then "+ New Project" in the sidebar) or via curl:

```bash
TOKEN=$(curl -s -X POST http://localhost:8008/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@local","name":"Demo","auth_provider":"local"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s -X POST http://localhost:8008/api/projects \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"VC Scheduler","client_name":"Demo Co","project_type":"Greenfield"}'
```

The project's UUID is in the response and in the browser URL after you click into it.

---

## 10. Demo flow

1. Upload a short brief into the chat (`.md` or `.pdf`). Wait ~30s for extraction.
2. Verify BR-001 appears in the Requirements tab.
3. In chat, type: `Generate the tech doc and stories for BR-001.`
4. While the agents run, watch the chat — green pill `Running story-tech-agent`, then `Running story-story-agent`.
5. Click `Story & Tech` in the sidebar (`/story-tech`).
6. TD-001 card appears with a brand-green ring. Stories tab shows the breakdown.
7. Click any card to open detail. Any ` ```mermaid ` block in the body is rendered as an SVG diagram automatically (sequence diagrams, flowcharts, etc.). Mermaid syntax in chat messages renders the same way.
8. Click any BR pill to jump to Discovery.

---

## Teardown

```bash
docker compose down
# Then close the three terminals.
```

---

## Common issues

| Problem | Fix |
|---|---|
| `ANTHROPIC_API_KEY` set but agents hang | Rotate the key; verify quota in the Anthropic console |
| Backend logs `ModuleNotFoundError: app` when running alembic manually | `cd backend && PYTHONPATH=. alembic upgrade head` |
| `/story-tech` shows empty after a successful agent run | Hard reload (`Cmd+Shift+R`); check `SELECT * FROM tech_docs;` shows the row |
| `docker exec ... psql` and the running app see different data | Local Postgres is shadowing Docker on 5432 — `brew services stop postgresql@16` |
| Migration says "Can't locate revision 044..." | Run `bash scripts/dev-up.sh` again — it walks all missing revisions in order |
| Chat shows `Running Agent...` instead of the agent name | Browser cache stale — hard reload |
