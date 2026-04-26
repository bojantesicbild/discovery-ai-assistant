"""Proposed updates: per-kind target dispatch.

Revision ID: 044_proposed_updates_target_kind
Revises: 043_blank_stale_extraction
Create Date: 2026-04-26

Until now `propose_update` only worked on requirements — every staged
proposal pointed at a BR-NNN via `target_req_id`. Stakeholders,
constraints, gaps, and contradictions had no equivalent flow, so a
follow-up document carrying a corrected role_title or a refined
cost_if_kept had nowhere to land. The agent had to drop the change.

This migration generalizes the table:

  target_kind  TEXT  — 'requirement' | 'stakeholder' | 'constraint'
                       | 'gap' | 'contradiction'

The legacy `target_req_id` column stays as the polymorphic display id
column — it now carries:
  - BR-NNN  for requirements (existing behavior)
  - the stakeholder name for stakeholders
  - CON-NNN for constraints
  - GAP-NNN for gaps
  - CTR-NNN for contradictions

Renaming the column would mean coordinating ~30 call sites for no
behavioural gain; the docstring + new `target_kind` discriminator carry
the meaning. Existing rows are backfilled with `target_kind='requirement'`
so the BR review portal flow keeps working unchanged.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "044_proposed_updates_target_kind"
down_revision: Union[str, None] = "043_blank_stale_extraction"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "proposed_updates",
        sa.Column(
            "target_kind",
            sa.String(length=32),
            nullable=False,
            server_default="requirement",
        ),
    )
    # Drop the server-side default once the backfill has happened — the
    # caller (MCP propose_update) now sets the column explicitly. Keeping
    # the default on disk would silently mask a missed insert path.
    op.alter_column("proposed_updates", "target_kind", server_default=None)
    # Pagination/filtering use (project_id, target_kind, target_req_id)
    # together. The composite index keeps "show all pending stakeholder
    # proposals for project X" a single index seek.
    op.create_index(
        "ix_proposed_updates_proj_kind_target",
        "proposed_updates",
        ["project_id", "target_kind", "target_req_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_proposed_updates_proj_kind_target", table_name="proposed_updates")
    op.drop_column("proposed_updates", "target_kind")
