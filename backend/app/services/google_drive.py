"""Minimal Google Drive REST API client.

Mirrors gmail.py: uses a stored refresh_token to mint access tokens, then
calls Drive's REST API directly. Supports listing files (with structured
filters) and exporting/downloading them so they can be ingested as Documents.
"""

import re
from typing import Optional

import httpx
import structlog

from app.config import settings

log = structlog.get_logger()

DRIVE_API = "https://www.googleapis.com/drive/v3"
TOKEN_URL = "https://oauth2.googleapis.com/token"

# Native Google file types we can export to a text format
GOOGLE_EXPORT_MAP: dict[str, tuple[str, str]] = {
    # mimeType -> (export_mime, file_extension)
    "application/vnd.google-apps.document": ("text/markdown", "md"),
    "application/vnd.google-apps.spreadsheet": ("text/csv", "csv"),
    "application/vnd.google-apps.presentation": ("text/plain", "txt"),
}

# Non-Google files we'll download as-is and let the existing extraction handle
SUPPORTED_DOWNLOAD_TYPES: set[str] = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # .docx
    "application/msword",  # .doc
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # .xlsx
}


async def get_access_token(refresh_token: str) -> str:
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


async def list_files(
    access_token: str,
    query: Optional[str] = None,
    page_size: int = 50,
) -> list[dict]:
    """List Drive files matching the Drive search query.

    `query` is Drive's `q` parameter syntax, e.g.
        "name contains 'kickoff' and mimeType = 'application/vnd.google-apps.document'"
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    params: dict = {
        "pageSize": page_size,
        "fields": "files(id,name,mimeType,modifiedTime,size,owners(displayName,emailAddress,photoLink),iconLink,webViewLink,parents)",
        "orderBy": "modifiedTime desc",
    }
    if query:
        params["q"] = query

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f"{DRIVE_API}/files", params=params, headers=headers)
        resp.raise_for_status()
        return resp.json().get("files", [])


async def get_file_metadata(access_token: str, file_id: str) -> dict:
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{DRIVE_API}/files/{file_id}",
            params={"fields": "id,name,mimeType,size,modifiedTime,owners,webViewLink"},
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json()


async def fetch_file_content(access_token: str, file_id: str, mime_type: str) -> tuple[bytes, str, str]:
    """Return (content_bytes, suggested_extension, content_mime).

    For native Google docs we export to a text format. For binary files we
    download as-is so the existing parser pipeline (PDF, DOCX, etc.) handles
    them.
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=60) as client:
        if mime_type in GOOGLE_EXPORT_MAP:
            export_mime, ext = GOOGLE_EXPORT_MAP[mime_type]
            resp = await client.get(
                f"{DRIVE_API}/files/{file_id}/export",
                params={"mimeType": export_mime},
                headers=headers,
            )
            resp.raise_for_status()
            return resp.content, ext, export_mime

        # Generic binary download
        resp = await client.get(
            f"{DRIVE_API}/files/{file_id}",
            params={"alt": "media"},
            headers=headers,
        )
        resp.raise_for_status()
        ext = _ext_from_mime(mime_type)
        return resp.content, ext, mime_type


def _ext_from_mime(mime: str) -> str:
    mapping = {
        "application/pdf": "pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/msword": "doc",
        "text/plain": "txt",
        "text/markdown": "md",
        "text/csv": "csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    }
    return mapping.get(mime, "bin")


def safe_filename(name: str, ext: str) -> str:
    base = re.sub(r"[^\w\-.\s]", "_", name).strip()[:100] or "drive_file"
    if base.lower().endswith(f".{ext}"):
        return base
    return f"{base}.{ext}"


def is_supported(mime: str) -> bool:
    return mime in GOOGLE_EXPORT_MAP or mime in SUPPORTED_DOWNLOAD_TYPES


def parse_folder_id(value: str) -> Optional[str]:
    """Accept either a raw folder ID or a Drive folder URL.

    Examples:
      https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn
      https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMn
      1AbCdEfGhIjKlMn
    """
    if not value:
        return None
    value = value.strip()
    m = re.search(r"folders/([a-zA-Z0-9_-]+)", value)
    if m:
        return m.group(1)
    if re.fullmatch(r"[a-zA-Z0-9_-]{10,}", value):
        return value
    return None
