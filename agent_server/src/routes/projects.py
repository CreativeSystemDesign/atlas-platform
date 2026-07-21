"""Machine project routes for project-scoped Atlas workspaces."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.persistence.projects import (
    create_project,
    find_similar_projects,
    get_default_project,
    get_project,
    list_projects,
)

router = APIRouter(prefix="/projects", tags=["Projects"])


class ProjectCreate(BaseModel):
    machine_id: str
    display_name: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    # R15: family binding at creation (manufacturer-legend + rule packs scope
    # to family, R2); never silently defaulted.
    manufacturer: str | None = None
    model: str | None = None
    # R15/G51 sibling guard: a first attempt that matches an existing machine
    # returns 409 with the matches; the client re-submits confirm_sibling=True
    # after the human explicitly chooses "create sibling".
    confirm_sibling: bool = False


@router.get("")
async def list_machine_projects() -> list[dict[str, Any]]:
    return await list_projects()


@router.get("/default")
async def get_default_machine_project() -> dict[str, Any]:
    return await get_default_project()


@router.get("/{project_id}")
async def get_machine_project(project_id: uuid.UUID) -> dict[str, Any]:
    project = await get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return project


@router.post("")
async def create_machine_project(body: ProjectCreate) -> dict[str, Any]:
    if not body.confirm_sibling:
        similar = await find_similar_projects(body.machine_id)
        if similar:
            raise HTTPException(
                status_code=409,
                detail={
                    "reason": "similar_machines_exist",
                    "message": "Near-identical machine(s) already exist — continue one of "
                               "them, or explicitly create a sibling (confirm_sibling=true).",
                    "matches": similar,
                })
    try:
        return await create_project(
            machine_id=body.machine_id,
            display_name=body.display_name,
            metadata=body.metadata,
            manufacturer=body.manufacturer,
            model=body.model,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        raise
