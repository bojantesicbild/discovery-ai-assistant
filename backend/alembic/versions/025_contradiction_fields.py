"""Contradictions: first-class title / side_a / side_b / area fields.

Revision ID: 025_contradiction_fields
Revises: 023_reminder_output_kind
Create Date: 2026-04-22

Rebalances the contradictions schema for how the discovery-extraction-agent
actually produces them — as free-form two-sided disagreements with a short
headline (e.g. "MVP handoff docs: David says 2, Sarah says 3") rather than
pointer-style FKs to two existing requirements.

The legacy shape (item_a_type / item_a_id / item_b_type / item_b_id) was
designed around a dedup pipeline that compared new extractions to existing
DB rows and emitted references. We deleted that pipeline in Session 1, and
the agent writes free-form content, so the MCP handler was papering over
the mismatch by stuffing the literal string 'unknown' and random UUIDs
into those columns. That cascaded into "New unknown (from uploaded document)"
showing up as every contradiction's title in the UI.

Migration:
- Add title / side_a / side_b / area columns (all nullable).
- Make legacy item_a_*/item_b_* columns nullable — still populated when
  the agent genuinely maps to existing rows (rare in practice) but not
  required.
- Backfill: for rows where item_a_type='unknown' (the broken ones), split
  existing `explanation` at the first colon into title + side_b. side_a
  left NULL — we can't recover what the pre-conflict state was from the
  placeholder data. Consumers already tolerate a NULL side_a.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "025_contradiction_fields"
down_revision: Union[str, None] = "023_reminder_output_kind"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("contradictions", sa.Column("title", sa.String(), nullable=True))
    op.add_column("contradictions", sa.Column("side_a", sa.Text(), nullable=True))
    op.add_column("contradictions", sa.Column("side_b", sa.Text(), nullable=True))
    op.add_column("contradictions", sa.Column("area", sa.String(), nullable=True))

    # Legacy pointer columns become optional — only populated when the
    # agent maps to real DB rows (rare, non-default path).
    op.alter_column("contradictions", "item_a_type", nullable=True)
    op.alter_column("contradictions", "item_a_id", nullable=True)
    op.alter_column("contradictions", "item_b_type", nullable=True)
    op.alter_column("contradictions", "item_b_id", nullable=True)
    op.alter_column("contradictions", "explanation", nullable=True)

    # Backfill broken rows (item_a_type='unknown') from the explanation
    # string. Title = everything before the first ':' (bounded to 80
    # chars to avoid full-sentence explanations). side_b = the body after.
    op.execute("""
        UPDATE contradictions
        SET title  = TRIM(SUBSTRING(explanation FROM 1 FOR POSITION(':' IN explanation) - 1)),
            side_b = TRIM(SUBSTRING(explanation FROM POSITION(':' IN explanation) + 1))
        WHERE title IS NULL
          AND item_a_type = 'unknown'
          AND explanation IS NOT NULL
          AND POSITION(':' IN explanation) BETWEEN 1 AND 80;
    """)
    # Rows with no colon in explanation: whole thing is the title.
    op.execute("""
        UPDATE contradictions
        SET title = SUBSTRING(explanation FROM 1 FOR 80)
        WHERE title IS NULL
          AND item_a_type = 'unknown'
          AND explanation IS NOT NULL;
    """)
    # Null out the placeholder legacy fields for the same rows so the
    # UI stops showing 'unknown' and doesn't try to resolve fake UUIDs.
    op.execute("""
        UPDATE contradictions
        SET item_a_type = NULL, item_a_id = NULL,
            item_b_type = NULL, item_b_id = NULL
        WHERE item_a_type = 'unknown';
    """)


def downgrade() -> None:
    # Undo schema additions. The backfilled title/side_b data is lost —
    # acceptable for a downgrade of a data-cleanup migration.
    op.alter_column("contradictions", "explanation", nullable=False)
    op.alter_column("contradictions", "item_b_id", nullable=False)
    op.alter_column("contradictions", "item_b_type", nullable=False)
    op.alter_column("contradictions", "item_a_id", nullable=False)
    op.alter_column("contradictions", "item_a_type", nullable=False)
    op.drop_column("contradictions", "area")
    op.drop_column("contradictions", "side_b")
    op.drop_column("contradictions", "side_a")
    op.drop_column("contradictions", "title")
