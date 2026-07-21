"""Slate 4.5 — guided-mode latch (explicit path only; auto-latch advisory).

Evidence: two full escalation clusters ("i need you to stop and follow my
directions for a minute" -> "stop" -> "i said one thing at a time"); the
successor violated the handoff-carried mode immediately; auto-continue
re-armed mid-walkthrough producing the doctrine-violating CN40B re-add;
walkthrough rail overhead ~42% from gate+continue churn.
"""

from __future__ import annotations

import asyncio
import json

from tests.test_copilot_chain import make


def test_guided_idles_all_machine_continuation():
    async def run():
        h = make(script=[{"tool_calls": 3}, {"tool_calls": 2}], autonomous=True)
        h.session.settings["guided"] = True
        await asyncio.wait_for(h.session.handle_user_message("fix the CON42 wire"), 5)
        assert len(h.turns) == 1  # work turn ran; NO auto-continue followed
        notes = [str(e.get("note", "")) for e in h.events]
        assert any("manual (guided) mode" in n for n in notes)

    asyncio.run(run())


def test_release_never_rearms_autonomous():
    async def run():
        h = make(autonomous=False)
        h.session.settings["guided"] = True
        await h.session.set_settings({"guided": False})
        assert h.session.settings["guided"] is False
        assert h.session.settings["autonomous"] is False  # independent flags

    asyncio.run(run())


def test_geo_budget_one_batch_per_shane_message(monkeypatch, tmp_path):
    from src.canvas_copilot import bridge, tools, vectors
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    s = cp.copilot_session
    monkeypatch.setattr(s, "bound_page", 10)
    monkeypatch.setattr(s, "needs_audit", False)
    monkeypatch.setattr(s, "_geo_batch_used", False)
    monkeypatch.setitem(s.settings, "guided", True)
    snapshot = {"page": 10, "nodes": [], "ports": [], "edges": [], "continuations": [],
                "graph_stats": {"components": 0, "terminals": 0, "wires": 0, "continuations": 0}}
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": snapshot, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    async def fake_texts(page):
        return []
    monkeypatch.setattr(vectors, "page_texts", fake_texts)
    monkeypatch.setattr(bridge, "send_commands", lambda cmds: [1])
    async def fake_ack(key, timeout_s):
        return {"kind": "annotate_applied", "key": key, "page": 10, "ops": 1,
                "notes": [], "minted": {}}
    monkeypatch.setattr(bridge, "wait_for_annotate_applied", fake_ack)

    async def run(ops):
        res = await tools.annotate.handler({"ops": ops, "reason": "test"})
        return json.loads(res["content"][0]["text"])

    geo = [{"op": "add_component", "bbox": {"x": 1, "y": 1, "width": 50, "height": 50}}]
    first = asyncio.run(run(geo))
    assert first.get("refused") is None
    second = asyncio.run(run(geo))
    assert second["refused"] == "guided-mode-budget"
    # a rename-only batch is not geometry — still allowed
    third = asyncio.run(run([{"op": "rename", "id": "x", "label": "y"}]))
    assert third.get("refused") is None
    # a fresh Shane message renews the budget
    s._geo_batch_used = False
    fourth = asyncio.run(run(geo))
    assert fourth.get("refused") is None


def test_handoff_carries_guided_mode(monkeypatch, tmp_path):
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    s = cp.CopilotSession()
    s.settings["guided"] = True
    s._pending_reset = "[SESSION HANDOFF] note"
    prompt = s._take_reset_prompt()
    assert prompt.startswith("[GUIDED MODE IS ON")
    s2 = cp.CopilotSession()
    s2.settings["guided"] = False
    s2._pending_reset = "[SESSION HANDOFF] note"
    assert not s2._take_reset_prompt().startswith("[GUIDED MODE")
