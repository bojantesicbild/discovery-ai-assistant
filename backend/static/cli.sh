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

  # Resolve each linked code repo to an absolute path on this laptop.
  # Writes .discovery/repos.json — gitignored — mapping repo name to
  # absolute path. `discovery claude` reads this to build --add-dir
  # flags so the agent can read across all linked repos.
  mkdir -p "$target/.discovery"
  _discovery_resolve_repos "$target" "$bundle"

  cat <<EOF

Done. Next:
  cd ~/discovery/$slug
  discovery claude

Linked code repos for this project:
$(jq -r 'to_entries[]? | "  - " + .key + "  →  " + .value' "$target/.discovery/repos.json" 2>/dev/null || echo "  (none linked)")
EOF
}

# Per-laptop resolution of linked code repos. For each entry in
# bundle.linked_repos, autodetect at common locations
# (~/work/{name}, ~/code/{name}, ~/dev/{name}) and confirm; if not
# found, offer to clone fresh into ~/work/{name}; users can also type
# a custom path or 'skip' if they don't have access.
_discovery_resolve_repos() {
  local target="$1"
  local bundle="$2"
  local repos_json="$target/.discovery/repos.json"

  # Start with an empty mapping.
  echo '{}' > "$repos_json"

  local count
  count=$(echo "$bundle" | jq -r '.linked_repos | length')
  if [ "$count" -eq 0 ]; then
    return 0
  fi

  echo
  echo "Resolving $count linked code repo(s) for this project."

  local i=0
  while [ "$i" -lt "$count" ]; do
    local name url
    name=$(echo "$bundle" | jq -r ".linked_repos[$i].name")
    url=$(echo "$bundle" | jq -r ".linked_repos[$i].url")
    branch=$(echo "$bundle" | jq -r ".linked_repos[$i].default_branch // \"main\"")
    i=$((i + 1))

    echo
    echo "  $name  →  $url ($branch)"

    # Autodetect at common parent dirs by matching the remote URL.
    local found=""
    local parent
    for parent in "$HOME/work" "$HOME/code" "$HOME/dev" "$HOME/projects" "$HOME/git"; do
      local candidate="$parent/$name"
      if [ -d "$candidate/.git" ]; then
        local remote
        remote=$(git -C "$candidate" remote get-url origin 2>/dev/null || true)
        if [ "$remote" = "$url" ]; then
          found="$candidate"
          break
        fi
      fi
    done

    if [ -n "$found" ]; then
      printf "    Already cloned at %s — use it? [Y/n/path] " "$found"
      local ans
      read -r ans
      case "$ans" in
        ""|y|Y|yes) ;;
        n|N|no) found="" ;;
        *) found="$ans" ;;
      esac
    fi

    if [ -z "$found" ]; then
      local default_dest="$HOME/work/$name"
      printf "    Not found. Clone to %s? [Y/n/path/skip] " "$default_dest"
      local ans
      read -r ans
      case "$ans" in
        ""|y|Y|yes)
          mkdir -p "$HOME/work"
          if git clone --branch "$branch" "$url" "$default_dest" 2>&1 | tail -3; then
            found="$default_dest"
          else
            echo "    Clone failed; skipping. Re-run 'discovery setup' after fixing access."
          fi
          ;;
        n|N|no|skip)
          echo "    Skipped — agent won't see this repo until you add it manually."
          ;;
        *)
          # Custom path. Either use existing clone or clone fresh.
          if [ -d "$ans/.git" ]; then
            found="$ans"
          else
            mkdir -p "$(dirname "$ans")"
            if git clone --branch "$branch" "$url" "$ans" 2>&1 | tail -3; then
              found="$ans"
            fi
          fi
          ;;
      esac
    fi

    if [ -n "$found" ]; then
      # Persist the path. Resolve to absolute so `discovery claude`
      # works regardless of where it's invoked from.
      local abs
      abs=$(cd "$found" && pwd)
      jq --arg n "$name" --arg p "$abs" '.[$n] = $p' "$repos_json" > "$repos_json.tmp" && mv "$repos_json.tmp" "$repos_json"
    fi
  done
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
  # Resolve claude's full path defensively. zsh sometimes caches command
  # lookups in a function-local hash that doesn't match the interactive
  # shell's PATH; using the resolved path bypasses that. Tries (in order):
  # `command -v`, then well-known locations.
  local claude_bin=""
  claude_bin=$(command -v claude 2>/dev/null) || claude_bin=""
  if [ -z "$claude_bin" ]; then
    for try in \
      "$HOME/.local/bin/claude" \
      "$HOME/.npm-global/bin/claude" \
      "/opt/homebrew/bin/claude" \
      "/usr/local/bin/claude"; do
      if [ -x "$try" ]; then
        claude_bin="$try"
        break
      fi
    done
  fi
  if [ -z "$claude_bin" ]; then
    echo "discovery: 'claude' (Claude Code) not found in PATH or common locations" >&2
    echo "  Tried: \$PATH, ~/.local/bin/claude, ~/.npm-global/bin/claude, /opt/homebrew/bin/claude, /usr/local/bin/claude" >&2
    echo "  Run 'which claude' in a fresh shell — if it resolves, your shell rc isn't being loaded by the function context." >&2
    return 1
  fi

  local args=()
  if [ -f ".discovery/repos.json" ]; then
    # Build --add-dir flags from the resolved linked-repos map. The
    # agent gets read access to every linked code repo without the
    # user having to type --add-dir manually each session.
    local path
    while IFS= read -r path; do
      [ -z "$path" ] && continue
      args+=(--add-dir "$path")
    done < <(jq -r '.[]' .discovery/repos.json 2>/dev/null)
  fi
  exec "$claude_bin" "${args[@]}" "$@"
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
  if [ ! -f ".discovery/repos.json" ] && [ ! -f ".discovery-linked-repos.json" ]; then
    echo "discovery repos: nothing here yet (run 'discovery setup' first)" >&2
    return 1
  fi
  echo "Linked repos (from project):"
  if [ -f ".discovery-linked-repos.json" ]; then
    jq -r '.[] | "  - " + .name + "  →  " + .url + "  (" + .default_branch + ")"' .discovery-linked-repos.json
  fi
  echo
  echo "Resolved on this laptop:"
  if [ -f ".discovery/repos.json" ]; then
    jq -r 'to_entries[]? | "  - " + .key + "  →  " + .value' .discovery/repos.json
  else
    echo "  (none — re-run 'discovery setup' to resolve)"
  fi
}
