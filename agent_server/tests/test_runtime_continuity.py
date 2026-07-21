from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from src.routes.runs import (
    _ensure_internal_agent_message_json,
    _persistable_event,
    _session_is_attachable,
    _thread_should_accept_resume,
    _thread_should_accept_steer,
    _tool_output_summary,
)
from src.routes.threads import _infer_live_phase
from src.runtime_active_runs import ActiveRunManager, ActiveThreadRun
from src.schemas import Thread, ThreadLiveRunPhase, ThreadOperationalState, ThreadStatus


def _thread(
    *,
    status: ThreadStatus = ThreadStatus.idle,
    operational_state: ThreadOperationalState = ThreadOperationalState.active,
) -> Thread:
    now = datetime.now(timezone.utc)
    return Thread(
        thread_id=uuid4(),
        created_at=now,
        updated_at=now,
        metadata={},
        status=status,
        operational_state=operational_state,
    )


def test_live_phase_prefers_active_session() -> None:
    thread = _thread()
    starting_session = {
        "thread_id": str(thread.thread_id),
        "run_id": str(uuid4()),
        "status": "running",
        "live_phase": "starting",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    active_session = {**starting_session, "live_phase": "active"}

    assert _infer_live_phase(thread, starting_session, {"status": "running"}) == ThreadLiveRunPhase.starting
    assert _infer_live_phase(thread, active_session, {"status": "running"}) == ThreadLiveRunPhase.active


def test_live_phase_uses_latest_run_status_for_recovery() -> None:
    thread = _thread()

    assert _infer_live_phase(thread, None, {"status": "error"}) == ThreadLiveRunPhase.recovery
    assert _infer_live_phase(thread, None, {"status": "interrupted"}) == ThreadLiveRunPhase.recovery
    assert _infer_live_phase(thread, None, {"status": "success"}) == ThreadLiveRunPhase.ended


def test_attach_and_steer_require_live_session_presence() -> None:
    thread = _thread()
    session = SimpleNamespace(status="running", live_phase="active")
    ended_session = SimpleNamespace(status="completed", live_phase="ended")

    assert _session_is_attachable(session) is True
    assert _session_is_attachable(ended_session) is False
    assert _thread_should_accept_steer(thread, session) is True
    assert _thread_should_accept_steer(thread, ended_session) is False


def test_resume_requires_interrupted_thread_and_ended_session() -> None:
    interrupted_thread = _thread(status=ThreadStatus.interrupted)
    running_thread = _thread(status=ThreadStatus.busy)
    interrupted_session = SimpleNamespace(status="interrupted", live_phase="ended")
    active_session = SimpleNamespace(status="running", live_phase="active")

    assert _thread_should_accept_resume(interrupted_thread, interrupted_session) is True
    assert _thread_should_accept_resume(interrupted_thread, active_session) is False
    assert _thread_should_accept_resume(running_thread, interrupted_session) is False
    assert _thread_should_accept_resume(interrupted_thread, None) is False


def test_stream_can_skip_replaying_history() -> None:
    async def exercise() -> None:
        manager = ActiveRunManager()
        manager._sessions["thread-1"] = ActiveThreadRun(thread_id="thread-1")

        await manager.publish("thread-1", {"event": "metadata", "data": "{}"})

        stream = manager.stream("thread-1", replay_history=False)
        task = asyncio.create_task(anext(stream))

        await asyncio.sleep(0)
        await manager.publish("thread-1", {"event": "end", "data": ""})

        assert await task == {"event": "end", "data": ""}
        await stream.aclose()

    asyncio.run(exercise())


def test_persistable_event_filters_runtime_events() -> None:
    agent_event = {
        "event": "agent.message",
        "data": '{"run_id":"4ee8e7d5-2636-4bb1-8510-94eaf2d4a72f","actor_id":"data-extraction-supervisor","content":"Inspecting the PDF"}',
    }
    run_state = {
        "event": "run.state",
        "data": '{"run_id":"4ee8e7d5-2636-4bb1-8510-94eaf2d4a72f","state":"running"}',
    }
    noisy_event = {
        "event": "messages/partial",
        "data": '[{"type":"AIMessageChunk","content":"..." }]',
    }

    assert _persistable_event(agent_event) is not None
    assert _persistable_event(run_state) is not None
    assert _persistable_event(noisy_event) is None


def test_internal_agent_message_accepts_valid_json() -> None:
    async def exercise() -> None:
        content = json.dumps(
            {
                "message_type": "status_update",
                "status": "running",
                "summary": "Inspecting the PDF.",
                "details": ["Checking table pages."],
                "metrics": {"pages_processed": 5},
                "artifacts": [],
                "warnings": [],
                "next_action": "delegate worker",
            }
        )
        normalized = await _ensure_internal_agent_message_json(content, "data-extraction-supervisor")
        payload = json.loads(normalized)
        assert payload["summary"] == "Inspecting the PDF."
        assert payload["metrics"]["pages_processed"] == 5

    asyncio.run(exercise())


def test_internal_agent_message_repairs_invalid_json_once() -> None:
    async def exercise() -> None:
        async def fake_repair(text: str, actor_name: str | None) -> str:
            assert actor_name == "table-structure-extractor"
            assert "markdown" in text
            return json.dumps(
                {
                    "message_type": "status_update",
                    "status": "completed",
                    "summary": "Extraction finished.",
                    "details": ["157 rows captured."],
                    "metrics": {"row_count": 157},
                    "artifacts": [
                        "/home/eshanegross/az_vm/atlas_platform/documents/the reference machine/the reference machine/out.csv"
                    ],
                    "warnings": [],
                    "next_action": "",
                }
            )

        normalized = await _ensure_internal_agent_message_json(
            "## markdown\nExtraction finished with 157 rows.",
            "table-structure-extractor",
            repairer=fake_repair,
        )
        payload = json.loads(normalized)
        assert payload["status"] == "completed"
        assert payload["metrics"]["row_count"] == 157
        assert payload["artifacts"] == [
            "/home/eshanegross/az_vm/atlas_platform/documents/the reference machine/the reference machine/out.csv"
        ]

    asyncio.run(exercise())


def test_internal_agent_message_falls_back_to_wrapped_payload() -> None:
    async def exercise() -> None:
        async def fake_repair(text: str, actor_name: str | None) -> str:
            return "still not json"

        raw = (
            "Extraction complete for `/home/eshanegross/az_vm/atlas_platform/documents/the reference machine/the reference machine/out.csv` "
            "with no warnings."
        )
        normalized = await _ensure_internal_agent_message_json(
            raw,
            "table-structure-extractor",
            repairer=fake_repair,
        )
        payload = json.loads(normalized)
        assert payload["summary"]
        assert payload["artifacts"] == [
            "/home/eshanegross/az_vm/atlas_platform/documents/the reference machine/the reference machine/out.csv"
        ]

    asyncio.run(exercise())


def test_tool_output_summary_suppresses_bulky_inspection_payloads() -> None:
    read_summary = _tool_output_summary(
        "read_file_anywhere",
        {"file_path": "/home/eshanegross/az_vm/atlas_platform/agent_server/src/graphs/skills/data-extraction-workflow/SKILL.md"},
        "1 ---\n2 name: data-extraction-workflow\n3 description: ...",
    )
    docs_summary = _tool_output_summary(
        "list_documents",
        {"directory": "the reference machine/the reference machine"},
        "Documents in /home/eshanegross/az_vm/atlas_platform/documents/the reference machine/the reference machine:\n the reference machine/the reference machine/04_ELECTRICAL_PARTS.pdf\n the reference machine/the reference machine/Copy of 1650_elec_parts.csv",
    )
    csv_summary = _tool_output_summary(
        "preview_csv",
        {"file_path": "the reference machine/the reference machine/Copy of 1650_elec_parts.csv"},
        "File: the reference machine/the reference machine/Copy of 1650_elec_parts.csv Columns: Location, Symbol Text, Description Rows shown: 20\nPOWER PANEL | MCB10 | CIRCUIT BREAKER",
    )

    assert read_summary == "Read SKILL.md"
    assert docs_summary == "Listed documents in the reference machine/the reference machine"
    assert "POWER PANEL" not in (csv_summary or "")
    assert "rows shown" in (csv_summary or "").lower()


def test_tool_output_summary_uses_structured_task_summary() -> None:
    summary = _tool_output_summary(
        "task",
        {"description": "Inspect repo"},
        json.dumps(
            {
                "message_type": "status_update",
                "status": "completed",
                "summary": "Repo Scout mapped the source tree.",
                "details": ["Read README.md"],
                "next_action": "Report the useful paths.",
            }
        ),
    )

    assert summary == "Repo Scout mapped the source tree. Next: Report the useful paths."
    assert "message_type" not in (summary or "")
