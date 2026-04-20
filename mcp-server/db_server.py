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


async def get_user_id(pid: str):
    """Resolve user id for tools that write user-attributed rows (reminders).

    Fallback chain: env var → project lead → any project member → solo
    user (when the users table has exactly one row, a reasonable default
    for single-dev setups). Returns None only when none of those resolve
    — caller should reject the tool call in that case."""
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
    """Recalculate readiness score after a write operation."""
    # Business (20%)
    has_authority = await conn.fetchval("SELECT COUNT(*) FROM stakeholders WHERE project_id = $1 AND decision_authority = 'final'", pid) or 0
    has_budget = await conn.fetchval("SELECT COUNT(*) FROM constraints WHERE project_id = $1 AND type = 'budget' AND status = 'confirmed'", pid) or 0
    has_timeline = await conn.fetchval("SELECT COUNT(*) FROM constraints WHERE project_id = $1 AND type = 'timeline'", pid) or 0
    has_stakeholders = await conn.fetchval("SELECT COUNT(*) FROM stakeholders WHERE project_id = $1", pid) or 0
    has_must = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1 AND priority = 'must'", pid) or 0
    biz_checks = [
        1.0 if has_authority > 0 else 0.0,
        1.0 if has_budget > 0 else 0.0,
        1.0 if has_timeline > 0 else 0.0,
        1.0 if has_stakeholders >= 2 else 0.5 if has_stakeholders >= 1 else 0.0,
        1.0 if has_must >= 2 else 0.5 if has_must >= 1 else 0.0,
    ]
    business = (sum(biz_checks) / len(biz_checks)) * 100

    # Functional (35%)
    total_reqs = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1", pid) or 0
    confirmed_reqs = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1 AND status = 'confirmed'", pid) or 0
    nfr = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1 AND type = 'non_functional'", pid) or 0
    func_checks = [
        1.0 if total_reqs >= 5 else 0.5 if total_reqs >= 2 else 0.0,
        confirmed_reqs / total_reqs if total_reqs > 0 else 0.0,
        1.0 if has_must >= 3 else 0.5 if has_must >= 1 else 0.0,
        1.0 if nfr >= 1 else 0.0,
    ]
    functional = (sum(func_checks) / len(func_checks)) * 100

    # Technical (20%)
    tech_decisions = await conn.fetchval("SELECT COUNT(*) FROM decisions WHERE project_id = $1", pid) or 0
    tech_constraints = await conn.fetchval("SELECT COUNT(*) FROM constraints WHERE project_id = $1 AND type = 'technology'", pid) or 0
    confirmed_decisions = await conn.fetchval("SELECT COUNT(*) FROM decisions WHERE project_id = $1 AND status = 'confirmed'", pid) or 0
    tech_checks = [
        1.0 if tech_decisions >= 2 else 0.5 if tech_decisions >= 1 else 0.0,
        1.0 if tech_constraints >= 1 else 0.0,
        1.0 if confirmed_decisions >= 1 else 0.0,
    ]
    technical = (sum(tech_checks) / len(tech_checks)) * 100

    # Scope (25%)
    in_scope = await conn.fetchval("SELECT COUNT(*) FROM scope_items WHERE project_id = $1 AND in_scope = true", pid) or 0
    out_scope = await conn.fetchval("SELECT COUNT(*) FROM scope_items WHERE project_id = $1 AND in_scope = false", pid) or 0
    unresolved = await conn.fetchval("SELECT COUNT(*) FROM contradictions WHERE project_id = $1 AND resolved = false", pid) or 0
    total_assumptions = await conn.fetchval("SELECT COUNT(*) FROM assumptions WHERE project_id = $1", pid) or 0
    validated_assumptions = await conn.fetchval("SELECT COUNT(*) FROM assumptions WHERE project_id = $1 AND validated = true", pid) or 0
    scope_checks = [
        1.0 if in_scope >= 3 else 0.5 if in_scope >= 1 else 0.0,
        1.0 if out_scope >= 1 else 0.0,
        1.0 if unresolved == 0 else 0.0,
        validated_assumptions / total_assumptions if total_assumptions > 0 else 0.5,
    ]
    scope = (sum(scope_checks) / len(scope_checks)) * 100

    # Overall
    overall = business * 0.20 + functional * 0.35 + technical * 0.20 + scope * 0.25
    overall = round(overall, 1)

    breakdown = json.dumps({"business": round(business, 1), "functional": round(functional, 1), "technical": round(technical, 1), "scope": round(scope, 1)})
    await conn.execute(
        "INSERT INTO readiness_history (id, project_id, score, breakdown, triggered_by) VALUES (gen_random_uuid(), $1, $2, $3, $4)",
        pid, overall, breakdown, "mcp_write"
    )
    # Trigger markdown sync (fire-and-forget)
    asyncio.ensure_future(_trigger_markdown_sync(pid))
    return overall


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(name="get_project_context", description="Get project overview: name, client, type, readiness score, document count, and per-area breakdown. Use at the start of any analysis.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_requirements", description="Get all business requirements with ID, title, priority (must/should/could), status (proposed/discussed/confirmed/dropped), description, and source quote. Filter by priority or status.", inputSchema={"type": "object", "properties": {"priority": {"type": "string", "description": "Filter: must, should, could, wont"}, "status": {"type": "string", "description": "Filter: proposed, discussed, confirmed, changed, dropped"}}, "required": []}),
        Tool(name="get_constraints", description="Get all project constraints: budget, timeline, technology, regulatory, organizational. Each has description, impact, and status.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_decisions", description="Get all decisions made during discovery: what was decided, by whom, rationale, alternatives considered, and status.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_stakeholders", description="Get all identified people: name, role, organization, decision authority (final/recommender/informed), and interests.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_assumptions", description="Get all assumptions: what we believe, basis for believing it, risk if wrong, and whether it's been validated.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_scope", description="Get all scope items: what's explicitly in or out of MVP, with rationale.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_contradictions", description="Get all contradictions/conflicts between items, with resolution status.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_readiness", description="Get discovery readiness score and per-area breakdown (business, functional, technical, scope).", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_documents", description="Get all uploaded documents with processing status and extraction counts.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="search", description="Search across all extracted data (requirements, constraints, decisions, people) by keyword.", inputSchema={"type": "object", "properties": {"query": {"type": "string", "description": "Search term"}}, "required": ["query"]}),
        Tool(name="get_activity", description="Get recent activity log: uploads, status changes, extractions.", inputSchema={"type": "object", "properties": {"limit": {"type": "integer", "description": "Number of entries (default 20)"}}, "required": []}),
        # Write tools
        Tool(name="update_requirement_status", description="Update a business requirement's status. Use when PO asks to confirm, discuss, change, or drop a requirement.", inputSchema={"type": "object", "properties": {"req_id": {"type": "string", "description": "Requirement ID (e.g. BR-001)"}, "status": {"type": "string", "enum": ["proposed", "discussed", "confirmed", "changed", "dropped"], "description": "New status"}}, "required": ["req_id", "status"]}),
        Tool(name="update_requirement_priority", description="Update a business requirement's priority.", inputSchema={"type": "object", "properties": {"req_id": {"type": "string", "description": "Requirement ID (e.g. BR-001)"}, "priority": {"type": "string", "enum": ["must", "should", "could", "wont"], "description": "New priority"}}, "required": ["req_id", "priority"]}),
        Tool(name="validate_assumption", description="Mark an assumption as validated or unvalidated.", inputSchema={"type": "object", "properties": {"statement_fragment": {"type": "string", "description": "Part of the assumption text to find it"}, "validated": {"type": "boolean", "description": "true = validated, false = unvalidated"}}, "required": ["statement_fragment", "validated"]}),
        Tool(name="resolve_contradiction", description="Resolve a contradiction with a resolution note.", inputSchema={"type": "object", "properties": {"explanation_fragment": {"type": "string", "description": "Part of the contradiction explanation to find it"}, "resolution_note": {"type": "string", "description": "How it was resolved"}}, "required": ["explanation_fragment", "resolution_note"]}),
        Tool(name="get_control_points", description="Get readiness as a flat checklist of 12 checks. Returns overall score and each check with status (covered/partial/missing) and the actual items found. Present as a simple checklist showing what's done and what's missing — do NOT group into areas.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_gaps", description="Get all identified knowledge gaps from the gaps table — open questions to ask the client/PO that are blocking discovery completion. Each gap has gap_id (GAP-XXX), question, severity (high/medium/low), area, status (open/resolved/dismissed), source quote, source person, and may list which requirements (BR-XXX) it blocks.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="search_documents", description="Full-text search across ALL extracted items: requirements, constraints, decisions, people, assumptions, scope items, gaps, and contradictions.", inputSchema={"type": "object", "properties": {"query": {"type": "string", "description": "Search term to match across all extracted data"}}, "required": ["query"]}),
        Tool(name="store_finding", description="Store a new finding discovered during analysis. Supports all types: requirement, constraint, decision, stakeholder, assumption, gap, scope, contradiction. Auto-assigns IDs and recalculates readiness.", inputSchema={"type": "object", "properties": {"finding_type": {"type": "string", "enum": ["requirement", "constraint", "decision", "stakeholder", "assumption", "gap", "scope", "contradiction"], "description": "Type of finding"}, "title": {"type": "string", "description": "Title/name of the finding"}, "description": {"type": "string", "description": "Detailed description (role for stakeholder, impact for assumption, area for gap, rationale for scope)"}, "priority": {"type": "string", "description": "Priority: must/should/could/wont for requirements, severity for gaps, 'in'/'out' for scope items, authority for stakeholders"}, "source": {"type": "string", "description": "Source context (default: agent)"}, "source_person": {"type": "string", "description": "Person who provided the finding (default: unknown)"}, "source_quote": {"type": "string", "description": "Verbatim quote from the source document (≥10 chars). Falls back to description if omitted."}, "acceptance_criteria": {"type": "array", "items": {"type": "string"}, "description": "Requirement-only. List of AC blocks in GIVEN/WHEN/THEN form, one string per AC."}}, "required": ["finding_type", "title", "description"]}),
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
                "MANDATORY sequence before calling this tool: "
                "(1) call get_current_time to ground on the server clock; "
                "(2) resolve the user's phrasing to an absolute ISO-8601 timestamp with an explicit timezone offset; "
                "(3) echo the resolved time back in the user's LOCAL timezone WITH the weekday, "
                "e.g. 'I'll ping you Sunday 2026-04-19 at 00:00 (CET). Confirm?'; "
                "(4) confirm the delivery channel, BUT IN USER-FRIENDLY LANGUAGE — say "
                "'email (Gmail draft)' or 'in-app notification', NOT the raw ids 'gmail' / 'in_app' / 'slack'. "
                "The user is a PM, not a developer. Example: 'Should I email you a draft or send you an in-app notification?' "
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
                    "channel": {"type": "string", "enum": ["gmail", "slack", "in_app"], "description": "Delivery channel — ALWAYS confirm with the user before calling"},
                    "prep_lead_hours": {"type": "number", "description": "Hours before due_at when prep runs. Default 6 is right for real meetings (brief ready the morning of). For short-horizon tests ('remind me in 5 minutes') set this LOW (e.g. 0.02 for ~1min, 0.03 for ~2min) — otherwise the prep window opens 6 hours BEFORE due_at, and on a 5-minute test the scanner picks it up immediately, which defeats the test of 'does it fire at the right time'."},
                    "prep_agent": {"type": "string", "description": "Which agent to run for prep. Default discovery-prep-agent."},
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

        if name == "get_decisions":
            rows = await conn.fetch("SELECT title, decided_by, rationale, alternatives, status FROM decisions WHERE project_id = $1", pid)
            return _json_result([dict(r) for r in rows])

        if name == "get_stakeholders":
            rows = await conn.fetch("SELECT name, role, organization, decision_authority, interests FROM stakeholders WHERE project_id = $1", pid)
            return _json_result([dict(r) for r in rows])

        if name == "get_assumptions":
            rows = await conn.fetch("SELECT statement, basis, risk_if_wrong, needs_validation_by, validated FROM assumptions WHERE project_id = $1", pid)
            return _json_result([dict(r) for r in rows])

        if name == "get_scope":
            rows = await conn.fetch("SELECT description, in_scope, rationale FROM scope_items WHERE project_id = $1 ORDER BY in_scope DESC", pid)
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

            decs = await conn.fetch("SELECT title, status FROM decisions WHERE project_id = $1 AND (title ILIKE $2 OR rationale ILIKE $2) LIMIT 5", pid, pattern)
            for d in decs:
                results.append({"type": "decision", "title": d["title"], "status": d["status"]})

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

        if name == "validate_assumption":
            fragment = arguments["statement_fragment"]
            validated = arguments["validated"]
            row = await conn.fetchrow("SELECT id, statement FROM assumptions WHERE project_id = $1 AND statement ILIKE $2 LIMIT 1", pid, f"%{fragment}%")
            if not row:
                return _json_result({"error": f"Assumption containing '{fragment}' not found"})
            await conn.execute("UPDATE assumptions SET validated = $1 WHERE id = $2", validated, row["id"])
            new_score = await _recalculate_readiness(conn, pid)
            return _json_result({"success": True, "assumption": row["statement"][:60], "validated": validated, "readiness": new_score})

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
            checks = []

            # 1. Decision-maker identified
            final_makers = await conn.fetch("SELECT name, role FROM stakeholders WHERE project_id = $1 AND decision_authority = 'final'", pid)
            checks.append({"check": "Decision-maker identified", "status": "covered" if final_makers else "missing",
                           "items": [f"{r['name']} ({r['role']})" for r in final_makers]})

            # 2. People identified (≥2)
            all_stk = await conn.fetch("SELECT name, role, decision_authority FROM stakeholders WHERE project_id = $1", pid)
            checks.append({"check": "People identified (≥2)", "status": "covered" if len(all_stk) >= 2 else "partial" if len(all_stk) >= 1 else "missing",
                           "items": [f"{r['name']} ({r['role']}, {r['decision_authority']})" for r in all_stk]})

            # 3. Requirements defined (≥5)
            total_reqs = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1", pid) or 0
            checks.append({"check": "Requirements defined (≥5)", "status": "covered" if total_reqs >= 5 else "partial" if total_reqs >= 2 else "missing",
                           "detail": f"{total_reqs} total"})

            # 4. Requirements confirmed (ratio)
            confirmed_reqs = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1 AND status = 'confirmed'", pid) or 0
            unconfirmed = await conn.fetch("SELECT req_id, title, status FROM requirements WHERE project_id = $1 AND status != 'confirmed'", pid)
            conf_ratio = confirmed_reqs / total_reqs if total_reqs > 0 else 0
            checks.append({"check": "Requirements confirmed", "status": "covered" if conf_ratio >= 0.8 else "partial" if confirmed_reqs > 0 else "missing",
                           "detail": f"{confirmed_reqs} of {total_reqs} confirmed ({round(conf_ratio*100)}%)",
                           "items": [f"{r['req_id']}: {r['title'][:40]} ({r['status']})" for r in unconfirmed]})

            # 5. MUST requirements (≥3)
            must_reqs = await conn.fetch("SELECT req_id, title FROM requirements WHERE project_id = $1 AND priority = 'must'", pid)
            checks.append({"check": "MUST requirements (≥3)", "status": "covered" if len(must_reqs) >= 3 else "partial" if len(must_reqs) >= 1 else "missing",
                           "detail": f"{len(must_reqs)} MUST", "items": [f"{r['req_id']}: {r['title'][:50]}" for r in must_reqs]})

            # 6. Decisions documented (≥2)
            dec_rows = await conn.fetch("SELECT title, status, decided_by FROM decisions WHERE project_id = $1", pid)
            checks.append({"check": "Decisions documented (≥2)", "status": "covered" if len(dec_rows) >= 2 else "partial" if len(dec_rows) >= 1 else "missing",
                           "items": [f"{r['title'][:50]} ({r['status']})" for r in dec_rows]})

            # 7. Decisions confirmed (≥1)
            confirmed_dec = [r for r in dec_rows if r["status"] == "confirmed"]
            checks.append({"check": "Decisions confirmed (≥1)", "status": "covered" if confirmed_dec else "missing",
                           "detail": f"{len(confirmed_dec)} confirmed"})

            # 8. Scope defined (in + out)
            in_items = await conn.fetch("SELECT description FROM scope_items WHERE project_id = $1 AND in_scope = true", pid)
            out_items = await conn.fetch("SELECT description FROM scope_items WHERE project_id = $1 AND in_scope = false", pid)
            scope_ok = len(in_items) >= 3 and len(out_items) >= 1
            checks.append({"check": "Scope defined (in + out)", "status": "covered" if scope_ok else "partial" if in_items or out_items else "missing",
                           "detail": f"{len(in_items)} in-scope, {len(out_items)} out-of-scope"})

            # 9. No unresolved contradictions
            contras = await conn.fetch("SELECT explanation FROM contradictions WHERE project_id = $1 AND resolved = false", pid)
            checks.append({"check": "No unresolved contradictions", "status": "covered" if not contras else "missing",
                           "detail": f"{len(contras)} open" if contras else "none",
                           "items": [r["explanation"][:60] for r in contras[:3]]})

            # 10. Budget constraint defined
            budget = await conn.fetch("SELECT description FROM constraints WHERE project_id = $1 AND type = 'budget'", pid)
            checks.append({"check": "Budget constraint defined", "status": "covered" if budget else "missing",
                           "items": [r["description"][:60] for r in budget]})

            # 11. Timeline constraint defined
            timeline = await conn.fetch("SELECT description FROM constraints WHERE project_id = $1 AND type = 'timeline'", pid)
            checks.append({"check": "Timeline constraint defined", "status": "covered" if timeline else "missing",
                           "items": [r["description"][:60] for r in timeline]})

            # 12. Assumptions validated (ratio)
            total_assumptions = await conn.fetchval("SELECT COUNT(*) FROM assumptions WHERE project_id = $1", pid) or 0
            validated_assumptions = await conn.fetchval("SELECT COUNT(*) FROM assumptions WHERE project_id = $1 AND validated = true", pid) or 0
            if total_assumptions > 0:
                a_ratio = validated_assumptions / total_assumptions
                a_status = "covered" if a_ratio >= 0.8 else "partial" if a_ratio > 0 else "missing"
                a_detail = f"{validated_assumptions} of {total_assumptions} validated"
            else:
                a_ratio = 0.5
                a_status = "partial"
                a_detail = "no assumptions tracked"
            checks.append({"check": "Assumptions validated", "status": a_status, "detail": a_detail})

            # Score: same as evaluator
            score_map = {"covered": 1.0, "partial": 0.5, "missing": 0.0}
            # Use exact ratio for checks 4 (confirmation) and 12 (assumptions)
            scores = []
            for i, c in enumerate(checks):
                if i == 3:  # confirmation ratio
                    scores.append(conf_ratio)
                elif i == 11:  # assumptions ratio
                    scores.append(a_ratio)
                else:
                    scores.append(score_map.get(c["status"], 0))
            overall = round((sum(scores) / len(scores)) * 100, 1)

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

            decs = await conn.fetch("SELECT title, rationale, decided_by, status FROM decisions WHERE project_id = $1 AND (title ILIKE $2 OR rationale ILIKE $2) LIMIT 10", pid, pattern)
            for d in decs:
                results.append({"type": "decision", "id": None, "title": d["title"], "description": (d["rationale"] or "")[:200], "status": d["status"]})

            stkh = await conn.fetch("SELECT name, role, organization, interests FROM stakeholders WHERE project_id = $1 AND (name ILIKE $2 OR role ILIKE $2 OR interests ILIKE $2) LIMIT 10", pid, pattern)
            for s in stkh:
                results.append({"type": "stakeholder", "id": None, "title": f"{s['name']} ({s['role']})", "description": (s["interests"] or "")[:200]})

            asms = await conn.fetch("SELECT statement, basis, risk_if_wrong FROM assumptions WHERE project_id = $1 AND (statement ILIKE $2 OR basis ILIKE $2) LIMIT 10", pid, pattern)
            for a in asms:
                results.append({"type": "assumption", "id": None, "title": (a["statement"] or "")[:100], "description": (a["risk_if_wrong"] or "")[:200]})

            scps = await conn.fetch("SELECT description, in_scope, rationale FROM scope_items WHERE project_id = $1 AND (description ILIKE $2 OR rationale ILIKE $2) LIMIT 10", pid, pattern)
            for s in scps:
                results.append({"type": "scope_item", "id": None, "title": (s["description"] or "")[:100], "description": f"{'In scope' if s['in_scope'] else 'Out of scope'}: {(s['rationale'] or '')[:150]}"})

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
                await conn.execute(
                    "INSERT INTO requirements (id, project_id, req_id, title, description, type, priority, status, confidence, source_quote, source_person, acceptance_criteria) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, 'functional', $5, 'proposed', 'medium', $6, $7, $8::jsonb)",
                    pid, new_req_id, title, description, req_priority, source_quote, source_person, json.dumps(acs)
                )
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New requirement {new_req_id}: {title}", json.dumps({"type": "requirement", "req_id": new_req_id, "source": source})
                )
                new_score = await _recalculate_readiness(conn, pid)
                return _json_result({"success": True, "type": "requirement", "req_id": new_req_id, "title": title, "readiness": new_score})

            elif finding_type == "constraint":
                # type / status are enums — coerce against the schema.
                # The agent can pass `priority` to override type (we
                # piggyback on the existing tool arg until 2C-2 adds
                # a proper kind_subtype field).
                con_type = coerce_enum("constraint", "type", priority, "technology")
                await conn.execute(
                    "INSERT INTO constraints (id, project_id, type, description, impact, source_quote, status) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'assumed')",
                    pid, con_type, title, description or "", source_quote or ""
                )
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New constraint: {title}", json.dumps({"type": "constraint", "source": source})
                )
                new_score = await _recalculate_readiness(conn, pid)
                return _json_result({"success": True, "type": "constraint", "title": title, "readiness": new_score})

            elif finding_type == "decision":
                # alternatives is JSONB so an empty string fails to
                # parse — use a real JSON array. status defaults to
                # 'tentative' (the schema enum is tentative/confirmed/
                # reversed; 'proposed' was wrong).
                await conn.execute(
                    "INSERT INTO decisions (id, project_id, title, decided_by, rationale, alternatives, impacts, status) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6::jsonb, 'tentative')",
                    pid, title, source_person, description, "[]", "[]"
                )
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New decision: {title}", json.dumps({"type": "decision", "source": source})
                )
                new_score = await _recalculate_readiness(conn, pid)
                return _json_result({"success": True, "type": "decision", "title": title, "readiness": new_score})

            elif finding_type == "stakeholder":
                await conn.execute(
                    "INSERT INTO stakeholders (id, project_id, name, role, organization, decision_authority) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)",
                    pid, title, description or "unknown", source or "unknown", priority or "informed"
                )
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New stakeholder: {title}", json.dumps({"type": "stakeholder"})
                )
                return _json_result({"success": True, "type": "stakeholder", "name": title})

            elif finding_type == "assumption":
                # FIX: the assumptions table has no `impact` column —
                # the previous INSERT was failing every call. The real
                # columns are statement, basis, risk_if_wrong,
                # needs_validation_by, validated. Tool doesn't expose
                # all four as args; use description as the basis and
                # leave risk_if_wrong empty for now.
                await conn.execute(
                    "INSERT INTO assumptions (id, project_id, statement, basis, risk_if_wrong, validated) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, false)",
                    pid, title, description or "", ""
                )
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New assumption: {title}", json.dumps({"type": "assumption"})
                )
                return _json_result({"success": True, "type": "assumption", "statement": title})

            elif finding_type == "gap":
                last = await conn.fetchval(
                    "SELECT gap_id FROM gaps WHERE project_id = $1 AND gap_id LIKE 'GAP-%' ORDER BY gap_id DESC LIMIT 1", pid
                )
                num = int(last.split("-")[1]) + 1 if last else 1
                gap_id = f"GAP-{num:03d}"
                await conn.execute(
                    "INSERT INTO gaps (id, project_id, gap_id, question, severity, area, status, source_quote) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'open', $6)",
                    pid, gap_id, title, priority or "medium", source or "general", source_quote or ""
                )
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New gap {gap_id}: {title}", json.dumps({"type": "gap", "gap_id": gap_id})
                )
                new_score = await _recalculate_readiness(conn, pid)
                return _json_result({"success": True, "type": "gap", "gap_id": gap_id, "question": title, "readiness": new_score})

            elif finding_type == "scope":
                # FIX: the scope_items table has no `item` or
                # `confirmed` columns — the previous INSERT was failing
                # every call. The real columns are description,
                # in_scope, rationale.
                in_scope = priority != "out"
                await conn.execute(
                    "INSERT INTO scope_items (id, project_id, description, in_scope, rationale) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4)",
                    pid, title, in_scope, description or ""
                )
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"Scope item: {title} ({'IN' if in_scope else 'OUT'})", json.dumps({"type": "scope", "in_scope": in_scope})
                )
                return _json_result({"success": True, "type": "scope", "item": title, "in_scope": in_scope})

            elif finding_type == "contradiction":
                await conn.execute(
                    "INSERT INTO contradictions (id, project_id, item_a_type, item_a_id, item_b_type, item_b_id, explanation, resolved) "
                    "VALUES (gen_random_uuid(), $1, 'unknown', gen_random_uuid(), 'unknown', gen_random_uuid(), $2, false)",
                    pid, title + ": " + (description or "")
                )
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New contradiction: {title}", json.dumps({"type": "contradiction"})
                )
                return _json_result({"success": True, "type": "contradiction", "explanation": title})

            else:
                return _json_result({"error": f"Unknown finding_type: {finding_type}. Supported: requirement, constraint, decision, stakeholder, assumption, gap, scope, contradiction."})

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

            errors: list[str] = []
            supported_channels = {"gmail", "in_app"}
            if channel not in supported_channels:
                errors.append(
                    f"channel '{channel}' is not supported in v1 — ask the user to pick one of: {sorted(supported_channels)}"
                )
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
                "(id, project_id, created_by_user_id, subject_type, subject_id, person, raw_request, due_at, prep_lead, channel, prep_agent, status) "
                "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, make_interval(hours => $8), $9, $10, 'pending') "
                "RETURNING id",
                pid, uid, subject_type, subject_id, person, raw_request, due_at, prep_lead_hours, channel, prep_agent,
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
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
