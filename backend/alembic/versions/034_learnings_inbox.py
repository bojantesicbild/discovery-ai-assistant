"""Learnings inbox — replace the unused scaffolding table.

Revision ID: 034_learnings_inbox
Revises: 033_sessions_and_events
Create Date: 2026-04-23

Phase 3 of the session-heartbeat architecture. The existing `learnings`
table was built for a different concept (skill/key/insight) and was
never populated or referenced by application code — a stale bit from
earlier planning. This migration drops it and recreates the table in
the heartbeat shape from the plan.

New shape:
- `category` distinguishes pm_preference / domain_fact / workflow_pattern
  / anti_pattern so the orchestrator can tier context loading by type.
- `content_key` is the dedup handle: repeat emissions of the same
  insight bump `reference_count` + `last_relevant_at` instead of
  creating a second row. UPSERT pattern mirrors relationships.
- `status` = transient | promoted | dismissed. Promotion happens when
  a PM explicitly confirms OR reference_count crosses a threshold.
- `evidence_quote` + `evidence_doc_id` let the agent cite WHY the
  learning exists, same as relationships.

Existing data: the pre-heartbeat `learnings` table had zero rows
across all projects at the time of this migration. A safer migration
would rename + migrate; we're doing a clean drop because there's
nothing to migrate and the column shape is fundamentally different.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

revision: str = "034_learnings_inbox"
down_revision: Union[str, None] = "033_sessions_and_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop the old scaffolding table and any indexes it left behind.
    op.drop_table("learnings")

    op.create_table(
        "learnings",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        # project_id nullable — NULL means a global learning that
        # applies across every project (e.g. "this PM prefers terse
        # commit messages"). Project-scoped by default.
        sa.Column("project_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"),
                  nullable=True),
        sa.Column("origin_session_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("sessions.id", ondelete="SET NULL"),
                  nullable=True),

        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("content", sa.Text, nullable=False),

        # Dedup key — normalized `content` (lowercased, whitespace-
        # collapsed) so repeat emissions of the same insight upsert
        # instead of duplicating. Kept explicit rather than derived
        # so the UNIQUE index works without function-based constraints.
        sa.Column("content_key", sa.String(256), nullable=False),

        sa.Column("evidence_quote", sa.Text, nullable=True),
        sa.Column("evidence_doc_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("documents.id", ondelete="SET NULL"),
                  nullable=True),

        sa.Column("status", sa.String(16), nullable=False,
                  server_default="transient"),
        sa.Column("reference_count", sa.Integer, nullable=False,
                  server_default="1"),
        sa.Column("last_relevant_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),

        sa.Column("promoted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("promoted_by", PGUUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dismissed_by", PGUUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),

        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),

        # Dedup — one row per (project, category, normalized_content).
        # project_id NULL collapses to the "global" namespace naturally
        # because (NULL, foo, bar) matches another (NULL, foo, bar) in
        # Postgres NULLS NOT DISTINCT UNIQUE semantics (set below).
        sa.UniqueConstraint("project_id", "category", "content_key",
                            name="uq_learnings_dedup",
                            postgresql_nulls_not_distinct=True),
    )

    # Hot-read index: session-start loads top-N active learnings for a
    # project. Status filter + last_relevant_at DESC covers it.
    op.create_index(
        "idx_learnings_active_recent",
        "learnings",
        ["project_id", "last_relevant_at"],
        postgresql_where=sa.text("status IN ('transient', 'promoted')"),
    )
    # Category filter is the second-most-common query shape
    # ("show me every anti_pattern").
    op.create_index(
        "idx_learnings_by_category",
        "learnings",
        ["category", "status"],
    )


def downgrade() -> None:
    op.drop_index("idx_learnings_by_category", table_name="learnings")
    op.drop_index("idx_learnings_active_recent", table_name="learnings")
    op.drop_table("learnings")

    # Recreate the pre-heartbeat shape so downgrade gets a working
    # (if unused) table back. Intentionally minimal — we're not
    # restoring rows, just schema shape.
    op.create_table(
        "learnings",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("skill", sa.String, nullable=False),
        sa.Column("type", sa.String, nullable=False),
        sa.Column("key", sa.String, nullable=False),
        sa.Column("insight", sa.Text, nullable=False),
        sa.Column("confidence", sa.Integer, nullable=False),
        sa.Column("source", sa.String, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "key", "type"),
    )
