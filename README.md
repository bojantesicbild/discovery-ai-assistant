# Discovery AI Assistant

Crnogorchi — a multi-domain AI companion for software delivery teams. Web UI for PMs + a terminal-mode setup for teammates running Claude Code on their own laptops against the same backend.

This README covers **terminal-mode setup**. For backend/frontend dev setup, see the per-subdir READMEs. For agent + workflow contracts, see [`assistants/CLAUDE.md`](assistants/CLAUDE.md).

---

## Local-terminal setup (for team members)

Five-step onboarding. Once you're done, every project you've been added to is one `cd && discovery claude` away.

### Prerequisites

- **Claude Code** (CLI) installed and on `PATH`
- **git**
- **jq** (`brew install jq` / `apt install jq`)
- A **web account** on the Crnogorchi backend (admin gives you access)

### 1. Install the CLI shell function

```bash
# Replace with your team's Crnogorchi URL
export DISCOVERY_HOST=https://crnogorchi.example.com

# Append the CLI to your shell rc (one-time)
curl -fsSL "$DISCOVERY_HOST/cli.sh" >> ~/.zshrc
# (use ~/.bashrc if you're on bash)
source ~/.zshrc
```

`cli.sh` is served from your backend so the CLI version always matches the API it calls. Re-source after backend upgrades to pull the latest.

### 2. Get a web JWT

Log into the web UI, open browser DevTools → Application → Local Storage → copy the value of the `token` key (or whatever your auth flow stores). Export it:

```bash
export DISCOVERY_JWT=eyJhbGc...   # full JWT
```

JWT is only needed for `discovery setup` and `discovery refresh-token`. Once setup is done, the per-project PAT in `.mcp.json` handles everything else.

### 3. Setup a project

Get the project's UUID from the web UI's project page URL (`/projects/<uuid>/...`). Then:

```bash
discovery setup <project_id>
```

This:
- Fetches a single bootstrap bundle from the backend (mints a fresh 90-day project-scoped PAT for your laptop).
- `git clone`s the project's vault into `~/discovery/<slug>/`.
- Writes `~/discovery/<slug>/.mcp.json` with the PAT (gitignored, never committed).
- Walks each linked code repo: probes `~/work/`, `~/code/`, `~/dev/`, `~/projects/`, `~/git/` for an existing clone whose origin URL matches; offers to reuse, clone fresh into `~/work/<name>`, or skip.
- Saves the resolved repo paths to `~/discovery/<slug>/.discovery/repos.json`.

### 4. Open Claude Code

```bash
cd ~/discovery/<slug>
discovery claude
```

`discovery claude` reads `.discovery/repos.json` and execs `claude` with `--add-dir` for each linked code repo. The agent now sees the vault (cwd) AND every linked code repo as readable roots.

### 5. Daily workflow

```bash
discovery sync           # before starting: git pull --rebase && git push
discovery claude         # start Claude Code with linked repos mounted
# … work …
discovery sync           # when done: push your sidecar notes back
```

### Other subcommands

```bash
discovery repos             # show linked repos + their resolved paths
discovery refresh-token     # rotate the PAT in .mcp.json (90-day expiry)
discovery help              # show all subcommands
```

---

## Architecture cheat-sheet

```
   YOUR SERVER (Crnogorchi)              YOUR LAPTOP
   ─────────────────────────              ──────────────────────
   Postgres  (findings DB)                 ~/discovery/<slug>/
   Discovery MCP /mcp/{id} (HTTPS)              ├── .claude/   (agents)
   Pipeline (Gmail/Drive/upload)                ├── CLAUDE.md
   Vault git remote /vaults/{id}.git            ├── .mcp.json  (PAT)
   Web UI                                       ├── .memory-bank/
                                                └── .discovery/
                                                     └── repos.json
                                          ~/work/api/    (linked code)
                                          ~/work/web/    (linked code)
```

- **Conversation runs on the laptop**: Claude Code spawns there, reads vault files locally, only MCP tool calls cross the network.
- **PATs are per-laptop**: each `discovery setup` mints a fresh one. Revoke from web UI Settings if a laptop is lost.
- **Vault is DB-derived + per-PM hand notes**: pipeline writes BR/GAP/CON/CTR/people files, PMs add follow-up context in sidecar notes (see `assistants/CLAUDE.md` Artifact Ownership Contract).

For operators (running the backend): see [`docs/operator.md`](docs/operator.md).
