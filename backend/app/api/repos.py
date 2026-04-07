"""API endpoints for project repositories and GitHub integration."""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.project import ProjectRepo
from app.schemas.project import ProjectRepoCreate, ProjectRepoResponse
from app.services import github

router = APIRouter(prefix="/api/projects/{project_id}/repos", tags=["repos"])


@router.post("", response_model=ProjectRepoResponse, status_code=201)
async def add_repo(
    project_id: uuid.UUID,
    data: ProjectRepoCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = ProjectRepo(
        project_id=project_id,
        name=data.name,
        url=data.url,
        provider=data.provider,
        access_token=data.access_token,
        default_branch=data.default_branch,
    )
    db.add(repo)
    await db.flush()
    return ProjectRepoResponse.model_validate(repo)


@router.get("", response_model=list[ProjectRepoResponse])
async def list_repos(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProjectRepo)
        .where(ProjectRepo.project_id == project_id)
        .order_by(ProjectRepo.created_at)
    )
    return [ProjectRepoResponse.model_validate(r) for r in result.scalars().all()]


@router.delete("/{repo_id}", status_code=204)
async def remove_repo(
    project_id: uuid.UUID,
    repo_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProjectRepo).where(
            ProjectRepo.id == repo_id,
            ProjectRepo.project_id == project_id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    await db.delete(repo)


@router.get("/{repo_id}/pulls")
async def get_repo_pulls(
    project_id: uuid.UUID,
    repo_id: uuid.UUID,
    state: str = "all",
    base: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProjectRepo).where(
            ProjectRepo.id == repo_id,
            ProjectRepo.project_id == project_id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    parsed = github.parse_github_url(repo.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="Could not parse GitHub URL")

    owner, repo_name = parsed
    try:
        pulls = await github.get_pulls(owner, repo_name, token=repo.access_token, state=state, base=base)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {str(e)}")

    return {"pulls": pulls, "repo_name": f"{owner}/{repo_name}"}


@router.get("/{repo_id}/commits")
async def get_repo_commits(
    project_id: uuid.UUID,
    repo_id: uuid.UUID,
    sha: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProjectRepo).where(
            ProjectRepo.id == repo_id,
            ProjectRepo.project_id == project_id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    parsed = github.parse_github_url(repo.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="Could not parse GitHub URL")

    owner, repo_name = parsed
    try:
        commits = await github.get_commits(owner, repo_name, token=repo.access_token, sha=sha)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {str(e)}")

    return {"commits": commits}


@router.get("/{repo_id}/info")
async def get_repo_info_endpoint(
    project_id: uuid.UUID,
    repo_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProjectRepo).where(ProjectRepo.id == repo_id, ProjectRepo.project_id == project_id)
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    parsed = github.parse_github_url(repo.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="Could not parse GitHub URL")
    owner, repo_name = parsed
    try:
        info = await github.get_repo_info(owner, repo_name, token=repo.access_token)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {str(e)}")
    return info


@router.get("/{repo_id}/workflows")
async def get_repo_workflows(
    project_id: uuid.UUID,
    repo_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProjectRepo).where(ProjectRepo.id == repo_id, ProjectRepo.project_id == project_id)
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    parsed = github.parse_github_url(repo.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="Could not parse GitHub URL")
    owner, repo_name = parsed
    try:
        runs = await github.get_workflow_runs(owner, repo_name, token=repo.access_token)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {str(e)}")
    return {"runs": runs}


@router.get("/{repo_id}/branches")
async def get_repo_branches(
    project_id: uuid.UUID,
    repo_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProjectRepo).where(
            ProjectRepo.id == repo_id,
            ProjectRepo.project_id == project_id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    parsed = github.parse_github_url(repo.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="Could not parse GitHub URL")

    owner, repo_name = parsed
    try:
        branches = await github.get_branches(owner, repo_name, token=repo.access_token)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {str(e)}")

    return {"branches": branches}
