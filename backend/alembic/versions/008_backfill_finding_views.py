"""Backfill: mark all existing findings as seen for all project members.

Revision ID: 008_backfill_finding_views
Revises: 007_finding_views
Create Date: 2026-04-08

This is the quiet rollout strategy. Without it, every existing requirement,
gap, constraint, etc. would appear as "unread" the moment users open the
app after the deploy — burying them with hundreds of false alerts.

Instead, we treat the moment of deploy as the "everything has been seen"
baseline. New findings ingested after deploy start unread normally.
"""
from typing import Sequence, Union
from alembic import op

revision: str = "008_backfill_finding_views"
down_revision: Union[str, None] = "007_finding_views"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Each tuple is (finding_type, source_table). Order doesn't matter; the
# inserts are independent.
_FINDING_SOURCES = [
    ("requirement", "requirements"),
    ("gap", "gaps"),
    ("constraint", "constraints"),
    ("decision", "decisions"),
    ("contradiction", "contradictions"),
    ("assumption", "assumptions"),
    ("scope", "scope_items"),
    ("stakeholder", "stakeholders"),
]


def upgrade() -> None:
    # For each project member, insert one finding_views row per finding in
    # their project. ON CONFLICT DO NOTHING handles the case where this
    # migration is run twice (defensive — should not happen).
    for finding_type, source_table in _FINDING_SOURCES:
        op.execute(f"""
            INSERT INTO finding_views (
                id, user_id, project_id, finding_type, finding_id,
                seen_at, seen_version, created_at, updated_at
            )
            SELECT
                gen_random_uuid(),
                pm.user_id,
                f.project_id,
                '{finding_type}',
                f.id,
                NOW(),
                1,
                NOW(),
                NOW()
            FROM {source_table} f
            JOIN project_members pm ON pm.project_id = f.project_id
            ON CONFLICT (user_id, finding_type, finding_id) DO NOTHING;
        """)


def downgrade() -> None:
    # Remove only the rows that were created by this backfill (we can't
    # distinguish them precisely from later writes, so the safest down is
    # a no-op — drop the whole table via 007's downgrade if needed).
    pass
