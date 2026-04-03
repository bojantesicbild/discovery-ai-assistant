from pydantic import BaseModel
from typing import Optional


class ChatMessage(BaseModel):
    text: str
    attachments: list[str] = []  # file paths or references


class ChatResponse(BaseModel):
    response: str
    sources: list[dict] = []
    tool_calls: list[dict] = []
