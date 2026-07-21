"""Assistants API — CRUD, search, versioning."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Any

from src.persistence.assistants import assistant_store
from src.graphs.registry import get_graph_topology, list_graph_ids

router = APIRouter(prefix="/assistants", tags=["Assistants"])


class AssistantCreate(BaseModel):
    assistant_id: uuid.UUID | None = None
    graph_id: str
    name: str = "Untitled"
    description: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    if_exists: str = "raise"


class AssistantUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    config: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


@router.post("")
async def create_assistant(body: AssistantCreate):
    if body.graph_id not in list_graph_ids():
        raise HTTPException(status_code=404, detail=f"Graph '{body.graph_id}' not found")
    return await assistant_store.create(
        graph_id=body.graph_id,
        assistant_id=body.assistant_id,
        name=body.name,
        description=body.description,
        config=body.config,
        metadata=body.metadata,
    )


@router.get("/{assistant_id}")
async def get_assistant(assistant_id: uuid.UUID):
    result = await assistant_store.get(assistant_id)
    if not result:
        raise HTTPException(status_code=404, detail="Assistant not found")
    return result


@router.patch("/{assistant_id}")
async def update_assistant(assistant_id: uuid.UUID, body: AssistantUpdate):
    updates = body.model_dump(exclude_none=True)
    result = await assistant_store.update(assistant_id, **updates)
    if not result:
        raise HTTPException(status_code=404, detail="Assistant not found")
    return result


@router.delete("/{assistant_id}")
async def delete_assistant(assistant_id: uuid.UUID):
    deleted = await assistant_store.delete(assistant_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Assistant not found")
    return {"ok": True}


@router.post("/search")
async def search_assistants(
    limit: int = 50, offset: int = 0, graph_id: str | None = None
):
    return await assistant_store.search(limit=limit, offset=offset, graph_id=graph_id)


@router.get("/{assistant_id}/graph")
async def get_assistant_graph(assistant_id: uuid.UUID):
    result = await assistant_store.get(assistant_id)
    if not result:
        raise HTTPException(status_code=404, detail="Assistant not found")
    graph_id = result["graph_id"]
    topology = get_graph_topology(graph_id)
    return {"graph_id": graph_id, **topology}


@router.get("/{assistant_id}/versions")
async def list_versions(assistant_id: uuid.UUID):
    result = await assistant_store.get(assistant_id)
    if not result:
        raise HTTPException(status_code=404, detail="Assistant not found")
    return [{"version": result["version"], "created_at": result["updated_at"]}]
