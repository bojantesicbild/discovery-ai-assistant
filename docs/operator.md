# Operator guide — Crnogorchi backend

Short guide for the human running the backend. Covers PAT minting +
revocation, vault repo storage, and the nginx layer needed for
team-member terminal mode.

## Personal access tokens (PATs)

Tokens are stored hashed in the `api_tokens` table; plaintext is shown
exactly once at creation and never recoverable.

- **Mint via web UI**: Settings → API tokens → Create. User-scoped.
- **Mint via `discovery setup`**: each call to `/api/projects/{id}/bootstrap`
  creates a fresh 90-day project-scoped token (`scopes={"project_id":...,
  "kind":"discovery-cli"}`). Auth: web JWT.
- **Revoke**: web UI Settings → revoke. Soft-revoke (sets `revoked_at`),
  audit trail survives.
- **Format**: `dsc_<44 url-safe chars>` — 256 bits of entropy, `dsc_`
  prefix is grep-friendly for secret scanners.
- **Auth path**: every request that arrives with `Authorization: Bearer dsc_...`
  routes to `verify_token()` in `app/services/api_tokens.py`. JWTs and
  PATs share the same `get_current_user` dep — they're interchangeable
  at the auth layer; route handlers can be PAT-strict if needed (the
  `/bootstrap` endpoint is, to prevent PAT → PAT escalation).

## Vault repos

Each project has two on-disk pieces, both under `<repo>/.runtime/`:

- **Worktree**: `<repo>/.runtime/projects/{project_id}/`
  Pipeline + claude_runner write here. Lazy-init'd by
  `claude_runner._setup_project_dir`. Has its own `.git/` so per-project
  `git status` doesn't reach the dev repo.
- **Bare**: `<repo>/.runtime/vaults/{project_id}.git`
  Lazy-created by `VaultSync` on first commit. nginx serves this over
  HTTPS to team-member clones. `git fsck` + tarball nightly is enough
  for backups.

`VaultSync` (`app/services/vault_sync.py`) is the single owner of
commits + pushes. Pipeline + MCP write paths call `vault_sync.commit()`;
the background loop debounces pushes (~10s) and handles
`push → rejected → fetch → rebase → push` automatically. Single instance
per backend process, lifespan-managed in `app/main.py`.

## nginx + git smart-HTTP

The vault repos are served via `git-http-backend` (CGI, ships with
git-core) gated by an `auth_request` to FastAPI's
`/api/internal/auth/verify-vault-access` endpoint. Sample config in
[`infra/nginx/discovery-vaults.conf`](../infra/nginx/discovery-vaults.conf)
— drop into `/etc/nginx/conf.d/` and edit `GIT_PROJECT_ROOT` to match
your install path.

Prereqs on the host:
- `git-core` package (provides `/usr/lib/git-core/git-http-backend`)
- `fcgiwrap` running on `/var/run/fcgiwrap.socket`
- The FastAPI backend listening on `127.0.0.1:8008` (or wherever you
  point the nginx `proxy_pass`)

Test from a second machine:
```bash
git -c "http.extraHeader=Authorization: Bearer dsc_..." \
    clone https://your-host/vaults/{project_id}.git
```

403 from nginx means the auth_request rejected the PAT (revoked, wrong
project, or non-member). 404 means the bare repo doesn't exist yet
(no pipeline writes have happened on that project — once one ingests,
VaultSync lazy-creates it).

## Public URL

`settings.public_url` (env: `PUBLIC_URL`) is the canonical URL team
laptops hit. Used by `/bootstrap` to compose:
- `vault_clone_url` — `${PUBLIC_URL}/vaults/{id}.git`
- MCP URL in `.mcp.json` — `${PUBLIC_URL}/mcp/{id}`

Default: `http://localhost:8008` (dev). Production: set to your
nginx-fronted HTTPS URL.

## CORS for the laptop CLI

When team members hit `/cli.sh` and `/api/projects/{id}/bootstrap` from
their browser (DevTools-copied JWT), the request comes from the FRONTEND
origin (`http://localhost:3000` in dev) — already in `cors_origins`. No
extra config needed for terminal-mode users; their `curl` calls don't
trigger CORS.

## Day-1 teammate flow (the acceptance test)

Hands the operator can do with no Crnogorchi-developer help:

1. Web UI: create the project + add the teammate as a `member` in
   ProjectMember.
2. Optionally: add ProjectRepo entries for any code repos the teammate
   should have read access to from agents.
3. Tell the teammate the backend URL + that they should:
   - Log into the web UI (`https://your-host/`)
   - Copy their JWT from DevTools
   - Run the install line + `discovery setup <project_id>`

Five minutes later they're in `claude` against the project. If they
hit a snag, the most likely culprit is `jq` not installed or the
backend's `PUBLIC_URL` set to localhost when their laptop is on a
different host.
