"""Gap descriptive fields: impact_summary + validation_plan + assumed_default + options.

Revision ID: 038_gap_descriptive_fields
Revises: 037_stakeholder_structured
Create Date: 2026-04-25

A gap doc today is mostly a question + source quote. The PM has to read
the quote, infer impact, infer next steps. Migration 038 adds four
descriptive fields so the doc itself answers:

  - Why does this matter?     →  impact_summary (text)
  - What's the assumption?    →  assumed_default (text, only for kind=unvalidated_assumption)
  - What choices are open?    →  options (jsonb list, only for kind=undecided)
  - What do I do about it?    →  validation_plan (jsonb list)

The legacy `suggested_action` column stays — same intent as
validation_plan but unstructured. Renderer prefers validation_plan
when both are populated.

All new columns nullable so existing rows keep rendering with the old
shape until they're re-extracted or backfilled.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "038_gap_descriptive_fields"
down_revision: Union[str, None] = "037_stakeholder_structured"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "gaps",
        sa.Column("impact_summary", sa.Text(), nullable=True),
    )
    op.add_column(
        "gaps",
        sa.Column(
            "validation_plan",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "gaps",
        sa.Column("assumed_default", sa.Text(), nullable=True),
    )
    op.add_column(
        "gaps",
        sa.Column(
            "options",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("gaps", "options")
    op.drop_column("gaps", "assumed_default")
    op.drop_column("gaps", "validation_plan")
    op.drop_column("gaps", "impact_summary")
