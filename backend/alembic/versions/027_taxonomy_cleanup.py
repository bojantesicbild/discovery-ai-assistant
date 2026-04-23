"""Taxonomy cleanup: drop decisions/scope/assumptions, enrich BR, add gap.kind.

Revision ID: 027_taxonomy_cleanup
Revises: 026_contradiction_sources
Create Date: 2026-04-22

Bundles three data-layer changes into one step so the system never sits
half-migrated:

1. Adds four optional fields to requirements so BR can absorb information
   that previously lived in decision / scope / assumption rows:
     - rationale                 (text)  — why this BR over alternatives
     - alternatives_considered   (jsonb) — ["option — reason rejected", ...]
     - scope_note                (string) — "MVP only", "iOS app only"
     - blocked_by                (jsonb) — ["BR-001", ...] for Phase-2 ordering

2. Adds gaps.kind — absorbs "unvalidated assumption" and "undecided"
   framings that used to warrant their own tables. Default 'missing_info'
   preserves existing semantics for all rows written before this migration.

3. Drops decisions, scope_items, assumptions entirely. No row migration —
   user confirmed the three kinds carry low signal in practice and any
   salvageable content migrates forward manually into BR.rationale /
   constraints / gap.kind. Cleans up finding_views + change_history rows
   that would otherwise point at deleted tables.

Downgrade re-creates empty tables with the same shape they had after
migration 009 (with sources / version / updated_at). Data is NOT restored.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "027_taxonomy_cleanup"
down_revision: Union[str, None] = "026_contradiction_sources"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Requirements — four new optional fields.
    op.add_column("requirements", sa.Column("rationale", sa.Text(), nullable=True))
    op.add_column(
        "requirements",
        sa.Column("alternatives_considered", JSONB, nullable=False, server_default="[]"),
    )
    op.add_column("requirements", sa.Column("scope_note", sa.String(), nullable=True))
    op.add_column(
        "requirements",
        sa.Column("blocked_by", JSONB, nullable=False, server_default="[]"),
    )

    # 2. Gaps — kind column (app-level enum; no DB check constraint so
    # new values can be added without a migration).
    op.add_column(
        "gaps",
        sa.Column("kind", sa.String(), nullable=False, server_default="missing_info"),
    )

    # 3. Drop the three taxonomy tables. Clean up orphan rows in
    # finding_views / change_history first so nothing dangles.
    op.execute(
        "DELETE FROM finding_views WHERE finding_type IN ('decision', 'scope', 'assumption')"
    )
    op.execute(
        "DELETE FROM change_history WHERE item_type IN ('decision', 'scope', 'assumption')"
    )
    op.drop_table("assumptions")
    op.drop_table("scope_items")
    op.drop_table("decisions")


def downgrade() -> None:
    # Re-create the three tables with their post-009 shape. Empty — no
    # data is restored. Column order matches the original CREATE TABLEs
    # so schema diffs stay clean.
    op.create_table(
        "decisions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("decided_by", sa.String, nullable=True),
        sa.Column("decided_date", sa.Date, nullable=True),
        sa.Column("rationale", sa.Text, nullable=False),
        sa.Column("alternatives", JSONB, server_default="[]"),
        sa.Column("impacts", JSONB, server_default="[]"),
        sa.Column(
            "source_doc_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents.id"),
            nullable=True,
        ),
        sa.Column("status", sa.String, server_default="tentative"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("sources", JSONB, nullable=False, server_default="[]"),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_table(
        "scope_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("in_scope", sa.Boolean, nullable=False),
        sa.Column("rationale", sa.Text, nullable=False),
        sa.Column(
            "source_doc_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("sources", JSONB, nullable=False, server_default="[]"),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_table(
        "assumptions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column("statement", sa.Text, nullable=False),
        sa.Column("basis", sa.Text, nullable=False),
        sa.Column("risk_if_wrong", sa.Text, nullable=False),
        sa.Column("needs_validation_by", sa.String, nullable=True),
        sa.Column("validated", sa.Boolean, server_default=sa.false()),
        sa.Column(
            "source_doc_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("sources", JSONB, nullable=False, server_default="[]"),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.drop_column("gaps", "kind")

    op.drop_column("requirements", "blocked_by")
    op.drop_column("requirements", "scope_note")
    op.drop_column("requirements", "alternatives_considered")
    op.drop_column("requirements", "rationale")
