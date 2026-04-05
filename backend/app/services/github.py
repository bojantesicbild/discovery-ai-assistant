"""Simple GitHub REST API client — no library dependency."""

import re
import httpx
from typing import Optional

API_BASE = "https://api.github.com"


def parse_github_url(url: str) -> tuple[str, str] | None:
    """Extract owner/repo from a GitHub URL."""
    patterns = [
        r"github\.com[:/]([^/]+)/([^/.]+?)(?:\.git)?$",
        r"^([^/]+)/([^/]+)$",
    ]
    for pat in patterns:
        m = re.search(pat, url)
        if m:
            return m.group(1), m.group(2)
    return None


async def get_pulls(owner: str, repo: str, token: Optional[str] = None, state: str = "all", per_page: int = 20) -> list[dict]:
    """Fetch pull requests."""
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{API_BASE}/repos/{owner}/{repo}/pulls",
            params={"state": state, "per_page": per_page, "sort": "updated", "direction": "desc"},
            headers=headers,
            timeout=15,
        )
        resp.raise_for_status()
        pulls = resp.json()

    return [
        {
            "number": pr["number"],
            "title": pr["title"],
            "state": pr["state"],
            "merged": pr.get("merged_at") is not None,
            "author": pr["user"]["login"],
            "author_avatar": pr["user"]["avatar_url"],
            "created_at": pr["created_at"],
            "updated_at": pr["updated_at"],
            "merged_at": pr.get("merged_at"),
            "url": pr["html_url"],
            "additions": pr.get("additions", 0),
            "deletions": pr.get("deletions", 0),
            "changed_files": pr.get("changed_files", 0),
            "draft": pr.get("draft", False),
            "labels": [l["name"] for l in pr.get("labels", [])],
            "head_branch": pr["head"]["ref"],
            "base_branch": pr["base"]["ref"],
        }
        for pr in pulls
    ]


async def get_branches(owner: str, repo: str, token: Optional[str] = None) -> list[dict]:
    """Fetch branches."""
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{API_BASE}/repos/{owner}/{repo}/branches",
            params={"per_page": 30},
            headers=headers,
            timeout=15,
        )
        resp.raise_for_status()

    return [
        {"name": b["name"], "sha": b["commit"]["sha"]}
        for b in resp.json()
    ]


async def get_repo_info(owner: str, repo: str, token: Optional[str] = None) -> dict:
    """Fetch basic repo info."""
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{API_BASE}/repos/{owner}/{repo}",
            headers=headers,
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

    return {
        "name": data["name"],
        "full_name": data["full_name"],
        "description": data.get("description"),
        "default_branch": data["default_branch"],
        "language": data.get("language"),
        "stars": data.get("stargazers_count", 0),
        "open_issues": data.get("open_issues_count", 0),
        "private": data.get("private", False),
    }
