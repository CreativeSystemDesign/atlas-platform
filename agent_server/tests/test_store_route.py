"""Durable store route behavior."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import pytest
from fastapi import HTTPException

from src.routes import store as store_route


@dataclass
class FakeItem:
    namespace: tuple[str, ...]
    key: str
    value: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class FakeStore:
    def __init__(self) -> None:
        self.items: dict[tuple[tuple[str, ...], str], FakeItem] = {}

    async def aget(self, namespace: tuple[str, ...], key: str) -> FakeItem | None:
        return self.items.get((namespace, key))

    async def aput(self, namespace: tuple[str, ...], key: str, value: dict[str, Any]) -> None:
        now = datetime.now(timezone.utc)
        existing = self.items.get((namespace, key))
        self.items[(namespace, key)] = FakeItem(
            namespace=namespace,
            key=key,
            value=value,
            created_at=existing.created_at if existing else now,
            updated_at=now,
        )

    async def adelete(self, namespace: tuple[str, ...], key: str) -> None:
        self.items.pop((namespace, key), None)

    async def asearch(
        self,
        namespace_prefix: tuple[str, ...],
        *,
        query: str | None = None,
        limit: int = 10,
        offset: int = 0,
    ) -> list[FakeItem]:
        del query
        matches = [
            item
            for (namespace, _key), item in self.items.items()
            if namespace[: len(namespace_prefix)] == namespace_prefix
        ]
        return matches[offset : offset + limit]

    async def alist_namespaces(self) -> list[tuple[str, ...]]:
        return sorted({namespace for namespace, _key in self.items})


def test_store_items_round_trip_through_langgraph_store(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_store = FakeStore()

    async def fake_get_store() -> FakeStore:
        return fake_store

    monkeypatch.setattr(store_route, "get_store", fake_get_store)

    async def scenario() -> None:
        body = store_route.StoreItem(
            namespace=["atlas-architect", "memories"],
            key="/note.md",
            value={"content": "remember this", "encoding": "utf-8"},
        )
        written = await store_route.put_item(body)
        assert written["namespace"] == ["atlas-architect", "memories"]
        assert written["key"] == "/note.md"
        assert written["value"]["content"] == "remember this"

        fetched = await store_route.get_item(
            key="/note.md",
            namespace=["atlas-architect", "memories"],
        )
        assert fetched["value"] == body.value

        found = await store_route.search_items(
            store_route.StoreSearchRequest(namespace=["atlas-architect"])
        )
        assert [item["key"] for item in found] == ["/note.md"]

        namespaces = await store_route.list_namespaces()
        assert namespaces == [{"namespace": ["atlas-architect", "memories"]}]

        assert await store_route.delete_item(
            key="/note.md",
            namespace=["atlas-architect", "memories"],
        ) == {"ok": True}

        with pytest.raises(HTTPException) as exc:
            await store_route.get_item(
                key="/note.md",
                namespace=["atlas-architect", "memories"],
            )
        assert exc.value.status_code == 404

    asyncio.run(scenario())
