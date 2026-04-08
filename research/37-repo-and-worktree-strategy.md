# Repo + Worktree Strategy for Code-Aware Agents

**Status:** Decisions pending — strategy laid out, build deferred.
**Date:** 2026-04-08
**Context:** We have a Slack-aware agent with shared web/Slack conversations. Now we want code agents (story/tech doc generators, code reviewers, refactor assistants) to actually read project source code. The repo metadata layer (`Repo` table, `services/github.py`, `api/repos.py`, Code page) already exists. The filesystem layer — actual cloned source the agent can read — does not. This document is the strategy for adding it.

---

## What we already have

- `backend/app/api/repos.py` — repos CRUD
- `backend/app/services/github.py` — GitHub API client
- `frontend/src/app/projects/[projectId]/code/page.tsx` — Code page exists
- `Repo` table — multi-repo per project, stores access token, default branch
- `claude_runner.get_project_dir()` — `.runtime/projects/<id>/` per project (the agent's `cwd`)

What's missing: the agent has no actual source code on disk to `Read`/`Grep`/`Edit`.

---

## Can Claude Code run git from a parent folder?

**Yes.** Three ways, all work:

1. **`git -C <path>` flag (cleanest)** — `git -C repo/ status`. Doesn't change cwd. Use this.
2. **`cd` in a subshell** — `(cd repo && git status)`. Works fine.
3. **Explicit `--git-dir` / `--work-tree`** — verbose, rarely needed.

Caveats:

- Claude's `Read`/`Grep`/`Glob`/`Edit` tools always use paths **relative to the original `cwd`**. Even after `cd repo` in a Bash call, the next `Read` must still say `repo/src/foo.ts`.
- Each Bash call is its own subprocess — `cd` doesn't persist.
- Auth for private repos: clone with token-in-URL (`https://x-access-token:<TOKEN>@github.com/...`). Future pulls work without prompts.
- Empty/failed clone: detect via `git -C repo/ status` exit code 128 (`not a git repository`); re-clone.

**Bottom line: no MCP wrapping needed for git.** Claude's built-in `Bash` + `git -C` is enough. Backend's job is just clone, pull, worktree create/remove. All git "intelligence" lives in the agent.

---

## The 5 core questions

### 1. WHERE does the repo live?

| Option | Pros | Cons |
|---|---|---|
| **A — One clone per project** at `.runtime/projects/<id>/repo/` | Simple, isolated, agent's cwd already points here | Each project = full clone, no storage sharing |
| **B — Shared bare clones** at `~/.cache/discovery/git/...` + worktrees per project | Storage efficient, native multi-branch | Cross-project contamination risk, harder cleanup |
| **C — Hybrid** (working clone + ad-hoc worktrees) | Simple by default, flexible when needed | Slightly more management |

```
.runtime/projects/<id>/
├── worktrees/
│   ├── main/                  ← default working tree (always present)
│   ├── pr-123/                ← created when needed
│   └── refactor-auth/
├── .memory-bank/
├── CLAUDE.md
├── .mcp.json
└── uploads/
```

**Recommendation:** Option C (hybrid). Storage savings of B aren't worth the complexity for an internal-team tool.

### 2. WHEN do we pull?

| Strategy | Freshness | Cost | When |
|---|---|---|---|
| **On-demand only** (button) | Stale | Free | MVP — predictable |
| **Periodic background** (arq cron) | Fresh | Low | Once we have multiple users |
| **Pull-before-each-agent-run** | Always fresh | High latency | Defer — bad UX |
| **Webhook-driven** (GitHub `push`) | Real-time | Free, needs public URL | v2 — needs ngrok |

**Recommendation:** On-demand button + opt-in periodic (default off, user enables "every 15 min" per repo).

### 3. WHO creates worktrees and WHEN?

Worktrees are valuable for:
1. **PR reviews** — agent reviews PR-123 while you work on main
2. **Long-running refactors** — "rewrite auth module" takes hours; isolate it
3. **Parallel exploration** — "what would this look like in TypeScript?"
4. **Slack-triggered work in PR threads** — bot uses the PR's worktree

Triggers:
- **Manual** — UI button + slash command `/worktree create feature/xyz`
- **Auto on PR open** — webhook (defer to v2)
- **Agent-initiated** — risky, defer

**Recommendation:** Manual only for v1.

### 4. HOW does the agent know which worktree to use?

This is the load-bearing question. Three options:

| Approach | Mechanism | Sessions | Verdict |
|---|---|---|---|
| **Per-worktree cwd** | Spawn Claude with `cwd=worktrees/pr-123/` | One per worktree | **Bad** — multiplies sessions, breaks shared chat |
| **Per-worktree symlinked CLAUDE.md** | One Claude per worktree, symlink memory across | One per worktree | **Bad** — same problem |
| **Single session, memory bank tells agent** | One Claude per project, `.memory-bank/worktrees.md` is source of truth | One per project (current) | ✅ **Pick this** |

**Why memory bank wins:**

1. **Preserves shared conversation.** The web↔Slack shared session we just built stays intact. Per-worktree sessions would shatter it.
2. **Worktrees are just folders** to the agent. A markdown file describing them is enough.
3. **Cross-worktree work is trivial.** "Compare auth in main vs pr-123" — one agent, two `Read` calls. With per-session worktrees the agent can't see the other side.
4. **Naturally extensible.** New worktree metadata → just append to the .md.
5. **Matches the 3-tier context loading** we already have. `worktrees.md` becomes Tier 1 — loaded on every agent turn.

### 5. HOW does the agent SEE the repo?

Agent's `cwd` is `.runtime/projects/<id>/`. Repos at `worktrees/<name>/` are right there:
- `Read worktrees/main/src/foo.ts`
- `Grep "pattern" worktrees/main/`
- `git -C worktrees/main/ status`
- `cd worktrees/main && npm test`

Two enhancements:
1. `CLAUDE.md` "Repository worktrees" section
2. `.memory-bank/worktrees.md` auto-generated source of truth

---

## Source of truth: `.memory-bank/worktrees.md`

Auto-generated by the backend, never edited by hand. Regenerated on:
- Worktree create/delete
- Pull (commit SHA changes)
- Background task completion (status updates)
- Daily cron (idle/stale flagging)

```markdown
---
updated: 2026-04-08T11:30:00Z
default: main
total: 3
---

# Worktrees

## main — `./worktrees/main/`
- **Branch**: `main` @ `abc1234` (clean)
- **Last pulled**: 2h ago
- **Use for**: read-only exploration, canonical state questions

## pr-123 — `./worktrees/pr-123/`
- **Branch**: `feature/auth-rewrite` @ `def5678`
- **Created**: 3d ago by Bojan
- **Status**: active (used 2h ago)
- **Notes**: PR #123 review. Last test run: 14 added, 2 failing in `auth.test.ts`

## refactor-db — `./worktrees/refactor-db/`
- **Branch**: `refactor/db-pool` @ `9abc012`
- **Status**: idle 5 days
- **Notes**: Database connection pool refactor. Paused for client meetings.
```

The agent picks up changes on its **very next tool call** — no session restart, no MCP refresh.

---

## CLAUDE.md addition (one-time)

```markdown
## Repository worktrees

The project's source code lives in git worktrees under `./worktrees/`. The
list of worktrees, their branches, and their status is in
`.memory-bank/worktrees.md` — read it before doing repo work.

To work in a specific worktree:
- Read files: `Read worktrees/<name>/path/to/file.ts`
- Search: `Grep "pattern" worktrees/<name>/`
- Git ops: `git -C worktrees/<name>/ <command>`
- Build/test: `cd worktrees/<name> && npm test`

The default worktree is `main`. If the user doesn't specify a worktree,
operate on `main`. Never commit in `main` — use a feature worktree.

Comparing worktrees is easy: just Read from both paths.
```

15 lines. Agent is fully worktree-fluent.

---

## Worktree lifecycle

State machine:
```
created → active → idle → stale → deleted
```

- **active** — used in last 7 days
- **idle** — 7-14 days no activity → UI badge
- **stale** — 14+ days → UI badge + auto-delete proposed (never auto-deleted, user confirms)

Database:
```python
class RepoWorktree(Base, IdMixin, TimestampMixin):
    project_id: UUID
    repo_id: UUID                 # FK to existing repos table
    name: str                     # "main", "pr-123", "refactor-auth"
    branch: str
    path: str                     # absolute path on disk
    created_by_user_id: UUID | None
    last_used_at: datetime | None
    last_commit_sha: str | None
    status: str                   # "active" | "idle" | "stale" | "deleted"
    size_bytes: int | None
```

Daily cron: walks worktrees, updates `last_used_at` from filesystem mtime, marks idle/stale by age. **Never auto-deletes** — flags for user confirmation.

---

## UI: Code page additions

```
┌─ Repository ─────────────────────────────────────┐
│ github.com/bojan/discovery-ai • main • abc1234   │
│ Last pulled: 2 hours ago        [↻ Pull latest]  │
│ Auto-pull: ☐ off  ○ 5 min  ● 15 min  ○ 60 min   │
└──────────────────────────────────────────────────┘

┌─ Worktrees (3) ──────────────── [+ New worktree] ┐
│ ● main             main           active   2h    │
│ ○ pr-123           feature/auth   idle     8d    │
│ ○ refactor         refactor/db    stale    16d   │
│                                          [Delete] │
└──────────────────────────────────────────────────┘
```

Per-worktree info:
- Branch + last commit
- Size on disk
- Last agent activity (link to chat session)
- "Open in chat" (binds new chat to this worktree — v1.1)
- Manual delete

---

## Parallelism — separate problem, separate answer

The memory bank approach has one gap: **Claude Code processes one turn at a time per session.** "Agent, do X in pr-123 AND Y in refactor-db simultaneously" within ONE chat runs sequentially, not in parallel.

Three options for real parallelism:

### Option 1 — Sequential within one chat (default)
- Agent does tasks in order
- **Pros**: Zero new infrastructure
- **Cons**: Slow for big tasks

### Option 2 — Multiple chat threads (one per worktree)
- Each thread = its own Claude Code subprocess running independently
- Slack threads naturally enable this
- **Pros**: True parallelism
- **Cons**: Loses shared conversation context — fragments by design

### Option 3 — Background tasks via arq ⭐
- User: `/task pr-123 run all tests and report failures`
- Backend spawns a background Claude Code job, `cwd=worktrees/pr-123/`, prompt = task
- Job runs detached. User keeps chatting in main thread.
- When done, job posts a **system message** to the shared conversation: "✅ Background task in pr-123 complete: 14 tests, 2 failing in auth.test.ts. Reply 'show details' to dig in."
- Same system message mechanism we shipped for pipeline ingestion notices
- **Pros**: True parallelism, fire-and-forget, results land in main chat
- **Cons**: ~150 LOC new code (most already exists)

**Recommendation:** Option 1 for v1, Option 3 for v1.1. Skip Option 2 — don't fragment conversations.

The "agent goes off and does work in the background while I chat" model is Option 3. It maps to "I told a teammate to do something async."

---

## Phased rollout

### Phase 1 — Working clone + manual pull (~1 day)
1. `RepoWorktree` model + migration 007
2. `services/git.py` — `clone`, `pull`, `create_worktree`, `remove_worktree`, `status`, `list_worktrees` (uses `subprocess` calling `git` CLI; auth via stored token-in-URL)
3. `api/repos.py` — `POST /repos/{id}/clone`, `POST /repos/{id}/pull`, `GET /repos/{id}/status`
4. Auto-create "main" worktree when repo first added
5. Update `assistants/CLAUDE.md` template — add "Repository worktrees" section
6. UI: Repository panel on Code page — clone state + Pull button
7. `.memory-bank/worktrees.md` generation on first clone (dumb template, no agent yet)

### Phase 2 — Worktrees + UI tracking (~1 day)
1. Worktree CRUD endpoints (`api/worktrees.py`)
2. UI: worktree list with status badges, "New worktree" button, delete confirmation
3. Slash commands: `/worktree create <branch>`, `/worktree list`, `/worktree delete <name>`
4. `services/worktree_writer.py` — function that regenerates `worktrees.md` whenever state changes (called from create/delete/pull)
5. Daily cleanup cron — flags idle/stale, never deletes

### Phase 3 — Auto-pull + binding (~half day)
1. Background pull cron (per repo, configurable interval)
2. Per-thread worktree binding (Slack thread or web session pinned to a worktree)
3. UI: "Open in chat" button per worktree

### Phase 4 — Background tasks (v1.1, ~1 day)
1. `BackgroundTask` model + migration
2. `api/background_tasks.py` — create/list/cancel
3. arq worker function `run_agent_task(task_id)` — spawns Claude Code subprocess in worktree cwd, captures result
4. `/task <worktree> <prompt>` slash command
5. Result posted to shared conversation as system message
6. UI: background task list with status, retry, stop

### Phase 5 — Webhooks + auto-PR worktrees (defer)
- GitHub `push` webhook → trigger pull
- GitHub `pull_request opened` webhook → auto-create worktree
- Needs public URL — defer until needed

### Phase 6 — Multi-repo polish
- Already supported by data model (multi-repo per project)
- UI needs repo selector
- Agent needs to know which repo a question targets
- Path convention: `worktrees/<repo-name>/<worktree-name>/`

---

## Decisions to make before building

1. **Storage**: Option C (per-project working clone + ad-hoc worktrees)? My vote: yes.
2. **Pull strategy v1**: on-demand only, or also opt-in periodic? My vote: on-demand + opt-in periodic.
3. **Worktree creation v1**: manual only? My vote: yes, manual only.
4. **Worktree → chat binding**: defer to v1.1? My vote: yes, defer.
5. **Auto-cleanup**: flag-only (user confirms) or auto-delete after N days? My vote: flag only, never auto-delete code.
6. **`worktrees.md` generation**: dumb template or agent-explored? My vote: dumb template first, agent enrichment in v1.1.
7. **Multiple worktrees per branch allowed?** My vote: no, one per branch per repo.
8. **Multi-repo: each repo as `worktrees/<repo-name>/<wt-name>/`?** My vote: yes, even with one repo, for consistency.
9. **Default worktree name**: always `main` regardless of branch name (`main`/`master`/`develop`)? My vote: yes.
10. **What if user asks for code work and no repo cloned yet?** Refuse with "click Add Repo" or auto-clone? My vote: refuse — explicit, predictable.
11. **Parallelism**: live with sequential for v1, add background tasks in v1.1? Or v1?

---

## Why this approach (the short version)

- **Single Claude Code session per project** preserved — shared web/Slack chat stays intact
- **Worktrees are just folders** — no special agent infrastructure
- **`.memory-bank/worktrees.md` is the bridge** — backend writes it, agent reads it on every turn
- **Backend's job is small**: clone, pull, worktree create/remove, regenerate the .md file
- **All git intelligence lives in the agent** via `git -C` and `Read`/`Grep`/`Bash`
- **Background tasks (v1.1)** give true parallelism without fragmenting conversations
- **Auto-cleanup never deletes code** — only flags for user confirmation

---

## Open questions I haven't answered

- **Lockfile / dependency install**: when a worktree is created on a branch with different `package.json` / `pyproject.toml`, the agent will probably need to `npm install` / `uv sync` before it can run things. Should the worktree creation flow auto-install? Or let the agent decide and run install commands when needed? Probably the latter — but consider a hook.
- **Build cache sharing**: multiple worktrees on the same repo could share node_modules via pnpm/yarn linking, but that's premature optimization.
- **`.env` files**: each worktree starts without `.env`. Should we copy from main? Auto-decrypt from a vault? Defer — agent can be told "copy main/.env to your worktree if needed".
- **Disk pressure**: if user creates 10 worktrees on a 5GB repo, that's 50GB. Need a per-project disk quota? Or just flag at 20GB and ask user to clean up?
- **Agent instructed to commit + push from a worktree**: what credentials does it use? The same token-in-URL we cloned with. Verify it has push scope. If not, agent should fall back to creating a patch file the user can apply.

---

## Files this work will touch (when we build it)

**New:**
- `backend/app/models/repo_worktree.py`
- `backend/alembic/versions/007_repo_worktrees.py`
- `backend/app/services/git.py`
- `backend/app/services/worktree_writer.py`
- `backend/app/api/worktrees.py`
- `backend/app/pipeline/repo_pull.py` (background pull cron)
- `frontend/src/components/RepositoryPanel.tsx`
- `frontend/src/components/WorktreeList.tsx`
- `frontend/src/lib/git-api.ts` (or fold into existing api.ts)

**Modified:**
- `backend/app/api/repos.py` — clone/pull/status endpoints
- `backend/app/main.py` — register worktrees router
- `backend/app/pipeline/worker.py` — repo_pull cron
- `backend/app/agent/claude_runner.py` — worktree-aware project dir setup
- `assistants/CLAUDE.md` — Repository worktrees section
- `frontend/src/app/projects/[projectId]/code/page.tsx` — repository panel + worktrees list

**For v1.1 (background tasks):**
- `backend/app/models/background_task.py`
- `backend/alembic/versions/008_background_tasks.py`
- `backend/app/api/background_tasks.py`
- `backend/app/pipeline/agent_task_runner.py`
- `frontend/src/components/BackgroundTaskList.tsx`
