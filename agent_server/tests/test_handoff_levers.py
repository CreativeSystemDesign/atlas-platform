"""Slate 7.1 — handoff-startup-cost-reduction.

Evidence (mined from the 27-handoff replay): successor overheads of
104.0/405.6/154.7/44.0s at handoff->first-mutating-op; a full-page re-survey
resume ran 219.8s to first op vs 28.2s when the message carried exact
targets; ELB41 without coords took 8 captures/~120s vs 1 capture/15-16s for
coord-carrying MC34A/MC347. The killed clauses stay dead here: no
VERIFIED-EXTENTS hard-reject (server-autofill with WARN on gaps only), and
no pin without staleness metadata (pins-without-staleness would
institutionalize the 17-stale-ops zombie-capture defect, slate 4.2/6.2).
"""

from __future__ import annotations

import asyncio

from src.canvas_copilot.copilot import CopilotSession, _resolve_verified_extents, compose_handoff_prompt

BASE = {"done_summary": "boxed CNV40", "open_items": [], "next_action": "continue"}


# --- compose_handoff_prompt: PINNED LOOKS ------------------------------------

def test_pinned_looks_section_renders_region_and_staleness():
    looks = [
        {"page": 10, "region": {"x": 100, "y": 200, "width": 300, "height": 400},
         "overlay_on": True, "age_events": 3, "age_s": 12.4},
        {"page": 10, "region": {"x": 0, "y": 0, "width": 50, "height": 50},
         "overlay_on": False, "age_events": 1472, "age_s": 4776.0},
    ]
    prompt = compose_handoff_prompt(BASE, [], pinned_looks=looks)
    assert "PINNED LOOKS" in prompt
    assert "RE-LOOKED" in prompt  # the explicit stale-pin warning
    assert "page 10, region x=100,y=200,w=300,h=400 (overlay on) — 3 events / 12s old" in prompt
    assert "1472 events / 4776s old" in prompt


def test_pinned_looks_section_omitted_when_empty():
    assert "PINNED LOOKS" not in compose_handoff_prompt(BASE, [])
    assert "PINNED LOOKS" not in compose_handoff_prompt(BASE, [], pinned_looks=[])


def test_pinned_looks_capped_at_four_even_if_caller_passes_more():
    looks = [{"page": 10, "region": {"x": i, "y": 0, "width": 1, "height": 1},
              "overlay_on": True, "age_events": i, "age_s": 0.0} for i in range(6)]
    prompt = compose_handoff_prompt(BASE, [], pinned_looks=looks)
    assert prompt.count("region x=") == 4


# --- compose_handoff_prompt: VERIFIED-EXTENTS --------------------------------

def test_verified_extents_table_renders_bbox_and_provenance():
    rows = [{"node_id": "n1", "label": "CNV40",
             "bbox": {"x": 1, "y": 2, "width": 3, "height": 4},
             "provenance": "Shane: perfect on CNV40", "missing": False}]
    prompt = compose_handoff_prompt(BASE, [], verified_extents=rows)
    assert "VERIFIED-EXTENTS" in prompt
    assert "CNV40 -> bbox {'x': 1, 'y': 2, 'width': 3, 'height': 4}" in prompt
    assert "[stamp: Shane: perfect on CNV40]" in prompt


def test_verified_extents_missing_node_is_warn_never_reject():
    rows = [{"node_id": "n2", "label": "n2", "bbox": {"x": 9, "y": 9, "width": 9, "height": 9},
             "provenance": "Shane: perfect on GHOST", "missing": True}]
    prompt = compose_handoff_prompt(BASE, [], verified_extents=rows)
    assert "WARN: stamped node n2 (n2) not found in the current snapshot" in prompt
    # the killed clause stays dead: this table never refuses anything
    assert "reject" not in prompt.lower() or "never a reject" in prompt.lower()
    assert "never a reject" in prompt


def test_verified_extents_omitted_when_empty():
    assert "VERIFIED-EXTENTS" not in compose_handoff_prompt(BASE, [])
    assert "VERIFIED-EXTENTS" not in compose_handoff_prompt(BASE, [], verified_extents=[])


# --- _resolve_verified_extents: label resolution + missing-node flag --------

def test_resolve_verified_extents_labels_found_node():
    from src.canvas_copilot import blockers

    blockers.stamp_extent("node-1", {"x": 10, "y": 20, "width": 30, "height": 40},
                          "Shane: perfect on CNV40")
    snap = {"nodes": [{"id": "node-1", "label": "CNV40",
                       "bbox": {"x": 10, "y": 20, "width": 30, "height": 40}}]}
    rows = _resolve_verified_extents(snap)
    assert len(rows) == 1
    assert rows[0]["label"] == "CNV40"
    assert rows[0]["missing"] is False
    assert rows[0]["bbox"] == {"x": 10, "y": 20, "width": 30, "height": 40}
    assert rows[0]["provenance"] == "Shane: perfect on CNV40"


def test_resolve_verified_extents_flags_node_absent_from_snapshot():
    from src.canvas_copilot import blockers

    blockers.stamp_extent("node-ghost", {"x": 0, "y": 0, "width": 5, "height": 5},
                          "Shane: perfect on GHOST")
    rows = _resolve_verified_extents({"nodes": []})
    assert len(rows) == 1
    assert rows[0]["missing"] is True
    assert rows[0]["label"] == "node-ghost"  # falls back to the node id, never invented


def test_resolve_verified_extents_empty_when_no_stamps():
    assert _resolve_verified_extents({"nodes": []}) == []


# --- compose_handoff_prompt: next_coords pass-through ------------------------

def test_next_coords_pass_through_renames_next_action_line():
    handoff = {**BASE, "next_action": "resize CNV40 to the printed border",
               "next_coords": {"x": 996, "y": 548}}
    prompt = compose_handoff_prompt(handoff, [])
    assert prompt.rstrip().endswith(
        "THEN (predecessor's explicit coords — {'x': 996, 'y': 548} — verify once, "
        "skip the re-survey): resize CNV40 to the printed border")


def test_next_action_line_unchanged_without_coords():
    # Regression guard: the pre-7.1 shape (tested elsewhere) must survive.
    prompt = compose_handoff_prompt(BASE, [])
    assert prompt.rstrip().endswith("THEN: continue")


# --- bridge.recent_captures: staleness in events AND seconds -----------------

def test_recent_captures_orders_newest_first_and_computes_staleness(monkeypatch):
    from collections import deque

    from src.canvas_copilot import bridge as bridge_mod

    monkeypatch.setattr(bridge_mod, "_capture_log", [])
    monkeypatch.setattr(bridge_mod, "_events", deque(maxlen=300))
    monkeypatch.setattr(bridge_mod.time, "time", lambda: 1000.0)
    bridge_mod.log_capture(10, {"x": 0, "y": 0, "width": 100, "height": 100}, True)
    bridge_mod._events.append({"seq": 5})  # 5 events elapsed since the first capture
    monkeypatch.setattr(bridge_mod.time, "time", lambda: 1037.0)
    bridge_mod.log_capture(10, {"x": 500, "y": 500, "width": 50, "height": 50}, False)
    bridge_mod._events.append({"seq": 9})  # 4 more events since the second capture
    monkeypatch.setattr(bridge_mod.time, "time", lambda: 1050.0)  # "now"

    out = bridge_mod.recent_captures(limit=4)
    assert len(out) == 2
    assert out[0]["region"] == {"x": 500, "y": 500, "width": 50, "height": 50}  # newest first
    assert out[0]["age_events"] == 4 and out[0]["age_s"] == 13.0
    assert out[1]["region"] == {"x": 0, "y": 0, "width": 100, "height": 100}
    assert out[1]["age_events"] == 9 and out[1]["age_s"] == 50.0


def test_recent_captures_respects_limit_and_empty_log(monkeypatch):
    from collections import deque

    from src.canvas_copilot import bridge as bridge_mod

    monkeypatch.setattr(bridge_mod, "_capture_log", [])
    monkeypatch.setattr(bridge_mod, "_events", deque(maxlen=300))
    assert bridge_mod.recent_captures(limit=4) == []
    for i in range(6):
        bridge_mod.log_capture(10, {"x": i, "y": 0, "width": 1, "height": 1}, True)
    assert len(bridge_mod.recent_captures(limit=4)) == 4
    assert bridge_mod.recent_captures(limit=0) == []


# --- blockers.list_extent_stamps ---------------------------------------------

def test_list_extent_stamps_only_returns_extent_prefixed_state():
    from src.canvas_copilot import blockers

    blockers.stamp_extent("node-1", {"x": 1, "y": 1, "width": 1, "height": 1}, "Shane: perfect")
    # a distractor state under a different key shape must not leak in.
    blockers.park_ticket("bbox-truncation-floor", "node-2", "is this real?", "audit")
    stamps = blockers.list_extent_stamps()
    assert list(stamps.keys()) == ["node-1"]
    assert stamps["node-1"]["bbox"] == {"x": 1, "y": 1, "width": 1, "height": 1}


# --- handoff -> first-op metric hook ------------------------------------------

def _fresh_session(monkeypatch, tmp_path):
    from src.canvas_copilot import bridge as bridge_mod
    from src.canvas_copilot import copilot as cp
    import src.canvas_copilot.tools as tools_mod

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp, "_SPILL_DIR", tmp_path / "spill")
    s = CopilotSession()

    async def no_audit():
        return None

    monkeypatch.setattr(tools_mod, "compute_page_audit", no_audit)
    monkeypatch.setattr(bridge_mod, "warning_ledger", lambda page=None: [])
    monkeypatch.setattr(bridge_mod, "recent_captures", lambda limit=4: [])
    monkeypatch.setattr(bridge_mod, "get_state", lambda: {"snapshot": {}})
    return s, cp, bridge_mod


def test_take_reset_prompt_stamps_handoff_ts(monkeypatch, tmp_path):
    s, cp, _ = _fresh_session(monkeypatch, tmp_path)
    assert s._handoff_ts is None
    asyncio.run(s.queue_reset({"done_summary": "d", "open_items": [], "next_action": "n"}))
    s._take_reset_prompt()
    assert s._handoff_ts is not None


def test_note_first_op_after_handoff_logs_once_then_noop(monkeypatch, tmp_path):
    s, cp, _ = _fresh_session(monkeypatch, tmp_path)
    calls = []
    monkeypatch.setattr(cp.logger, "info", lambda *a, **k: calls.append(a))
    asyncio.run(s.queue_reset({"done_summary": "d", "open_items": [], "next_action": "n"}))
    s._take_reset_prompt()

    s.note_first_op_after_handoff()
    assert s._handoff_ts is None
    assert any("handoff -> first successor op" in str(a[0]) for a in calls)

    calls.clear()
    s.note_first_op_after_handoff()  # idempotent: no handoff pending -> no second log
    assert calls == []


def test_note_first_op_before_any_handoff_is_a_noop(monkeypatch, tmp_path):
    s, cp, _ = _fresh_session(monkeypatch, tmp_path)
    calls = []
    monkeypatch.setattr(cp.logger, "info", lambda *a, **k: calls.append(a))
    s.note_first_op_after_handoff()  # never pressured, never crashes
    assert calls == []


# --- integration: queue_reset actually attaches pinned looks + extents ------

def test_queue_reset_attaches_pinned_looks_and_verified_extents(monkeypatch, tmp_path):
    from src.canvas_copilot import blockers

    s, cp, bridge_mod = _fresh_session(monkeypatch, tmp_path)
    monkeypatch.setattr(
        bridge_mod, "recent_captures",
        lambda limit=4: [{"page": 10, "region": {"x": 1, "y": 2, "width": 3, "height": 4},
                          "overlay_on": True, "age_events": 2, "age_s": 5.0}])
    monkeypatch.setattr(
        bridge_mod, "get_state",
        lambda: {"snapshot": {"nodes": [{"id": "n1", "label": "CNV40",
                                         "bbox": {"x": 1, "y": 1, "width": 1, "height": 1}}]}})
    blockers.stamp_extent("n1", {"x": 1, "y": 1, "width": 1, "height": 1}, "Shane: perfect on CNV40")

    res = asyncio.run(s.queue_reset({"done_summary": "d", "open_items": [], "next_action": "n"}))
    assert "PINNED LOOKS" in res["resume_prompt"]
    assert "VERIFIED-EXTENTS" in res["resume_prompt"]
    assert "CNV40" in res["resume_prompt"]
