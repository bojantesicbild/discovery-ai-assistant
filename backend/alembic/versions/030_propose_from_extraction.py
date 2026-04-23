"""Generalize proposed_updates so the extraction agent can stage
re-extraction deltas, not just gap-answer deltas.

Revision ID: 030_propose_from_extraction
Revises: 029_constraint_fields
Create Date: 2026-04-23

Until now a ProposedUpdate always belonged to a gap answer (Review
portal flow). When the pipeline re-extracts a document and finds new
info on an existing BR, there's no gap — the source is the document
itself. This migration widens the shape:

- source_gap_id → nullable. Extraction-driven proposals leave it NULL
  and set source_doc_id instead.
- source_doc_id (new, nullable FK to documents) — UUID of the doc
  whose extraction produced this proposal.
- source_person (new, nullable string) — stakeholder quoted in the doc.
- rejection_reason (new, nullable text) — free-text "why the PM said no"
  captured by the reject endpoint. Feeds the learning layer (future work)
  that surfaces past rejections to the next extraction run so the agent
  stops re-proposing the same pattern.

Existing rows keep their shape — nothing backfilled, nothing lost.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

revision: str = "030_propose_from_extraction"
down_revision: Union[str, None] = "029_constraint_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Loosen the gap requirement.
    op.alter_column(
        "proposed_updates",
        "source_gap_id",
        existing_type=sa.String(),
        nullable=True,
    )
    # Extraction-driven provenance.
    op.add_column(
        "proposed_updates",
        sa.Column(
            "source_doc_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "proposed_updates",
        sa.Column("source_person", sa.String(), nullable=True),
    )
    # Rejection learning signal.
    op.add_column(
        "proposed_updates",
        sa.Column("rejection_reason", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("proposed_updates", "rejection_reason")
    op.drop_column("proposed_updates", "source_person")
    op.drop_column("proposed_updates", "source_doc_id")
    # Restore NOT NULL — this will fail if extraction-driven rows exist
    # with source_gap_id NULL, which is the intended behavior on downgrade
    # (you can't go back without data loss).
    op.alter_column(
        "proposed_updates",
        "source_gap_id",
        existing_type=sa.String(),
        nullable=False,
    )
