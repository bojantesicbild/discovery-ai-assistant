"""Tech-Story domain — initial tables.

Revision ID: 045_tech_story_init
Revises: 044_proposed_updates_target_kind
Create Date: 2026-05-05

Adds the thin DB index for the Phase 2 tech-story chain. Content lives
in vault markdown files (`docs/tech-docs/*.md` and PBI story files,
written by `story-tech-agent` / `story-story-agent`); these tables only
record the metadata the web UI needs to render the list view, navigate
between TD and US, and link back to source BRs.

Why two tables instead of a polymorphic one: TD-as-container-of-US is a
real hierarchy (every story belongs to exactly one tech doc), and the
two have meaningfully different fields (acceptance_criteria only on US,
no parent on TD). Splitting keeps queries trivial and each row ~half
the width of a polymorphic union.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "045_tech_story_init"
down_revision: Union[str, None] = "044_proposed_updates_target_kind"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tech_docs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column("td_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("file_path", sa.String(), nullable=True),
        sa.Column(
            "source_brs",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "status", sa.String(), nullable=False, server_default="draft"
        ),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "project_id", "td_id", name="uq_tech_docs_project_td"
        ),
    )

    op.create_table(
        "stories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column(
            "tech_doc_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tech_docs.id"),
            nullable=False,
        ),
        sa.Column("us_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("file_path", sa.String(), nullable=True),
        sa.Column(
            "source_brs",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "acceptance_criteria",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "status", sa.String(), nullable=False, server_default="todo"
        ),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("project_id", "us_id", name="uq_stories_project_us"),
    )
    op.create_index(
        "ix_stories_tech_doc_id", "stories", ["tech_doc_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_stories_tech_doc_id", table_name="stories")
    op.drop_table("stories")
    op.drop_table("tech_docs")
