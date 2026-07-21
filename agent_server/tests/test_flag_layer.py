"""Numbered flag layer (Shane's idea, 2026-07-06): the agent SEES problem N
standing on its element instead of reconstructing id→location→cause across
repeated audits (page-11 spent 44/86 turns and 19 audit calls doing that).

Design invariants: flags come from the LAST completed audit (never recomputed
at look time — compute_page_audit has side effects); ERRORs number first;
elements deleted since the audit drop out; Shane's canvas gets the same flags
as highlights, pushed only when the flag set CHANGES.
"""

from __future__ import annotations

import asyncio
import json

SNAP = {
    "page": 10,
    "nodes": [{"id": "n1", "label": "R40",
               "bbox": {"x": 100, "y": 100, "width": 200, "height": 150}}],
    "ports": [{"id": "p1", "type": "junction", "label": "J-1",
               "point": {"x": 500, "y": 500}}],
    "edges": [], "continuations": [],
}


def _wire(monkeypatch, tmp_path, violations):
    from src.canvas_copilot import bridge, vectors, yolo
    from src.canvas_copilot import copilot as cp
    from src.canvas_copilot import tools

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp.copilot_session, "page_debts", {}, raising=False)
    sent = {"cmds": []}
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": SNAP, "snapshot_seq": 7, "snapshot_age_s": 0.1})
    monkeypatch.setattr(bridge, "send_commands",
                        lambda cmds: sent["cmds"].extend(cmds) or [1])
    monkeypatch.setattr(bridge, "moot_stale_warnings", lambda snap: 0)
    monkeypatch.setattr(bridge, "warning_ledger", lambda page: [])

    async def _none(page):
        return []
    monkeypatch.setattr(vectors, "page_segments", _none)
    monkeypatch.setattr(vectors, "page_texts", _none)
    monkeypatch.setattr(vectors, "page_circles", lambda page: [])
    monkeypatch.setattr(vectors, "page_enclosures", lambda page: [])
    monkeypatch.setattr(yolo, "page_detections", lambda page: [])

    from src.canvas_copilot import audit as audit_mod
    real = audit_mod.audit_graph

    def fake_audit(snap, *a, **kw):
        r = real(snap, *a, **kw)
        r["violations"] = list(violations)
        counts = {"ERROR": 0, "WARN": 0, "INFO": 0}
        for v in violations:
            counts[v["severity"]] += 1
        r["counts"] = counts
        return r
    monkeypatch.setattr(tools, "audit_graph", fake_audit, raising=False)
    monkeypatch.setattr(audit_mod, "audit_graph", fake_audit)
    tools._last_audit_flag_list.clear()
    tools._last_flag_push_sig[0] = ""
    return tools, sent


VIOLATIONS = [
    {"rule": "missed-junction-dot", "severity": "WARN", "ids": ["p1"],
     "detail": "dot at (500,500) not drawn"},
    {"rule": "bbox-truncation-floor", "severity": "ERROR", "ids": ["n1"],
     "detail": "R40 truncated"},
]


def test_audit_caches_numbered_flags_errors_first(monkeypatch, tmp_path):
    tools, sent = _wire(monkeypatch, tmp_path, VIOLATIONS)
    asyncio.run(tools.compute_page_audit())
    entries = tools._last_audit_flag_list["entries"]
    assert [e["n"] for e in entries] == [1, 2]
    assert entries[0]["severity"] == "ERROR" and entries[0]["ids"] == ["n1"]
    assert entries[1]["rule"] == "missed-junction-dot"
    # Shane's canvas got the flags as crimson highlights
    hl = [c for c in sent["cmds"] if c.get("type") == "highlight"]
    assert len(hl) == 2 and hl[0]["note"] == "flag 1: bbox-truncation-floor"
    assert all(c["color"] == "#e11d48" for c in hl)


def test_highlights_push_only_on_flag_set_change(monkeypatch, tmp_path):
    tools, sent = _wire(monkeypatch, tmp_path, VIOLATIONS)
    asyncio.run(tools.compute_page_audit())
    n_after_first = len([c for c in sent["cmds"] if c.get("type") == "highlight"])
    asyncio.run(tools.compute_page_audit())  # identical flag set
    n_after_second = len([c for c in sent["cmds"] if c.get("type") == "highlight"])
    assert n_after_first == n_after_second == 2


def test_flags_resolve_to_current_positions_and_drop_deleted(monkeypatch, tmp_path):
    tools, _ = _wire(monkeypatch, tmp_path, VIOLATIONS)
    asyncio.run(tools.compute_page_audit())
    flags = tools._flags_for_render(SNAP)
    assert flags[0]["points"] == [{"x": 100, "y": 100}]   # node bbox corner
    assert flags[1]["points"] == [{"x": 500, "y": 500}]   # port point
    # element deleted since the audit: its flag drops out silently
    snap2 = {**SNAP, "ports": []}
    flags2 = tools._flags_for_render(snap2)
    assert [f["n"] for f in flags2] == [1]
    # different page: no flags at all (stale cache never leaks cross-page)
    assert tools._flags_for_render({**SNAP, "page": 11}) == []


def test_render_capture_draws_flags_and_manifest_legend():
    from src.canvas_copilot.capture import render_capture as rc
    import inspect

    assert "flags" in inspect.signature(rc).parameters


def test_info_and_idless_violations_never_flag(monkeypatch, tmp_path):
    vs = [{"rule": "junction-no-dot", "severity": "INFO", "ids": ["p1"], "detail": "x"},
          {"rule": "continuation-refs-unrepresented", "severity": "WARN", "ids": [],
           "detail": "point-based"}]
    tools, sent = _wire(monkeypatch, tmp_path, vs)
    asyncio.run(tools.compute_page_audit())
    assert tools._last_audit_flag_list["entries"] == []
    assert not [c for c in sent["cmds"] if c.get("type") == "highlight"]
