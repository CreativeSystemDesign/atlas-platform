"""Slate 6.7 — reset_session becomes unbrickable.

Root cause (verified in the page-10 forensics): tool-call serialization at
extreme context leaks XML parameter markup INTO the JSON done_summary; the
old strict schema then failed "open_items required" 10 consecutive times
while the agent believed it complied. The salvage layer: lenient coercion,
raw-bytes spill, echo-error then degraded handoff for signal-free payloads,
persisted pending resets (commit = the note persisting), synthesized
teardown handoffs, and orphan-proof queued messages.
"""

from __future__ import annotations

import asyncio
import json

from src.canvas_copilot.copilot import CopilotSession, _coerce_reset_payload


# --- coercion shim -----------------------------------------------------------

JAMMED = {
    "done_summary": (
        'Boxed CNV40 and INV40, audit clean on both</parameter>\n'
        '<parameter name="open_items">["wire M40 phase column", "review CON42"]'
        '</parameter>\n<parameter name="next_action">audit_page then wire M40'
    ),
}


def test_jammed_fields_split_and_markup_stripped():
    payload, notes = _coerce_reset_payload(JAMMED)
    assert payload["done_summary"] == "Boxed CNV40 and INV40, audit clean on both"
    assert payload["open_items"] == ["wire M40 phase column", "review CON42"]
    assert payload["next_action"] == "audit_page then wire M40"
    assert any("split jammed field 'open_items'" in n for n in notes)


def test_stringy_lists_and_defaults():
    payload, notes = _coerce_reset_payload(
        {"done_summary": "did things", "open_items": "fix A\n- fix B; fix C"})
    assert payload["open_items"] == ["fix A", "fix B", "fix C"]
    assert "UNVERIFIED" not in payload["done_summary"]
    assert "next_action" in payload and payload["next_action"]  # defaulted
    assert any("defaulted missing next_action" in n for n in notes)


def test_unparsed_tool_input_recovers():
    raw = {"__unparsedToolInput": json.dumps(
        {"done_summary": "ok", "open_items": [], "next_action": "go"})}
    payload, notes = _coerce_reset_payload(raw)
    assert payload["done_summary"] == "ok" and payload["next_action"] == "go"
    assert any("__unparsedToolInput" in n for n in notes)


def test_clean_payload_passes_untouched():
    clean = {"done_summary": "d", "open_items": ["a"], "next_action": "n"}
    payload, notes = _coerce_reset_payload(dict(clean))
    assert payload == clean and notes == []


# --- queue_reset integration -------------------------------------------------

def _fresh_session(monkeypatch, tmp_path):
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp, "_SPILL_DIR", tmp_path / "spill")
    s = CopilotSession()

    async def no_audit():
        return None
    import src.canvas_copilot.tools as tools_mod
    monkeypatch.setattr(tools_mod, "compute_page_audit", no_audit)
    import src.canvas_copilot.bridge as bridge_mod
    monkeypatch.setattr(bridge_mod, "warning_ledger", lambda page=None: [])
    return s, cp


def test_queue_reset_salvages_and_labels(monkeypatch, tmp_path):
    s, cp = _fresh_session(monkeypatch, tmp_path)
    res = asyncio.run(s.queue_reset(dict(JAMMED)))
    assert res["queued"] is True and res.get("salvage")
    assert "[SALVAGED HANDOFF" in res["resume_prompt"]
    assert "wire M40 phase column" in res["resume_prompt"]
    # raw bytes spilled for forensics
    spills = list((tmp_path / "spill").glob("*reset_salvage.json"))
    assert spills and "done_summary" in spills[0].read_text()
    # the note IS the commit: persisted immediately
    saved = json.loads((tmp_path / "session.json").read_text())
    assert saved["pending_reset"] == res["resume_prompt"]


def test_signal_free_echoes_once_then_degrades(monkeypatch, tmp_path):
    s, cp = _fresh_session(monkeypatch, tmp_path)
    first = asyncio.run(s.queue_reset({"bogus": "<parameter/>"}))
    assert first["queued"] is False and "received" in first
    second = asyncio.run(s.queue_reset({"bogus": "<parameter/>"}))
    assert second["queued"] is True
    assert "DEGRADED" in second["resume_prompt"]
    assert s._pending_reset  # successor is note-born regardless


def test_pending_reset_and_queue_survive_restart(monkeypatch, tmp_path):
    s, cp = _fresh_session(monkeypatch, tmp_path)
    asyncio.run(s.queue_reset({"done_summary": "d", "open_items": [], "next_action": "n"}))
    s._queued_messages.append("orphan candidate")
    s._persist()
    s2 = CopilotSession()  # same monkeypatched _SESSION_FILE
    assert s2._pending_reset and "): d" in s2._pending_reset  # 6.11 reworded the DONE stamp
    # Full-SDK panel (2026-07-07): queue entries normalize to {text, images?}
    # dicts on load; persisted plain strings (this append) stay readable.
    assert list(s2._queued_messages) == [{"text": "orphan candidate"}]


def test_new_session_synthesizes_teardown_handoff(monkeypatch, tmp_path):
    s, cp = _fresh_session(monkeypatch, tmp_path)
    s.session_id = "sess-123"
    s._queued_messages.append("shane: fix the CON42 wire")
    s._turn_last_text = "I was mid-way through wiring M40"
    asyncio.run(s.new_session())
    note = s._pending_reset
    assert note and "[SYNTHESIZED HANDOFF" in note
    assert "ORPHANED SHANE MESSAGE" in note and "fix the CON42 wire" in note
    assert "UNVERIFIED" in note  # no claim authority
    assert not s._queued_messages  # orphans ride the note, not the queue
    # a genuinely fresh session (no session id) stays blank
    s2, _ = _fresh_session(monkeypatch, tmp_path)
    s2.session_id = None
    s2._pending_reset = None
    asyncio.run(s2.new_session())
    assert s2._pending_reset is None
