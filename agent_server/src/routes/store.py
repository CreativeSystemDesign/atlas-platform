"""Store API - durable key-value store for long-term memory."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.persistence.langgraph_store import get_store

router = APIRouter(prefix="/store", tags=["Store"])


class StoreItem(BaseModel):
    namespace: list[str] = Field(default_factory=list)
    key: str
    value: dict[str, Any] = Field(default_factory=dict)


class StoreSearchRequest(BaseModel):
    namespace: list[str] = Field(default_factory=list)
    query: str | None = None
    limit: int = 10
    offset: int = 0


def _namespace_tuple(namespace: list[str] | None) -> tuple[str, ...]:
    return tuple(namespace or [])


def _serialize_item(item: Any) -> dict[str, Any]:
    created_at = getattr(item, "created_at", None)
    updated_at = getattr(item, "updated_at", None)
    return {
        "namespace": list(item.namespace),
        "key": item.key,
        "value": item.value,
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else created_at,
        "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") else updated_at,
    }


@router.get("/items")
async def get_item(key: str, namespace: list[str] | None = None):
    store = await get_store()
    item = await store.aget(_namespace_tuple(namespace), key)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _serialize_item(item)


@router.put("/items")
async def put_item(body: StoreItem):
    store = await get_store()
    namespace = _namespace_tuple(body.namespace)
    await store.aput(namespace, body.key, body.value)
    item = await store.aget(namespace, body.key)
    if not item:
        raise HTTPException(status_code=500, detail="Item write did not read back")
    return _serialize_item(item)


@router.delete("/items")
async def delete_item(key: str, namespace: list[str] | None = None):
    store = await get_store()
    namespace_tuple = _namespace_tuple(namespace)
    existing = await store.aget(namespace_tuple, key)
    if existing is None:
        raise HTTPException(status_code=404, detail="Item not found")
    await store.adelete(namespace_tuple, key)
    return {"ok": True}


@router.post("/items/search")
async def search_items(body: StoreSearchRequest):
    store = await get_store()
    results = await store.asearch(
        _namespace_tuple(body.namespace),
        query=body.query,
        limit=body.limit,
        offset=body.offset,
    )
    return [_serialize_item(item) for item in results]


@router.post("/namespaces")
async def list_namespaces():
    store = await get_store()
    namespaces = await store.alist_namespaces()
    return [{"namespace": list(namespace)} for namespace in namespaces]
