"""API tokens — personal access tokens for MCP + CLI auth.

Revision ID: 035_api_tokens
Revises: 034_learnings_inbox
Create Date: 2026-04-24

Multi-user stage 1. Tokens let users authenticate the MCP subprocess
(whether spawned by the backend on their behalf or launched from a
terminal session) without baking credentials into .mcp.json.

Design:
- token_hash only. Plaintext shown ONCE at creation, never again. If
  the user loses the token they create a new one.
- Prefix 'dsc_' on plaintext so log scanners / secret-detection tools
  can redact them reliably. The prefix is NOT stored — only the hash
  of the full plaintext.
- Revocation is a nullable `revoked_at` timestamp. We don't hard
  delete; audit trail matters when tokens misbehave.
- Partial UNIQUE on token_hash WHERE revoked_at IS NULL so a revoked
  token's hash can be re-used (defensive — collisions are astronomically
  unlikely given 32 random bytes, but revoked + fresh should never
  alias).
- last_used_at bumped by the verify endpoint. Cheap signal for "is
  this token still in use" when a PM wants to prune old ones.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "035_api_tokens"
down_revision: Union[str, None] = "034_learnings_inbox"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "api_tokens",
        sa.Column(
            "id", sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True, server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id", sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("token_hash", sa.String(128), nullable=False),
        sa.Column("scopes", sa.dialects.postgresql.JSONB, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Lookup path: the verify endpoint hashes the incoming plaintext and
    # queries by hash. Partial-unique WHERE revoked_at IS NULL so revoked
    # rows can coexist without blocking fresh tokens.
    op.create_index(
        "uq_api_tokens_hash_active",
        "api_tokens", ["token_hash"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index(
        "ix_api_tokens_user", "api_tokens", ["user_id", "revoked_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_api_tokens_user", table_name="api_tokens")
    op.drop_index("uq_api_tokens_hash_active", table_name="api_tokens")
    op.drop_table("api_tokens")
