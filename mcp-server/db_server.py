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
                    "kind": {"type": "string", "enum": ["missing_info", "unvalidated_assumption", "undecided"], "description": "Gap-only. Kind of gap: 'missing_info' (default) = client never told us; 'unvalidated_assumption' = we're assuming X but nothing confirms it; 'undecided' = a call that needs to be made but hasn't been."},
                    "side_a": {"type": "string", "description": "Contradiction-only. The FIRST conflicting statement — what one source/person said. E.g. 'David says 2 handoff docs'."},
                    "side_b": {"type": "string", "description": "Contradiction-only. The SECOND conflicting statement — what the other source/person said. E.g. 'Sarah says 3 handoff docs are required'."},
                    "area": {"type": "string", "description": "Contradiction-only. Domain category: tech-stack / scope / governance / timeline / budget / other."},
                    "side_a_source": {"type": "string", "description": "Contradiction-only. Document / source reference for side_a (e.g. 'client-meeting-notes-2.md', 'tech-stack-email.eml'). Leave null if unknown."},
                    "side_a_person": {"type": "string", "description": "Contradiction-only. Person who stated side_a (e.g. 'David Miller'). Leave null if unknown."},
                    "side_b_source": {"type": "string", "description": "Contradiction-only. Document / source reference for side_b. Leave null if unknown."},
                    "side_b_person": {"type": "string", "description": "Contradiction-only. Person who stated side_b. Leave null if unknown."},
                },
                "required": ["finding_type", "title", "description"],
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
                await conn.execute(
                    "INSERT INTO requirements (id, project_id, req_id, title, description, type, priority, status, confidence, "
                    " source_quote, source_person, source_doc_id, acceptance_criteria, "
                    " rationale, alternatives_considered, scope_note, blocked_by) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, 'functional', $5, 'proposed', 'medium', "
                    "        $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13::jsonb)",
                    pid, new_req_id, title, description, req_priority,
                    source_quote, source_person, source_doc_uuid, json.dumps(acs),
                    rationale, json.dumps(alternatives), scope_note, json.dumps(blocked_by),
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
                    "INSERT INTO constraints (id, project_id, type, description, impact, source_quote, source_doc_id, status) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'assumed')",
                    pid, con_type, title, description or "", source_quote or "", source_doc_uuid
                )
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New constraint: {title}", json.dumps({"type": "constraint", "source": source})
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
                await conn.execute(
                    "INSERT INTO gaps (id, project_id, gap_id, question, kind, severity, area, status, source_quote, source_doc_id) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'open', $7, $8)",
                    pid, gap_id, title, kind, priority or "medium", source or "general", source_quote or "", source_doc_uuid
                )
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New gap {gap_id} ({kind}): {title}", json.dumps({"type": "gap", "gap_id": gap_id, "kind": kind})
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
                # Keep explanation populated for legacy readers (search,
                # agent get_contradictions, etc.) — compose from the new
                # fields so old queries still return meaningful content.
                expl_parts = [p for p in [title, side_a, side_b] if p]
                explanation = " / ".join(expl_parts)
                await conn.execute(
                    "INSERT INTO contradictions "
                    "(id, project_id, title, side_a, side_b, area, "
                    " side_a_source, side_a_person, side_b_source, side_b_person, "
                    " explanation, source_doc_id, resolved) "
                    "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)",
                    pid, title, side_a or None, side_b or None, area,
                    side_a_source, side_a_person, side_b_source, side_b_person,
                    explanation or None, source_doc_uuid,
                )
                await conn.execute(
                    "INSERT INTO activity_log (id, project_id, action, summary, details) "
                    "VALUES (gen_random_uuid(), $1, 'finding_stored', $2, $3)",
                    pid, f"New contradiction: {title}",
                    json.dumps({"type": "contradiction", "area": area}),
                )
                return _json_result({"success": True, "type": "contradiction", "title": title})

            else:
                return _json_result({"error": f"Unknown finding_type: {finding_type}. Supported: requirement, constraint, stakeholder, gap, contradiction."})

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
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
