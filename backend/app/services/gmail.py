"""Minimal Gmail REST API client.

Uses a stored refresh_token (from the OAuth flow) to mint short-lived access
tokens, then calls Gmail's REST API directly. No google-api-python-client
dependency — keeps things lean and matches the rest of our service modules
(see github.py).
"""

import base64
from typing import Optional

import httpx
import structlog

from app.config import settings

log = structlog.get_logger()

GMAIL_API = "https://gmail.googleapis.com/gmail/v1"
TOKEN_URL = "https://oauth2.googleapis.com/token"


async def get_access_token(refresh_token: str) -> str:
    """Exchange a refresh_token for a short-lived access_token."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            TOKEN_URL,
            data={
                "client_id": settings.google_oauth_client_id,
                "client_secret": settings.google_oauth_client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


async def list_messages(
    access_token: str,
    query: Optional[str] = None,
    max_results: int = 25,
) -> list[dict]:
    """List recent messages matching the Gmail search query.

    `query` follows the same syntax as Gmail's search box, e.g.
        "from:acme.com newer_than:30d"
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    params: dict = {"maxResults": max_results}
    if query:
        params["q"] = query

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{GMAIL_API}/users/me/messages",
            params=params,
            headers=headers,
        )
        resp.raise_for_status()
        ids = [m["id"] for m in resp.json().get("messages", [])]

        # Fetch metadata for each (subject, from, snippet, date)
        results = []
        for mid in ids:
            mr = await client.get(
                f"{GMAIL_API}/users/me/messages/{mid}",
                params={"format": "metadata", "metadataHeaders": ["From", "Subject", "Date", "To"]},
                headers=headers,
            )
            if mr.status_code != 200:
                continue
            data = mr.json()
            headers_map = {h["name"]: h["value"] for h in data.get("payload", {}).get("headers", [])}
            results.append({
                "id": mid,
                "thread_id": data.get("threadId"),
                "from": headers_map.get("From", ""),
                "to": headers_map.get("To", ""),
                "subject": headers_map.get("Subject", "(no subject)"),
                "date": headers_map.get("Date", ""),
                "snippet": data.get("snippet", ""),
                "label_ids": data.get("labelIds", []),
            })
        return results


async def get_message_full(access_token: str, message_id: str) -> dict:
    """Fetch a full message including body."""
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{GMAIL_API}/users/me/messages/{message_id}",
            params={"format": "full"},
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json()


def extract_body_text(message: dict) -> str:
    """Walk a Gmail message payload tree and return the best plain-text body."""
    payload = message.get("payload", {})

    def walk(part: dict) -> Optional[str]:
        mime = part.get("mimeType", "")
        body = part.get("body", {}) or {}
        data = body.get("data")
        if mime == "text/plain" and data:
            return _decode_b64(data)
        if mime == "text/html" and data and not _has_text_plain(payload):
            # Fall back to HTML stripped of tags
            html = _decode_b64(data)
            return _strip_html(html)
        for sub in part.get("parts", []) or []:
            found = walk(sub)
            if found:
                return found
        return None

    return walk(payload) or message.get("snippet", "")


def _has_text_plain(payload: dict) -> bool:
    if payload.get("mimeType") == "text/plain":
        return True
    for sub in payload.get("parts", []) or []:
        if _has_text_plain(sub):
            return True
    return False


def _decode_b64(data: str) -> str:
    try:
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    except Exception:
        return ""


def _strip_html(html: str) -> str:
    """Quick-and-dirty HTML→text. Good enough for email bodies; the
    extraction pipeline doesn't need perfect formatting."""
    import re
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S | re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p>", "\n\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def format_as_document(message: dict, body: str) -> tuple[str, str]:
    """Build a (filename, markdown_content) tuple suitable for ingestion as
    a Document in the existing pipeline."""
    headers_map = {h["name"]: h["value"] for h in message.get("payload", {}).get("headers", [])}
    subject = headers_map.get("Subject", "(no subject)")
    sender = headers_map.get("From", "")
    to = headers_map.get("To", "")
    date = headers_map.get("Date", "")

    safe_subject = "".join(c if c.isalnum() or c in "-_ " else "_" for c in subject)[:80].strip() or "email"
    filename = f"{safe_subject}.md"

    markdown = (
        f"---\n"
        f"source: gmail\n"
        f"message_id: {message.get('id')}\n"
        f"thread_id: {message.get('threadId')}\n"
        f"from: {sender}\n"
        f"to: {to}\n"
        f"date: {date}\n"
        f"subject: {subject}\n"
        f"---\n\n"
        f"# {subject}\n\n"
        f"**From:** {sender}  \n"
        f"**To:** {to}  \n"
        f"**Date:** {date}\n\n"
        f"---\n\n"
        f"{body}\n"
    )
    return filename, markdown
