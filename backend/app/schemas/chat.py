from pydantic import BaseModel


class ChatMessage(BaseModel):
    text: str
    attachments: list[str] = []  # file paths or references
    # Optional model override per turn. Maps to the Claude Code --model
    # flag; --resume keeps the session_id so swapping models mid-thread
    # continues the same conversation. Falls back to a server default
    # when unset (e.g. saved sessions, Slack inbound).
    model: str | None = None


class ChatResponse(BaseModel):
    response: str
    sources: list[dict] = []
    tool_calls: list[dict] = []
