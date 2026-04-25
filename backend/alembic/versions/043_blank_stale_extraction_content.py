"""Blank content on stale extraction_running messages.

Revision ID: 043_blank_stale_extraction
Revises: 042_conversation_messages
Create Date: 2026-04-25

Until 042 the extraction pipeline shipped its placeholder with
`content: "📄 Extracting findings from <file>…"` already populated. The
frontend now uses an empty-content + ghost-UI pattern for in-flight
runs, so any pre-existing rows still carrying that legacy text would
fall back to the old text-bubble render instead of the ghost. This
migration clears `content` on every `kind='extraction_running'` row in
both storage layers so the ghost UI activates on the next reload:

  - conversation_messages  (the cursor-paginated rows from 042)
  - conversations.messages (the rolling JSONB list still used by Slack
    listener / reminder delivery / consume_unseen scans)

Filter is intentionally tight (kind='extraction_running' AND
_processing flag still on) so we don't accidentally wipe finished
extraction summaries — those have kind='extraction_done' with the
real summary in content.

Downgrade is a no-op because we cannot reconstruct the original
filename-templated text without knowing the doc filename per row.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "043_blank_stale_extraction"
down_revision: Union[str, None] = "042_conversation_messages"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1) conversation_messages — typed columns make this a simple UPDATE.
    #    Patch both the column and the mirrored payload->>content so the
    #    two never drift. Reminder prep gets the same treatment because
    #    its placeholder used to ship with a "render_reminder_card(...)"
    #    body that's now expected to be empty + ghost-rendered.
    bind.execute(
        sa.text(
            """
            UPDATE conversation_messages
            SET
                content = '',
                payload = jsonb_set(payload, '{content}', '""'::jsonb, true)
            WHERE kind IN ('extraction_running', 'reminder_prep')
            """
        )
    )

    # 2) conversations.messages — JSONB list, walked element-wise. Use a
    #    set-returning subquery so we rebuild the array in place. Only
    #    touch entries whose kind is in-flight (extraction_running OR
    #    reminder_prep) AND _processing is true; finished rows stay as-is.
    bind.execute(
        sa.text(
            """
            UPDATE conversations c
            SET messages = (
                SELECT COALESCE(jsonb_agg(
                    CASE
                        WHEN msg->>'kind' IN ('extraction_running', 'reminder_prep')
                             AND COALESCE((msg->>'_processing')::boolean, false) = true
                        THEN jsonb_set(msg, '{content}', '""'::jsonb, true)
                        ELSE msg
                    END
                    ORDER BY ord
                ), '[]'::jsonb)
                FROM jsonb_array_elements(c.messages) WITH ORDINALITY AS t(msg, ord)
            )
            WHERE jsonb_typeof(c.messages) = 'array'
              AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements(c.messages) AS m(msg)
                  WHERE m.msg->>'kind' IN ('extraction_running', 'reminder_prep')
              )
            """
        )
    )


def downgrade() -> None:
    # Cannot restore the original "📄 Extracting findings from <file>…"
    # text without per-row knowledge of doc.filename, so this is a no-op.
    pass
