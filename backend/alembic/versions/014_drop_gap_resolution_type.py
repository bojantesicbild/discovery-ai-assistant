"""Drop resolution_type column from gaps

Revision ID: 014_drop_resolution_type
Revises: 013_req_acceptance_criteria
Create Date: 2026-04-17

Reverts migration 012. The classification (auto_resolve / ask_client /
ask_po) is redundant with the gap's open/resolved status — an open gap
is a gap the user will either resolve themselves or add to the meeting
agenda; a resolved gap is done. The agent's gap-analysis report keeps
those categories as markdown sections, but we don't need them as a
structured column.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "014_drop_resolution_type"
down_revision: Union[str, None] = "013_req_acceptance_criteria"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("gaps", "resolution_type")


def downgrade() -> None:
    op.add_column(
        "gaps",
        sa.Column("resolution_type", sa.String(), nullable=True),
    )
