import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.project import Project, ProjectMember
from app.models.document import Document
from app.models.control import ReadinessHistory
from app.schemas.project import (
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectListResponse,
    ProjectMemberAdd, ProjectMemberResponse,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    data: ProjectCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = Project(
        name=data.name,
        client_name=data.client_name,
        project_type=data.project_type,
        repo_url=data.repo_url,
    )
    db.add(project)
    await db.flush()

    # Creator becomes project lead
    member = ProjectMember(project_id=project.id, user_id=user.id, role="lead")
    db.add(member)
    await db.flush()

    # Initialize .memory-bank, .obsidian, seed files immediately
    try:
        from app.agent.claude_runner import claude_runner
        claude_runner.get_project_dir(project.id)
    except Exception:
        pass  # Non-fatal — will be created on first chat

    return ProjectResponse(
        id=project.id,
        name=project.name,
        client_name=project.client_name,
        project_type=project.project_type,
        status=project.status,
        repo_url=project.repo_url,
        created_at=project.created_at,
        updated_at=project.updated_at,
        members=[ProjectMemberResponse(user_id=user.id, role="lead", user_email=user.email, user_name=user.name)],
    )


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.is_admin:
        query = select(Project).order_by(Project.updated_at.desc())
    else:
        query = (
            select(Project)
            .join(ProjectMember)
            .where(ProjectMember.user_id == user.id)
            .order_by(Project.updated_at.desc())
        )
    result = await db.execute(query)
    projects = result.scalars().all()

    responses = []
    for p in projects:
        doc_count = await db.scalar(
            select(func.count()).where(Document.project_id == p.id)
        )
        readiness = await db.scalar(
            select(ReadinessHistory.score)
            .where(ReadinessHistory.project_id == p.id)
            .order_by(ReadinessHistory.created_at.desc())
            .limit(1)
        )
        responses.append(ProjectResponse(
            id=p.id, name=p.name, client_name=p.client_name,
            project_type=p.project_type, status=p.status,
            repo_url=p.repo_url, created_at=p.created_at,
            updated_at=p.updated_at, documents_count=doc_count or 0,
            readiness_score=readiness,
        ))

    return ProjectListResponse(projects=responses, total=len(responses))


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Project).options(selectinload(Project.members)).where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    doc_count = await db.scalar(select(func.count()).where(Document.project_id == project_id))
    readiness = await db.scalar(
        select(ReadinessHistory.score)
        .where(ReadinessHistory.project_id == project_id)
        .order_by(ReadinessHistory.created_at.desc())
        .limit(1)
    )

    members = [
        ProjectMemberResponse(user_id=m.user_id, role=m.role)
        for m in project.members
    ]

    return ProjectResponse(
        id=project.id, name=project.name, client_name=project.client_name,
        project_type=project.project_type, status=project.status,
        repo_url=project.repo_url, created_at=project.created_at,
        updated_at=project.updated_at, members=members,
        documents_count=doc_count or 0, readiness_score=readiness,
    )


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: uuid.UUID,
    data: ProjectUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(project, field, value)

    await db.flush()

    return ProjectResponse(
        id=project.id, name=project.name, client_name=project.client_name,
        project_type=project.project_type, status=project.status,
        repo_url=project.repo_url, created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_project(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.status = "archived"
    await db.flush()


@router.post("/{project_id}/members", status_code=status.HTTP_201_CREATED)
async def add_member(
    project_id: uuid.UUID,
    data: ProjectMemberAdd,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    member = ProjectMember(project_id=project_id, user_id=data.user_id, role=data.role)
    db.add(member)
    await db.flush()
    return {"status": "added"}
