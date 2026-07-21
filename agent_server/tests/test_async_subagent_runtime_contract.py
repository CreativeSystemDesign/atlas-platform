from __future__ import annotations

from src.schemas import RunCreate, RunStatus


def test_run_create_accepts_langgraph_sdk_stream_mode_string() -> None:
    body = RunCreate.model_validate(
        {
            "assistant_id": "extraction-orchestrator",
            "input": {"messages": [{"role": "user", "content": "smoke"}]},
            "stream_mode": "values",
        }
    )

    assert body.assistant_id == "extraction-orchestrator"
    assert body.stream_mode == "values"


def test_run_status_includes_sdk_visible_cancelled_state() -> None:
    assert RunStatus.cancelled.value == "cancelled"
