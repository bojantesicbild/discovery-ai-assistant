"""Walk the vault and upsert the tech-doc / story DB index.

Mirrors the file-naming convention emitted by `story-tech-agent` and
`story-story-agent` (see assistants/.claude/agents/*-agent.md). The
agents encode the artifact identity in the filename — no YAML
frontmatter — so the sync is a pure path-pattern matcher.

Convention:

    .memory-bank/docs/
    ├── tech-docs/
    │   └── TD-NNN-<slug>.md           ← one flat file per tech doc
    └── stories/
        └── TD-NNN/
            ├── breakdown.md           ← per-TD overview — SKIPPED here
            └── US-NNN-<slug>.md       ← one PBI per story

ID derivation:
    td_id = "TD-NNN" lifted directly from the filename
    us_id = "US-NNN" lifted directly from the filename (numbers are
            project-globally minted by the agent, so two TDs never
            share a US-NNN)

The BR↔TD link lives on the DB row's `source_brs` field (populated by
the agent through prose citation, then reflected in the UI as a
clickable pill). Filenames intentionally do NOT carry the BR id —
that decoupling lets a TD's source BR change without a file rename.

For now, sync auto-fills `source_brs` from BR-NNN tokens found in the
tech doc body, so existing tech docs that mention BR-001 keep their
inbound pill. The agent prompt also tells the LLM to cite the source
BR in prose, not in the filename.

Title: first H1 in the body. For tech docs we strip the leading
"TD-NNN · " prefix and a trailing "— Technical Spec" so the title
field stays a clean human label.

Status: default ("draft" for TDs, "todo" for stories) — the agents
don't set one; status transitions happen through the web UI's PATCH.

Idempotency: lookup-by-id (the id is deterministic from filename), so
re-running on unchanged files reports 0/0. Deletion is never
performed — orphaned rows whose files vanish stay until you wipe
them explicitly.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.claude_runner import claude_runner
from app.models.tech_story import Story, TechDoc

log = structlog.get_logger()


# ── filename patterns ───────────────────────────────────────────────

# tech-docs/TD-001-visioconference-scheduler.md  → TD num 001
_TD_FILE = re.compile(r"^TD-(\d+)[-_].+\.md$", re.IGNORECASE)
# Backward-compat: agents that haven't picked up the new prompt still
# emit BR-NNN-*.md (the BR id was used as the TD id when the
# convention encoded the source BR in the filename). We derive
# td_id = TD-NNN from the BR digits so the panel doesn't go blank
# while a project's agents migrate.
_TD_FILE_LEGACY_BR = re.compile(r"^BR-(\d+)[-_].+\.md$", re.IGNORECASE)
# stories/TD-001/US-007-participant-picker.md  → US num 007
_US_FILE = re.compile(r"^US-(\d+)[-_].+\.md$", re.IGNORECASE)
# Backward-compat: STORY-MMM-*.md filenames under per-BR folders.
_US_FILE_LEGACY = re.compile(r"^STORY-(\d+)[-_].+\.md$", re.IGNORECASE)
# Parent folder name under stories/ — must be `TD-NNN` exactly (or
# `BR-NNN` for legacy projects) so we only treat per-parent subfolders
# as story buckets (anything else, like `archive/`, gets skipped).
_TD_FOLDER = re.compile(r"^TD-(\d+)$", re.IGNORECASE)
_BR_FOLDER = re.compile(r"^BR-(\d+)$", re.IGNORECASE)
# Strip a leading "TD-NNN · " prefix off the H1 (the agent records the
# id in the heading line for self-evidence, but the title field stays
# clean) and a trailing "— Technical Spec" suffix so list-view titles
# read as plain feature names.
_TD_HEADING_PREFIX = re.compile(r"^TD-\d+\s*[·:\-]\s*", re.IGNORECASE)
_US_HEADING_PREFIX = re.compile(r"^US-\d+\s*[·:\-]\s*", re.IGNORECASE)
_TECH_SPEC_SUFFIX = re.compile(r"\s*[—-]\s*Technical\s+Spec\s*$", re.IGNORECASE)
# Pull BR-NNN tokens out of the body so source_brs is populated even
# though the agent doesn't write the id into the filename.
_BR_REF = re.compile(r"\bBR-(\d+)\b")


def _vault_root(project_id: uuid.UUID) -> Path:
    return claude_runner.get_project_dir(project_id) / ".memory-bank"


def _first_h1(body: str) -> str | None:
    for line in body.splitlines():
        s = line.strip()
        if s.startswith("# ") and not s.startswith("# #"):
            return s[2:].strip()
    return None


def _td_title_from_body(body: str, fallback_stem: str) -> str:
    raw = _first_h1(body) or fallback_stem.replace("-", " ").replace("_", " ").title()
    raw = _TD_HEADING_PREFIX.sub("", raw)
    return _TECH_SPEC_SUFFIX.sub("", raw).strip()


def _us_title_from_body(body: str, fallback_stem: str) -> str:
    raw = _first_h1(body) or fallback_stem.replace("-", " ").replace("_", " ").title()
    return _US_HEADING_PREFIX.sub("", raw).strip()


def _br_refs_in_body(body: str) -> list[str]:
    """Pick the BR-NNN tokens out of the document. Order-preserving and
    de-duplicated so the DB row's source_brs reads as the author wrote
    it; if the agent forgets to mention a BR, we don't fabricate one."""
    seen: list[str] = []
    for m in _BR_REF.finditer(body):
        token = f"BR-{m.group(1).zfill(3)}"
        if token not in seen:
            seen.append(token)
    return seen


# ── core ────────────────────────────────────────────────────────────


async def sync_tech_docs_from_vault(
    db: AsyncSession, project_id: uuid.UUID
) -> dict:
    """Reconcile tech_docs + stories tables with what the agents have
    written under .memory-bank/docs/. Idempotent — safe to call on
    every page mount.

    Returns counts per kind plus a `skipped` list (files that matched
    a folder we walk but didn't fit the naming convention; useful for
    debugging "why didn't this story show up?").
    """
    vault = _vault_root(project_id)
    tech_dir = vault / "docs" / "tech-docs"
    stories_dir = vault / "docs" / "stories"

    report: dict[str, Any] = {
        "tech_docs": {"created": 0, "updated": 0},
        "stories": {"created": 0, "updated": 0},
        "skipped": [],
    }

    # ── Pass 1: tech docs ────────────────────────────────────────────
    # We need TDs in the DB before stories so the FK resolves on the
    # same sync run.
    td_by_num: dict[str, TechDoc] = {}  # "001" → TechDoc

    if tech_dir.exists():
        for path in sorted(tech_dir.glob("*.md")):
            m = _TD_FILE.match(path.name) or _TD_FILE_LEGACY_BR.match(path.name)
            if not m:
                # E.g., breakdown / index files dropped at the wrong level.
                report["skipped"].append(
                    {"file": str(path.relative_to(vault)), "reason": "filename does not match TD-NNN-*.md (or legacy BR-NNN-*.md)"}
                )
                continue
            td_num = m.group(1).zfill(3)
            td_id = f"TD-{td_num}"

            try:
                content = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as e:
                report["skipped"].append(
                    {"file": str(path.relative_to(vault)), "reason": f"read error: {e}"}
                )
                continue

            title = _td_title_from_body(content, path.stem)
            rel_path = str(path.relative_to(vault))
            # source_brs comes from the document body now — the BR id is
            # cited in prose, not encoded in the filename.
            source_brs = _br_refs_in_body(content)

            existing = await db.execute(
                select(TechDoc).where(
                    TechDoc.project_id == project_id, TechDoc.td_id == td_id
                )
            )
            td = existing.scalar_one_or_none()

            if td is None:
                td = TechDoc(
                    id=uuid.uuid4(),
                    project_id=project_id,
                    td_id=td_id,
                    title=title,
                    file_path=rel_path,
                    source_brs=source_brs,
                    status="draft",
                    summary=None,
                )
                db.add(td)
                await db.flush()
                report["tech_docs"]["created"] += 1
            else:
                changed = False
                if td.title != title:
                    td.title = title
                    changed = True
                if td.file_path != rel_path:
                    td.file_path = rel_path
                    changed = True
                if td.source_brs != source_brs:
                    td.source_brs = source_brs
                    changed = True
                if changed:
                    report["tech_docs"]["updated"] += 1

            td_by_num[td_num] = td

    # ── Pass 2: stories ──────────────────────────────────────────────
    # Walk per-TD subfolders only. `breakdown.md` (and anything else not
    # matching the US-NNN-*.md pattern) is intentionally skipped — the
    # breakdown is surfaced separately on the TD detail view.
    if stories_dir.exists():
        for td_folder in sorted(stories_dir.iterdir()):
            if not td_folder.is_dir():
                continue
            fm = _TD_FOLDER.match(td_folder.name) or _BR_FOLDER.match(td_folder.name)
            if not fm:
                continue
            td_num = fm.group(1).zfill(3)
            parent = td_by_num.get(td_num)
            if parent is None:
                # Parent TD might exist in the DB from a prior sync —
                # check before declaring the stories orphans.
                lookup = await db.execute(
                    select(TechDoc).where(
                        TechDoc.project_id == project_id,
                        TechDoc.td_id == f"TD-{td_num}",
                    )
                )
                parent = lookup.scalar_one_or_none()
            if parent is None:
                report["skipped"].append(
                    {
                        "folder": str(td_folder.relative_to(vault)),
                        "reason": f"no tech doc found for TD-{td_num} — write tech-docs/TD-{td_num}-*.md first",
                    }
                )
                continue

            # Walk both the new (US-NNN-*.md) and legacy (STORY-NNN-*.md)
            # filenames; the only failure case is a stray .md that
            # matches neither pattern.
            for path in sorted(td_folder.glob("*.md")):
                sm = _US_FILE.match(path.name) or _US_FILE_LEGACY.match(path.name)
                if not sm:
                    report["skipped"].append(
                        {"file": str(path.relative_to(vault)), "reason": "filename does not match US-NNN-*.md (or legacy STORY-NNN-*.md)"}
                    )
                    continue
                us_num = sm.group(1).zfill(3)
                us_id = f"US-{us_num}"

                try:
                    content = path.read_text(encoding="utf-8")
                except (OSError, UnicodeDecodeError) as e:
                    report["skipped"].append(
                        {"file": str(path.relative_to(vault)), "reason": f"read error: {e}"}
                    )
                    continue

                title = _us_title_from_body(content, path.stem)
                rel_path = str(path.relative_to(vault))
                # Stories inherit the parent TD's BR list when they
                # don't cite their own — this keeps the BR pill on
                # every PBI without forcing the agent to repeat the
                # citation in each story body.
                own_brs = _br_refs_in_body(content)
                source_brs = own_brs if own_brs else (parent.source_brs or [])

                existing = await db.execute(
                    select(Story).where(
                        Story.project_id == project_id, Story.us_id == us_id
                    )
                )
                story = existing.scalar_one_or_none()

                if story is None:
                    story = Story(
                        id=uuid.uuid4(),
                        project_id=project_id,
                        tech_doc_id=parent.id,
                        us_id=us_id,
                        title=title,
                        file_path=rel_path,
                        source_brs=source_brs,
                        acceptance_criteria=[],
                        status="todo",
                        summary=None,
                    )
                    db.add(story)
                    report["stories"]["created"] += 1
                else:
                    changed = False
                    if story.tech_doc_id != parent.id:
                        story.tech_doc_id = parent.id
                        changed = True
                    if story.title != title:
                        story.title = title
                        changed = True
                    if story.file_path != rel_path:
                        story.file_path = rel_path
                        changed = True
                    if story.source_brs != source_brs:
                        story.source_brs = source_brs
                        changed = True
                    if changed:
                        report["stories"]["updated"] += 1

    await db.commit()
    log.info(
        "tech_story_sync.done",
        project_id=str(project_id),
        td_created=report["tech_docs"]["created"],
        td_updated=report["tech_docs"]["updated"],
        us_created=report["stories"]["created"],
        us_updated=report["stories"]["updated"],
        skipped=len(report["skipped"]),
    )
    return report
