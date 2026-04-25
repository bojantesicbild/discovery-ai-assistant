"""Contradiction descriptive context: impact_summary + resolution_options.

Revision ID: 040_ctr_descriptive
Revises: 039_con_negotiation
Create Date: 2026-04-25

A contradiction doc today says what the two sides are + who said
what. The PM staring at it has to infer:
  - what's BLOCKED if no one decides
  - what concrete paths exist to resolve it

Migration 040 surfaces those as structured fields:

  impact_summary      TEXT   — what's at stake / consequences if unresolved
  resolution_options  JSONB  — list of paths, each "<option> — <pros / cons>"

Both nullable so existing rows keep rendering with the side_a / side_b
shape until they're re-extracted or backfilled.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "040_ctr_descriptive"
down_revision: Union[str, None] = "039_con_negotiation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "contradictions",
        sa.Column("impact_summary", sa.Text(), nullable=True),
    )
    op.add_column(
        "contradictions",
        sa.Column(
            "resolution_options",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("contradictions", "resolution_options")
    op.drop_column("contradictions", "impact_summary")
