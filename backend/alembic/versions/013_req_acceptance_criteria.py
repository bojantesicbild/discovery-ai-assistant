"""Add acceptance_criteria column to requirements

Revision ID: 013_req_acceptance_criteria
Revises: 012_gap_resolution_type
Create Date: 2026-04-17
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "013_req_acceptance_criteria"
down_revision: Union[str, None] = "012_gap_resolution_type"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "requirements",
        sa.Column(
            "acceptance_criteria",
            JSONB(),
            nullable=False,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("requirements", "acceptance_criteria")
