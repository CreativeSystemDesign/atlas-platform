"""Artifact route behavior for virtual Architect memory artifacts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException

from src.routes import artifacts


class FakeStoreContext:
    def __enter__(self) -> "FakeMemoryStore":
        return FakeMemoryStore()

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None


@dataclass
class FakeItem:
    value: dict[str, Any]


class FakeMemoryStore:
    def __init__(self) -> None:
        self.items = {
            (("atlas-architect", "memories"), "/atlas-architect-runtime-memory.md"): FakeItem(
                value={"content": "# Memory\n\nUse `/memories/` tools."}
            )
        }

    def get(self, namespace: tuple[str, ...], key: str) -> FakeItem | None:
        return self.items.get((namespace, key))


def test_download_architect_memory_artifact(monkeypatch):
    monkeypatch.setattr(artifacts, "sync_store_context", lambda: FakeStoreContext())

    response = artifacts.download_artifact("/memories/atlas-architect-runtime-memory.md")

    assert response.status_code == 200
    assert response.body == b"# Memory\n\nUse `/memories/` tools."
    assert response.media_type == "text/markdown; charset=utf-8"
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="atlas-architect-runtime-memory.md"'
    )


def test_download_missing_architect_memory_artifact(monkeypatch):
    monkeypatch.setattr(artifacts, "sync_store_context", lambda: FakeStoreContext())

    try:
        artifacts.download_artifact("/memories/missing.md")
    except HTTPException as exc:
        assert exc.status_code == 404
    else:
        raise AssertionError("missing memory artifact should 404")
