"""Constraint negotiation context: cost_if_kept + workaround_options + renegotiation_path.

Revision ID: 039_con_negotiation
Revises: 038_gap_descriptive_fields
Create Date: 2026-04-25

A constraint doc today says what the rule is + how it technically
limits the project. The PM staring at it has to infer:
  - what's the BUSINESS cost of accepting it
  - what alternatives were considered
  - what it'd take to change it

Migration 039 surfaces those as structured fields:

  cost_if_kept        TEXT   — business cost of acceptance
  workaround_options  JSONB  — list of options considered (each entry:
                                "<option> — <pros / cons or why rejected>").
                                Replaces the single `workaround` text.
  renegotiation_path  TEXT   — what changing the constraint takes
                                (who, lead time, cost, conditions). Most
                                actionable when status ∈ {assumed, negotiable}.

Legacy `workaround` column stays — same intent as workaround_options
but unstructured. Renderer prefers workaround_options when both are
populated.

All new columns nullable so existing rows keep rendering with the old
shape until they're re-extracted or backfilled.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "039_con_negotiation"
down_revision: Union[str, None] = "038_gap_descriptive_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "constraints",
        sa.Column("cost_if_kept", sa.Text(), nullable=True),
    )
    op.add_column(
        "constraints",
        sa.Column(
            "workaround_options",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "constraints",
        sa.Column("renegotiation_path", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("constraints", "renegotiation_path")
    op.drop_column("constraints", "workaround_options")
    op.drop_column("constraints", "cost_if_kept")
