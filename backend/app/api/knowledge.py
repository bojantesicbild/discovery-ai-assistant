"""Knowledge graph API + Wiki file browser."""

import re
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from app.deps import get_current_user
from app.models.auth import User
from app.agent.claude_runner import claude_runner
from app.services.graph_parser import parse_knowledge_graph

router = APIRouter(prefix="/api/projects/{project_id}", tags=["knowledge"])


def _get_discovery_dir(project_id: uuid.UUID) -> Path:
    project_dir = claude_runner.get_project_dir(project_id)
    return project_dir / ".memory-bank" / "docs" / "discovery"


def _parse_frontmatter(content: str) -> tuple[dict, str]:
    """Extract YAML frontmatter from markdown."""
    if not content.startswith("---"):
        return {}, content
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content
    try:
        import yaml
        meta = yaml.safe_load(parts[1]) or {}
    except Exception:
        meta = {}
    return meta, parts[2]


# ── Knowledge Graph ──

@router.get("/knowledge-graph")
async def get_knowledge_graph(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
):
    discovery_dir = _get_discovery_dir(project_id)
    if not discovery_dir.exists():
        return {"nodes": [], "edges": []}

    graph = parse_knowledge_graph(discovery_dir)
    return graph


# ── Wiki File Browser ──

@router.get("/wiki/files")
async def list_wiki_files(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
):
    """List all markdown files in the discovery wiki with frontmatter metadata."""
    discovery_dir = _get_discovery_dir(project_id)
    if not discovery_dir.exists():
        return {"files": []}

    files = []
    for md_file in sorted(discovery_dir.rglob("*.md")):
        try:
            content = md_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        meta, _ = _parse_frontmatter(content)
        rel_path = str(md_file.relative_to(discovery_dir))

        files.append({
            "path": rel_path,
            "name": md_file.stem,
            "folder": str(md_file.parent.relative_to(discovery_dir)) if md_file.parent != discovery_dir else "",
            "id": str(meta.get("id", "")),
            "title": str(meta.get("title", "")) or md_file.stem.replace("-", " ").title(),
            "category": str(meta.get("category", "")),
            "status": str(meta.get("status", "")),
            "priority": str(meta.get("priority", "")),
            "date": str(meta.get("date", "")),
        })

    return {"files": files}


@router.get("/wiki/file")
async def get_wiki_file(
    project_id: uuid.UUID,
    path: str = Query(..., description="Relative path within docs/discovery/"),
    user: User = Depends(get_current_user),
):
    """Get a wiki file's content, frontmatter, and backlinks."""
    discovery_dir = _get_discovery_dir(project_id)
    file_path = (discovery_dir / path).resolve()

    # Path traversal protection
    if not str(file_path).startswith(str(discovery_dir.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        content = file_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        raise HTTPException(status_code=500, detail=str(e))

    meta, body = _parse_frontmatter(content)
    file_id = str(meta.get("id", "")) or file_path.stem

    # Find backlinks — other files that reference this file's ID
    backlinks = []
    wikilink_pattern = re.compile(r"\[\[([^\]]+)\]\]")

    for other_file in discovery_dir.rglob("*.md"):
        if other_file == file_path:
            continue
        try:
            other_content = other_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        other_meta, other_body = _parse_frontmatter(other_content)
        links = wikilink_pattern.findall(other_body)

        # Check if any link targets this file
        for link in links:
            link_lower = link.lower().strip()
            if (link_lower == file_id.lower() or
                link_lower == file_path.stem.lower() or
                link_lower == meta.get("title", "").lower()):
                other_id = str(other_meta.get("id", "")) or other_file.stem
                backlinks.append({
                    "path": str(other_file.relative_to(discovery_dir)),
                    "id": other_id,
                    "title": str(other_meta.get("title", "")) or other_file.stem.replace("-", " ").title(),
                    "category": str(other_meta.get("category", "")),
                })
                break

    return {
        "content": content,
        "body": body.strip(),
        "frontmatter": {k: str(v) for k, v in meta.items() if v},
        "backlinks": backlinks,
        "path": path,
    }
