"""
Discovery MCP Server — connects directly to PostgreSQL.
Gives Claude Code (chat or local) access to all extracted project data.

Usage:
  python db_server.py

Environment:
  DATABASE_URL=postgresql://discovery_user:discovery_pass@localhost:5432/discovery_db
  DISCOVERY_PROJECT_ID=your-project-uuid  (optional, defaults to most recent)

Configure in .claude/settings.json:
  "discovery": {
    "command": "python",
    "args": ["/path/to/mcp-server/db_server.py"],
    "env": {
      "DATABASE_URL": "postgresql://discovery_user:discovery_pass@localhost:5432/discovery_db",
      "DISCOVERY_PROJECT_ID": ""
    }
  }
"""

import os
import sys
import json
import uuid
import asyncio
from pathlib import Path

import asyncpg
import yaml
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://discovery_user:discovery_pass@localhost:5432/discovery_db")
PROJECT_ID = os.environ.get("DISCOVERY_PROJECT_ID", "")
USER_ID = os.environ.get("DISCOVERY_USER_ID", "")
# The all-zeros UUID is the session-sharing sentinel, not a real user.
# Treat it as unset so the fallback chain in get_user_id runs.
if USER_ID == "00000000-0000-0000-0000-000000000000":
    USER_ID = ""

# Multi-user auth: when set, we call the backend /api/auth/mcp-verify
# at startup to exchange the PAT for a real user_id. The result is
# cached for the subprocess lifetime — MCP processes are short-lived
# (one per chat turn for web, one per terminal session for CLI) so
# in-memory cache is exactly the right scope. See MU-1 / MU-2 in the
# session-heartbeat architecture plan.
API_TOKEN = os.environ.get("DISCOVERY_API_TOKEN", "")
API_URL = os.environ.get("DISCOVERY_API_URL", "http://localhost:8000")

# Populated by _resolve_token_identity() on first call. The trio is:
#   user_id: UUID string, treated as authoritative when present
#   allowed_project_ids: set of UUID strings, used for soft-warnings
#   source: one of "token" | "env" | "db-fallback" | "unresolved",
#           diagnostic for stderr logging
_TOKEN_IDENTITY: dict | None = None
_TOKEN_IDENTITY_LOCK: asyncio.Lock | None = None


# ─────────────────────────────────────────────────────────────────────
# Schema-aware enum validation
# ─────────────────────────────────────────────────────────────────────
# We load the same canonical YAML schemas the backend uses
# (assistants/.claude/schemas/*.yaml). This lets us validate enum
# values for type/status/priority/etc. before INSERT, falling back
# to safe defaults when an agent passes garbage. Catches the kind of
# drift Phase 2C-1 fixed before it can sneak back in.
#
# We deliberately do NOT import schema_lib from the backend — mcp-server
# is a standalone process with its own venv. Instead we read the YAML
# files directly, which is the same source of truth.

_SCHEMAS_CACHE: dict | None = None


def _find_repo_root() -> Path | None:
    """Walk up from this file looking for the repo's `.runtime/` dir so we
    can find per-project discovery vaults without hardcoding a path."""
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        if (parent / ".runtime" / "projects").is_dir():
            return parent
        # Some layouts don't pre-create .runtime; fall back to "mcp-server's
        # parent is the repo root" which is the actual convention.
        if (parent / "mcp-server").is_dir() and (parent / "backend").is_dir():
            return parent
    return None


def _discovery_dir_for(pid: str) -> Path | None:
    """Resolve the discovery vault directory for a given project id.
    Returns None when the project hasn't been ingested yet (empty vault)."""
    root = _find_repo_root()
    if root is None:
        return None
    d = root / ".runtime" / "projects" / pid / ".memory-bank" / "docs" / "discovery"
    return d if d.exists() else None


# Load the backend's graph_parser via importlib so we can reuse the exact
# parsing logic the web UI uses, without importing the whole backend
# package (which has many transitive dependencies the MCP venv doesn't need).
# Falls back gracefully if the file is missing — the graph tools return
# an error instead of crashing.
_GRAPH_PARSER = None

def _load_graph_parser():
    global _GRAPH_PARSER
    if _GRAPH_PARSER is not None:
        return _GRAPH_PARSER
    root = _find_repo_root()
    if root is None:
        return None
    candidate = root / "backend" / "app" / "services" / "graph_parser.py"
    if not candidate.exists():
        return None
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("_graph_parser", candidate)
        if spec is None or spec.loader is None:
            return None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _GRAPH_PARSER = mod
        return mod
    except Exception:
        return None


def _bfs_related(nodes: list[dict], edges: list[dict], start_id: str,
                 radius: int, edge_type_filter: list[str] | None) -> dict:
    """Breadth-first traversal from `start_id` up to `radius` hops.

    Treats edges as undirected because the graph's edges are symmetric in
    practice (a `constrained` edge means "this BR is constrained by that
    constraint" AND "that constraint affects this BR" — both directions).

    `edge_type_filter` is a list of substrings matched against edge labels.
    Example: `["constrained"]` keeps only constraint/BR edges."""
    node_by_id = {n["id"]: n for n in nodes}
    if start_id not in node_by_id:
        # Case-insensitive retry — the parser sometimes normalises IDs
        # (br-001 vs BR-001). Fall back to prefix match.
        lower = start_id.lower()
        for nid in node_by_id:
            if nid.lower() == lower:
                start_id = nid
                break
        else:
            return {"start": start_id, "found": False, "nodes": [], "edges": []}

    adj: dict[str, list[tuple[str, dict]]] = {}
    for e in edges:
        if edge_type_filter:
            label = (e.get("label") or "").lower()
            if not any(t.lower() in label for t in edge_type_filter):
                continue
        adj.setdefault(e["source"], []).append((e["target"], e))
        adj.setdefault(e["target"], []).append((e["source"], e))

    visited = {start_id}
    traversed_edges: list[dict] = []
    seen_edge_keys: set[tuple] = set()
    frontier = [start_id]
    for _ in range(max(0, radius)):
        next_frontier: list[str] = []
        for nid in frontier:
            for neighbor, edge in adj.get(nid, []):
                key = (edge["source"], edge["target"], edge.get("label", ""))
                if key not in seen_edge_keys:
                    seen_edge_keys.add(key)
                    traversed_edges.append(edge)
                if neighbor not in visited:
                    visited.add(neighbor)
                    next_frontier.append(neighbor)
        frontier = next_frontier
        if not frontier:
            break

    return {
        "start": start_id,
        "found": True,
        "nodes": [node_by_id[nid] for nid in visited if nid in node_by_id],
        "edges": traversed_edges,
    }


def _graph_stats(nodes: list[dict], edges: list[dict], top_n: int) -> dict:
    """Degree rankings + per-type counts. Useful for 'which BR is most
    connected?' / 'which doc spawned the most findings?' questions."""
    degree: dict[str, int] = {}
    for e in edges:
        degree[e["source"]] = degree.get(e["source"], 0) + 1
        degree[e["target"]] = degree.get(e["target"], 0) + 1

    nodes_by_type: dict[str, list[dict]] = {}
    for n in nodes:
        nodes_by_type.setdefault(n["type"], []).append(n)

    def _ranked(node_list: list[dict]) -> list[dict]:
        scored = [
            {"id": n["id"], "label": n["label"], "type": n["type"], "degree": degree.get(n["id"], 0)}
            for n in node_list
        ]
        return sorted(scored, key=lambda x: -x["degree"])[:top_n]

    return {
        "total_nodes": len(nodes),
        "total_edges": len(edges),
        "nodes_by_type": {t: len(ns) for t, ns in nodes_by_type.items()},
        "most_connected_overall": _ranked(nodes),
        "most_connected_requirements": _ranked(nodes_by_type.get("requirement", [])),
        "most_connected_constraints": _ranked(nodes_by_type.get("constraint", [])),
        "most_connected_gaps": _ranked(nodes_by_type.get("gap", [])),
        "most_connected_contradictions": _ranked(nodes_by_type.get("contradiction", [])),
        "most_connected_documents": _ranked(nodes_by_type.get("document", [])),
        "most_connected_people": _ranked(nodes_by_type.get("stakeholder", [])),
    }


def _find_schemas_dir() -> Path | None:
    """Locate assistants/.claude/schemas/ relative to this file.

    The mcp-server lives at <repo>/mcp-server/db_server.py and the
    schemas live at <repo>/assistants/.claude/schemas/. Walk up from
    this file until we find one. Returns None if missing (so the
    server still starts in environments where schemas aren't shipped)."""
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        candidate = parent / "assistants" / ".claude" / "schemas"
        if candidate.exists() and candidate.is_dir():
            return candidate
    return None


def _load_schemas() -> dict:
    """Lazy-load the YAML schemas into a {kind: {field: dict, ...}} map.

    Output shape per kind:
        {
            "fields": {key: {"type", "values", "required", "default"}},
            "enums": {key: [v1, v2, ...]},   # convenience subset
        }
    """
    global _SCHEMAS_CACHE
    if _SCHEMAS_CACHE is not None:
        return _SCHEMAS_CACHE

    schemas_dir = _find_schemas_dir()
    if not schemas_dir:
        _SCHEMAS_CACHE = {}
        return _SCHEMAS_CACHE

    out: dict = {}
    for path in sorted(schemas_dir.glob("*.yaml")):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, dict) or "kind" not in data:
            continue
        kind = data["kind"]
        fields: dict[str, dict] = {}
        enums: dict[str, list] = {}
        for f in data.get("fields", []):
            key = f.get("key")
            if not key:
                continue
            fields[key] = {
                "type": f.get("type"),
                "values": f.get("values"),
                "required": f.get("required", False),
                "default": f.get("default"),
            }
            if f.get("type") == "enum" and f.get("values"):
                enums[key] = f["values"]
        out[kind] = {"fields": fields, "enums": enums}
    _SCHEMAS_CACHE = out
    return _SCHEMAS_CACHE


def coerce_enum(kind: str, field: str, value: str | None, fallback: str) -> str:
    """Validate `value` against the enum declared in the schema for
    `kind.field`. If invalid (or None), return `fallback`. The fallback
    must itself be valid — if not, returns the first declared enum value.

    Used to harden the per-kind INSERTs against agent typos and against
    schema drift. Logs to stderr (not the MCP protocol channel) when a
    coercion happens so debugging is possible."""
    schemas = _load_schemas()
    enum_values = schemas.get(kind, {}).get("enums", {}).get(field)
    if not enum_values:
        # Schema unavailable or field isn't an enum — accept as-is
        return value if value else fallback
    if value and value in enum_values:
        return value
    if fallback in enum_values:
        if value:
            print(f"[mcp] coerce {kind}.{field}={value!r} -> {fallback!r}", file=sys.stderr)
        return fallback
    # Last resort: first valid value
    print(f"[mcp] coerce {kind}.{field}={value!r} -> {enum_values[0]!r} (fallback {fallback!r} also invalid)", file=sys.stderr)
    return enum_values[0]

server = Server("discovery-db")
_pool = None


async def get_pool():
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=3)
    return _pool


async def get_project_id():
    """Get project ID — from env or most recent project."""
    if PROJECT_ID:
        return PROJECT_ID
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT id FROM projects WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1")
        return str(row["id"]) if row else None


async def _resolve_token_identity() -> dict:
    """Exchange DISCOVERY_API_TOKEN for a user identity via the backend,
    once per subprocess lifetime. Returns the cached dict on subsequent
    calls.

    Graceful degradation: if the token is missing, the backend is
    unreachable, or verify returns non-200, we record the failure and
    callers fall through to the env/DB chain. Dev setups without a
    token keep working. Production setups with a revoked token get a
    clear stderr line instead of silent wrong-user attribution.
    """
    global _TOKEN_IDENTITY, _TOKEN_IDENTITY_LOCK
    if _TOKEN_IDENTITY is not None:
        return _TOKEN_IDENTITY
    if _TOKEN_IDENTITY_LOCK is None:
        _TOKEN_IDENTITY_LOCK = asyncio.Lock()
    async with _TOKEN_IDENTITY_LOCK:
        if _TOKEN_IDENTITY is not None:
            return _TOKEN_IDENTITY
        if not API_TOKEN:
            _TOKEN_IDENTITY = {"user_id": None, "allowed_project_ids": set(), "source": "unresolved"}
            return _TOKEN_IDENTITY
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.post(
                    f"{API_URL}/api/auth/mcp-verify",
                    json={"token": API_TOKEN},
                )
            if r.status_code != 200:
                print(
                    f"[mcp] token verify failed: HTTP {r.status_code} — "
                    f"falling back to env/DB user resolution",
                    file=sys.stderr,
                )
                _TOKEN_IDENTITY = {"user_id": None, "allowed_project_ids": set(), "source": "unresolved"}
                return _TOKEN_IDENTITY
            data = r.json()
            _TOKEN_IDENTITY = {
                "user_id": data.get("user_id"),
                "allowed_project_ids": set(data.get("allowed_project_ids") or []),
                "email": data.get("email"),
                "source": "token",
            }
            print(
                f"[mcp] authenticated as {data.get('email')} "
                f"({len(_TOKEN_IDENTITY['allowed_project_ids'])} projects)",
                file=sys.stderr,
            )
            return _TOKEN_IDENTITY
        except Exception as e:
            print(
                f"[mcp] token verify errored: {e} — falling back to env/DB",
                file=sys.stderr,
            )
            _TOKEN_IDENTITY = {"user_id": None, "allowed_project_ids": set(), "source": "unresolved"}
            return _TOKEN_IDENTITY


async def get_user_id(pid: str):
    """Resolve user id for tools that write user-attributed rows (reminders).

    Resolution order:
      1. PAT — DISCOVERY_API_TOKEN verified via backend /api/auth/mcp-verify
      2. Explicit env var DISCOVERY_USER_ID (dev escape hatch)
      3. Project lead from project_members
      4. Any project member
      5. Solo-user fallback (users table has exactly one row)

    Returns None only when none of those resolve — caller should
    reject the tool call in that case. MU-2: tokens take precedence so
    multi-user installs attribute writes to the right human."""
    # (1) Token path — preferred, multi-user-safe
    ident = await _resolve_token_identity()
    if ident.get("user_id"):
        # Soft-warn if the authenticated user isn't a member of the
        # project this MCP call is about. We don't block — local dev
        # often runs as the bootstrap user with no membership rows —
        # but the signal helps detect misconfigured .mcp.json.
        allowed = ident.get("allowed_project_ids") or set()
        if pid and allowed and pid not in allowed:
            print(
                f"[mcp] warning: token user {ident.get('email')} is not a "
                f"member of project {pid} — proceeding anyway",
                file=sys.stderr,
            )
        return ident["user_id"]

    # (2) Env var — dev escape hatch, unchanged
    if USER_ID:
        return USER_ID
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT user_id FROM project_members WHERE project_id = $1 AND role = 'lead' ORDER BY created_at ASC LIMIT 1",
            pid,
        )
        if row:
            return str(row["user_id"])
        # Any member of this project.
        row = await conn.fetchrow(
            "SELECT user_id FROM project_members WHERE project_id = $1 ORDER BY created_at ASC LIMIT 1",
            pid,
        )
        if row:
            return str(row["user_id"])
        # Solo-user escape hatch: if there's exactly one user in the whole
        # system, attribute to them. Avoids breaking single-dev setups
        # where project_members never got seeded.
        count = await conn.fetchval("SELECT count(*) FROM users")
        if count == 1:
            row = await conn.fetchrow("SELECT id FROM users LIMIT 1")
            return str(row["id"]) if row else None
        return None


def _json_result(data) -> list[TextContent]:
    return [TextContent(type="text", text=json.dumps(data, indent=2, default=str))]


async def _trigger_markdown_sync(pid: str):
    """Trigger markdown re-export via the backend API (fire-and-forget)."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(f"http://localhost:8000/api/projects/{pid}/sync-markdown",
                            headers={"Authorization": "Bearer internal"})
    except Exception:
        pass  # Non-fatal


async def _recalculate_readiness(conn, pid: str):
    """Recalculate readiness after a write — mirrors evaluator.py S2.6 formula.

    Four components, weighted: coverage (0.35) + clarity (0.25) +
    alignment (0.20) + context (0.20), scaled to 0-100. Logic matches
    backend/app/services/evaluator.py so the MCP and the API return the
    same number for the same data. If you change one, change both."""
    # Coverage — BR count + average fill
    total_reqs = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1", pid) or 0
    count_signal = min(total_reqs / 5, 1.0) if total_reqs else 0.0
    fill_signal = 0.0
    if total_reqs:
        # Four "filled-or-not" fields matching evaluator._BR_FILLED_FIELDS.
        # Null / empty-string / empty-array all count as not filled.
        fill_rows = await conn.fetch(
            """
            SELECT
              (description IS NOT NULL AND description <> '')::int
              + (priority IS NOT NULL AND priority <> '')::int
              + (acceptance_criteria IS NOT NULL AND jsonb_array_length(acceptance_criteria) > 0)::int
              + (rationale IS NOT NULL AND rationale <> '')::int AS filled
            FROM requirements WHERE project_id = $1
            """,
            pid,
        )
        fill_signal = sum(row["filled"] for row in fill_rows) / (len(fill_rows) * 4)
    coverage = 0.5 * count_signal + 0.5 * fill_signal

    # Clarity — open gaps per BR
    open_gaps = await conn.fetchval(
        "SELECT COUNT(*) FROM gaps WHERE project_id = $1 AND status = 'open'", pid
    ) or 0
    clarity = 0.0 if total_reqs == 0 else max(0.0, 1.0 - (open_gaps / total_reqs))

    # Alignment — contradictions resolved
    total_contras = await conn.fetchval(
        "SELECT COUNT(*) FROM contradictions WHERE project_id = $1", pid
    ) or 0
    unresolved = await conn.fetchval(
        "SELECT COUNT(*) FROM contradictions WHERE project_id = $1 AND resolved = false", pid
    ) or 0
    alignment = 1.0 if total_contras == 0 else (total_contras - unresolved) / total_contras

    # Context — stakeholders + decision-maker + constraints
    stk_count = await conn.fetchval(
        "SELECT COUNT(*) FROM stakeholders WHERE project_id = $1", pid
    ) or 0
    has_final = await conn.fetchval(
        "SELECT COUNT(*) FROM stakeholders WHERE project_id = $1 AND decision_authority = 'final'", pid
    ) or 0
    con_count = await conn.fetchval(
        "SELECT COUNT(*) FROM constraints WHERE project_id = $1", pid
    ) or 0
    people_signal = min(stk_count / 2, 1.0)
    authority_signal = 1.0 if has_final > 0 else 0.0
    constraint_signal = min(con_count / 2, 1.0)
    context = (people_signal + authority_signal + constraint_signal) / 3.0

    overall = round(
        (coverage * 0.35 + clarity * 0.25 + alignment * 0.20 + context * 0.20) * 100, 1
    )

    breakdown = json.dumps({
        "components": {
            "coverage":  {"score": round(coverage, 3),  "weight": 0.35},
            "clarity":   {"score": round(clarity, 3),   "weight": 0.25},
            "alignment": {"score": round(alignment, 3), "weight": 0.20},
            "context":   {"score": round(context, 3),   "weight": 0.20},
        }
    })
    await conn.execute(
        "INSERT INTO readiness_history (id, project_id, score, breakdown, triggered_by) VALUES (gen_random_uuid(), $1, $2, $3, $4)",
        pid, overall, breakdown, "mcp_write"
    )
    asyncio.ensure_future(_trigger_markdown_sync(pid))
    return overall


# ─────────────────────────────────────────────────────────────────────
# Relationships — dual-write + query helpers
# ─────────────────────────────────────────────────────────────────────
# The MCP uses raw asyncpg (no SQLAlchemy), so we mirror the backend's
# `app.services.relationships` contract here with SQL. Keeping the two
# in sync is a drift risk, but small — both write to the same table
# with the same unique key, so the UPSERT semantics can't actually
# diverge silently.


async def _resolve_finding_uuid(conn, pid: str, display_id: str) -> tuple[str, str] | None:
    """Resolve a display id (BR-004 / GAP-007 / CON-002 / CTR-005 /
    stakeholder name / doc filename) to (kind, uuid). Returns None when
    nothing matches."""
    if not display_id:
        return None
    upper = display_id.upper()
    if upper.startswith("BR-"):
        row = await conn.fetchrow(
            "SELECT id FROM requirements WHERE project_id = $1 AND req_id = $2",
            pid, upper,
        )
        return ("requirement", str(row["id"])) if row else None
    if upper.startswith("GAP-"):
        row = await conn.fetchrow(
            "SELECT id FROM gaps WHERE project_id = $1 AND gap_id = $2",
            pid, upper,
        )
        return ("gap", str(row["id"])) if row else None
    if upper.startswith("CON-"):
        try:
            idx = int(upper.split("-", 1)[1]) - 1
        except (ValueError, IndexError):
            return None
        row = await conn.fetchrow(
            "SELECT id FROM constraints WHERE project_id = $1 "
            "ORDER BY created_at, id OFFSET $2 LIMIT 1",
            pid, idx,
        )
        return ("constraint", str(row["id"])) if row else None
    if upper.startswith("CTR-"):
        try:
            idx = int(upper.split("-", 1)[1]) - 1
        except (ValueError, IndexError):
            return None
        row = await conn.fetchrow(
            "SELECT id FROM contradictions WHERE project_id = $1 "
            "ORDER BY created_at, id OFFSET $2 LIMIT 1",
            pid, idx,
        )
        return ("contradiction", str(row["id"])) if row else None

    # No prefix — try stakeholder name, then document filename.
    row = await conn.fetchrow(
        "SELECT id FROM stakeholders WHERE project_id = $1 AND name = $2",
        pid, display_id,
    )
    if row:
        return ("stakeholder", str(row["id"]))
    row = await conn.fetchrow(
        "SELECT id FROM documents WHERE project_id = $1 AND filename = $2",
        pid, display_id,
    )
    if row:
        return ("document", str(row["id"]))
    return None


async def _upsert_relationship(
    conn, *, pid: str,
    from_type: str, from_uuid: str,
    to_type: str, to_uuid: str,
    rel_type: str,
    confidence: str,
    created_by: str,
    source_doc_id: str | None = None,
    source_quote: str | None = None,
    rationale: str | None = None,
) -> None:
    """Insert a relationship row or bump last_seen_at + reactivate on
    re-proposal. Mirrors app.services.relationships.upsert_relationship.

    Confidence never downgrades: explicit > proposed > derived."""
    await conn.execute(
        """
        INSERT INTO relationships
          (project_id, from_type, from_uuid, to_type, to_uuid,
           rel_type, confidence, created_by,
           source_doc_id, source_quote, rationale)
        VALUES ($1, $2, $3::uuid, $4, $5::uuid, $6, $7::rel_confidence,
                $8::rel_source, $9, $10, $11)
        ON CONFLICT ON CONSTRAINT uq_relationships_endpoints
        DO UPDATE SET
          last_seen_at = NOW(),
          status = 'active',
          retracted_at = NULL,
          retracted_by = NULL,
          retraction_reason = NULL,
          source_quote = EXCLUDED.source_quote,
          rationale = EXCLUDED.rationale,
          confidence = CASE
            WHEN relationships.confidence = 'explicit' THEN 'explicit'::rel_confidence
            WHEN EXCLUDED.confidence = 'explicit' THEN 'explicit'::rel_confidence
            WHEN relationships.confidence = 'proposed' THEN 'proposed'::rel_confidence
            ELSE EXCLUDED.confidence
          END
        """,
        pid, from_type, from_uuid, to_type, to_uuid,
        rel_type, confidence, created_by,
        source_doc_id, source_quote, rationale,
    )


async def _active_session_id(conn, pid: str, uid: str | None) -> str:
    """Find or create the 'active' session row for (project, user).

    Matches the race-safe pattern in app.services.sessions — select
    first, insert if missing, fall back to re-select if a concurrent
    insert won the partial unique index."""
    q_user = "user_id = $2::uuid" if uid else "user_id IS NULL"
    params = [pid] + ([uid] if uid else [])
    row = await conn.fetchrow(
        f"SELECT id FROM sessions "
        f"WHERE project_id = $1 AND status = 'active' AND {q_user} "
        f"LIMIT 1",
        *params,
    )
    if row:
        # Keep the heartbeat fresh so the idle reaper doesn't flip it.
        await conn.execute(
            "UPDATE sessions SET last_event_at = NOW() WHERE id = $1",
            row["id"],
        )
        return str(row["id"])
    try:
        row = await conn.fetchrow(
            "INSERT INTO sessions (project_id, user_id, status) "
            "VALUES ($1, $2::uuid, 'active') RETURNING id",
            pid, uid,
        )
        return str(row["id"])
    except Exception:
        row = await conn.fetchrow(
            f"SELECT id FROM sessions "
            f"WHERE project_id = $1 AND status = 'active' AND {q_user} "
            f"LIMIT 1",
            *params,
        )
        if row:
            return str(row["id"])
        raise


async def _emit_event(
    conn, *, pid: str, event_type: str,
    payload: dict | None = None,
    artifact_updates: dict | None = None,
) -> None:
    """Fire-and-forget event emission from MCP write paths. Resolves
    the active session for the current user (via USER_ID env or fallback
    chain), inserts one session_events row, bumps session.last_event_at.

    Artifact merge matches the backend service semantics: list values
    extend with dedup, scalars replace."""
    try:
        uid = await get_user_id(pid)
        sid = await _active_session_id(conn, pid, uid)
    except Exception as e:
        # Silent swallow — event emission must never break the main
        # MCP call. Diagnostic via stderr for ops.
        print(f"[mcp] session lookup failed ({event_type}): {e}", file=sys.stderr)
        return

    try:
        await conn.execute(
            "INSERT INTO session_events "
            "(session_id, project_id, event_type, payload) "
            "VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)",
            sid, pid, event_type, json.dumps(payload or {}),
        )
    except Exception as e:
        print(f"[mcp] session_events insert failed ({event_type}): {e}", file=sys.stderr)
        return

    if artifact_updates:
        try:
            # Read current, merge, write back. Small payload, one row,
            # fine without a row-lock for now.
            cur = await conn.fetchval(
                "SELECT artifacts_produced FROM sessions WHERE id = $1::uuid",
                sid,
            )
            current = json.loads(cur) if isinstance(cur, str) else (cur or {})
            for key, val in artifact_updates.items():
                if isinstance(val, list):
                    existing = current.get(key) or []
                    if not isinstance(existing, list):
                        existing = [existing]
                    for item in val:
                        if item not in existing:
                            existing.append(item)
                    current[key] = existing
                else:
                    current[key] = val
            await conn.execute(
                "UPDATE sessions SET artifacts_produced = $1::jsonb WHERE id = $2::uuid",
                json.dumps(current), sid,
            )
        except Exception:
            # Artifact bookkeeping is a nice-to-have; never let it
            # take down the main MCP call.
            pass


async def _fetch_finding_refs(conn, kind: str, uuids: list[str]) -> list[dict]:
    """Resolve a batch of (kind, uuid) pairs back to {uuid, kind,
    display_id, label}. Used by get_connections to render neighbours.

    Display ids for requirement / gap come from their `req_id` / `gap_id`
    columns; constraint and contradiction use a short UUID prefix since
    their display ids are positional (assigned at markdown render time).
    Stakeholder uses name; document uses filename.
    """
    if not uuids:
        return []
    if kind == "requirement":
        rows = await conn.fetch(
            "SELECT id, req_id, title FROM requirements WHERE id = ANY($1::uuid[])",
            uuids,
        )
        return [
            {"uuid": str(r["id"]), "kind": kind,
             "display_id": r["req_id"], "label": r["title"] or ""}
            for r in rows
        ]
    if kind == "gap":
        rows = await conn.fetch(
            "SELECT id, gap_id, question FROM gaps WHERE id = ANY($1::uuid[])",
            uuids,
        )
        return [
            {"uuid": str(r["id"]), "kind": kind,
             "display_id": r["gap_id"], "label": (r["question"] or "")[:80]}
            for r in rows
        ]
    if kind == "constraint":
        rows = await conn.fetch(
            "SELECT id, description FROM constraints WHERE id = ANY($1::uuid[])",
            uuids,
        )
        return [
            {"uuid": str(r["id"]), "kind": kind,
             "display_id": f"CON-{str(r['id'])[:8]}",
             "label": (r["description"] or "")[:80]}
            for r in rows
        ]
    if kind == "contradiction":
        rows = await conn.fetch(
            "SELECT id, title, explanation FROM contradictions WHERE id = ANY($1::uuid[])",
            uuids,
        )
        return [
            {"uuid": str(r["id"]), "kind": kind,
             "display_id": f"CTR-{str(r['id'])[:8]}",
             "label": r["title"] or (r["explanation"] or "")[:80]}
            for r in rows
        ]
    if kind == "stakeholder":
        rows = await conn.fetch(
            "SELECT id, name, role FROM stakeholders WHERE id = ANY($1::uuid[])",
            uuids,
        )
        return [
            {"uuid": str(r["id"]), "kind": kind,
             "display_id": r["name"], "label": r["role"] or ""}
            for r in rows
        ]
    if kind == "document":
        rows = await conn.fetch(
            "SELECT id, filename FROM documents WHERE id = ANY($1::uuid[])",
            uuids,
        )
        return [
            {"uuid": str(r["id"]), "kind": kind,
             "display_id": r["filename"], "label": r["filename"]}
            for r in rows
        ]
    return []


async def _derived_connections(conn, pid: str, center: tuple[str, str]) -> list[dict]:
    """Two cheap inference groups computed at query time so we don't
    materialize O(N²) co-extraction edges. Mirrors the backend
    service's _derived_groups_for."""
    kind, cuuid = center
    groups: list[dict] = []

    # Fetch the center's source_doc_id + source_person (columns vary
    # per kind, hence this tiny dispatch).
    center_row = None
    if kind in ("requirement", "gap", "constraint", "stakeholder", "contradiction"):
        center_row = await conn.fetchrow(
            f"SELECT source_doc_id, "
            f"       {'source_person' if kind != 'stakeholder' else 'NULL AS source_person'} "
            f"FROM {kind}s WHERE id = $1::uuid",
            cuuid,
        )
    if center_row is None:
        return groups

    source_doc_id = center_row["source_doc_id"]
    source_person = center_row["source_person"]

    if source_doc_id:
        members: list[dict] = []
        for sibling_kind in ("requirement", "gap", "constraint", "stakeholder", "contradiction"):
            rows = await conn.fetch(
                f"SELECT id FROM {sibling_kind}s "
                f"WHERE project_id = $1 AND source_doc_id = $2::uuid AND id <> $3::uuid "
                f"LIMIT 30",
                pid, str(source_doc_id), cuuid,
            )
            if not rows:
                continue
            refs = await _fetch_finding_refs(conn, sibling_kind, [str(r["id"]) for r in rows])
            members.extend(refs)
        if members:
            doc = await conn.fetchrow(
                "SELECT filename FROM documents WHERE id = $1::uuid",
                str(source_doc_id),
            )
            groups.append({
                "kind": "shared_source_doc",
                "key": doc["filename"] if doc else str(source_doc_id)[:8],
                "members": members,
            })

    if source_person:
        members = []
        for sibling_kind in ("requirement", "gap", "constraint", "contradiction"):
            rows = await conn.fetch(
                f"SELECT id FROM {sibling_kind}s "
                f"WHERE project_id = $1 AND source_person = $2 AND id <> $3::uuid "
                f"LIMIT 30",
                pid, source_person, cuuid,
            )
            if not rows:
                continue
            refs = await _fetch_finding_refs(conn, sibling_kind, [str(r["id"]) for r in rows])
            members.extend(refs)
        if members:
            groups.append({
                "kind": "shared_stakeholder",
                "key": source_person,
                "members": members,
            })

    return groups


async def _dual_write_relationships(
    conn, *, pid: str,
    finding_type: str, finding_uuid: str,
    blocked_by_ids: list[str] | None = None,
    blocks_ids: list[str] | None = None,
    affects_ids: list[str] | None = None,
    concerns_ids: list[str] | None = None,
    source_doc_id: str | None = None,
    source_person_name: str | None = None,
    source_quote: str | None = None,
) -> int:
    """Emit explicit relationships alongside a newly stored finding.
    Called inline from the MCP store_finding handlers so every new
    finding contributes to the edge graph immediately."""
    written = 0

    for br in blocked_by_ids or []:
        target = await _resolve_finding_uuid(conn, pid, br)
        if target and target[0] == "requirement":
            await _upsert_relationship(
                conn, pid=pid,
                from_type=finding_type, from_uuid=finding_uuid,
                to_type=target[0], to_uuid=target[1],
                rel_type="blocked_by",
                confidence="explicit", created_by="extraction",
                source_doc_id=source_doc_id, source_quote=source_quote,
            )
            written += 1

    for br in blocks_ids or []:
        target = await _resolve_finding_uuid(conn, pid, br)
        if target and target[0] == "requirement":
            await _upsert_relationship(
                conn, pid=pid,
                from_type=finding_type, from_uuid=finding_uuid,
                to_type=target[0], to_uuid=target[1],
                rel_type="blocks",
                confidence="explicit", created_by="extraction",
                source_doc_id=source_doc_id, source_quote=source_quote,
            )
            written += 1

    for br in affects_ids or []:
        target = await _resolve_finding_uuid(conn, pid, br)
        if target and target[0] == "requirement":
            await _upsert_relationship(
                conn, pid=pid,
                from_type=finding_type, from_uuid=finding_uuid,
                to_type=target[0], to_uuid=target[1],
                rel_type="affects",
                confidence="explicit", created_by="extraction",
                source_doc_id=source_doc_id, source_quote=source_quote,
            )
            written += 1

    # `concerns` edges — used primarily by contradictions pointing at the
    # BR(s) / constraint(s) whose approach is in dispute. Targets may be
    # requirements or constraints; anything else silently skipped.
    for ref in concerns_ids or []:
        target = await _resolve_finding_uuid(conn, pid, ref)
        if target and target[0] in ("requirement", "constraint"):
            await _upsert_relationship(
                conn, pid=pid,
                from_type=finding_type, from_uuid=finding_uuid,
                to_type=target[0], to_uuid=target[1],
                rel_type="concerns",
                confidence="explicit", created_by="extraction",
                source_doc_id=source_doc_id, source_quote=source_quote,
            )
            written += 1

    if source_doc_id:
        await _upsert_relationship(
            conn, pid=pid,
            from_type=finding_type, from_uuid=finding_uuid,
            to_type="document", to_uuid=source_doc_id,
            rel_type="derived_from",
            confidence="explicit", created_by="extraction",
            source_doc_id=source_doc_id,
        )
        written += 1

    if source_person_name:
        stk = await conn.fetchrow(
            "SELECT id FROM stakeholders WHERE project_id = $1 AND name = $2",
            pid, source_person_name,
        )
        if stk:
            await _upsert_relationship(
                conn, pid=pid,
                from_type=finding_type, from_uuid=finding_uuid,
                to_type="stakeholder", to_uuid=str(stk["id"]),
                rel_type="raised_by",
                confidence="explicit", created_by="extraction",
                source_doc_id=source_doc_id, source_quote=source_quote,
            )
            written += 1

    return written


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(name="get_project_context", description="Get project overview: name, client, type, readiness score, document count, and per-area breakdown. Use at the start of any analysis.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_requirements", description="Get all business requirements with ID, title, priority (must/should/could), status (proposed/discussed/confirmed/dropped), description, and source quote. Filter by priority or status.", inputSchema={"type": "object", "properties": {"priority": {"type": "string", "description": "Filter: must, should, could, wont"}, "status": {"type": "string", "description": "Filter: proposed, discussed, confirmed, changed, dropped"}}, "required": []}),
        Tool(name="get_constraints", description="Get all project constraints: budget, timeline, technology, regulatory, organizational. Each has description, impact, and status.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_stakeholders", description="Get all identified people: name, role, organization, decision authority (final/recommender/informed), and interests.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_contradictions", description="Get all contradictions/conflicts between items, with resolution status.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_readiness", description="Get discovery readiness score and the four-component breakdown (coverage, clarity, alignment, context).", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_documents", description="Get all uploaded documents with processing status and extraction counts.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="search", description="Search across all extracted data (requirements, constraints, stakeholders, gaps, contradictions) by keyword.", inputSchema={"type": "object", "properties": {"query": {"type": "string", "description": "Search term"}}, "required": ["query"]}),
        Tool(name="get_activity", description="Get recent activity log: uploads, status changes, extractions.", inputSchema={"type": "object", "properties": {"limit": {"type": "integer", "description": "Number of entries (default 20)"}}, "required": []}),
        # Write tools
        Tool(name="update_requirement_status", description="Update a business requirement's status. Use when PO asks to confirm, discuss, change, or drop a requirement.", inputSchema={"type": "object", "properties": {"req_id": {"type": "string", "description": "Requirement ID (e.g. BR-001)"}, "status": {"type": "string", "enum": ["proposed", "discussed", "confirmed", "changed", "dropped"], "description": "New status"}}, "required": ["req_id", "status"]}),
        Tool(name="update_requirement_priority", description="Update a business requirement's priority.", inputSchema={"type": "object", "properties": {"req_id": {"type": "string", "description": "Requirement ID (e.g. BR-001)"}, "priority": {"type": "string", "enum": ["must", "should", "could", "wont"], "description": "New priority"}}, "required": ["req_id", "priority"]}),
        Tool(name="resolve_contradiction", description="Resolve a contradiction with a resolution note.", inputSchema={"type": "object", "properties": {"explanation_fragment": {"type": "string", "description": "Part of the contradiction explanation to find it"}, "resolution_note": {"type": "string", "description": "How it was resolved"}}, "required": ["explanation_fragment", "resolution_note"]}),
        Tool(name="get_control_points", description="Get readiness as a flat checklist mirroring the four-component evaluator (Coverage / Clarity / Alignment / Context). Returns the overall score and each component with status (covered / partial / missing) and the underlying count details. Present as a checklist — do NOT invent sub-checks that aren't in the response.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_gaps", description="Get all identified knowledge gaps. Each gap has gap_id (GAP-XXX), question, kind (missing_info / unvalidated_assumption / undecided), severity, area, status, source quote / person, and may list which requirements (BR-XXX) it blocks.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="search_documents", description="Full-text search across extracted items: requirements, constraints, stakeholders, gaps, and contradictions.", inputSchema={"type": "object", "properties": {"query": {"type": "string", "description": "Search term to match across all extracted data"}}, "required": ["query"]}),
        Tool(
            name="store_finding",
            description=(
                "Store a new finding discovered during analysis. Supported types: "
                "requirement, constraint, stakeholder, gap, contradiction. "
                "(Session-2 cleanup: decision / scope / assumption are gone — "
                "decision-like info goes on the BR as `rationale` + `alternatives_considered`, "
                "scope boundaries go on the BR as `scope_note`, and assumptions go in as a "
                "gap with kind=unvalidated_assumption or as a constraint.) "
                "Auto-assigns IDs and recalculates readiness."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "finding_type": {"type": "string", "enum": ["requirement", "constraint", "stakeholder", "gap", "contradiction"], "description": "Type of finding"},
                    "title": {"type": "string", "description": "Title/name of the finding. For contradictions: a short headline (e.g. 'MVP handoff documents', 'Extraction model')."},
                    "description": {"type": "string", "description": "Detailed description (role for stakeholder, area for gap). For contradictions: prefer the explicit side_a/side_b fields instead."},
                    "priority": {"type": "string", "description": "Priority: must/should/could/wont for requirements, severity for gaps, authority for stakeholders"},
                    "source": {"type": "string", "description": "Source context (default: agent)"},
                    "source_person": {"type": "string", "description": "Person who provided the finding (default: unknown)"},
                    "source_quote": {"type": "string", "description": "Verbatim quote from the source document (≥10 chars). Falls back to description if omitted."},
                    "source_doc_id": {"type": "string", "description": "UUID of the Document this finding was extracted from. ALWAYS pass this when the pipeline tells you the document id — it's what drives the Source column in the UI and the markdown source backlinks. Skip only for findings you're inferring with no single source document."},
                    "acceptance_criteria": {"type": "array", "items": {"type": "string"}, "description": "Requirement-only. List of AC blocks in GIVEN/WHEN/THEN form, one string per AC."},
                    "rationale": {"type": "string", "description": "Requirement-only. Why this BR over alternatives — absorbs the 'decision' concept. Populate when the source explains WHY, not just WHAT."},
                    "alternatives_considered": {"type": "array", "items": {"type": "string"}, "description": "Requirement-only. Options weighed and rejected, one per entry, format '<option> — <reason rejected>'. Skip if only one path was ever on the table."},
                    "scope_note": {"type": "string", "description": "Requirement-only. Short boundary clarifier if this BR doesn't apply everywhere (e.g. 'MVP only', 'iOS only'). Skip for most BRs."},
                    "blocked_by": {"type": "array", "items": {"type": "string"}, "description": "Requirement-only. BR ids that must ship before this one (e.g. ['BR-001', 'BR-004']). Used by story-story-agent to sequence PBIs in Phase 2."},
                    "affects_reqs": {"type": "array", "items": {"type": "string"}, "description": "Constraint-only. BR ids this constraint shapes (e.g. ['BR-004', 'BR-007']). Gives the PM a one-click 'what's at risk if this constraint stays' view. Include only when the source document clearly links the constraint to specific requirements."},
                    "workaround": {"type": "string", "description": "Constraint-only. Short mitigation note — the negotiation lever the PM can use when pushing back on an assumed constraint. Format: 'option considered — reason it fails' or just a free-text sentence. Skip when no workaround is discussed in the source."},
                    "kind": {"type": "string", "enum": ["missing_info", "unvalidated_assumption", "undecided"], "description": "Gap-only. Kind of gap: 'missing_info' (default) = client never told us; 'unvalidated_assumption' = we're assuming X but nothing confirms it; 'undecided' = a call that needs to be made but hasn't been."},
                    "blocked_reqs": {"type": "array", "items": {"type": "string"}, "description": "Gap-only. BR ids this gap blocks — capture when the source explicitly says a question must be answered before a BR can proceed ('we can't finalize BR-004 until we decide X'). Format ['BR-004', 'BR-005']. Drives the PM's 'what's at risk if this gap stays open' view."},
                    "side_a": {"type": "string", "description": "Contradiction-only. The FIRST conflicting statement — what one source/person said. E.g. 'David says 2 handoff docs'."},
                    "side_b": {"type": "string", "description": "Contradiction-only. The SECOND conflicting statement — what the other source/person said. E.g. 'Sarah says 3 handoff docs are required'."},
                    "area": {"type": "string", "description": "Contradiction-only. Domain category: tech-stack / scope / governance / timeline / budget / other."},
                    "side_a_source": {"type": "string", "description": "Contradiction-only. Document / source reference for side_a (e.g. 'client-meeting-notes-2.md', 'tech-stack-email.eml'). Leave null if unknown."},
                    "side_a_person": {"type": "string", "description": "Contradiction-only. Person who stated side_a (e.g. 'David Miller'). Leave null if unknown."},
                    "side_b_source": {"type": "string", "description": "Contradiction-only. Document / source reference for side_b. Leave null if unknown."},
                    "side_b_person": {"type": "string", "description": "Contradiction-only. Person who stated side_b. Leave null if unknown."},
                    "concerns_refs": {"type": "array", "items": {"type": "string"}, "description": "Contradiction-only. Display ids of BRs and/or constraints this contradiction is ABOUT — the things whose approach or validity is in dispute. E.g. a 'RAGFlow vs Qdrant' contradiction concerns BR-007 (retrieval layer) and CON-003 (RAGFlow contract constraint). Used to wire the contradiction into the graph so it surfaces on the BR/constraint detail view. Leave empty when the contradiction is free-floating (a disagreement not yet tied to a specific requirement)."},
                },
                "required": ["finding_type", "title", "description"],
            },
        ),
        Tool(
            name="propose_update",
            description=(
                "Stage a delta to an EXISTING requirement instead of creating a duplicate. "
                "Call this when your dedup check (get_requirements) matched an existing BR but "
                "the current document carries new info — a new rationale, an extra acceptance "
                "criterion, a source_person that wasn't captured, etc. Each call writes ONE "
                "staged proposal (one field, one patch) that shows up on the PM's BR detail "
                "view with Accept / Reject buttons. PM decides; nothing mutates the BR until "
                "they accept.\n\n"
                "IMPORTANT: only propose fields whose content genuinely differs from what the "
                "BR already has. Don't propose the same value back. Don't propose on "
                "priority / status / confidence / version — those go through "
                "update_requirement_status / update_requirement_priority.\n\n"
                "Supported fields: description, user_perspective, rationale, scope_note, "
                "title, source_person, acceptance_criteria, business_rules, edge_cases, "
                "alternatives_considered, blocked_by.\n\n"
                "For list fields (acceptance_criteria etc.), pass ONLY the new entries — "
                "the accept endpoint appends with dedup. For string fields, pass the new "
                "value; accept replaces the existing string.\n\n"
                "Before proposing, check `get_past_rejections` for this BR + field. If the "
                "PM has already rejected a similar proposal, don't re-propose — note it in "
                "your chat summary instead."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "target_req_id": {"type": "string", "description": "BR id to patch (e.g. 'BR-004')."},
                    "field": {"type": "string", "description": "Which requirement field to patch. One of: description, user_perspective, rationale, scope_note, title, source_person, acceptance_criteria, business_rules, edge_cases, alternatives_considered, blocked_by."},
                    "value": {"description": "New value. For string fields a string; for list fields an array of strings (only the new entries — they'll be appended with dedup on accept)."},
                    "rationale": {"type": "string", "description": "One-sentence note on why the agent is proposing this. Appears in the UI so the PM can judge the change without re-reading the source document."},
                    "source_doc_id": {"type": "string", "description": "UUID of the document that surfaced this delta — always pass the Document ID from the pipeline message."},
                    "source_person": {"type": "string", "description": "Stakeholder quoted in the source for this delta, when named."},
                },
                "required": ["target_req_id", "field", "value"],
            },
        ),
        Tool(
            name="get_past_rejections",
            description=(
                "Return the PM's recent rejected proposals on this project so the extraction "
                "agent doesn't re-propose the same pattern. Call this BEFORE propose_update "
                "for any BR you're about to patch — if the PM already rejected a similar "
                "proposal on this target+field, skip the propose_update and note in your chat "
                "summary that an earlier rejection covers this. This is the 'learning' loop: "
                "no model fine-tuning, just growing institutional memory fed back each run.\n\n"
                "Returns rejected_at desc, rows with target_req_id, proposed_field, "
                "proposed_value, rejection_reason, rejected_at."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "target_req_id": {"type": "string", "description": "Filter to a specific BR id. Optional — omit to see all recent rejections across the project."},
                    "field": {"type": "string", "description": "Filter to a specific field. Optional."},
                    "limit": {"type": "integer", "description": "Max rows to return (default 20)."},
                },
                "required": [],
            },
        ),
        Tool(
            name="get_related",
            description=(
                "Traverse the Knowledge Base graph and return the items connected "
                "to a given node within `radius` hops. Use this whenever the PM "
                "asks a traversal question — 'what gap is impacting BR-004 most', "
                "'which docs contradict BR-006', 'who touches the technology "
                "constraints', 'what's blocked by GAP-003' — instead of guessing "
                "from content overlap. The graph already encodes explicit edges "
                "(constrained, co-extracted, derived-from, mentions) that aren't "
                "in the structured tables.\n\n"
                "Pass the node's visible id (BR-001 / GAP-012 / CON-003 / CTR-004 / "
                "doc filename / stakeholder slug). Pass `radius` 1 for direct "
                "neighbours, 2 for the neighbours-of-neighbours. Optional "
                "`edge_types` filter matches substrings of edge labels, e.g. "
                "['constrained'] or ['co-extracted']."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "node_id": {"type": "string", "description": "Starting node id (BR-001, GAP-003, CON-002, CTR-005, doc stem, or stakeholder slug)."},
                    "radius": {"type": "integer", "description": "Hops to traverse (1-3). Default 1."},
                    "edge_types": {"type": "array", "items": {"type": "string"}, "description": "Optional substring match on edge labels — e.g. ['constrained'] keeps only BR↔constraint edges."},
                    "max_nodes": {"type": "integer", "description": "Cap on nodes returned (default 40). Large results get truncated."},
                },
                "required": ["node_id"],
            },
        ),
        Tool(
            name="get_graph_stats",
            description=(
                "Return overall Knowledge Base graph shape: total node / edge "
                "counts, nodes grouped by type, and degree-ranked top-N lists "
                "per type. Use when the PM asks ranking questions — 'which BR "
                "is most connected', 'which doc spawned the most findings', "
                "'who touches the most constraints'. Cheap to call; parses the "
                "vault fresh each time."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "top_n": {"type": "integer", "description": "How many items per ranking list (default 10)."},
                },
                "required": [],
            },
        ),
        Tool(
            name="propose_relationship",
            description=(
                "Stage an explicit edge between two findings as a PROPOSAL, "
                "not an immediate write. The PM reviews on the detail panel "
                "and accepts (flips to 'explicit') or rejects (retracts with "
                "a reason that feeds the past-rejections loop).\n\n"
                "Use this when the current document suggests a relationship "
                "to an EXISTING item — e.g. a new gap that hints it blocks "
                "BR-004, a new constraint that affects BR-007. For edges "
                "discovered AT extraction time on a freshly-written finding, "
                "prefer the built-in dual-write fields (blocked_by on req, "
                "blocked_reqs on gap, affects_reqs on constraint) which "
                "write 'explicit' immediately.\n\n"
                "Rel types: 'blocks', 'blocked_by', 'affects', 'affected_by', "
                "'raised_by', 'derived_from', 'contradicts'. Unknown types "
                "are allowed but won't render with nice labels.\n\n"
                "Endpoints are display ids (BR-004, GAP-007, CON-002, CTR-005, "
                "document filename, stakeholder name)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "from_id": {"type": "string", "description": "Display id of the FROM side (BR-004 / GAP-007 / CON-002 / CTR-005 / stakeholder name / document filename)."},
                    "to_id": {"type": "string", "description": "Display id of the TO side."},
                    "rel_type": {"type": "string", "description": "Edge type: blocks, blocked_by, affects, affected_by, raised_by, derived_from, contradicts."},
                    "source_quote": {"type": "string", "description": "Verbatim quote from the source document supporting this edge (≥10 chars)."},
                    "rationale": {"type": "string", "description": "One-sentence explanation of why this edge should exist."},
                    "source_doc_id": {"type": "string", "description": "UUID of the document whose reading surfaced this edge — pass the Document ID from the pipeline message."},
                },
                "required": ["from_id", "to_id", "rel_type"],
            },
        ),
        Tool(
            name="get_connections",
            description=(
                "Return all edges (outgoing + incoming + derived) touching "
                "one finding. This is the primary traversal primitive — "
                "replaces content-overlap guessing for relational questions "
                "like 'what gap blocks BR-004', 'which contradictions touch "
                "this constraint', 'who raised this requirement'.\n\n"
                "Explicit edges come from the relationships table (agent- "
                "and human-authored). Derived groups are cheap inference "
                "(same source_doc, same source_person) — not stored to "
                "avoid combinatorial explosion on large documents.\n\n"
                "Every edge carries confidence ('explicit' / 'proposed' / "
                "'derived'), source_doc, and source_quote. Cite them in "
                "your chat reply — 'GAP-007 blocks BR-004 (explicit, from "
                "client-meeting-2.md)' beats 'likely impacts'.\n\n"
                "Pass the finding's display id (BR-004 / GAP-007 / ...)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "finding_id": {"type": "string", "description": "Display id of the finding (BR-004, GAP-007, CON-002, CTR-005, stakeholder name, document filename)."},
                    "rel_types": {"type": "array", "items": {"type": "string"}, "description": "Optional filter — comma-of-types to restrict to (e.g. ['blocks', 'blocked_by'])."},
                    "include_derived": {"type": "boolean", "description": "Include shared-source-doc / shared-stakeholder derived groups. Default true."},
                    "max_edges": {"type": "integer", "description": "Cap on explicit edges returned. Default 60."},
                },
                "required": ["finding_id"],
            },
        ),
        Tool(
            name="get_active_learnings",
            description=(
                "Return the top-N active learnings for this project — the "
                "PM preferences, domain facts, workflow patterns, and "
                "anti-patterns the agent has accumulated across prior "
                "sessions. CALL THIS AT THE START OF EVERY EXTRACTION OR "
                "DISCOVERY TASK so you don't re-propose patterns the PM "
                "has already rejected and you match their established "
                "preferences.\n\n"
                "Ordered by reference_count desc, then last_relevant_at "
                "desc — most-reinforced first. Promoted rows always "
                "included; transient rows filtered by min_references "
                "(default 1 to surface everything, set 2+ to see only "
                "recurring patterns).\n\n"
                "Cite learnings in your chat output when you act on them, "
                "e.g. 'skipped proposing X because PM previously rejected "
                "this pattern twice'."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "category": {"type": "string", "enum": ["pm_preference", "domain_fact", "workflow_pattern", "anti_pattern"], "description": "Optional — filter to one category."},
                    "min_references": {"type": "integer", "description": "Minimum reference_count to include (default 1)."},
                    "limit": {"type": "integer", "description": "Max rows (default 10)."},
                },
                "required": [],
            },
        ),
        Tool(
            name="record_learning",
            description=(
                "Capture a PATTERN you've observed — a PM preference, a "
                "domain fact, an anti-pattern, or a workflow convention "
                "— so the next extraction + gap-analysis run reads it "
                "back via get_active_learnings. Repeat emissions of the "
                "same content collapse into one row with bumped "
                "reference_count, so don't worry about duplicates.\n\n"
                "Use this when you notice:\n"
                "- The PM rejected two similar proposals for the same "
                "reason → category='anti_pattern'\n"
                "- The PM consistently phrases ACs a certain way → "
                "category='pm_preference'\n"
                "- The source documents agree on a fact not captured as "
                "a finding → category='domain_fact'\n"
                "- The PM always does X before Y at session-end → "
                "category='workflow_pattern'\n\n"
                "Be terse in `content` — one sentence. Pass "
                "`evidence_quote` verbatim from the source (document or "
                "chat) so the PM can verify WHY the agent captured it."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "category": {"type": "string", "enum": ["pm_preference", "domain_fact", "workflow_pattern", "anti_pattern"]},
                    "content": {"type": "string", "description": "One-sentence insight. Repeat emissions dedup by normalized content."},
                    "evidence_quote": {"type": "string", "description": "Optional verbatim supporting quote from source doc or chat."},
                },
                "required": ["category", "content"],
            },
        ),
        Tool(
            name="get_current_time",
            description=(
                "Get the server's current time and timezone. Call this BEFORE scheduling any reminder "
                "so relative expressions ('tomorrow', 'in 2 hours', 'Friday') are grounded on the real "
                "clock — do NOT guess the current time or assume a timezone. Returns "
                "{now_utc, now_local, timezone, today_local}."
            ),
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="schedule_reminder",
            description=(
                "Schedule an in-project reminder for a future moment ('remind me to check BR-003 with Sara tomorrow, prep insights'). "
                "IMPORTANT: For ANY user-facing reminder about a BR / gap / meeting / PM follow-up, "
                "use THIS tool. Do NOT use Claude Code's built-in CronCreate / CronDelete / CronList — "
                "those schedule raw Claude Code runs and land outside the project DB, so the prepared "
                "brief never appears in chat, the dashboard does not see the reminder, and "
                "cancel_reminder / reschedule_reminder / list_reminders cannot act on it. "
                "This tool creates a row owned by the project reminder system, which: "
                "runs the prep agent at due_at - prep_lead, writes a brief to docs/meeting-prep/, "
                "surfaces the lifecycle in chat, and delivers via the configured channel. "
                "Note: plain free-text reminders (subject_type='free' with no person and no subject_id — "
                "e.g., 'remind me to test' or 'remind me in 1 minute') skip the brief step entirely "
                "and deliver just a notification. Only reminders with a BR / gap / person get a full "
                "prep brief. Don't promise the user a 'meeting brief' for a plain personal reminder. "
                "MANDATORY sequence before calling this tool: "
                "(1) call get_current_time to ground on the server clock; "
                "(2) resolve the user's phrasing to an absolute ISO-8601 timestamp with an explicit timezone offset; "
                "(3) echo the resolved time back in the user's LOCAL timezone WITH the weekday, "
                "e.g. 'I'll ping you Sunday 2026-04-19 at 00:00 (CET). Confirm?'; "
                "(4) confirm the delivery channel, BUT IN USER-FRIENDLY LANGUAGE — say "
                "'email (Gmail draft)', 'Google Calendar event', or 'in-app notification', NOT the raw ids 'gmail' / 'calendar' / 'in_app' / 'slack'. "
                "The user is a PM, not a developer. Example: 'Should I email you a draft, put it on your Google Calendar, or send an in-app notification?' "
                "Only translate back to the raw channel id when you actually call this tool; "
                "(5) if the subject is a BR or gap, confirm the id (must exist in the project). "
                "Only call this tool AFTER the user confirms the echoed time, channel, and subject. "
                "Returns {ok, reminder_id, validation_errors[]}. If validation_errors is non-empty, "
                "relay the first error to the user and ask for a correction — do NOT retry blindly."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "subject_type": {"type": "string", "enum": ["requirement", "gap", "free"], "description": "What the reminder is about"},
                    "subject_id": {"type": "string", "description": "Display id (BR-003 / GAP-012). Required for requirement/gap; null for free."},
                    "person": {"type": "string", "description": "Person involved (e.g. stakeholder name). Optional."},
                    "raw_request": {"type": "string", "description": "Original PM phrasing — audit trail"},
                    "due_at_iso": {"type": "string", "description": "ISO-8601 timestamp with timezone (e.g. 2026-04-19T09:00:00+02:00)"},
                    "channel": {"type": "string", "enum": ["gmail", "calendar", "in_app", "slack"], "description": "Delivery channel — ALWAYS confirm with the user in friendly language ('email / Google Calendar / in-app / Slack') before calling. `gmail` creates a Gmail draft; `calendar` creates a Google Calendar event (requires Gmail integration connected with calendar.events scope); `in_app` posts a chat notification only; `slack` is reserved, not wired in v1."},
                    "prep_lead_hours": {"type": "number", "description": "Hours before due_at when prep runs. Default 6 is right for real meetings (brief ready the morning of). For short-horizon tests ('remind me in 5 minutes') set this LOW (e.g. 0.02 for ~1min, 0.03 for ~2min) — otherwise the prep window opens 6 hours BEFORE due_at, and on a 5-minute test the scanner picks it up immediately, which defeats the test of 'does it fire at the right time'."},
                    "prep_agent": {"type": "string", "description": "Which agent to run for prep when output_kind=agenda. Default discovery-prep-agent."},
                    "output_kind": {"type": "string", "enum": ["notification", "status", "agenda", "research"], "description": "What the reminder produces when it fires. PICK CAREFULLY — a wrong pick either wastes an LLM run or produces a useless empty ping. Rules: (1) 'notification' = default; use for plain reminders with no subject ('remind me in 2 min', 'take a break'). No file, just a ping. (2) 'status' = short DB-backed summary; use for 'remind me about BR-003 tomorrow' — quick lookup of current state, priority, blocking gaps. No LLM, fires in ~100ms. (3) 'agenda' = full discovery-prep-agent run; ONLY use when the user is genuinely preparing for a meeting with a stakeholder ('prep me for Sara's meeting Monday'). Takes ~1 minute + LLM cost — never the default. (4) 'research' = reserved, not yet implemented. When a person is named, ASK the user: 'Should I prep a full meeting agenda or just a short status check?' Don't assume."},
                    "recurrence_end_at_iso": {"type": "string", "description": "ISO-8601 timestamp when recurrence stops. Null = runs forever (the user gets to cancel manually)."},
                },
                "required": ["subject_type", "raw_request", "due_at_iso", "channel"],
            },
        ),
        Tool(
            name="list_reminders",
            description=(
                "List project reminders (rows created via schedule_reminder). Do NOT use CronList — "
                "that returns Claude Code platform crons, not the project's user-facing reminders. "
                "Use this to find a specific reminder before canceling or rescheduling it "
                "('what reminders do I have?', 'show me the Sara one'). "
                "By default returns active rows only (pending / processing / prepared). Pass "
                "include_closed=true to also see delivered / canceled / failed. Filters compose: "
                "person does substring match, subject_id is exact. Returns rows ordered by due_at "
                "ascending with id, subject_type, subject_id, person, due_at, channel, status, "
                "raw_request, prep_output_path, external_ref, created_at."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "status": {"type": "string", "description": "Exact status filter (overrides include_closed). One of: pending, processing, prepared, delivered, canceled, failed"},
                    "person": {"type": "string", "description": "Substring match on person (case-insensitive)"},
                    "subject_id": {"type": "string", "description": "Exact display id (BR-003 / GAP-012)"},
                    "include_closed": {"type": "boolean", "description": "Include delivered / canceled / failed rows. Default false."},
                    "limit": {"type": "integer", "description": "Max rows (default 20, max 100)"},
                },
                "required": [],
            },
        ),
        Tool(
            name="cancel_reminder",
            description=(
                "Cancel a project reminder that hasn't been delivered yet. Use this for reminders "
                "created via schedule_reminder — do NOT use CronDelete, which only removes Claude "
                "Code platform crons and cannot touch project reminders. "
                "Find the reminder_id via list_reminders first. "
                "Allowed current states: pending, processing, prepared, failed — these move to canceled. "
                "Rejected: delivered (already fired — suggest scheduling a new reminder instead). "
                "Idempotent: canceling an already-canceled row returns ok with noop=true. "
                "Before calling, confirm the target with the user by echoing the subject + due_at + person."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "reminder_id": {"type": "string", "description": "UUID from list_reminders"},
                },
                "required": ["reminder_id"],
            },
        ),
        Tool(
            name="reschedule_reminder",
            description=(
                "Move a pending project reminder to a new due_at (and optionally change prep_lead_hours). "
                "This operates on rows created by schedule_reminder — not on Claude Code platform crons. "
                "If the user rescheduled a prior 'reminder' that was actually a CronCreate, cancel that "
                "via CronDelete and create a fresh one here via schedule_reminder instead. "
                "MANDATORY sequence before calling: "
                "(1) list_reminders to find the target id; "
                "(2) get_current_time to ground the new time on the server clock; "
                "(3) echo the change to the user in LOCAL time WITH weekday, e.g. "
                "'Moving reminder from Sunday 2026-04-19 00:00 (CEST) to Monday 2026-04-21 09:00 (CEST). Confirm?'; "
                "(4) only call after the user confirms. "
                "State guard: only pending rows are reschedulable. Processing (prep running) is "
                "rejected — wait for it to finish. Prepared (brief already written) is rejected — "
                "cancel + schedule a new one so the brief stays attached to a coherent time. "
                "Delivered / canceled / failed are all rejected similarly. Validation on new_due_at_iso "
                "matches schedule_reminder: must be future, must include timezone offset."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "reminder_id": {"type": "string", "description": "UUID from list_reminders"},
                    "new_due_at_iso": {"type": "string", "description": "ISO-8601 timestamp with timezone (e.g. 2026-04-21T09:00:00+02:00)"},
                    "new_prep_lead_hours": {"type": "number", "description": "Optional. Keep existing if omitted."},
                },
                "required": ["reminder_id", "new_due_at_iso"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    pool = await get_pool()
    pid = await get_project_id()

    if not pid:
        return _json_result({"error": "No active project found. Set DISCOVERY_PROJECT_ID env var."})

    async with pool.acquire() as conn:

        if name == "get_project_context":
            project = await conn.fetchrow("SELECT name, client_name, project_type, status FROM projects WHERE id = $1", pid)
            doc_count = await conn.fetchval("SELECT COUNT(*) FROM documents WHERE project_id = $1", pid)
            req_count = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1", pid)
            req_confirmed = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1 AND status = 'confirmed'", pid)
            contradictions = await conn.fetchval("SELECT COUNT(*) FROM contradictions WHERE project_id = $1 AND resolved = false", pid)
            readiness = await conn.fetchrow("SELECT score, breakdown FROM readiness_history WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1", pid)

            return _json_result({
                "project": dict(project) if project else {},
                "documents": doc_count,
                "requirements": {"total": req_count, "confirmed": req_confirmed},
                "unresolved_contradictions": contradictions,
                "readiness": {"score": readiness["score"], "breakdown": json.loads(readiness["breakdown"]) if readiness and readiness["breakdown"] else {}} if readiness else {"score": 0, "breakdown": {}},
            })

        if name == "get_requirements":
            query = "SELECT req_id, title, type, priority, description, user_perspective, business_rules, edge_cases, acceptance_criteria, source_quote, status, confidence FROM requirements WHERE project_id = $1"
            params = [pid]
            if p := arguments.get("priority"):
                query += " AND priority = $2"
                params.append(p)
            elif s := arguments.get("status"):
                query += " AND status = $2"
                params.append(s)
            query += " ORDER BY req_id"
            rows = await conn.fetch(query, *params)
            return _json_result([dict(r) for r in rows])

        if name == "get_constraints":
            rows = await conn.fetch("SELECT type, description, impact, source_quote, status FROM constraints WHERE project_id = $1", pid)
            return _json_result([dict(r) for r in rows])

        if name == "get_stakeholders":
            rows = await conn.fetch("SELECT name, role, organization, decision_authority, interests FROM stakeholders WHERE project_id = $1", pid)
            return _json_result([dict(r) for r in rows])

        if name == "get_contradictions":
            rows = await conn.fetch("SELECT item_a_type, item_b_type, explanation, resolved, resolution_note FROM contradictions WHERE project_id = $1", pid)
            return _json_result([dict(r) for r in rows])

        if name == "get_readiness":
            row = await conn.fetchrow("SELECT score, breakdown FROM readiness_history WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1", pid)
            if not row:
                return _json_result({"score": 0, "status": "no data"})
            score = row["score"]
            return _json_result({
                "score": score,
                "status": "ready" if score >= 85 else "conditional" if score >= 65 else "not_ready",
                "breakdown": json.loads(row["breakdown"]) if row["breakdown"] else {},
            })

        if name == "get_documents":
            rows = await conn.fetch("SELECT filename, file_type, pipeline_stage, items_extracted, contradictions_found, created_at FROM documents WHERE project_id = $1 ORDER BY created_at DESC", pid)
            return _json_result([dict(r) for r in rows])

        if name == "search":
            q = arguments.get("query", "")
            pattern = f"%{q}%"
            results = []

            reqs = await conn.fetch("SELECT req_id, title, priority, status FROM requirements WHERE project_id = $1 AND (title ILIKE $2 OR description ILIKE $2) LIMIT 10", pid, pattern)
            for r in reqs:
                results.append({"type": "requirement", "id": r["req_id"], "title": r["title"], "priority": r["priority"], "status": r["status"]})

            cons = await conn.fetch("SELECT type, description, status FROM constraints WHERE project_id = $1 AND description ILIKE $2 LIMIT 5", pid, pattern)
            for c in cons:
                results.append({"type": "constraint", "title": f"{c['type']}: {c['description'][:60]}", "status": c["status"]})

            return _json_result({"query": q, "results": results, "total": len(results)})

        if name == "get_activity":
            limit = arguments.get("limit", 20)
            rows = await conn.fetch("SELECT action, summary, created_at FROM activity_log WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2", pid, limit)
            return _json_result([dict(r) for r in rows])

        # ── Write tools ──

        if name == "update_requirement_status":
            req_id = arguments["req_id"]
            new_status = arguments["status"]
            old = await conn.fetchrow("SELECT status FROM requirements WHERE project_id = $1 AND req_id = $2", pid, req_id)
            if not old:
                return _json_result({"error": f"Requirement {req_id} not found"})
            await conn.execute("UPDATE requirements SET status = $1 WHERE project_id = $2 AND req_id = $3", new_status, pid, req_id)
            await conn.execute("INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'requirement_updated', $2, $3)", pid, f"Updated {req_id}: status {old['status']} → {new_status}", json.dumps({"req_id": req_id, "old_status": old["status"], "new_status": new_status}))
            new_score = await _recalculate_readiness(conn, pid)
            return _json_result({"success": True, "req_id": req_id, "old_status": old["status"], "new_status": new_status, "readiness": new_score})

        if name == "update_requirement_priority":
            req_id = arguments["req_id"]
            new_priority = arguments["priority"]
            old = await conn.fetchrow("SELECT priority FROM requirements WHERE project_id = $1 AND req_id = $2", pid, req_id)
            if not old:
                return _json_result({"error": f"Requirement {req_id} not found"})
            await conn.execute("UPDATE requirements SET priority = $1 WHERE project_id = $2 AND req_id = $3", new_priority, pid, req_id)
            await conn.execute("INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'requirement_updated', $2, $3)", pid, f"Updated {req_id}: priority {old['priority']} → {new_priority}", json.dumps({"req_id": req_id, "change": "priority"}))
            new_score = await _recalculate_readiness(conn, pid)
            return _json_result({"success": True, "req_id": req_id, "old_priority": old["priority"], "new_priority": new_priority, "readiness": new_score})

        if name == "resolve_contradiction":
            fragment = arguments["explanation_fragment"]
            note = arguments["resolution_note"]
            row = await conn.fetchrow("SELECT id, explanation FROM contradictions WHERE project_id = $1 AND explanation ILIKE $2 LIMIT 1", pid, f"%{fragment}%")
            if not row:
                return _json_result({"error": f"Contradiction containing '{fragment}' not found"})
            await conn.execute("UPDATE contradictions SET resolved = true, resolution_note = $1 WHERE id = $2", note, row["id"])
            new_score = await _recalculate_readiness(conn, pid)
            return _json_result({"success": True, "contradiction": row["explanation"][:60], "resolved": True, "readiness": new_score})

        # ── New read tools ──

        if name == "get_control_points":
            # Return the four-component view, matching backend evaluator
            # (Session 2, S2.6). Agents prompt-engineered for the old
            # 12-check shape should be updated — the system prompt's
            # README / CLAUDE.md describes the new shape.
            def _status(score: float) -> str:
                if score >= 0.8: return "covered"
                if score > 0.0:  return "partial"
                return "missing"

            # Coverage
            total_reqs = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1", pid) or 0
            count_signal = min(total_reqs / 5, 1.0) if total_reqs else 0.0
            fill_signal = 0.0
            if total_reqs:
                fill_rows = await conn.fetch(
                    """
                    SELECT
                      (description IS NOT NULL AND description <> '')::int
                      + (priority IS NOT NULL AND priority <> '')::int
                      + (acceptance_criteria IS NOT NULL AND jsonb_array_length(acceptance_criteria) > 0)::int
                      + (rationale IS NOT NULL AND rationale <> '')::int AS filled
                    FROM requirements WHERE project_id = $1
                    """,
                    pid,
                )
                fill_signal = sum(row["filled"] for row in fill_rows) / (len(fill_rows) * 4)
            coverage = 0.5 * count_signal + 0.5 * fill_signal

            # Clarity
            open_gaps = await conn.fetchval("SELECT COUNT(*) FROM gaps WHERE project_id = $1 AND status = 'open'", pid) or 0
            clarity = 0.0 if total_reqs == 0 else max(0.0, 1.0 - (open_gaps / total_reqs))

            # Alignment
            total_contras = await conn.fetchval("SELECT COUNT(*) FROM contradictions WHERE project_id = $1", pid) or 0
            unresolved = await conn.fetchval("SELECT COUNT(*) FROM contradictions WHERE project_id = $1 AND resolved = false", pid) or 0
            alignment = 1.0 if total_contras == 0 else (total_contras - unresolved) / total_contras

            # Context
            stk_count = await conn.fetchval("SELECT COUNT(*) FROM stakeholders WHERE project_id = $1", pid) or 0
            has_final = await conn.fetchval("SELECT COUNT(*) FROM stakeholders WHERE project_id = $1 AND decision_authority = 'final'", pid) or 0
            con_count = await conn.fetchval("SELECT COUNT(*) FROM constraints WHERE project_id = $1", pid) or 0
            context = (min(stk_count / 2, 1.0) + (1.0 if has_final else 0.0) + min(con_count / 2, 1.0)) / 3.0

            overall = round((coverage * 0.35 + clarity * 0.25 + alignment * 0.20 + context * 0.20) * 100, 1)

            checks = [
                {"check": f"Coverage — {total_reqs} BR{'s' if total_reqs != 1 else ''} captured, avg fill {int(fill_signal * 100)}%",
                 "score": round(coverage, 3), "status": _status(coverage), "component": "coverage"},
                {"check": f"Clarity — {open_gaps} open gap{'s' if open_gaps != 1 else ''} across {total_reqs} BR{'s' if total_reqs != 1 else ''}",
                 "score": round(clarity, 3), "status": _status(clarity), "component": "clarity"},
                {"check": f"Alignment — {unresolved} of {total_contras} contradiction{'s' if total_contras != 1 else ''} unresolved",
                 "score": round(alignment, 3), "status": _status(alignment), "component": "alignment"},
                {"check": f"Context — {stk_count} stakeholder{'s' if stk_count != 1 else ''}, {con_count} constraint{'s' if con_count != 1 else ''}, {'decision-maker set' if has_final else 'no decision-maker'}",
                 "score": round(context, 3), "status": _status(context), "component": "context"},
            ]

            return _json_result({"score": overall, "total_checks": len(checks), "checks": checks})

        if name == "get_gaps":
            rows = await conn.fetch(
                "SELECT gap_id, question, severity, area, status, "
                "       source_quote, source_person, blocked_reqs, "
                "       suggested_action, resolution "
                "FROM gaps WHERE project_id = $1 "
                "ORDER BY CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, gap_id",
                pid
            )
            return _json_result([dict(r) for r in rows])

        if name == "search_documents":
            q = arguments.get("query", "")
            pattern = f"%{q}%"
            results = []

            reqs = await conn.fetch("SELECT req_id, title, description, priority, status FROM requirements WHERE project_id = $1 AND (title ILIKE $2 OR description ILIKE $2) LIMIT 10", pid, pattern)
            for r in reqs:
                results.append({"type": "requirement", "id": r["req_id"], "title": r["title"], "description": (r["description"] or "")[:200], "status": r["status"]})

            cons = await conn.fetch("SELECT type, description, impact, status FROM constraints WHERE project_id = $1 AND (description ILIKE $2 OR impact ILIKE $2) LIMIT 10", pid, pattern)
            for c in cons:
                results.append({"type": "constraint", "id": c["type"], "title": f"{c['type']}: {(c['description'] or '')[:80]}", "description": (c["impact"] or "")[:200], "status": c["status"]})

            stkh = await conn.fetch("SELECT name, role, organization, interests FROM stakeholders WHERE project_id = $1 AND (name ILIKE $2 OR role ILIKE $2 OR interests ILIKE $2) LIMIT 10", pid, pattern)
            for s in stkh:
                results.append({"type": "stakeholder", "id": None, "title": f"{s['name']} ({s['role']})", "description": (s["interests"] or "")[:200]})

            gaps = await conn.fetch("SELECT gap_id, question, severity, status, suggested_action FROM gaps WHERE project_id = $1 AND (question ILIKE $2 OR suggested_action ILIKE $2) LIMIT 10", pid, pattern)
            for g in gaps:
                results.append({"type": "gap", "id": g["gap_id"], "title": (g["question"] or "")[:120], "description": f"[{g['severity']}] {(g['suggested_action'] or '')[:150]}", "status": g["status"]})

            ctrs = await conn.fetch("SELECT item_a_type, item_b_type, explanation, resolved FROM contradictions WHERE project_id = $1 AND explanation ILIKE $2 LIMIT 10", pid, pattern)
            for c in ctrs:
                results.append({"type": "contradiction", "id": None, "title": f"{c['item_a_type']} vs {c['item_b_type']}", "description": (c["explanation"] or "")[:200], "status": "resolved" if c["resolved"] else "open"})

            return _json_result({"query": q, "results": results, "total": len(results)})

        # ── New write tool ──

        if name == "store_finding":
            finding_type = arguments["finding_type"]
            title = arguments["title"]
            description = arguments["description"]
            priority = arguments.get("priority", "should")
            source = arguments.get("source", "agent")
            source_person = arguments.get("source_person", "unknown")
            # Verbatim quote from the source. Falls back to description
            # if the agent didn't provide one — keeps existing call sites
            # working without forcing every agent to add a new arg.
            source_quote = arguments.get("source_quote") or description
            # source_doc_id is the UUID of the originating document. The
            # extraction pipeline prompt tells the agent to pass this on
            # every finding; if a value comes in that isn't a valid UUID
            # (legacy callers, agent hallucination) we drop it rather than
            # error — the column is nullable and a bad insert here would
            # block the whole document.
            _raw_doc_id = arguments.get("source_doc_id") or None
            source_doc_uuid: uuid.UUID | None = None
            if _raw_doc_id:
                try:
                    source_doc_uuid = uuid.UUID(str(_raw_doc_id))
                except (ValueError, TypeError):
                    source_doc_uuid = None

            if finding_type == "requirement":
                # Auto-assign next BR-XXX id
                last = await conn.fetchval(
                    "SELECT req_id FROM requirements WHERE project_id = $1 AND req_id LIKE 'BR-%' ORDER BY req_id DESC LIMIT 1", pid
                )
                if last:
                    num = int(last.split("-")[1]) + 1
                else:
                    num = 1
                new_req_id = f"BR-{num:03d}"

                # type / priority / status / confidence are all enums
                # in the schema — coerce against it so agent typos
                # don't poison the data.
                req_priority = coerce_enum("requirement", "priority", priority, "should")
                # acceptance_criteria is optional — agents that extract ACs pass
                # a list of strings (each one a GIVEN/WHEN/THEN block). Falls
                # back to an empty array so the NOT NULL column has a value.
                acs = arguments.get("acceptance_criteria") or []
                # Session-2 BR enrichment: rationale absorbs decision info,
                # alternatives_considered lists rejected options, scope_note
                # is a boundary clarifier, blocked_by orders work for Phase 2.
                rationale = arguments.get("rationale") or None
                alternatives = arguments.get("alternatives_considered") or []
                scope_note = arguments.get("scope_note") or None
                blocked_by = arguments.get("blocked_by") or []
                row = await conn.fetchrow(
                    "INSERT INTO requirements (id, project_id, req_id, title, description, type, priority, status, confidence, "
                    " source_quote, source_person, source_doc_id, acceptance_criteria, "
                    " rationale, alternatives_considered, scope_note, blocked_by) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, 'functional', $5, 'proposed', 'medium', "
                    "        $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13::jsonb) "
                    "RETURNING id",
                    pid, new_req_id, title, description, req_priority,
                    source_quote, source_person, source_doc_uuid, json.dumps(acs),
                    rationale, json.dumps(alternatives), scope_note, json.dumps(blocked_by),
                )
                finding_uuid = str(row["id"])
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New requirement {new_req_id}: {title}", json.dumps({"type": "requirement", "req_id": new_req_id, "source": source})
                )
                # Dual-write explicit edges: blocked_by + derived_from + raised_by.
                await _dual_write_relationships(
                    conn, pid=pid,
                    finding_type="requirement", finding_uuid=finding_uuid,
                    blocked_by_ids=blocked_by,
                    source_doc_id=str(source_doc_uuid) if source_doc_uuid else None,
                    source_person_name=(source_person if source_person and source_person != "unknown" else None),
                    source_quote=source_quote,
                )
                await _emit_event(
                    conn, pid=pid, event_type="finding_stored",
                    payload={"kind": "requirement", "id": new_req_id, "title": title},
                    artifact_updates={"findings_created": [new_req_id]},
                )
                new_score = await _recalculate_readiness(conn, pid)
                return _json_result({"success": True, "type": "requirement", "req_id": new_req_id, "title": title, "readiness": new_score})

            elif finding_type == "constraint":
                # type / status are enums — coerce against the schema.
                # The agent can pass `priority` to override type (we
                # piggyback on the existing tool arg until 2C-2 adds
                # a proper kind_subtype field).
                con_type = coerce_enum("constraint", "type", priority, "technology")
                affects = arguments.get("affects_reqs") or []
                workaround = arguments.get("workaround") or None
                row = await conn.fetchrow(
                    "INSERT INTO constraints (id, project_id, type, description, impact, "
                    " source_quote, source_person, source_doc_id, affects_reqs, workaround, status) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, 'assumed') "
                    "RETURNING id",
                    pid, con_type, title, description or "", source_quote or "",
                    source_person, source_doc_uuid, json.dumps(affects), workaround
                )
                finding_uuid = str(row["id"])
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New constraint: {title}", json.dumps({"type": "constraint", "source": source})
                )
                await _dual_write_relationships(
                    conn, pid=pid,
                    finding_type="constraint", finding_uuid=finding_uuid,
                    affects_ids=affects,
                    source_doc_id=str(source_doc_uuid) if source_doc_uuid else None,
                    source_person_name=(source_person if source_person and source_person != "unknown" else None),
                    source_quote=source_quote,
                )
                await _emit_event(
                    conn, pid=pid, event_type="finding_stored",
                    payload={"kind": "constraint", "title": title, "type": con_type},
                    artifact_updates={"findings_created": [f"CON:{title[:40]}"]},
                )
                new_score = await _recalculate_readiness(conn, pid)
                return _json_result({"success": True, "type": "constraint", "title": title, "readiness": new_score})

            elif finding_type == "stakeholder":
                await conn.execute(
                    "INSERT INTO stakeholders (id, project_id, name, role, organization, decision_authority, source_doc_id) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)",
                    pid, title, description or "unknown", source or "unknown", priority or "informed", source_doc_uuid
                )
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New stakeholder: {title}", json.dumps({"type": "stakeholder"})
                )
                await _emit_event(
                    conn, pid=pid, event_type="finding_stored",
                    payload={"kind": "stakeholder", "name": title, "role": description},
                    artifact_updates={"findings_created": [f"STK:{title}"]},
                )
                return _json_result({"success": True, "type": "stakeholder", "name": title})

            elif finding_type == "gap":
                last = await conn.fetchval(
                    "SELECT gap_id FROM gaps WHERE project_id = $1 AND gap_id LIKE 'GAP-%' ORDER BY gap_id DESC LIMIT 1", pid
                )
                num = int(last.split("-")[1]) + 1 if last else 1
                gap_id = f"GAP-{num:03d}"
                # kind = missing_info (default) | unvalidated_assumption | undecided
                # Coerced defensively so an agent typo still inserts a row.
                kind = arguments.get("kind") or "missing_info"
                if kind not in ("missing_info", "unvalidated_assumption", "undecided"):
                    kind = "missing_info"
                # Gaps that block BRs — the agent-time capture of blocking
                # relationships. Dual-written as `blocks` edges below.
                blocked_reqs = arguments.get("blocked_reqs") or []
                row = await conn.fetchrow(
                    "INSERT INTO gaps (id, project_id, gap_id, question, kind, severity, area, status, "
                    " source_quote, source_person, source_doc_id, blocked_reqs) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10::jsonb) "
                    "RETURNING id",
                    pid, gap_id, title, kind, priority or "medium",
                    source or "general", source_quote or "",
                    (source_person if source_person and source_person != "unknown" else None),
                    source_doc_uuid, json.dumps(blocked_reqs),
                )
                finding_uuid = str(row["id"])
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New gap {gap_id} ({kind}): {title}", json.dumps({"type": "gap", "gap_id": gap_id, "kind": kind})
                )
                await _dual_write_relationships(
                    conn, pid=pid,
                    finding_type="gap", finding_uuid=finding_uuid,
                    blocks_ids=blocked_reqs,
                    source_doc_id=str(source_doc_uuid) if source_doc_uuid else None,
                    source_person_name=(source_person if source_person and source_person != "unknown" else None),
                    source_quote=source_quote,
                )
                await _emit_event(
                    conn, pid=pid, event_type="finding_stored",
                    payload={"kind": "gap", "id": gap_id, "gap_kind": kind, "question": title},
                    artifact_updates={"findings_created": [gap_id]},
                )
                new_score = await _recalculate_readiness(conn, pid)
                return _json_result({"success": True, "type": "gap", "gap_id": gap_id, "kind": kind, "question": title, "readiness": new_score})

            elif finding_type == "contradiction":
                # First-class contradiction fields. `side_a` / `side_b` are
                # the two conflicting statements; `title` is the short
                # headline; `area` is the domain category. Per-side
                # provenance (source + person) goes into side_*_source /
                # side_*_person so the UI can render source and person
                # chips next to each side. Legacy item_a_*/item_b_* stay
                # NULL unless the agent explicitly maps to DB rows.
                side_a = arguments.get("side_a") or ""
                side_b = arguments.get("side_b") or description or ""
                area = arguments.get("area") or None
                side_a_source = arguments.get("side_a_source") or None
                side_a_person = arguments.get("side_a_person") or None
                side_b_source = arguments.get("side_b_source") or None
                side_b_person = arguments.get("side_b_person") or None
                # concerns_refs: display ids (BR-NNN / CON-NNN) that this
                # contradiction is ABOUT. The retrieval-layer contradiction
                # concerns BR-007; the SOC-2 budget contradiction concerns
                # CON-004. Wires the contradiction into the graph so
                # get_connections surfaces it from the BR detail view.
                concerns_refs = arguments.get("concerns_refs") or []
                # Keep explanation populated for legacy readers (search,
                # agent get_contradictions, etc.) — compose from the new
                # fields so old queries still return meaningful content.
                expl_parts = [p for p in [title, side_a, side_b] if p]
                explanation = " / ".join(expl_parts)
                row = await conn.fetchrow(
                    "INSERT INTO contradictions "
                    "(id, project_id, title, side_a, side_b, area, "
                    " side_a_source, side_a_person, side_b_source, side_b_person, "
                    " explanation, source_doc_id, resolved) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false) "
                    "RETURNING id",
                    pid, title, side_a or None, side_b or None, area,
                    side_a_source, side_a_person, side_b_source, side_b_person,
                    explanation or None, source_doc_uuid,
                )
                contradiction_uuid = str(row["id"])
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) "
                    "VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New contradiction: {title}",
                    json.dumps({"type": "contradiction", "area": area}),
                )
                # Dual-write concerns edges so the contradiction shows up
                # on the BR / constraint detail view via get_connections.
                await _dual_write_relationships(
                    conn, pid=pid,
                    finding_type="contradiction", finding_uuid=contradiction_uuid,
                    concerns_ids=concerns_refs,
                    source_doc_id=str(source_doc_uuid) if source_doc_uuid else None,
                    source_quote=side_a or side_b,
                )
                await _emit_event(
                    conn, pid=pid, event_type="finding_stored",
                    payload={"kind": "contradiction", "title": title, "area": area, "concerns": concerns_refs},
                    artifact_updates={"findings_created": [f"CTR:{title[:40]}"]},
                )
                return _json_result({"success": True, "type": "contradiction", "title": title, "concerns": concerns_refs})

            else:
                return _json_result({"error": f"Unknown finding_type: {finding_type}. Supported: requirement, constraint, stakeholder, gap, contradiction."})

        if name == "propose_update":
            target_req_id = arguments.get("target_req_id")
            field = arguments.get("field")
            value = arguments.get("value")
            rationale = arguments.get("rationale") or None
            person = arguments.get("source_person") or None
            doc_id_raw = arguments.get("source_doc_id") or None

            # App-level enforcement of the whitelist — mirrors the backend
            # `_apply_patch` function so the agent gets a clean error before
            # the row hits the DB rather than a 400 on accept.
            string_fields = {
                "description", "user_perspective", "rationale", "scope_note",
                "title", "source_person",
            }
            list_fields = {
                "acceptance_criteria", "business_rules", "edge_cases",
                "alternatives_considered", "blocked_by",
            }
            if not target_req_id or not field:
                return _json_result({"error": "target_req_id and field are required"})
            if field not in string_fields and field not in list_fields:
                return _json_result({
                    "error": f"Cannot propose on field '{field}'. Allowed: "
                             f"{sorted(string_fields | list_fields)}"
                })

            # Resolve the target BR (by its req_id within the project).
            br = await conn.fetchrow(
                "SELECT id, "
                "       description, user_perspective, rationale, scope_note, title, source_person, "
                "       acceptance_criteria, business_rules, edge_cases, "
                "       alternatives_considered, blocked_by "
                "FROM requirements WHERE project_id = $1 AND req_id = $2",
                pid, target_req_id,
            )
            if not br:
                return _json_result({"error": f"Requirement {target_req_id} not found"})

            # asyncpg returns JSONB columns as the raw JSON string (no
            # codec registered on this connection), so list-typed BR
            # fields come back as a JSON-encoded string like
            # '["ac1", "ac2"]' rather than a Python list. Decode before
            # comparing / echoing into current_value — otherwise `list()`
            # on a string would split it into one entry per character.
            raw = br[field] if field in br.keys() else None
            current: Any
            if field in list_fields:
                if isinstance(raw, str):
                    try:
                        current = json.loads(raw)
                    except (TypeError, ValueError):
                        current = []
                elif isinstance(raw, list):
                    current = raw
                else:
                    current = []
            else:
                current = raw

            # No-op guard: don't stage a proposal that reproduces the
            # existing value. For lists: skip when every new entry is
            # already present.
            if field in list_fields:
                new_items = value if isinstance(value, list) else [value]
                new_items = [s for s in new_items if isinstance(s, str) and s.strip()]
                existing_items = list(current or [])
                truly_new = [s for s in new_items if s not in existing_items]
                if not truly_new:
                    return _json_result({
                        "skipped": True,
                        "reason": f"All proposed {field} entries already exist on {target_req_id}.",
                    })
                staged_value = truly_new
                current_value_for_row = existing_items or None
            else:
                staged_value = str(value) if value is not None else None
                if (staged_value or "") == (current or ""):
                    return _json_result({
                        "skipped": True,
                        "reason": f"{field} on {target_req_id} already equals the proposed value.",
                    })
                current_value_for_row = current

            # Validate + parse the doc id (same defensive pattern as
            # store_finding — bad UUIDs silently fall back to NULL rather
            # than failing the whole call).
            doc_uuid = None
            if doc_id_raw:
                try:
                    doc_uuid = uuid.UUID(str(doc_id_raw))
                except (ValueError, TypeError):
                    doc_uuid = None

            await conn.execute(
                "INSERT INTO proposed_updates "
                "(id, project_id, source_gap_id, source_doc_id, source_person, "
                " target_req_id, proposed_field, proposed_value, current_value, rationale, status) "
                "VALUES (gen_random_uuid(), $1, NULL, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, 'pending')",
                pid, doc_uuid, person, target_req_id, field,
                json.dumps(staged_value), json.dumps(current_value_for_row), rationale,
            )
            await conn.execute(
                "INSERT INTO activity_log (id, project_id, action, summary, details) "
                "VALUES (gen_random_uuid(), $1, 'proposal_created', $2, $3)",
                pid, f"Proposed update to {target_req_id} ({field})",
                json.dumps({"req_id": target_req_id, "field": field, "source": "extraction"}),
            )
            await _emit_event(
                conn, pid=pid, event_type="proposal_created",
                payload={"target_req_id": target_req_id, "field": field, "source": "extraction"},
                artifact_updates={"proposals_created": [target_req_id]},
            )
            return _json_result({
                "success": True,
                "target_req_id": target_req_id,
                "field": field,
                "staged_value": staged_value,
            })

        if name == "get_past_rejections":
            target_req_id = arguments.get("target_req_id")
            field = arguments.get("field")
            limit = int(arguments.get("limit") or 20)
            clauses = ["project_id = $1", "status = 'rejected'"]
            params: list = [pid]
            if target_req_id:
                clauses.append(f"target_req_id = ${len(params) + 1}")
                params.append(target_req_id)
            if field:
                clauses.append(f"proposed_field = ${len(params) + 1}")
                params.append(field)
            params.append(limit)
            rows = await conn.fetch(
                "SELECT target_req_id, proposed_field, proposed_value, "
                "       rejection_reason, reviewed_at "
                "FROM proposed_updates "
                f"WHERE {' AND '.join(clauses)} "
                f"ORDER BY reviewed_at DESC NULLS LAST "
                f"LIMIT ${len(params)}",
                *params,
            )
            return _json_result([
                {
                    "target_req_id": r["target_req_id"],
                    "field": r["proposed_field"],
                    "rejected_value": r["proposed_value"],
                    "reason": r["rejection_reason"],
                    "rejected_at": r["reviewed_at"].isoformat() if r["reviewed_at"] else None,
                }
                for r in rows
            ])

        if name == "get_related":
            node_id = arguments.get("node_id") or ""
            radius = int(arguments.get("radius") or 1)
            edge_types = arguments.get("edge_types")
            max_nodes = int(arguments.get("max_nodes") or 40)
            if not node_id:
                return _json_result({"error": "node_id is required"})
            gp = _load_graph_parser()
            if gp is None:
                return _json_result({"error": "graph parser not available in this environment"})
            ddir = _discovery_dir_for(pid)
            if ddir is None:
                return _json_result({"error": "no discovery vault for this project yet — upload a document first"})
            graph = gp.parse_knowledge_graph(ddir)
            result = _bfs_related(graph["nodes"], graph["edges"], node_id, radius, edge_types)
            if not result["found"]:
                return _json_result({"error": f"Node '{node_id}' not found in the graph"})
            # Truncate node list to max_nodes, keep all traversed edges so
            # the relationship story stays intact even if some endpoints
            # fell off the node list.
            if len(result["nodes"]) > max_nodes:
                kept = {n["id"] for n in result["nodes"][:max_nodes]}
                result["nodes"] = [n for n in result["nodes"] if n["id"] in kept]
                result["truncated"] = True
            return _json_result(result)

        if name == "get_graph_stats":
            top_n = int(arguments.get("top_n") or 10)
            gp = _load_graph_parser()
            if gp is None:
                return _json_result({"error": "graph parser not available in this environment"})
            ddir = _discovery_dir_for(pid)
            if ddir is None:
                return _json_result({"error": "no discovery vault for this project yet — upload a document first"})
            graph = gp.parse_knowledge_graph(ddir)
            return _json_result(_graph_stats(graph["nodes"], graph["edges"], top_n))

        if name == "propose_relationship":
            from_id = arguments.get("from_id") or ""
            to_id = arguments.get("to_id") or ""
            rel_type = arguments.get("rel_type") or ""
            source_quote = arguments.get("source_quote") or None
            rationale_text = arguments.get("rationale") or None
            doc_id_raw = arguments.get("source_doc_id") or None

            if not (from_id and to_id and rel_type):
                return _json_result({"error": "from_id, to_id, rel_type are all required"})

            frm = await _resolve_finding_uuid(conn, pid, from_id)
            to = await _resolve_finding_uuid(conn, pid, to_id)
            if frm is None:
                return _json_result({"error": f"from_id {from_id!r} not found in project"})
            if to is None:
                return _json_result({"error": f"to_id {to_id!r} not found in project"})

            doc_uuid = None
            if doc_id_raw:
                try:
                    doc_uuid = str(uuid.UUID(str(doc_id_raw)))
                except (ValueError, TypeError):
                    doc_uuid = None

            await _upsert_relationship(
                conn, pid=pid,
                from_type=frm[0], from_uuid=frm[1],
                to_type=to[0], to_uuid=to[1],
                rel_type=rel_type,
                confidence="proposed",
                created_by="propose_update",
                source_doc_id=doc_uuid,
                source_quote=source_quote,
                rationale=rationale_text,
            )
            await _emit_event(
                conn, pid=pid, event_type="relationship_proposed",
                payload={
                    "from_id": from_id, "to_id": to_id, "rel_type": rel_type,
                    "source": source_quote,
                },
            )
            return _json_result({
                "success": True,
                "from": {"id": from_id, "kind": frm[0]},
                "to": {"id": to_id, "kind": to[0]},
                "rel_type": rel_type,
                "status": "proposed",
            })

        if name == "get_connections":
            finding_id = arguments.get("finding_id") or ""
            rel_types_filter = arguments.get("rel_types")
            include_derived = bool(arguments.get("include_derived", True))
            max_edges = int(arguments.get("max_edges") or 60)

            if not finding_id:
                return _json_result({"error": "finding_id is required"})
            center = await _resolve_finding_uuid(conn, pid, finding_id)
            if center is None:
                return _json_result({"error": f"finding_id {finding_id!r} not found"})

            # Explicit edges — both directions in one query; project into
            # outgoing/incoming from the center's perspective.
            params: list = [pid, center[0], center[1]]
            q = (
                "SELECT id, from_type, from_uuid, to_type, to_uuid, "
                "       rel_type, confidence, source_doc_id, "
                "       source_quote, rationale, created_by "
                "FROM relationships "
                "WHERE project_id = $1 AND status = 'active' "
                "  AND ((from_type = $2 AND from_uuid = $3::uuid) "
                "    OR (to_type = $2 AND to_uuid = $3::uuid))"
            )
            if rel_types_filter:
                q += f" AND rel_type = ANY(${len(params) + 1}::text[])"
                params.append(list(rel_types_filter))
            q += f" LIMIT ${len(params) + 1}"
            params.append(max_edges)

            rows = await conn.fetch(q, *params)

            # Batch-resolve neighbours to display ids — one query per kind.
            neighbours: dict[str, set] = {}
            for r in rows:
                if str(r["from_uuid"]) == center[1] and r["from_type"] == center[0]:
                    neighbours.setdefault(r["to_type"], set()).add(str(r["to_uuid"]))
                else:
                    neighbours.setdefault(r["from_type"], set()).add(str(r["from_uuid"]))

            ref_map: dict[tuple[str, str], dict] = {}
            for kind, uuids in neighbours.items():
                if not uuids:
                    continue
                refs = await _fetch_finding_refs(conn, kind, list(uuids))
                for ref in refs:
                    ref_map[(kind, ref["uuid"])] = ref

            # Resolve source doc filenames for cited edges.
            doc_ids = {str(r["source_doc_id"]) for r in rows if r["source_doc_id"]}
            doc_name_by_id: dict[str, str] = {}
            if doc_ids:
                doc_rows = await conn.fetch(
                    "SELECT id, filename FROM documents WHERE id = ANY($1::uuid[])",
                    list(doc_ids),
                )
                doc_name_by_id = {str(dr["id"]): dr["filename"] for dr in doc_rows}

            INVERSE = {
                "blocks": "blocked_by", "blocked_by": "blocks",
                "affects": "affected_by", "affected_by": "affects",
                "raised_by": "raised", "raised": "raised_by",
                "derived_from": "source_of", "source_of": "derived_from",
                "co_extracted": "co_extracted", "contradicts": "contradicts",
                "mentions": "mentions",
            }

            outgoing: list[dict] = []
            incoming: list[dict] = []
            for r in rows:
                if str(r["from_uuid"]) == center[1] and r["from_type"] == center[0]:
                    n_key = (r["to_type"], str(r["to_uuid"]))
                    direction = "outgoing"
                    rtype = r["rel_type"]
                else:
                    n_key = (r["from_type"], str(r["from_uuid"]))
                    direction = "incoming"
                    rtype = INVERSE.get(r["rel_type"], r["rel_type"])
                neighbour = ref_map.get(n_key)
                if neighbour is None:
                    continue
                edge = {
                    "rel_type": rtype,
                    "confidence": r["confidence"],
                    "direction": direction,
                    "source_doc": doc_name_by_id.get(str(r["source_doc_id"])) if r["source_doc_id"] else None,
                    "source_quote": r["source_quote"],
                    "rationale": r["rationale"],
                    "created_by": r["created_by"],
                    "neighbor": neighbour,
                }
                (outgoing if direction == "outgoing" else incoming).append(edge)

            # Derived groups: same source_doc_id, same source_person.
            derived_groups: list[dict] = []
            if include_derived:
                derived_groups = await _derived_connections(conn, pid, center)

            center_ref = await _fetch_finding_refs(conn, center[0], [center[1]])
            center_dict = center_ref[0] if center_ref else {
                "uuid": center[1], "kind": center[0],
                "display_id": finding_id, "label": "",
            }
            return _json_result({
                "center": center_dict,
                "outgoing": outgoing,
                "incoming": incoming,
                "derived": derived_groups,
            })

        if name == "get_active_learnings":
            category = arguments.get("category")
            min_refs = int(arguments.get("min_references") or 1)
            limit = int(arguments.get("limit") or 10)
            params = [pid, min_refs]
            clauses = [
                "(project_id = $1 OR project_id IS NULL)",
                "status IN ('transient', 'promoted')",
                "reference_count >= $2",
            ]
            if category:
                params.append(category)
                clauses.append(f"category = ${len(params)}")
            params.append(limit)
            rows = await conn.fetch(
                "SELECT id, project_id, category, content, evidence_quote, "
                "       status, reference_count, last_relevant_at, "
                "       promoted_at "
                "FROM learnings "
                f"WHERE {' AND '.join(clauses)} "
                f"ORDER BY reference_count DESC, last_relevant_at DESC "
                f"LIMIT ${len(params)}",
                *params,
            )
            return _json_result([
                {
                    "id": str(r["id"]),
                    "project_id": str(r["project_id"]) if r["project_id"] else None,
                    "category": r["category"],
                    "content": r["content"],
                    "evidence_quote": r["evidence_quote"],
                    "status": r["status"],
                    "reference_count": r["reference_count"],
                    "last_relevant_at": r["last_relevant_at"].isoformat() if r["last_relevant_at"] else None,
                    "promoted_at": r["promoted_at"].isoformat() if r["promoted_at"] else None,
                }
                for r in rows
            ])

        if name == "record_learning":
            category = arguments.get("category") or ""
            content = (arguments.get("content") or "").strip()
            evidence_quote = arguments.get("evidence_quote") or None
            allowed = ("pm_preference", "domain_fact", "workflow_pattern", "anti_pattern")
            if category not in allowed:
                return _json_result({"error": f"bad category {category!r}, expected {allowed}"})
            if not content:
                return _json_result({"error": "content is required"})
            # Normalize content into dedup key — mirrors
            # app.services.learnings._content_key.
            import re as _re
            key = _re.sub(r"\s+", " ", content.lower().strip())[:256]

            # Find active session so the learning is linked to the
            # origin context. Best-effort — unset if lookup fails.
            uid = await get_user_id(pid)
            session_id = None
            try:
                session_id = await _active_session_id(conn, pid, uid)
            except Exception:
                session_id = None

            row = await conn.fetchrow(
                """
                INSERT INTO learnings
                  (project_id, origin_session_id, category, content, content_key,
                   evidence_quote, status, reference_count, last_relevant_at)
                VALUES ($1, $2::uuid, $3, $4, $5, $6, 'transient', 1, NOW())
                ON CONFLICT ON CONSTRAINT uq_learnings_dedup
                DO UPDATE SET
                  reference_count = learnings.reference_count + 1,
                  last_relevant_at = NOW(),
                  evidence_quote = COALESCE(EXCLUDED.evidence_quote, learnings.evidence_quote),
                  status = CASE
                    WHEN learnings.status = 'promoted' THEN 'promoted'
                    ELSE 'transient'
                  END,
                  dismissed_at = NULL,
                  dismissed_by = NULL
                RETURNING id, category, content, reference_count, status
                """,
                pid, session_id, category, content, key, evidence_quote,
            )
            # Emit a session event so the dashboard timeline shows this
            # learning being captured in-session.
            await _emit_event(
                conn, pid=pid, event_type="learning_recorded",
                payload={
                    "learning_id": str(row["id"]),
                    "category": row["category"],
                    "content": row["content"][:200],
                    "reference_count": row["reference_count"],
                },
            )
            return _json_result({
                "success": True,
                "id": str(row["id"]),
                "category": row["category"],
                "content": row["content"],
                "reference_count": row["reference_count"],
                "status": row["status"],
            })

        if name == "get_current_time":
            import datetime as _dt
            now_utc = _dt.datetime.now(_dt.timezone.utc)
            local = now_utc.astimezone()
            return _json_result({
                "now_utc": now_utc.isoformat(),
                "now_local": local.isoformat(),
                "timezone": str(local.tzinfo),
                "today_local": local.strftime("%Y-%m-%d (%A)"),
            })

        if name == "schedule_reminder":
            from datetime import datetime, timezone

            subject_type = arguments.get("subject_type")
            subject_id = arguments.get("subject_id")
            person = arguments.get("person")
            raw_request = arguments.get("raw_request") or ""
            due_at_iso = arguments.get("due_at_iso") or ""
            channel = arguments.get("channel")
            prep_lead_hours = float(arguments.get("prep_lead_hours", 6))
            prep_agent = arguments.get("prep_agent") or "discovery-prep-agent"
            recurrence = arguments.get("recurrence") or "none"
            recurrence_end_iso = arguments.get("recurrence_end_at_iso")
            output_kind = arguments.get("output_kind") or "notification"

            errors: list[str] = []
            supported_channels = {"gmail", "in_app", "calendar"}
            if channel not in supported_channels:
                errors.append(
                    f"channel '{channel}' is not supported in v1 — ask the user to pick one of: {sorted(supported_channels)}"
                )
            if recurrence not in {"none", "daily", "weekdays", "weekly", "monthly"}:
                errors.append(f"recurrence '{recurrence}' invalid — must be none/daily/weekdays/weekly/monthly")
            if output_kind not in {"notification", "status", "agenda", "research"}:
                errors.append(f"output_kind '{output_kind}' invalid — must be notification/status/agenda/research")
            if output_kind == "status" and subject_type not in {"requirement", "gap"}:
                errors.append("output_kind='status' requires subject_type=requirement or gap with a valid subject_id")
            if output_kind == "research":
                errors.append("output_kind='research' is reserved and not yet implemented — use 'status' or 'agenda'")

            recurrence_end_at = None
            if recurrence_end_iso:
                try:
                    recurrence_end_at = datetime.fromisoformat(recurrence_end_iso)
                    if recurrence_end_at.tzinfo is None:
                        errors.append("recurrence_end_at_iso must include a timezone offset")
                except ValueError:
                    errors.append(f"recurrence_end_at_iso is not a valid ISO-8601 timestamp: {recurrence_end_iso!r}")
            if subject_type not in {"requirement", "gap", "free"}:
                errors.append("subject_type must be requirement, gap, or free")

            try:
                due_at = datetime.fromisoformat(due_at_iso)
                if due_at.tzinfo is None:
                    errors.append("due_at_iso must include a timezone offset (e.g. +00:00)")
                elif due_at <= datetime.now(timezone.utc):
                    errors.append(f"due_at_iso must be in the future, got {due_at.isoformat()}")
            except ValueError:
                errors.append(f"due_at_iso is not a valid ISO-8601 timestamp: {due_at_iso!r}")
                due_at = None

            # Subject existence check — so the orchestrator can ask the user
            # to clarify instead of scheduling a brief about a non-existent BR.
            if subject_type in {"requirement", "gap"}:
                if not subject_id:
                    errors.append(f"subject_id is required when subject_type='{subject_type}'")
                else:
                    if subject_type == "requirement":
                        hit = await conn.fetchval(
                            "SELECT id FROM requirements WHERE project_id = $1 AND req_id = $2",
                            pid, subject_id,
                        )
                    else:
                        hit = await conn.fetchval(
                            "SELECT id FROM gaps WHERE project_id = $1 AND gap_id = $2",
                            pid, subject_id,
                        )
                    if not hit:
                        # Suggest closest match so orchestrator can offer it.
                        col = "req_id" if subject_type == "requirement" else "gap_id"
                        tbl = "requirements" if subject_type == "requirement" else "gaps"
                        near = await conn.fetch(
                            f"SELECT {col} FROM {tbl} WHERE project_id = $1 ORDER BY {col} LIMIT 5",
                            pid,
                        )
                        known = [r[col] for r in near]
                        errors.append(
                            f"{subject_id} not found in this project. Known ids start with: {known}. "
                            f"Ask the user to confirm the correct id."
                        )

            uid = await get_user_id(pid)
            if not uid:
                errors.append("No user found to attribute the reminder to. Set DISCOVERY_USER_ID or add a project lead.")

            if errors:
                return _json_result({"ok": False, "validation_errors": errors})

            # Insert — all validated.
            row = await conn.fetchrow(
                "INSERT INTO reminders "
                "(id, project_id, created_by_user_id, subject_type, subject_id, person, raw_request, due_at, prep_lead, channel, prep_agent, status, recurrence, recurrence_end_at, output_kind) "
                "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, make_interval(hours => $8), $9, $10, 'pending', $11, $12, $13) "
                "RETURNING id",
                pid, uid, subject_type, subject_id, person, raw_request, due_at, prep_lead_hours, channel, prep_agent, recurrence, recurrence_end_at, output_kind,
            )
            await conn.execute(
                "INSERT INTO activity_log (id, project_id, action, summary, details) "
                "VALUES (gen_random_uuid(), $1, 'reminder_scheduled', $2, $3)",
                pid,
                f"Reminder scheduled: {subject_id or subject_type} @ {due_at.isoformat()} via {channel}",
                json.dumps({"reminder_id": str(row["id"]), "channel": channel, "prep_agent": prep_agent}),
            )
            return _json_result({
                "ok": True,
                "reminder_id": str(row["id"]),
                "echo": f"Reminder scheduled for {due_at.isoformat()} ({channel}). Prep will run ~{prep_lead_hours:g}h before.",
            })

        if name == "list_reminders":
            status = arguments.get("status")
            person = arguments.get("person")
            subject_id = arguments.get("subject_id")
            include_closed = bool(arguments.get("include_closed", False))
            limit = min(int(arguments.get("limit", 20) or 20), 100)

            where = ["project_id = $1"]
            params: list = [pid]
            if status:
                if status not in {"pending", "processing", "prepared", "delivered", "canceled", "failed"}:
                    return _json_result({"ok": False, "error": f"invalid status: {status!r}"})
                where.append(f"status = ${len(params) + 1}")
                params.append(status)
            elif not include_closed:
                where.append("status IN ('pending', 'processing', 'prepared')")
            if person:
                where.append(f"person ILIKE ${len(params) + 1}")
                params.append(f"%{person}%")
            if subject_id:
                where.append(f"subject_id = ${len(params) + 1}")
                params.append(subject_id)

            q = (
                "SELECT id, subject_type, subject_id, person, due_at, prep_lead, channel, status, "
                "raw_request, prep_output_path, external_ref, error_message, created_at "
                "FROM reminders WHERE " + " AND ".join(where) + " "
                f"ORDER BY due_at ASC LIMIT {limit}"
            )
            rows = await conn.fetch(q, *params)
            return _json_result({
                "ok": True,
                "count": len(rows),
                "reminders": [
                    {
                        "id": str(r["id"]),
                        "subject_type": r["subject_type"],
                        "subject_id": r["subject_id"],
                        "person": r["person"],
                        "due_at": r["due_at"].isoformat() if r["due_at"] else None,
                        "prep_lead_hours": r["prep_lead"].total_seconds() / 3600 if r["prep_lead"] else None,
                        "channel": r["channel"],
                        "status": r["status"],
                        "raw_request": r["raw_request"],
                        "prep_output_path": r["prep_output_path"],
                        "external_ref": r["external_ref"],
                        "error_message": r["error_message"],
                        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                    }
                    for r in rows
                ],
            })

        if name == "cancel_reminder":
            rid = arguments.get("reminder_id")
            if not rid:
                return _json_result({"ok": False, "error": "reminder_id is required"})
            try:
                rid_uuid = uuid.UUID(rid) if not isinstance(rid, uuid.UUID) else rid
            except (ValueError, AttributeError):
                return _json_result({"ok": False, "error": f"reminder_id is not a valid UUID: {rid!r}"})

            current = await conn.fetchrow(
                "SELECT id, status, subject_id, person, due_at FROM reminders WHERE id = $1 AND project_id = $2",
                rid_uuid, pid,
            )
            if not current:
                return _json_result({"ok": False, "error": "reminder not found in this project"})

            old_status = current["status"]
            if old_status == "canceled":
                return _json_result({
                    "ok": True,
                    "noop": True,
                    "reminder_id": str(rid_uuid),
                    "status": "canceled",
                })
            if old_status == "delivered":
                return _json_result({
                    "ok": False,
                    "error": (
                        f"reminder already delivered on {current['due_at'].isoformat()} — "
                        "too late to cancel. Schedule a new reminder if you need one."
                    ),
                })

            await conn.execute(
                "UPDATE reminders SET status = 'canceled', updated_at = now() WHERE id = $1",
                rid_uuid,
            )
            await conn.execute(
                "INSERT INTO activity_log (id, project_id, action, summary, details) "
                "VALUES (gen_random_uuid(), $1, 'reminder_canceled', $2, $3)",
                pid,
                f"Reminder canceled: {current['subject_id'] or 'free'} @ {current['due_at'].isoformat()}",
                json.dumps({"reminder_id": str(rid_uuid), "old_status": old_status}),
            )
            return _json_result({
                "ok": True,
                "reminder_id": str(rid_uuid),
                "old_status": old_status,
                "status": "canceled",
            })

        if name == "reschedule_reminder":
            from datetime import datetime, timezone

            rid = arguments.get("reminder_id")
            new_iso = arguments.get("new_due_at_iso") or ""
            new_lead = arguments.get("new_prep_lead_hours")

            errors: list[str] = []
            if not rid:
                errors.append("reminder_id is required")
            try:
                rid_uuid = uuid.UUID(rid) if not isinstance(rid, uuid.UUID) else rid
            except (ValueError, AttributeError, TypeError):
                errors.append(f"reminder_id is not a valid UUID: {rid!r}")
                rid_uuid = None

            try:
                new_due_at = datetime.fromisoformat(new_iso)
                if new_due_at.tzinfo is None:
                    errors.append("new_due_at_iso must include a timezone offset")
                elif new_due_at <= datetime.now(timezone.utc):
                    errors.append(f"new_due_at_iso must be in the future, got {new_due_at.isoformat()}")
            except ValueError:
                errors.append(f"new_due_at_iso is not a valid ISO-8601 timestamp: {new_iso!r}")
                new_due_at = None

            if errors:
                return _json_result({"ok": False, "validation_errors": errors})

            current = await conn.fetchrow(
                "SELECT id, status, subject_id, person, due_at FROM reminders WHERE id = $1 AND project_id = $2",
                rid_uuid, pid,
            )
            if not current:
                return _json_result({"ok": False, "error": "reminder not found in this project"})
            if current["status"] != "pending":
                msg = {
                    "processing": "reminder is currently running prep — wait for it to finish, then cancel + schedule a new one if needed",
                    "prepared": "reminder already has a prepared brief — cancel it and schedule a new one so the brief stays consistent with its time",
                    "delivered": "reminder already delivered — schedule a new one instead",
                    "canceled": "reminder is canceled — schedule a new one instead",
                    "failed": "reminder failed — cancel it and schedule a new one",
                }.get(current["status"], f"cannot reschedule a reminder in status {current['status']!r}")
                return _json_result({"ok": False, "error": msg, "current_status": current["status"]})

            if new_lead is not None:
                await conn.execute(
                    "UPDATE reminders SET due_at = $1, prep_lead = make_interval(hours => $2), updated_at = now() "
                    "WHERE id = $3",
                    new_due_at, float(new_lead), rid_uuid,
                )
            else:
                await conn.execute(
                    "UPDATE reminders SET due_at = $1, updated_at = now() WHERE id = $2",
                    new_due_at, rid_uuid,
                )
            await conn.execute(
                "INSERT INTO activity_log (id, project_id, action, summary, details) "
                "VALUES (gen_random_uuid(), $1, 'reminder_rescheduled', $2, $3)",
                pid,
                f"Reminder rescheduled: {current['subject_id'] or 'free'} → {new_due_at.isoformat()}",
                json.dumps({
                    "reminder_id": str(rid_uuid),
                    "old_due_at": current["due_at"].isoformat(),
                    "new_due_at": new_due_at.isoformat(),
                    "new_prep_lead_hours": new_lead,
                }),
            )
            return _json_result({
                "ok": True,
                "reminder_id": str(rid_uuid),
                "old_due_at": current["due_at"].isoformat(),
                "new_due_at": new_due_at.isoformat(),
                "echo": f"Reminder moved to {new_due_at.isoformat()}.",
            })

    return _json_result({"error": f"Unknown tool: {name}"})


async def main():
    # Resolve the PAT once at startup so the [mcp] authenticated-as line
    # lands in stderr before the first tool call — easier to spot a
    # misconfigured token during bootstrap than to chase it through the
    # first extraction. Any failure here is soft; get_user_id still has
    # the env + DB fallback chain.
    await _resolve_token_identity()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
