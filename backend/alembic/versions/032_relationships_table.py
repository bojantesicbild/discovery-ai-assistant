"""Relationships as first-class entities.

Revision ID: 032_relationships_table
Revises: 031_restore_conversations
Create Date: 2026-04-23

Phase 1 of the session-heartbeat architecture (see
docs/research/2026-04-23-session-heartbeat-plan.md).

Creates a single typed edge table to replace per-kind list columns
(`gap.blocked_reqs`, `requirement.blocked_by`, `constraint.affects_reqs`,
etc.). Every relationship in the product becomes one row with
provenance, confidence, and lifecycle attached.

Key design decisions:
- UUID endpoints so renaming BR-004 never shatters edges.
- `confidence` enum (explicit / derived / proposed) lets the UI tier
  presentation by trust and lets the agent cite source strength.
- `created_by` enum identifies which subsystem emitted the row;
  disagreement between subsystems becomes visible data instead of an
  overwrite.
- `status='retracted'` instead of DELETE so rejection reasons feed the
  learning loop built in migration 030.
- UPSERT dedup key `(project_id, from_uuid, to_uuid, rel_type,
  created_by)` — re-proposing the same edge bumps `last_seen_at`
  rather than creating duplicates.
- Partial indexes gated on `status = 'active'` keep hot reads fast.

Existing columns (blocked_reqs, blocked_by, affects_reqs) are NOT
dropped yet — the Phase 1 rollout dual-writes so we can verify before
cutting over. See Phase 6 of the plan for the column removal migration.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID, ENUM as PGENUM

revision: str = "032_relationships_table"
down_revision: Union[str, None] = "031_restore_conversations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Enum values are hard-coded here instead of referencing Python constants
# so the migration is self-contained and replayable without the app.
_CONFIDENCE = ("explicit", "derived", "proposed")
_SOURCE = ("extraction", "propose_update", "human", "graph_parser", "review_portal")


def upgrade() -> None:
    # Create the enums explicitly so the column-level references below
    # can pass create_type=False cleanly (otherwise SQLAlchemy tries to
    # create them again as a side-effect of the column declaration).
    confidence_enum = PGENUM(*_CONFIDENCE, name="rel_confidence", create_type=False)
    source_enum = PGENUM(*_SOURCE, name="rel_source", create_type=False)

    op.execute(f"CREATE TYPE rel_confidence AS ENUM {_CONFIDENCE!r}")
    op.execute(f"CREATE TYPE rel_source AS ENUM {_SOURCE!r}")

    op.create_table(
        "relationships",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"),
                  nullable=False),

        # endpoints — UUIDs so renames never break edges
        sa.Column("from_type", sa.String(32), nullable=False),
        sa.Column("from_uuid", PGUUID(as_uuid=True), nullable=False),
        sa.Column("to_type", sa.String(32), nullable=False),
        sa.Column("to_uuid", PGUUID(as_uuid=True), nullable=False),

        sa.Column("rel_type", sa.String(32), nullable=False),

        # Postgres ENUMs — catch agent typos at INSERT, not at PM frustration
        sa.Column("confidence", confidence_enum, nullable=False),
        sa.Column("created_by", source_enum, nullable=False),

        # provenance lives on the row — no joins needed to answer "why"
        sa.Column("source_doc_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("documents.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("source_quote", sa.Text, nullable=True),
        sa.Column("rationale", sa.Text, nullable=True),
        sa.Column("created_by_user", PGUUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),

        # lifecycle — retract, don't destroy
        sa.Column("status", sa.String(16), nullable=False,
                  server_default="active"),
        sa.Column("retracted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("retracted_by", PGUUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("retraction_reason", sa.Text, nullable=True),

        # dedup — one row per (endpoints, rel_type, created_by)
        # so extraction_agent and graph_parser can hold independent
        # opinions on the same edge without stomping each other.
        sa.UniqueConstraint("project_id", "from_uuid", "to_uuid",
                            "rel_type", "created_by",
                            name="uq_relationships_endpoints"),
    )

    # Partial indexes tuned for the common query shapes:
    # "who does X point to?" and "who points to X?". Gated on active
    # status so retracted edges don't pollute hot reads.
    op.create_index(
        "idx_rel_from_active",
        "relationships",
        ["project_id", "from_uuid"],
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_index(
        "idx_rel_to_active",
        "relationships",
        ["project_id", "to_uuid"],
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_index(
        "idx_rel_type_active",
        "relationships",
        ["project_id", "rel_type"],
        postgresql_where=sa.text("status = 'active'"),
    )


def downgrade() -> None:
    op.drop_index("idx_rel_type_active", table_name="relationships")
    op.drop_index("idx_rel_to_active", table_name="relationships")
    op.drop_index("idx_rel_from_active", table_name="relationships")
    op.drop_table("relationships")
    op.execute("DROP TYPE rel_source")
    op.execute("DROP TYPE rel_confidence")
