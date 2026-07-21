"""Architect runtime memory wiring."""

from __future__ import annotations

import asyncio

from src.graphs import architect, tools


def test_parent_architect_prompt_includes_memory_invariants(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_create_deep_agent(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(architect, "create_deep_agent", fake_create_deep_agent)
    monkeypatch.setattr(architect, "make_architect_llm", lambda model_id=None: object())
    monkeypatch.setattr(architect, "_toolset", lambda *names: [])
    monkeypatch.setattr(architect, "build_architect_subagents", lambda: [])
    monkeypatch.setattr(architect, "interrupt_on_policy", lambda: {})

    architect.build_architect_graph(
        checkpointer=object(),
        store=object(),
        system_prompt="BASE PROMPT",
    )

    prompt = captured["system_prompt"]
    assert isinstance(prompt, str)
    assert "/memories/ is Atlas Architect's durable long-term memory filesystem" in prompt
    assert "use search_architect_memories with a topic query" in prompt
    assert "Use the architect-runtime skill" in prompt
    assert prompt.endswith("BASE PROMPT")
    middleware = captured["middleware"]
    assert isinstance(middleware, list)
    assert any(
        isinstance(item, architect.ArchitectMemoryRecallMiddleware)
        for item in middleware
    )


def test_auto_recall_trigger_policy() -> None:
    assert architect._should_auto_recall_memory("What do you remember about Slice 0?")
    assert architect._should_auto_recall_memory("Please extract this schematic.")
    assert architect._should_auto_recall_memory("How does LangGraph memory work?")
    assert not architect._should_auto_recall_memory(
        "Use search_langchain_docs against the Qdrant vector store for Deep Agents docs."
    )
    assert not architect._should_auto_recall_memory("hello")


class FakeMemoryConn:
    def __init__(self, store: object | None = None) -> None:
        self.store = store

    def __enter__(self):
        return self.store if self.store is not None else self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeMemoryStore:
    def __init__(self) -> None:
        self.items: dict[tuple[tuple[str, ...], str], object] = {}

    def put(self, namespace, key, value):
        self.items[(namespace, key)] = type("Item", (), {"key": key, "value": value})()

    def get(self, namespace, key):
        return self.items.get((namespace, key))

    def search(self, namespace, limit=100):
        del limit
        return [item for (ns, _key), item in self.items.items() if ns == namespace]


def test_anywhere_file_tools_route_memories_to_architect_store(monkeypatch) -> None:
    fake_store = FakeMemoryStore()
    monkeypatch.setattr(
        tools,
        "_with_architect_memory_store",
        lambda: FakeMemoryConn(fake_store),
    )

    written = tools.write_file_anywhere.invoke(
        {
            "file_path": "/memories/ui-validation.md",
            "content": "first line\n",
        }
    )
    assert "Written Architect memory" in written
    assert fake_store.get(
        ("atlas-architect", "memories"),
        "/ui-validation.md",
    ).value["content"] == "first line\n"
    assert "modified_at" in fake_store.get(
        ("atlas-architect", "memories"),
        "/ui-validation.md",
    ).value

    appended = tools.append_file.invoke(
        {
            "file_path": "/memories/ui-validation.md",
            "content": "second line\n",
        }
    )
    assert "Appended to Architect memory" in appended

    read = tools.read_file_anywhere.invoke(
        {
            "file_path": "/memories/ui-validation.md",
            "max_lines": 10,
        }
    )
    assert read == "first line\nsecond line\n"


def test_shell_rejects_virtual_memory_paths() -> None:
    result = asyncio.run(
        tools.shell.ainvoke(
            {"command": "ls -la /memories"},
            config={"configurable": {"thread_id": "test-thread"}},
        )
    )
    assert "/memories/ is Architect's virtual Redis-backed memory route" in result


def test_search_architect_memories_finds_topic_without_path(monkeypatch) -> None:
    fake_store = FakeMemoryStore()
    fake_store.put(
        ("atlas-architect", "memories"),
        "/schematic_spine_slice0.md",
        {
            "content": (
                "# Schematic Spine Slice 0\n\n"
                "Vector sequence fingerprint detection uses spatial-analysis-agent "
                "and detect_schematic_spine_slice0 for ELB 3 Phase symbols."
            ),
            "modified_at": "2026-04-25T00:00:00+00:00",
        },
    )
    fake_store.put(
        ("atlas-architect", "memories"),
        "/unrelated.md",
        {"content": "# Other\n\nCoffee settings and unrelated notes."},
    )
    monkeypatch.setattr(
        tools,
        "_with_architect_memory_store",
        lambda: FakeMemoryConn(fake_store),
    )

    result = tools.search_architect_memories.invoke(
        {"query": "How did schematic spine vector detection work?", "limit": 3}
    )

    assert "/memories/schematic_spine_slice0.md" in result
    assert "Vector sequence fingerprint" in result
    assert "/memories/unrelated.md" not in result
