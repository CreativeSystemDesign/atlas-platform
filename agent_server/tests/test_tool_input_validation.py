"""Slate 6.6 — canvas tools validate references before acting.

Python legs: capture resolves component labels AND node ids (typed error
with candidates, never the silent ~257KB full-page fallback that defeated
ELB41/MC347/MC34A/node-a1), and sessions are server-side page-bound with an
explicit rebind affordance (a repair once landed on page 9 while the
session's work was page 10).
"""

from __future__ import annotations

import asyncio
import json

from src.canvas_copilot.capture import resolve_component_ref

NODES = [
    {"id": "node-1", "label": "CNV40", "bbox": {"x": 989, "y": 538, "width": 251, "height": 756}},
    {"id": "node-2", "label": "ELB41", "bbox": {"x": 455, "y": 213, "width": 162, "height": 135}},
    {"id": "node-3", "label": "CN40A", "bbox": {"x": 100, "y": 100, "width": 40, "height": 40}},
    {"id": "node-4", "label": "CN40A", "bbox": {"x": 300, "y": 100, "width": 40, "height": 40}},
]


def test_resolver_matches_id_and_label_case_insensitive():
    node, err = resolve_component_ref(NODES, "node-2")
    assert err is None and node["id"] == "node-2"
    node, err = resolve_component_ref(NODES, "elb41")  # Shane types lowercase
    assert err is None and node["id"] == "node-2"


def test_resolver_unknown_gets_suggestions_never_full_page():
    node, err = resolve_component_ref(NODES, "ELB40")
    assert node is None and err
    assert "ELB41" in err and "NEVER" in err


def test_resolver_duplicate_labels_return_candidates_never_a_guess():
    node, err = resolve_component_ref(NODES, "CN40A")
    assert node is None and err
    assert "ambiguous" in err and "node-3" in err and "node-4" in err


def test_capture_unknown_label_is_typed_error(monkeypatch):
    from src.canvas_copilot import bridge, tools

    snapshot = {"page": 10, "nodes": NODES, "ports": [], "edges": [], "continuations": []}
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": snapshot, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    res = asyncio.run(tools.capture.handler({"component_id": "MC999"}))
    out = json.loads(res["content"][0]["text"])
    assert out["ok"] is False and out.get("unknown_component") is True


# --- page binding ------------------------------------------------------------

def _bound_session(monkeypatch, tmp_path, bound):
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp.copilot_session, "bound_page", bound)
    return cp.copilot_session


def _snap(monkeypatch, page):
    from src.canvas_copilot import bridge

    snapshot = {"page": page, "nodes": [], "ports": [], "edges": [], "continuations": []}
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": snapshot, "snapshot_seq": 1, "snapshot_age_s": 0.1})


def test_page_guard_binds_first_then_refuses_flips(monkeypatch, tmp_path):
    from src.canvas_copilot import tools

    s = _bound_session(monkeypatch, tmp_path, None)
    _snap(monkeypatch, 10)
    assert tools._page_guard({}) is None  # first contact binds
    assert s.bound_page == 10
    _snap(monkeypatch, 9)  # Shane (or a stray click) flips the canvas
    err = tools._page_guard({})
    assert err and err["refused"] == "page-flip"
    assert "page_ack:9" in err["note"] and err["bound_page"] == 10


def test_page_ack_rebinds_only_when_it_matches_reality(monkeypatch, tmp_path):
    from src.canvas_copilot import tools

    s = _bound_session(monkeypatch, tmp_path, 10)
    _snap(monkeypatch, 9)
    bad = tools._page_guard({"page_ack": 11})  # acked a page the canvas is NOT on
    assert bad and bad["refused"] == "page-ack-mismatch"
    assert s.bound_page == 10
    ok = tools._page_guard({"page_ack": 9})
    assert ok is None and s.bound_page == 9


def test_annotate_refuses_on_page_flip_before_dispatch(monkeypatch, tmp_path):
    from src.canvas_copilot import bridge, tools

    _bound_session(monkeypatch, tmp_path, 10)
    _snap(monkeypatch, 9)
    sent = {"n": 0}
    monkeypatch.setattr(bridge, "send_commands", lambda cmds: sent.update(n=sent["n"] + 1) or [1])
    res = asyncio.run(tools.annotate.handler(
        {"ops": [{"op": "add_component", "bbox": {"x": 1, "y": 1, "width": 50, "height": 50}}],
         "reason": "test"}))
    out = json.loads(res["content"][0]["text"])
    assert out["refused"] == "page-flip" and sent["n"] == 0
