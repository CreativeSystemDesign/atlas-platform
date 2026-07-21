import asyncio

from src.persistence import memory_backup


def test_memory_backup_queues_request_when_snapshot_is_running(monkeypatch) -> None:
    async def run() -> None:
        calls: list[str] = []

        async def fake_snapshot_once(source: str) -> dict[str, object]:
            calls.append(source)
            if source == "first":
                await asyncio.sleep(0.01)
            return {"status": "completed", "count": 0, "source": source}

        async def fake_set_backup_state(**_kwargs: object) -> None:
            return None

        memory_backup._queued_backup_source = None  # type: ignore[attr-defined]
        monkeypatch.setattr(
            memory_backup,
            "_snapshot_architect_memories_once",
            fake_snapshot_once,
        )
        monkeypatch.setattr(memory_backup, "_set_backup_state", fake_set_backup_state)

        first_task = asyncio.create_task(
            memory_backup.snapshot_architect_memories_to_neon("first")
        )
        await asyncio.sleep(0)
        queued = await memory_backup.snapshot_architect_memories_to_neon("second")
        first_result = await first_task

        assert queued == {
            "status": "queued",
            "reason": "backup already running",
            "source": "second",
        }
        assert first_result["status"] == "completed"
        assert first_result["source"] == "second"
        assert first_result["runs_completed"] == 2
        assert calls == ["first", "second"]

    asyncio.run(run())


def test_memory_backup_preserves_last_snapshot_when_redis_is_empty(monkeypatch) -> None:
    async def run() -> None:
        state_updates: list[dict[str, object]] = []
        executed_sql: list[str] = []

        class FakeStore:
            async def asearch(self, *_args: object, **_kwargs: object) -> list[object]:
                return []

        class FakeResult:
            async def fetchone(self) -> tuple[int]:
                return (3,)

        class FakeConnection:
            async def execute(self, query: str, _params: object) -> FakeResult | None:
                normalized = query.strip()
                executed_sql.append(normalized)
                if normalized.startswith("SELECT COUNT(*)"):
                    return FakeResult()
                return None

            async def commit(self) -> None:
                raise AssertionError("commit should not run when preserving the prior snapshot")

        class FakeConnectionContext:
            async def __aenter__(self) -> FakeConnection:
                return FakeConnection()

            async def __aexit__(self, exc_type, exc, tb) -> None:
                return None

        class FakePool:
            def connection(self) -> FakeConnectionContext:
                return FakeConnectionContext()

        async def fake_set_backup_state(**kwargs: object) -> None:
            state_updates.append(kwargs)

        async def fake_get_store() -> FakeStore:
            return FakeStore()

        async def fake_get_pool() -> FakePool:
            return FakePool()

        monkeypatch.setattr(memory_backup, "get_store", fake_get_store)
        monkeypatch.setattr(memory_backup, "get_pool", fake_get_pool)
        monkeypatch.setattr(memory_backup, "_set_backup_state", fake_set_backup_state)

        result = await memory_backup._snapshot_architect_memories_once("auto:run_complete")

        assert result == {
            "status": "completed",
            "count": 3,
            "source": "auto:run_complete",
            "live_count": 0,
            "preserved_previous_snapshot": True,
        }
        assert all("DELETE FROM architect_memory_backups" not in query for query in executed_sql)
        assert state_updates == [
            {"status": "running", "source": "auto:run_complete"},
            {
                "status": "completed",
                "source": "auto:run_complete",
                "count": 3,
                "error": "Redis memory namespace was empty; preserved previous Neon snapshot.",
            },
        ]

    asyncio.run(run())
