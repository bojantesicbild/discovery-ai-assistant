# discovery — local-terminal Crnogorchi setup CLI
#
# Source from your shell rc:
#   curl -fsSL "$DISCOVERY_HOST/cli.sh" >> ~/.zshrc
#   source ~/.zshrc
#
# Required env (set in shell or .env loaded by your shell):
#   DISCOVERY_HOST    — base URL of the backend, e.g. https://discovery.example
#   DISCOVERY_JWT     — your web session token (login to web UI, copy from devtools)
#
# Subcommands:
#   discovery setup <project_id>   — clone vault, write .mcp.json
#   discovery sync                 — git pull --rebase + push (run in vault dir)
#   discovery claude               — wraps `claude` with --add-dir for linked repos (Phase 4)
#   discovery refresh-token        — mint a new PAT and rewrite .mcp.json
#   discovery repos                — list linked code repos for the current vault

discovery() {
  local cmd="$1"
  shift || true

  case "$cmd" in
    setup)
      _discovery_setup "$@"
      ;;
    sync)
      _discovery_sync "$@"
      ;;
    claude)
      _discovery_claude "$@"
      ;;
    refresh-token)
      _discovery_refresh_token "$@"
      ;;
    repos)
      _discovery_repos "$@"
      ;;
    "" | help | -h | --help)
      _discovery_help
      ;;
    *)
      echo "discovery: unknown subcommand '$cmd'" >&2
      echo "Run 'discovery help' for usage." >&2
      return 2
      ;;
  esac
}

_discovery_help() {
  cat <<'EOF'
discovery — local-terminal Crnogorchi setup

Usage:
  discovery setup <project_id>   Clone vault, write .mcp.json
  discovery sync                 Pull + push the vault (run in vault dir)
  discovery claude               Open Claude Code with linked repos mounted
  discovery refresh-token        Rotate the PAT in this vault's .mcp.json
  discovery repos                Show linked code repos for this vault

Env:
  DISCOVERY_HOST    e.g. https://discovery.example.com
  DISCOVERY_JWT     web session token (used by `setup` + `refresh-token` only)
EOF
}

_discovery_check_env() {
  if [ -z "$DISCOVERY_HOST" ]; then
    echo "discovery: DISCOVERY_HOST is not set" >&2
    return 1
  fi
}

_discovery_check_jwt() {
  if [ -z "$DISCOVERY_JWT" ]; then
    echo "discovery: DISCOVERY_JWT is not set (log in to the web UI to get one)" >&2
    return 1
  fi
}

# --- setup -----------------------------------------------------------

_discovery_setup() {
  _discovery_check_env || return 1
  _discovery_check_jwt || return 1

  local pid="$1"
  if [ -z "$pid" ]; then
    echo "Usage: discovery setup <project_id>" >&2
    return 2
  fi

  command -v jq >/dev/null 2>&1 || { echo "discovery: 'jq' is required (brew install jq / apt install jq)" >&2; return 1; }
  command -v git >/dev/null 2>&1 || { echo "discovery: 'git' is required" >&2; return 1; }

  local bundle
  bundle=$(curl -fsSL -H "Authorization: Bearer $DISCOVERY_JWT" \
    "$DISCOVERY_HOST/api/projects/$pid/bootstrap") || {
      echo "discovery: bootstrap fetch failed" >&2; return 1; }

  local slug clone_url pat
  slug=$(echo "$bundle" | jq -r '.project_slug')
  clone_url=$(echo "$bundle" | jq -r '.vault_clone_url')
  pat=$(echo "$bundle" | jq -r '.user_pat')

  local target="${HOME}/discovery/${slug}"
  mkdir -p "${HOME}/discovery"

  if [ -d "$target/.git" ]; then
    echo "discovery: $target already exists; running pull instead"
    (cd "$target" && git pull --rebase)
  else
    git -c "http.extraHeader=Authorization: Bearer $pat" clone "$clone_url" "$target" || {
      echo "discovery: clone failed" >&2; return 1; }
    # Persist the auth header into the local clone's config so subsequent
    # pull/push from inside the vault don't need the env var.
    git -C "$target" config "http.${clone_url%/*}/.extraHeader" "Authorization: Bearer $pat"
  fi

  # Write .mcp.json (gitignored; do NOT commit).
  echo "$bundle" | jq -r '.mcp_config' > "$target/.mcp.json"
  if ! grep -qxF ".mcp.json" "$target/.gitignore" 2>/dev/null; then
    printf '\n.mcp.json\n.discovery/\n' >> "$target/.gitignore"
  fi

  echo "$bundle" | jq -r '.linked_repos' > "$target/.discovery-linked-repos.json"

  cat <<EOF

Done. Next:
  cd ~/discovery/$slug
  claude

Linked code repos for this project:
$(echo "$bundle" | jq -r '.linked_repos[]? | "  - " + .name + "  →  " + .url')

Phase 4 will add 'discovery claude' that wraps claude with --add-dir
for each linked repo. For now, clone them manually wherever you keep
your code and pass --add-dir yourself.
EOF
}

# --- sync ------------------------------------------------------------

_discovery_sync() {
  if [ ! -d ".git" ]; then
    echo "discovery sync: not a git repo (cd into your vault clone first)" >&2
    return 1
  fi
  git pull --rebase || return 1
  git push || true
}

# --- claude wrapper (Phase 4 will add --add-dir for linked repos) ---

_discovery_claude() {
  command -v claude >/dev/null 2>&1 || { echo "discovery: 'claude' (Claude Code) not found in PATH" >&2; return 1; }
  exec claude "$@"
}

# --- refresh-token ---------------------------------------------------

_discovery_refresh_token() {
  _discovery_check_env || return 1
  _discovery_check_jwt || return 1

  if [ ! -f ".mcp.json" ]; then
    echo "discovery refresh-token: no .mcp.json here (cd into your vault clone first)" >&2
    return 1
  fi

  # Reuse the bootstrap endpoint to mint a fresh PAT.
  local pid
  pid=$(jq -r '.mcpServers.discovery.url' .mcp.json | sed -E 's|.*/mcp/([0-9a-f-]+).*|\1|')
  if [ -z "$pid" ]; then
    echo "discovery refresh-token: could not parse project_id from .mcp.json" >&2
    return 1
  fi

  local bundle
  bundle=$(curl -fsSL -H "Authorization: Bearer $DISCOVERY_JWT" \
    "$DISCOVERY_HOST/api/projects/$pid/bootstrap") || {
      echo "discovery: refresh failed" >&2; return 1; }
  echo "$bundle" | jq -r '.mcp_config' > .mcp.json
  echo "PAT rotated in .mcp.json. Old PAT still valid until you revoke it from the web UI."
}

# --- repos -----------------------------------------------------------

_discovery_repos() {
  if [ ! -f ".discovery-linked-repos.json" ]; then
    echo "discovery repos: nothing here yet (run 'discovery setup' first)" >&2
    return 1
  fi
  jq -r '.[] | "  - " + .name + "  →  " + .url + "  (" + .default_branch + ")"' .discovery-linked-repos.json
}
