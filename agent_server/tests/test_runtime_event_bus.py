import asyncio
import json

from src.runtime_event_bus import RuntimeEventBus


class FakeRedis:
    def __init__(self) -> None:
        self.sequence = 0
        self.streams: dict[str, list[dict[str, str]]] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.lists: dict[str, list[str]] = {}
        self.strings: dict[str, str] = {}
        self.published: list[tuple[str, str]] = []

    async def ping(self) -> bool:
        return True

    async def info(self, section: str) -> dict[str, str]:
        assert section == "server"
        return {"redis_version": "8.0.0"}

    async def execute_command(self, *args: str) -> list[object] | str:
        command = args[0]
        if command == "JSON.SET":
            return "OK"
        if command == "FT._LIST":
            return []
        raise AssertionError(f"unexpected Redis command: {args}")

    async def delete(self, key: str) -> int:
        assert key == "atlas:redis:capability:json"
        return 1

    async def incr(self, key: str) -> int:
        assert key == "atlas:runtime:sequence"
        self.sequence += 1
        return self.sequence

    async def xadd(
        self,
        key: str,
        fields: dict[str, str],
        *,
        maxlen: int,
        approximate: bool,
    ) -> str:
        assert maxlen > 0
        assert approximate is True
        self.streams.setdefault(key, []).append(fields)
        return f"{self.sequence}-0"

    async def xrevrange(self, key: str, *, count: int) -> list[tuple[str, dict[str, str]]]:
        rows = self.streams.get(key, [])
        return [(f"{idx + 1}-0", item) for idx, item in reversed(list(enumerate(rows)))][:count]

    async def hset(self, key: str, *, mapping: dict[str, str]) -> None:
        self.hashes[key] = mapping

    async def hgetall(self, key: str) -> dict[str, str]:
        return self.hashes.get(key, {})

    async def publish(self, channel: str, message: str) -> int:
        self.published.append((channel, message))
        return 1

    async def lpush(self, key: str, value: str) -> int:
        self.lists.setdefault(key, []).insert(0, value)
        return len(self.lists[key])

    async def ltrim(self, key: str, start: int, end: int) -> bool:
        self.lists[key] = self.lists.get(key, [])[start : end + 1]
        return True

    async def set(self, key: str, value: str, *, ex: int) -> bool:
        assert ex > 0
        self.strings[key] = value
        return True

    async def get(self, key: str) -> str | None:
        return self.strings.get(key)


def test_publish_sse_frame_writes_global_run_stream_and_state() -> None:
    async def run() -> None:
        bus = RuntimeEventBus("redis://localhost:6379/0")
        fake = FakeRedis()
        bus._client = fake  # type: ignore[attr-defined]

        stream_id = await bus.publish_sse_frame(
            {
                "event": "run.state",
                "data": json.dumps(
                    {
                        "thread_id": "thread-1",
                        "run_id": "run-1",
                        "state": "running",
                        "timestamp": "2026-04-25T12:00:00+00:00",
                    }
                ),
            }
        )

        assert stream_id == "1-0"
        assert fake.streams["atlas:runtime:events"][0]["event_type"] == "run.state"
        assert fake.streams["atlas:runtime:events"][0]["status"] == "running"
        assert fake.streams["atlas:run:run-1:events"][0]["sequence"] == "1"
        assert fake.hashes["atlas:run:run-1:state"]["status"] == "running"
        assert fake.published[0][0] == "atlas:thread:thread-1:stream"

    asyncio.run(run())


def test_worker_wake_and_cancel_use_official_redis_primitives() -> None:
    async def run() -> None:
        bus = RuntimeEventBus("redis://localhost:6379/0")
        fake = FakeRedis()
        bus._client = fake  # type: ignore[attr-defined]

        await bus.wake_run_worker()
        await bus.request_run_cancel("run-1", reason="test")

        assert fake.lists["atlas:runs:wake"] == ["1"]
        assert await bus.is_run_cancel_requested("run-1") is True
        assert fake.published[0][0] == "atlas:run:run-1:cancel"
        assert json.loads(fake.published[0][1])["reason"] == "test"

    asyncio.run(run())


def test_benchmark_state_round_trips_explicit_status_and_payload() -> None:
    async def run() -> None:
        bus = RuntimeEventBus("redis://localhost:6379/0")
        fake = FakeRedis()
        bus._client = fake  # type: ignore[attr-defined]

        await bus.set_benchmark_state(
            name="disk",
            status="completed",
            payload={"trigger": "idle baseline", "read_mbps": 10.0, "write_mbps": 8.0},
        )

        state = await bus.get_benchmark_state("disk")

        assert state["status"] == "completed"
        assert state["trigger"] == "idle baseline"
        assert state["read_mbps"] == 10.0
        assert state["error"] is None

    asyncio.run(run())


def test_tool_metadata_frame_promotes_nested_run_identity() -> None:
    async def run() -> None:
        bus = RuntimeEventBus("redis://localhost:6379/0")
        fake = FakeRedis()
        bus._client = fake  # type: ignore[attr-defined]

        await bus.publish_sse_frame(
            {
                "event": "messages/metadata",
                "data": json.dumps(
                    {
                        "tool_call": {
                            "thread_id": "thread-2",
                            "run_id": "run-2",
                            "agent_name": "atlas-architect",
                            "status": "running",
                            "timestamp": "2026-04-25T12:05:00+00:00",
                        }
                    }
                ),
            }
        )

        event = fake.streams["atlas:runtime:events"][0]
        assert event["thread_id"] == "thread-2"
        assert event["run_id"] == "run-2"
        assert event["source"] == "atlas-architect"
        assert event["status"] == "running"
        assert fake.streams["atlas:run:run-2:events"][0]["event_type"] == "messages/metadata"

    asyncio.run(run())


def test_message_array_frame_promotes_message_identity() -> None:
    async def run() -> None:
        bus = RuntimeEventBus("redis://localhost:6379/0")
        fake = FakeRedis()
        bus._client = fake  # type: ignore[attr-defined]

        await bus.publish_sse_frame(
            {
                "event": "messages/complete",
                "data": json.dumps(
                    [
                        {
                            "type": "AIMessage",
                            "content": "Actual Architect response.",
                            "thread_id": "thread-architect",
                            "run_id": "run-architect",
                            "actor_id": "atlas-architect",
                            "actor_label": "Architect",
                        }
                    ]
                ),
            }
        )

        event = fake.streams["atlas:runtime:events"][0]
        assert event["thread_id"] == "thread-architect"
        assert event["run_id"] == "run-architect"
        assert event["source"] == "atlas-architect"
        assert fake.streams["atlas:run:run-architect:events"][0]["event_type"] == (
            "messages/complete"
        )

    asyncio.run(run())


def test_coordinator_subagent_status_does_not_create_worker_state() -> None:
    async def run() -> None:
        bus = RuntimeEventBus("redis://localhost:6379/0")
        fake = FakeRedis()
        bus._client = fake  # type: ignore[attr-defined]

        await bus.publish_sse_frame(
            {
                "event": "subagent.status",
                "data": json.dumps(
                    {
                        "thread_id": "thread-3",
                        "run_id": "run-3",
                        "agent_name": "atlas-architect",
                        "status": "running",
                    }
                ),
            }
        )

        assert "atlas:worker:atlas-architect:state" not in fake.hashes

    asyncio.run(run())


def test_require_ready_validates_redis8_json_and_search() -> None:
    async def run() -> None:
        bus = RuntimeEventBus("redis://localhost:6379/0")
        fake = FakeRedis()
        bus._client = fake  # type: ignore[attr-defined]

        await bus.require_ready()
        info = await bus.runtime_info()

        assert info["version"] == "8.0.0"
        assert info["major_version"] == 8
        assert info["json"] is True
        assert info["search"] is True

    asyncio.run(run())


def test_runtime_event_replay_filters_without_rewriting_payloads() -> None:
    async def run() -> None:
        bus = RuntimeEventBus("redis://localhost:6379/0")
        fake = FakeRedis()
        bus._client = fake  # type: ignore[attr-defined]

        await bus.publish_sse_frame(
            {
                "event": "agent.message",
                "data": json.dumps(
                    {
                        "thread_id": "thread-4",
                        "run_id": "run-4",
                        "actor_id": "data-extraction-supervisor",
                        "content": "Actual supervisor response.",
                        "timestamp": "2026-04-25T12:10:00+00:00",
                    }
                ),
            }
        )
        await bus.publish_sse_frame(
            {
                "event": "tool.started",
                "data": json.dumps(
                    {
                        "thread_id": "thread-4",
                        "run_id": "run-4",
                        "agent_name": "data-extraction-supervisor",
                        "name": "task",
                        "status": "running",
                        "timestamp": "2026-04-25T12:11:00+00:00",
                    }
                ),
            }
        )

        replay = await bus.list_runtime_events(
            run_id="run-4",
            event_type="agent.message",
            newest_first=False,
        )

        assert replay["ok"] is True
        assert replay["count"] == 1
        event = replay["events"][0]
        assert event["source"] == "data-extraction-supervisor"
        assert event["event_type"] == "agent.message"
        assert event["payload"]["content"] == "Actual supervisor response."

    asyncio.run(run())


def test_runtime_transcript_projects_real_messages_tools_and_status() -> None:
    async def run() -> None:
        bus = RuntimeEventBus("redis://localhost:6379/0")
        fake = FakeRedis()
        bus._client = fake  # type: ignore[attr-defined]

        await bus.publish_sse_frame(
            {
                "event": "agent.message",
                "data": json.dumps(
                    {
                        "thread_id": "thread-5",
                        "run_id": "run-5",
                        "actor_id": "data-extraction-supervisor",
                        "actor_label": "Data Extraction Supervisor",
                        "content": "Actual supervisor response.",
                        "timestamp": "2026-04-25T12:20:00+00:00",
                    }
                ),
            }
        )
        await bus.publish_sse_frame(
            {
                "event": "tool.started",
                "data": json.dumps(
                    {
                        "thread_id": "thread-5",
                        "run_id": "run-5",
                        "agent_name": "data-extraction-supervisor",
                        "name": "task",
                        "status": "running",
                        "args": {"subagent_type": "table-structure-extractor"},
                    }
                ),
            }
        )
        await bus.publish_sse_frame(
            {
                "event": "run.state",
                "data": json.dumps(
                    {
                        "thread_id": "thread-5",
                        "run_id": "run-5",
                        "state": "completed",
                    }
                ),
            }
        )

        transcript = await bus.list_runtime_transcript(
            run_id="run-5",
            newest_first=False,
        )

        assert [item["kind"] for item in transcript["items"]] == [
            "message",
            "tool",
            "status",
        ]
        assert transcript["items"][0]["content"] == "Actual supervisor response."
        assert transcript["items"][0]["actor_label"] == "Data Extraction Supervisor"
        assert transcript["items"][1]["tool_name"] == "task"
        assert transcript["items"][1]["args"] == {
            "subagent_type": "table-structure-extractor"
        }
        assert transcript["items"][2]["status"] == "completed"
        assert transcript["items"][0]["raw_event"]["event_type"] == "agent.message"

    asyncio.run(run())


def test_runtime_transcript_prefers_final_message_and_tool_records() -> None:
    async def run() -> None:
        bus = RuntimeEventBus("redis://localhost:6379/0")
        fake = FakeRedis()
        bus._client = fake  # type: ignore[attr-defined]

        await bus.publish_sse_frame(
            {
                "event": "messages/partial",
                "data": json.dumps(
                    [
                        {
                            "id": "msg-1",
                            "content": "partial response",
                            "thread_id": "thread-6",
                            "run_id": "run-6",
                            "actor_id": "atlas-architect",
                            "actor_label": "Architect",
                        }
                    ]
                ),
            }
        )
        await bus.publish_sse_frame(
            {
                "event": "messages/complete",
                "data": json.dumps(
                    [
                        {
                            "id": "msg-1",
                            "content": "final response",
                            "thread_id": "thread-6",
                            "run_id": "run-6",
                            "actor_id": "atlas-architect",
                            "actor_label": "Architect",
                        }
                    ]
                ),
            }
        )
        tool_payload = {
            "thread_id": "thread-6",
            "run_id": "run-6",
            "tool_run_id": "tool-1",
            "name": "search_architect_memories",
            "status": "running",
            "args": {"query": "redis"},
        }
        await bus.publish_sse_frame(
            {"event": "tool.started", "data": json.dumps(tool_payload)}
        )
        await bus.publish_sse_frame(
            {
                "event": "messages/metadata",
                "data": json.dumps({"tool_call": {**tool_payload, "status": "running"}}),
            }
        )
        await bus.publish_sse_frame(
            {
                "event": "tool.completed",
                "data": json.dumps({**tool_payload, "status": "complete", "output": "done"}),
            }
        )

        transcript = await bus.list_runtime_transcript(
            run_id="run-6",
            newest_first=False,
        )

        assert len(transcript["items"]) == 2
        assert transcript["items"][0]["kind"] == "message"
        assert transcript["items"][0]["event_type"] == "messages/complete"
        assert transcript["items"][0]["content"] == "final response"
        assert transcript["items"][1]["kind"] == "tool"
        assert transcript["items"][1]["event_type"] == "tool.completed"
        assert transcript["items"][1]["output"] == "done"

    asyncio.run(run())


def test_runtime_transcript_preserves_provider_emitted_reasoning() -> None:
    async def run() -> None:
        bus = RuntimeEventBus("redis://localhost:6379/0")
        fake = FakeRedis()
        bus._client = fake  # type: ignore[attr-defined]

        await bus.publish_sse_frame(
            {
                "event": "reasoning.delta",
                "data": json.dumps(
                    {
                        "thread_id": "thread-7",
                        "run_id": "run-7",
                        "actor_id": "atlas-architect",
                        "actor_label": "Architect",
                        "reasoning_id": "reasoning-1",
                        "reasoning": "provider emitted reasoning draft",
                    }
                ),
            }
        )
        await bus.publish_sse_frame(
            {
                "event": "reasoning.complete",
                "data": json.dumps(
                    {
                        "thread_id": "thread-7",
                        "run_id": "run-7",
                        "actor_id": "atlas-architect",
                        "actor_label": "Architect",
                        "reasoning_id": "reasoning-1",
                        "reasoning": "provider emitted final reasoning",
                    }
                ),
            }
        )
        await bus.publish_sse_frame(
            {
                "event": "messages/complete",
                "data": json.dumps(
                    [
                        {
                            "id": "msg-7",
                            "content": "final answer",
                            "reasoning_summary": "official summary",
                            "thread_id": "thread-7",
                            "run_id": "run-7",
                            "actor_id": "atlas-architect",
                            "actor_label": "Architect",
                        }
                    ]
                ),
            }
        )

        transcript = await bus.list_runtime_transcript(
            run_id="run-7",
            newest_first=False,
        )

        assert [item["kind"] for item in transcript["items"]] == ["reasoning", "message"]
        assert transcript["items"][0]["event_type"] == "reasoning.complete"
        assert transcript["items"][0]["content"] == "provider emitted final reasoning"
        assert transcript["items"][1]["content"] == "final answer"
        assert transcript["items"][1]["reasoning"] == "official summary"

    asyncio.run(run())
