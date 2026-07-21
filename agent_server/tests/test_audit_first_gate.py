"""Slate 4.1 — the audit-first gate.

The prose FIRST-ACTION mandate was violated in 2/3 handoffs of one segment
(capture->annotate before any audit); compliant sessions reconciled in 2-7s.
The gate is binary and content-blind — it cannot misjudge the page and so
cannot become a sixth FP class. 24/27 handoffs were already compliant: this
buys determinism for the ~11% tail; the unaudited-ops counter covers the
error-killed-verification hole.
"""

from __future__ import annotations

import asyncio
import json

SNAP = {"page": 10, "nodes": [], "ports": [], "edges": [], "continuations": []}


def _wire(monkeypatch, tmp_path, needs_audit):
    from src.canvas_copilot import bridge
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp.copilot_session, "needs_audit", needs_audit)
    monkeypatch.setattr(cp.copilot_session, "unaudited_ops", 0)
    monkeypatch.setattr(cp.copilot_session, "bound_page", 10)
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": SNAP, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    sent = {"n": 0}
    monkeypatch.setattr(bridge, "send_commands", lambda cmds: sent.update(n=sent["n"] + 1) or [1])
    return cp.copilot_session, sent


def test_handoff_born_session_cannot_mutate_before_audit(monkeypatch, tmp_path):
    from src.canvas_copilot import tools

    s, sent = _wire(monkeypatch, tmp_path, needs_audit=True)
    res = asyncio.run(tools.annotate.handler(
        {"ops": [{"op": "add_component", "bbox": {"x": 1, "y": 1, "width": 50, "height": 50}}],
         "reason": "test"}))
    out = json.loads(res["content"][0]["text"])
    assert out["refused"] == "audit-first" and sent["n"] == 0


def test_completed_audit_clears_gate_and_counter(monkeypatch, tmp_path):
    from src.canvas_copilot import tools

    s, _ = _wire(monkeypatch, tmp_path, needs_audit=True)
    s.unaudited_ops = 7

    async def fake_audit():
        return {"page": 10, "violations": [], "counts": {}, "clean": True}
    monkeypatch.setattr(tools, "compute_page_audit", fake_audit)
    asyncio.run(tools.audit_page.handler({}))
    assert s.needs_audit is False and s.unaudited_ops == 0


def test_failed_audit_does_not_clear_the_gate(monkeypatch, tmp_path):
    from src.canvas_copilot import tools

    s, _ = _wire(monkeypatch, tmp_path, needs_audit=True)

    async def no_audit():
        return None  # empty bridge: "no canvas snapshot"
    monkeypatch.setattr(tools, "compute_page_audit", no_audit)
    res = asyncio.run(tools.audit_page.handler({}))
    assert json.loads(res["content"][0]["text"])["ok"] is False
    assert s.needs_audit is True  # completion clears, issuance does not


def test_take_reset_prompt_arms_the_gate(monkeypatch, tmp_path):
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    s = cp.CopilotSession()
    s.needs_audit = False
    s._pending_reset = "note"
    s._take_reset_prompt()
    assert s.needs_audit is True


def test_context_block_renders_gate_and_counter(monkeypatch, tmp_path):
    from src.canvas_copilot import bridge
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    s = cp.CopilotSession()
    s.needs_audit = True
    s.unaudited_ops = 3
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": SNAP, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    block = s._context_block()
    assert "AUDIT-FIRST GATE ARMED" in block and "unaudited_ops=3" in block
