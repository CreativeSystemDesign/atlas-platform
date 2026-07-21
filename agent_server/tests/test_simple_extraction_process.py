from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests

BASE_URL = os.getenv("ATLAS_LIVE_BASE_URL", "https://agent.atlas-platform.cloud")
PDF_PATH = "/home/eshanegross/az_vm/atlas_platform/documents/the reference machine/the reference machine/04_ELECTRICAL PARTS LIST_<drawing-no>.pdf"
OUTPUT_PATH = f"/tmp/atlas_simple_extraction_process_{uuid.uuid4().hex[:8]}.csv"


def _iter_sse(response: requests.Response):
    event = None
    data_lines: list[str] = []
    for raw in response.iter_lines(decode_unicode=True):
        if raw is None:
            continue
        line = raw.strip("\r")
        if not line:
            if event:
                yield event, "\n".join(data_lines)
            event = None
            data_lines = []
            continue
        if line.startswith("event:"):
            event = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data_lines.append(line.split(":", 1)[1].strip())


def _event_timestamp(body: str) -> datetime | None:
    try:
        payload = json.loads(body)
    except Exception:
        return None
    if isinstance(payload, list) and payload:
        payload = payload[0]
    if not isinstance(payload, dict):
        return None
    raw = payload.get("timestamp")
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


@pytest.mark.skipif(
    os.getenv("RUN_SIMPLE_EXTRACTION_PROCESS_TEST") != "1",
    reason="live smoke test disabled unless RUN_SIMPLE_EXTRACTION_PROCESS_TEST=1",
)
def test_simple_extraction_process() -> None:
    output_file = Path(OUTPUT_PATH)
    if output_file.exists():
        output_file.unlink()

    thread_id = str(uuid.uuid4())
    prompt = (
        f"Extract all data from the table that spans 24 pages in the PDF {PDF_PATH}. "
        f"Write the extracted data to {OUTPUT_PATH} as CSV. "
        "Use the data-extraction-supervisor and its worker team. "
        "Return a concise final status report with output path and extracted row count."
    )
    thread_res = requests.post(
        f"{BASE_URL}/threads",
        json={"thread_id": thread_id, "if_exists": "do_nothing"},
        timeout=30,
    )
    thread_res.raise_for_status()

    saw_supervisor = False
    saw_worker = False
    saw_completion = False
    saw_reattach_continuation = False
    final_reply = ""
    deadline = time.time() + 900
    with requests.post(
        f"{BASE_URL}/threads/{thread_id}/runs/live",
        json={
            "assistant_id": "atlas-architect",
            "input": {"messages": [{"type": "human", "content": prompt}]},
            "stream_mode": ["messages"],
        },
        stream=True,
        timeout=1800,
    ) as response:
        response.raise_for_status()
        for event, body in _iter_sse(response):
            if event == "agent.message":
                if "data-extraction-supervisor" in body:
                    saw_supervisor = True
                if any(
                    name in body
                    for name in (
                        "table-structure-extractor",
                        "ocr-extractor",
                        "vision-extractor",
                        "schema-mapper",
                        "spatial-analysis-agent",
                    )
                ):
                    saw_worker = True
            elif event == "timeline.event":
                if '"actor_id": "data-extraction-supervisor"' in body:
                    saw_supervisor = True
                if any(
                    f'"actor_id": "{name}"' in body
                    for name in (
                        "table-structure-extractor",
                        "ocr-extractor",
                        "vision-extractor",
                        "schema-mapper",
                        "spatial-analysis-agent",
                    )
                ):
                    saw_worker = True
            if saw_supervisor and saw_worker and not saw_reattach_continuation:
                attach_started = datetime.now(timezone.utc)
                with requests.get(
                    f"{BASE_URL}/threads/{thread_id}/runs/live",
                    stream=True,
                    timeout=180,
                ) as attach_response:
                    attach_response.raise_for_status()
                    for attach_event, attach_body in _iter_sse(attach_response):
                        if attach_event not in {"agent.message", "timeline.event", "run.state"}:
                            continue
                        event_ts = _event_timestamp(attach_body)
                        if event_ts is not None and event_ts >= attach_started:
                            saw_reattach_continuation = True
                            break
            elif event == "messages/complete":
                payload = json.loads(body)
                if isinstance(payload, list) and payload:
                    content = str(payload[0].get("content", "") or "").strip()
                    if content:
                        final_reply = content
            elif event == "run.state":
                if '"state": "completed"' in body:
                    saw_completion = True
                    break
                if (
                    '"state": "failed"' in body
                    or '"state": "error"' in body
                    or '"state": "interrupted"' in body
                ):
                    break
            if time.time() > deadline:
                break

    assert saw_supervisor, "Data extraction supervisor never became visible in the live process"
    assert saw_worker, "No data extraction worker became visible in the live process"
    assert saw_reattach_continuation, "Reattached thread did not continue receiving live runtime events"
    assert saw_completion, "Live extraction process did not complete within the smoke-test window"
    assert final_reply, "Architect did not produce a final top-level reply"
    assert OUTPUT_PATH in final_reply, "Final Architect reply did not mention the output CSV path"
    assert output_file.exists(), "Expected extracted CSV output file was not created"
