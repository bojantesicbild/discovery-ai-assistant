"""Stakeholder concerns: present-tense risks the person has voiced.

Revision ID: 041_stk_concerns
Revises: 040_ctr_descriptive
Create Date: 2026-04-25

Stakeholder docs today carry decisions (past) + interests (ongoing
themes) + role. The PM prepping for a meeting still has to scan the
whole vault to figure out what's currently bothering the person.

Migration 041 adds:

  concerns  JSONB  — list of risks/worries the person has voiced.
                     Each entry shaped "<topic> — <what they said>".

Nullable; existing rows render unchanged until re-extracted.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "041_stk_concerns"
down_revision: Union[str, None] = "040_ctr_descriptive"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "stakeholders",
        sa.Column(
            "concerns",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("stakeholders", "concerns")
