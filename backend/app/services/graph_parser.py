"""
Graph parser -- extracts nodes and edges from markdown files with [[wikilinks]].
Builds a knowledge graph from the file-based knowledge layer.

Fixes:
- Case-insensitive ID matching (BR-005 == br-005)
- Skip index files (requirements.md, decisions.md) as edge sources
- Only link requirements to THEIR stakeholders/decisions, not all
"""

import re
import yaml
from pathlib import Path

WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")

CATEGORY_TYPE_MAP = {
    "requirement": "requirement",
    "functional-requirement": "requirement",
    "non-functional-requirement": "requirement",
    "non_functional": "requirement",
    "organizational": "requirement",
    "decision": "decision",
    "stakeholder": "stakeholder",
    "person": "stakeholder",
    "contradiction": "contradiction",
    "contradictions-index": "contradiction",
    "document": "document",
    "constraint": "constraint",
    "gap": "gap",
    "assumption": "document",
    "scope": "document",
    "handoff": "document",
    "brief": "document",
    "template": "document",
}

# Index files to skip as edge sources (they link to everything)
INDEX_CATEGORIES = {"requirements-index", "decisions-index", "stakeholders-index",
                    "contradictions-index", "readiness", "constraints-index"}


def _parse_frontmatter(content: str) -> tuple[dict, str]:
    if not content.startswith("---"):
        return {}, content
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content
    try:
        meta = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError:
        meta = {}
    return meta, parts[2]


def _normalize_id(name: str) -> str:
    """Normalize ID: BR-005 stays BR-005, person names keep case, rest lowercased."""
    stripped = name.strip()
    # Keep BR-XXX / DEC-XXX pattern as uppercase
    if re.match(r'^[A-Za-z]+-\d+$', stripped):
        return stripped.upper()
    # Keep person names (2+ capitalized words)
    parts = stripped.split()
    if len(parts) >= 2 and all(p[0].isupper() for p in parts if p):
        return stripped
    return re.sub(r"[^a-z0-9]+", "-", stripped.lower()).strip("-")


def _resolve_link_target(link_text: str, known_ids: dict) -> str:
    """Resolve a wikilink target to a known node ID."""
    # Exact match
    if link_text in known_ids:
        return link_text
    # Normalized match (BR-012 -> BR-012)
    normalized = _normalize_id(link_text)
    if normalized in known_ids:
        return normalized
    # Case-insensitive match
    lower = link_text.lower()
    for kid in known_ids:
        if kid.lower() == lower:
            return kid
    # Slug match
    slug = re.sub(r"[^a-z0-9]+", "-", lower).strip("-")
    for kid in known_ids:
        if re.sub(r"[^a-z0-9]+", "-", kid.lower()).strip("-") == slug:
            return kid
    return normalized


DOCUMENT_NAMES = {
    "discovery brief", "discovery-brief", "mvp scope freeze", "mvp-scope-freeze",
    "functional requirements", "functional-requirements", "project brief",
    "project-brief", "system patterns", "tech context", "key decisions",
}


def _guess_type(name: str) -> str:
    """Guess node type for implicit nodes."""
    lower = name.lower()
    if re.match(r'^br-\d+', lower):
        return "requirement"
    if re.match(r'^dec-\d+', lower):
        return "decision"
    if re.match(r'^con-\d+', lower):
        return "constraint"
    if re.match(r'^gap-\d+', lower):
        return "gap"
    if lower.endswith('.md'):
        return "document"
    if lower in DOCUMENT_NAMES or "brief" in lower or "requirements" in lower or "scope" in lower:
        return "document"
    if "decision" in lower:
        return "decision"
    if "contradiction" in lower:
        return "contradiction"
    if "constraint" in lower:
        return "constraint"
    # Person names: 2+ capitalized words (check AFTER document names)
    parts = name.split()
    if len(parts) >= 2 and all(p[0].isupper() for p in parts if p):
        return "stakeholder"
    return "document"


def _get_context(body: str, link_target: str) -> str:
    """Extract the relationship label after a wikilink (the '— xxx' part)."""
    pattern = re.compile(re.escape(f"[[{link_target}]]"))
    match = pattern.search(body)
    if not match:
        return ""

    # Get the line containing the link
    line_start = body.rfind("\n", 0, match.start()) + 1
    line_end = body.find("\n", match.end())
    if line_end == -1:
        line_end = len(body)

    # Get text AFTER the wikilink on the same line
    after = body[match.end():line_end].strip()

    # Extract the part after "—" or "-" separator
    for sep in ("—", " - ", "–"):
        if sep in after:
            label = after.split(sep, 1)[1].strip()
            # Clean markdown
            label = re.sub(r'\*+', '', label).strip()
            # Short, meaningful label
            if label and len(label) >= 3:
                return label[:50]

    # Check section heading above for context (e.g. "## Affected Requirements")
    before_link = body[:match.start()]
    heading_match = re.search(r'^##\s+(.+)$', before_link, re.MULTILINE)
    if heading_match:
        heading = heading_match.group(1).strip().lower()
        HEADING_LABELS = {
            "affected requirements": "affected",
            "related": "related",
            "blocked requirements": "blocks",
            "people": "involves",
            "stakeholders": "involves",
            "ask": "needs answer from",
            "sources": "sourced from",
            "source documents": "sourced from",
            "source": "sourced from",
        }
        for key, label in HEADING_LABELS.items():
            if key in heading:
                return label

    return ""


def parse_knowledge_graph(discovery_dir: Path) -> dict:
    """Parse .md files in discovery dir and build a knowledge graph."""
    node_ids: dict[str, dict] = {}
    edges: list[dict] = []

    # First pass: collect all file-backed nodes
    for md_file in sorted(discovery_dir.rglob("*.md")):
        try:
            content = md_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        meta, body = _parse_frontmatter(content)
        category = str(meta.get("category", "")).lower()

        # Skip index files — they link to everything and create noise
        if category in INDEX_CATEGORIES:
            continue
        # Skip .gitkeep-like files
        if len(content.strip()) < 20:
            continue

        raw_id = str(meta.get("id", ""))
        file_id = raw_id or _normalize_id(md_file.stem)
        title = str(meta.get("title", "")) or md_file.stem.replace("-", " ").title()
        # Include ID prefix in label for requirements (BR-001: Title)
        if raw_id and re.match(r'^[A-Z]+-\d+', raw_id):
            label = f"{raw_id}: {title}"
        else:
            label = title
        node_type = CATEGORY_TYPE_MAP.get(category, _guess_type(label))

        # Build meta
        node_meta = {}
        for k in ("priority", "status", "confidence", "source_person", "source_doc", "category", "version", "date"):
            v = meta.get(k)
            if v:
                node_meta[k] = str(v)

        desc = meta.get("description", "")
        if isinstance(desc, str) and desc:
            node_meta["description"] = desc[:200]

        quote_match = re.search(r'>\s*"([^"]+)"', body)
        if quote_match:
            node_meta["source_quote"] = quote_match.group(1)[:150]

        # Add file modification time for timeline
        try:
            mtime = md_file.stat().st_mtime
            from datetime import datetime
            node_meta["created_at"] = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
        except OSError:
            pass

        node_ids[file_id] = {
            "id": file_id,
            "label": label,
            "type": node_type,
            "meta": node_meta,
        }

    # Second pass: extract edges from wikilinks (only from individual files, not indexes)
    for md_file in sorted(discovery_dir.rglob("*.md")):
        try:
            content = md_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        meta, body = _parse_frontmatter(content)
        category = str(meta.get("category", "")).lower()

        # Skip index files for edges
        if category in INDEX_CATEGORIES:
            continue
        if len(content.strip()) < 20:
            continue

        source_id = str(meta.get("id", "")) or _normalize_id(md_file.stem)
        if source_id not in node_ids:
            continue

        # Extract wikilinks
        links = WIKILINK_RE.findall(body)
        seen_targets = set()

        for link_text in links:
            target_id = _resolve_link_target(link_text, node_ids)

            # Skip self-links and duplicates
            if target_id == source_id or target_id in seen_targets:
                continue
            seen_targets.add(target_id)

            context = _get_context(body, link_text)

            # Create implicit node for targets without files
            # But first check if a case-variant exists (BR-012 vs br-012)
            if target_id not in node_ids:
                # Check case-insensitive
                existing_key = None
                for kid in node_ids:
                    if kid.lower() == target_id.lower():
                        existing_key = kid
                        break
                if existing_key:
                    # Redirect edge to the existing node
                    target_id = existing_key
                else:
                    node_ids[target_id] = {
                        "id": target_id,
                        "label": link_text,
                        "type": _guess_type(link_text),
                        "meta": {},
                    }

            edges.append({
                "source": source_id,
                "target": target_id,
                "label": context,
            })

    return {"nodes": list(node_ids.values()), "edges": edges}
