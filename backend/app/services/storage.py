"""File storage for uploaded documents — saves to disk for pipeline processing."""

import uuid
import shutil
from pathlib import Path
from app.config import settings

UPLOAD_DIR = Path(settings.assistants_dir).parent / "uploads"


def get_upload_dir(project_id: uuid.UUID) -> Path:
    path = UPLOAD_DIR / str(project_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


async def save_upload(project_id: uuid.UUID, filename: str, content: bytes) -> Path:
    """Save uploaded file to disk. Returns the file path."""
    project_dir = get_upload_dir(project_id)
    # Add UUID prefix to avoid filename collisions
    safe_name = f"{uuid.uuid4().hex[:8]}_{filename}"
    file_path = project_dir / safe_name
    file_path.write_bytes(content)
    return file_path


async def read_upload(file_path: Path) -> bytes:
    """Read an uploaded file from disk."""
    return file_path.read_bytes()


async def read_upload_text(file_path: Path) -> str:
    """Read uploaded file as text (for txt, md, eml)."""
    try:
        return file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return file_path.read_text(encoding="latin-1")


async def delete_upload(file_path: Path):
    """Delete an uploaded file."""
    if file_path.exists():
        file_path.unlink()


def get_file_path(project_id: uuid.UUID, filename: str) -> Path:
    """Get path to an uploaded file."""
    return get_upload_dir(project_id) / filename
