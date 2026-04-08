# Unread / Review State for Findings

**Status:** Planning — no code yet.
**Date:** 2026-04-08
**Context:** As pipeline ingestion produces requirements, gaps, constraints,
contradictions, decisions, scope items, and people, the user has no easy way
to tell which findings they have **already reviewed** vs which are **new and
still need attention**. This becomes critical as document count grows: a
project with 50 requirements and a fresh ingest of 8 new ones should make
the 8 obvious. Right now everything looks the same.

This document is the strategy for adding "unread / review state" tracking
across all finding types, including UI, backend, and edge cases.

---

## What "unread" should mean

Distinguish carefully between several closely related concepts. Picking the
wrong one creates a feature that feels wrong even when it works.

| Concept | Definition | Example |
|---|---|---|
| **Unseen** | The user has never opened/expanded this row | A new BR-008 from this morning's Gmail import |
| **Unreviewed** | The user has seen it but hasn't taken any explicit action (confirm/dismiss/edit) | BR-008 — user clicked it once but didn't confirm or dismiss |
| **Stale** | Last reviewed > N days ago | BR-001 confirmed 30 days ago — still confirmed but maybe outdated |
| **Changed since reviewed** | Was reviewed, but the underlying content has been updated | BR-008 — user confirmed v1, then a re-extraction modified the description |
| **Resolved** | Explicitly marked done by the user | GAP-003 marked resolved |

**Recommendation: track "unseen" + "changed since seen" as v1.** That gives
the badge system its main job: "things you haven't looked at yet". Defer
"stale" and the more nuanced statuses to v1.1+ once the core flow ships.

---

## What it looks like in the UI

Three places matter:

### 1. Tab badges (DataPanel header)

The current tabs show counts (`Requirements 24`, `Gaps 14`). Add a small
**unread dot or count** next to each tab when it has unseen items:

```
Requirements 24  •3   Gaps 14  •2   Constraints 11   Contradictions 0
```

- `•3` = 3 unread items in that tab
- Solid green dot for "has unread" with the count
- No dot when everything is read

The dot draws the eye to where attention is needed.

### 2. Row indicator inside each tab

Each row in the requirements / gaps / constraints / etc. list gets a **left
border accent** when unread:

```
┌────────────────────────────────────────┐
│ ▎ BR-008  Discovery API rate limits    │  ← bright green left bar = unread
│   FUNCTIONAL  MUST  proposed           │
├────────────────────────────────────────┤
│   BR-007  Gmail message attachments    │  ← no bar = read
│   FUNCTIONAL  SHOULD  confirmed        │
└────────────────────────────────────────┘
```

The bar disappears (or fades) when the row gets marked read.

Per-row optional badge: `NEW`, `CHANGED` — small uppercase 9px text. Only
shown for items that are unread or changed since seen.

### 3. Sidebar phase counter

The sidebar already shows `Discovery 4` (number of phases or items). Repurpose
or augment this to show **total unread across all tabs in this project**:

```
Discovery  ●5
```

The dot is the same brand green; the number is the total of unread BRs +
unread gaps + unread cons + unread contras + unread decisions across the
whole project.

---

## How "read" gets marked

Three trigger options, each with a different feel:

### Option A — Auto-mark on view (passive)
- Opening a row's expanded details → marks read
- Hovering for >1s → marks read
- Scrolling past it in the list → marks read

**Pros:** Zero effort. Matches Gmail / Slack feel.
**Cons:** Easy to "lose" things by accident-scrolling. No moment of intent.

### Option B — Explicit mark (active)
- A "Mark read" button per row
- A "Mark all read" button per tab

**Pros:** User has full control. Nothing accidentally clears.
**Cons:** Manual work. Users skip it. The feature becomes useless.

### Option C — Auto on row click + bulk action (hybrid) ⭐
- **Click to expand a row** → marks read
- Reading the title in the list **does not** count as read
- A **"Mark all read"** button per tab for bulk clearing
- A **"Mark all read in project"** button somewhere in settings

**Pros:** Natural action triggers it; explicit control still available; matches
mental model of "reading" being interactive (you have to actually look at it).
**Cons:** Requires the row to be expandable (most already are).

**Recommendation: Option C.** It's the standard pattern in inbox UIs and
matches how DataPanel rows already work.

---

## Data model

Two storage approaches:

### Approach 1 — Per-finding `seen_at` column
Add a `seen_at: datetime | None` column to every finding table:
`requirements`, `gaps`, `constraints`, `decisions`, `contradictions`,
`assumptions`, `scope_items`, `stakeholders`.

**Pros:** Simple, queryable, joined into any list query for free.
**Cons:** 8 migrations. Cross-table queries to count unread per project.
Single-user only — `seen_at` is global, can't track "user A saw it but
user B didn't" without an extra column.

### Approach 2 — Separate `finding_views` table
One table that records (user_id, project_id, finding_type, finding_id, seen_at):

```python
class FindingView(Base, IdMixin, TimestampMixin):
    user_id: UUID
    project_id: UUID
    finding_type: str           # "requirement", "gap", "constraint", ...
    finding_id: UUID            # FK polymorphic — references the actual row
    seen_at: datetime
    seen_version: int           # bumps on row update so we can detect "changed since seen"
```
Unique on `(user_id, finding_type, finding_id)`.

**Pros:** Per-user tracking out of the box. One migration. Doesn't pollute
finding tables with view metadata.
**Cons:** Joins / subqueries for "is this row seen by current user". Slightly
more complex queries. Polymorphic FK isn't enforced by the DB.

### Approach 3 — Counter-based (last_seen_id per type per user)
Per user/project/type, store the highest `created_at` timestamp the user has
seen. Anything created after that is unread.

```python
class FindingReadCursor(Base, IdMixin, TimestampMixin):
    user_id: UUID
    project_id: UUID
    finding_type: str
    last_seen_at: datetime
```
Unique on `(user_id, project_id, finding_type)`.

To mark a row read = bump the cursor to that row's `created_at` (if newer
than current cursor).

To compute unread count = `COUNT(*) WHERE created_at > cursor.last_seen_at`.

**Pros:** Trivial — one row per (user, project, type). Fast count queries
(simple WHERE clause). Naturally handles "everything before T was seen".
**Cons:** Coarser — can't say "I saw BR-003 and BR-005 but not BR-004".
"Mark this specific row read" doesn't make sense; the cursor only moves forward.

### Recommendation

**Approach 2 (`finding_views`).** It's the right granularity for what we want
("show me which specific rows are unread") and supports per-user tracking
naturally. The polymorphic FK is fine without DB-level enforcement because
findings are only created server-side and we control the access path.

Approach 3 is tempting for simplicity but breaks the "click on BR-008 to
mark only BR-008 read" UX because the cursor would jump past everything in
between.

---

## API design

### Read endpoints (extended)
The existing list endpoints (`GET /requirements`, `GET /gaps`, etc.) gain
an optional `include_seen=true` query param. When set, each row gets a
`seen_at` field populated from the `finding_views` table for the current user.

```json
[
  { "req_id": "BR-008", "title": "...", "seen_at": null },        // unread
  { "req_id": "BR-007", "title": "...", "seen_at": "2026-04-08T..." }
]
```

### Mark-read endpoints
```
POST /api/projects/{id}/findings/{type}/{finding_id}/seen
POST /api/projects/{id}/findings/{type}/seen-all          (bulk per-tab)
POST /api/projects/{id}/findings/seen-all                  (bulk per-project)
```

Idempotent: posting `seen` for an already-seen row is a no-op.

### Aggregate count endpoint
```
GET /api/projects/{id}/findings/unread
→ { "requirement": 3, "gap": 2, "constraint": 0, "contradiction": 1, ...,
    "total": 6 }
```
Used for the tab badges + sidebar counter. Polled every 15s by the frontend
or pushed when ingestion completes.

---

## Frontend wiring

### State
- Each DataPanel tab subscribes to `unread` data and renders the badge
- Each row checks its own `seen_at` and applies the left bar / NEW badge
- The sidebar's `Discovery` item shows `total` unread

### Marking read
- DataPanel row `onClick` → expand + fire `POST .../seen` (best-effort, non-blocking)
- Tab "Mark all read" button → fires `POST .../seen-all`

### Optimistic update
- Click a row → set `seen_at` locally immediately, fire the API call in background
- Tab badge count decrements instantly
- On API failure, revert (rare; the API is just a write)

### Polling
- The unread count endpoint is polled every 15s while the user is on the chat page
- On ingestion completion (system message arrives), force-refresh the unread count

---

## Edge cases

1. **Re-extraction modifies a row** — does it become "unread again"?
   - Approach 2 with `seen_version` handles this: bump `version` on the row
     when extraction updates it; `seen_version < version` = "changed since seen"
   - Show as a different badge: `CHANGED` instead of `NEW`
   - **Defer to v1.1** — v1 only tracks "never seen"

2. **Bulk import (Gmail/Drive sync) drops 200 new rows** — does the user
   want to see 200 unread badges?
   - Yes, that's the point of the feature
   - But provide a "Mark all read" button so they can clear quickly

3. **User clicks chip in chat system notice that jumps to a tab** — should
   the click count as "seeing the row"?
   - **No.** Navigating to a tab is not the same as reviewing a row.
   - Only expanding a row counts.

4. **What about the agent reading a row via MCP?**
   - The agent is not a user. Agent reads do NOT mark rows seen.
   - Tracked under `user_id`, agent has no user_id.

5. **Newly created findings via `store_finding` MCP tool (created by the agent in chat)** — should they be "seen" automatically since the user is talking to the agent?
   - **Tricky.** The user is in the conversation but hasn't explicitly looked at the row in DataPanel.
   - Default: still mark as unread. The user can click in DataPanel to confirm they've reviewed it.
   - Show a transient toast "BR-009 created — review in Requirements tab" so they know.

6. **Agent generates a draft answer and posts it as a system message in chat** — same as above.

7. **Multi-user team** — different users have different unread sets. The
   `finding_views` table is keyed on `user_id` so each user's state is
   independent. Counts in the sidebar / tab badges show the current user's
   counts.

8. **A finding gets deleted** — its `finding_views` rows should be cleaned up
   (cascade or scheduled cleanup). Otherwise leftover view rows accumulate.

9. **Initial state for existing projects** — when this feature ships, every
   existing finding has no `finding_views` row → looks "unread". A user
   opening the app for the first time after deploy would see ALL existing
   findings as unread (potentially hundreds).
   - **Mitigation:** on first load, run a one-time backfill that marks
     everything currently in the DB as "seen" for every user. New findings
     after deploy start unread.
   - **Or:** show a banner "Mark all existing findings as read?" that the
     user clicks once.

---

## What this enables (the "why")

Once unread tracking exists, several adjacent features become trivial:

- **Notification dropdown** — show "5 new findings from Gmail sync" with
  click-to-jump
- **Daily digest** — already exists; can now include "what's still unread
  from yesterday"
- **Sidebar attention model** — the green dot on Discovery / Story & Tech
  draws the eye to phases that need user input
- **Search filters** — "show me only unread requirements"
- **Onboarding flow** — first-time users see everything as "to review", with
  a guided mark-as-read experience
- **Audit/compliance** — "this requirement was reviewed by Bojan on 2026-04-08"

---

## Phased rollout

### Phase 1 — Per-user unread tracking (v1, ~1 day)
1. **Migration 008** — `finding_views` table
2. **`models/finding_view.py`** — SQLAlchemy model
3. **`services/finding_views.py`** — helpers: `mark_seen`, `mark_seen_bulk`,
   `get_seen_map(user_id, project_id, finding_type)`, `count_unread_by_type`
4. **Extend list endpoints** (`api/extracted_items.py`) — accept
   `include_seen=true`, join with finding_views
5. **New endpoints:**
   - `POST /findings/{type}/{id}/seen`
   - `POST /findings/{type}/seen-all`
   - `POST /findings/seen-all`
   - `GET /findings/unread`
6. **`lib/api.ts`** — frontend client functions
7. **DataPanel** — row left-bar accent, NEW badge, "Mark all read" button per
   tab, click-to-mark-read on expand
8. **Sidebar** — unread total badge on Discovery item
9. **Tab badges** — small dot+count next to each tab label
10. **Backfill migration** — mark all existing findings as seen for all
    existing users (so the rollout doesn't bury people)

### Phase 2 — Smart features (v1.1)
- `seen_version` field — detect "changed since seen", show CHANGED badge
- Stale detection (last reviewed > N days)
- Filter chips: "show only unread"
- Toast notifications when new findings land mid-session

### Phase 3 — Cross-feature integration (v1.2)
- Notification dropdown shows unread summary
- Daily digest includes unread carry-over
- Audit log of who reviewed what when

---

## Decisions to make before building

1. **Granularity:** Approach 2 (`finding_views` table)? My vote: yes.
2. **Mark-read trigger:** Option C (click-to-expand + bulk button)? My vote: yes.
3. **Per-user vs project-shared:** per-user (different team members have
   different review state)? My vote: per-user — that's the whole point.
4. **What counts as "seen":** only DataPanel row click? Or also tooltip
   hover, search highlight, mention in agent reply? My vote: only explicit
   row expansion.
5. **Bulk action visibility:** "Mark all read" button always visible at top
   of each tab, or only when there's something unread? My vote: only when unread.
6. **Initial backfill:** auto-mark all existing as seen on deploy, or show a
   one-time banner? My vote: auto-mark, no banner — quietest rollout.
7. **What about findings created by the agent via `store_finding` in the
   user's own chat session** — auto-seen because the user "saw" them in
   chat, or unread because they haven't been reviewed in DataPanel? My vote:
   unread (defensive — chat mention ≠ DataPanel review).
8. **Defer or include now:** `seen_version` / "changed since seen" — defer
   to v1.1? My vote: yes, defer.

---

## Files this work will touch (Phase 1)

**New:**
- `backend/app/models/finding_view.py`
- `backend/app/services/finding_views.py`
- `backend/alembic/versions/008_finding_views.py`
- `backend/alembic/versions/009_backfill_finding_views.py` (data migration)

**Modified:**
- `backend/app/models/__init__.py` — register FindingView
- `backend/app/api/extracted_items.py` — `include_seen` query param + `seen` mark endpoints
- `backend/app/api/dashboard.py` — unread count aggregate endpoint
- `frontend/src/lib/api.ts` — new client functions
- `frontend/src/components/DataPanel.tsx` — row indicator, NEW badge, mark-read button, tab badges
- `frontend/src/components/Sidebar.tsx` — unread total on Discovery item

---

## Open questions to revisit

- **Multi-tenant teams** — when the project actually has 3+ active members,
  does the sidebar badge show only my unread or the team's unread?
- **Cross-project counter** — is there value in a "you have N unread items
  across all projects" badge somewhere global?
- **Mobile app** — does the unread state make more or less sense on a phone?
  (Not a current concern — there's no mobile app.)
- **Snooze** — Gmail-style "snooze for 3 days, come back as unread" — useful
  for "I'll deal with this on Monday"?
