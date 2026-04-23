"""Contradictions: per-side source / person columns.

Revision ID: 026_contradiction_sources
Revises: 025_contradiction_fields
Create Date: 2026-04-22

025 gave contradictions first-class two-sided content (side_a / side_b).
This migration adds provenance PER SIDE:
  - side_a_source  (document filename or reference the side_a came from)
  - side_a_person  (person who said / holds side_a)
  - side_b_source / side_b_person — same for side_b

The UI already renders source-chip and person-chip slots for each side;
they've just been empty because the schema had no place to put the data.
Extraction agent will start filling these when it emits the contradiction.

No backfill — legacy rows stay NULL. Agent-written rows from now on will
carry sources. Four nullable columns, purely additive, zero risk.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "026_contradiction_sources"
down_revision: Union[str, None] = "025_contradiction_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("contradictions", sa.Column("side_a_source", sa.String(), nullable=True))
    op.add_column("contradictions", sa.Column("side_a_person", sa.String(), nullable=True))
    op.add_column("contradictions", sa.Column("side_b_source", sa.String(), nullable=True))
    op.add_column("contradictions", sa.Column("side_b_person", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("contradictions", "side_b_person")
    op.drop_column("contradictions", "side_b_source")
    op.drop_column("contradictions", "side_a_person")
    op.drop_column("contradictions", "side_a_source")
