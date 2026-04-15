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


def _md_to_html(md: str) -> str:
    """Convert markdown to styled HTML for email. Produces clean,
    email-client-compatible HTML with inline styles (no external CSS)."""
    import re
    html = md
    # Headings
    html = re.sub(r'^### (.+)$', r'<h3 style="font-size:15px;font-weight:700;margin:14px 0 4px;color:#1a1a1a">\1</h3>', html, flags=re.M)
    html = re.sub(r'^## (.+)$', r'<h2 style="font-size:17px;font-weight:700;margin:18px 0 6px;color:#1a1a1a;border-bottom:1px solid #e5e7eb;padding-bottom:4px">\1</h2>', html, flags=re.M)
    html = re.sub(r'^# (.+)$', r'<h1 style="font-size:20px;font-weight:800;margin:0 0 10px;color:#1a1a1a">\1</h1>', html, flags=re.M)
    # HR
    html = re.sub(r'^---$', '<hr style="border:none;border-top:1px solid #e5e7eb;margin:14px 0">', html, flags=re.M)
    # Bold + italic
    html = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', html)
    html = re.sub(r'\*(.+?)\*', r'<em>\1</em>', html)
    # Checkboxes
    html = re.sub(r'^- \[ \] (.+)$', r'<div style="display:flex;gap:6px;margin:3px 0;padding:4px 8px;background:#f9fafb;border-radius:4px;border:1px solid #e5e7eb;font-size:14px">☐ \1</div>', html, flags=re.M)
    # Bullets
    html = re.sub(r'^- (.+)$', r'<li style="margin:2px 0;font-size:14px">\1</li>', html, flags=re.M)
    # Numbered lists
    html = re.sub(r'^\d+\. (.+)$', r'<li style="margin:2px 0;font-size:14px;list-style:decimal">\1</li>', html, flags=re.M)
    # Paragraphs
    html = html.replace('\n\n', '<br><br>')
    html = html.replace('\n', '<br>')
    # Wrap
    html = f'<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#374151;max-width:640px">{html}</div>'
    return html


async def create_draft(
    access_token: str,
    to: str = "",
    subject: str = "",
    body: str = "",
    sender_email: str = "",
) -> dict:
    """Create a Gmail draft with HTML-formatted body from markdown."""
    import base64
    from email.mime.text import MIMEText

    html_body = _md_to_html(body)
    mime = MIMEText(html_body, "html", "utf-8")
    if to:
        mime["to"] = to
    mime["subject"] = subject

    raw = base64.urlsafe_b64encode(mime.as_bytes()).decode("ascii")

    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{GMAIL_API}/users/me/drafts",
            headers=headers,
            json={"message": {"raw": raw}},
        )
        resp.raise_for_status()
        data = resp.json()
        msg_id = data.get("message", {}).get("id", "")
        # Use authuser=email so the link opens in the correct Gmail
        # account when multiple accounts are logged in
        auth_param = f"authuser={sender_email}&" if sender_email else ""
        return {
            "draft_id": data.get("id"),
            "message_id": msg_id,
            "gmail_url": f"https://mail.google.com/mail/u/?{auth_param}#drafts?compose={msg_id}" if msg_id else None,
        }


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
