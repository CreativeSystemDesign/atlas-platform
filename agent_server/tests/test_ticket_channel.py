"""Slate 6.3 — the Shane ticket channel.

Evidence: the identical CNV40 question was re-asked in 4 consecutive
sessions (~$1.80, never answered); Shane's verbal false-positive verdicts
were voided by the template's own VOID clause so tickets rode open 5-6+
sessions; a successor violated "do NOT resize into that cell" 27 seconds
into its life. States key on (rule, element-id) — never the aggregate md5
ticket hash — and shane-disposed binds to geometry at disposition time.
"""

from __future__ import annotations

import asyncio
import json

from src.canvas_copilot import blockers
from src.canvas_copilot.blockers import build_tickets, open_blockers

SNAP = {
    "nodes": [{"id": "node-cnv", "label": "CNV40",
               "bbox": {"x": 996, "y": 548, "width": 576, "height": 1160}}],
    "ports": [], "edges": [], "continuations": [],
}
TRUNC = {"rule": "bbox-truncation-floor", "severity": "ERROR",
         "ids": ["node-cnv"], "detail": "box covers 12% of its cell"}
DANGLE = {"rule": "junction-dangle", "severity": "ERROR",
          "ids": ["port-j1"], "detail": "junction J-1 degree 1"}


def _iso(monkeypatch, tmp_path):
    monkeypatch.setattr(blockers, "_TICKET_STATE_FILE", tmp_path / "states.json")
    monkeypatch.setattr(blockers, "_ticket_states", None)


def test_park_suppresses_reserve_but_still_blocks_done(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    audit = {"violations": [TRUNC, DANGLE], "counts": {"ERROR": 2}}
    blockers.park_ticket("bbox-truncation-floor", "node-cnv",
                         "I believe the printed border matches my box — please rule", "test")
    t = build_tickets(audit, SNAP)
    assert [x["rule"] for x in t["live"]] == ["junction-dangle"]  # next actionable served
    assert t["parked"] and t["parked"][0]["rule"] == "bbox-truncation-floor"
    gate = open_blockers(audit, SNAP)
    assert gate["parked"] == 1 and gate["live"] == 1  # parked still counts against done


def test_dispose_is_geometry_bound(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    audit = {"violations": [TRUNC], "counts": {"ERROR": 1}}
    blockers.dispose_ticket("bbox-truncation-floor", "node-cnv",
                            "false-positive", "shane-panel", SNAP)
    t = build_tickets(audit, SNAP)
    assert not t["live"] and not t["parked"]  # disposed satisfies the gate
    # the element MOVES after the verdict -> disposition invalidated, flag lives
    moved = {**SNAP, "nodes": [{**SNAP["nodes"][0],
                                "bbox": {"x": 996, "y": 548, "width": 900, "height": 1160}}]}
    t2 = build_tickets(audit, moved)
    assert t2["live"] and t2["live"][0]["rule"] == "bbox-truncation-floor"
    assert blockers.element_state("bbox-truncation-floor", "node-cnv") is None


def test_reopen_returns_flag_to_queue_with_provenance(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    blockers.park_ticket("bbox-truncation-floor", "node-cnv", "q", "test")
    assert blockers.reopen_ticket("bbox-truncation-floor", "node-cnv",
                                  'chat-quote: "no, the box is too small, fix it"')
    audit = {"violations": [TRUNC], "counts": {"ERROR": 1}}
    assert build_tickets(audit, SNAP)["live"]
    # the reopen event is journaled for review, not silently dropped
    assert any(v.get("state") == "reopened" for v in blockers._states().values())


def test_states_survive_restart_via_file(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    blockers.park_ticket("naming", "port-x", "q", "test")
    monkeypatch.setattr(blockers, "_ticket_states", None)  # simulate process restart
    assert blockers.element_state("naming", "port-x")["state"] == "awaiting-shane"


def test_annotate_geometry_lock_on_parked_element(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    from src.canvas_copilot import bridge, tools
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp.copilot_session, "bound_page", 10)
    snapshot = {"page": 10, **SNAP}
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": snapshot, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    sent = {"n": 0}
    monkeypatch.setattr(bridge, "send_commands", lambda cmds: sent.update(n=sent["n"] + 1) or [1])
    blockers.park_ticket("bbox-truncation-floor", "node-cnv", "disputed extent", "test")
    res = asyncio.run(tools.annotate.handler(
        {"ops": [{"op": "resize", "id": "node-cnv",
                  "bbox": {"x": 996, "y": 548, "width": 900, "height": 1160}}],
         "reason": "test"}))
    out = json.loads(res["content"][0]["text"])
    assert out["refused"] == "awaiting-shane-lock" and sent["n"] == 0
    # non-geometry work elsewhere still flows
    res2 = asyncio.run(tools.annotate.handler(
        {"ops": [{"op": "rename", "id": "node-cnv", "label": "CNV40"}], "reason": "test"}))
    out2 = json.loads(res2["content"][0]["text"])
    assert out2.get("refused") != "awaiting-shane-lock"


def test_law_text_speaks_the_true_law(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    from src.canvas_copilot.blockers import _LAW, blocker_response

    assert "zero false positives" not in _LAW
    assert "only Shane may dismiss them" in _LAW
    audit = {"violations": [DANGLE], "counts": {"ERROR": 1}}
    out = blocker_response(audit, SNAP)
    assert "only Shane may dismiss them" in out["blocker"]["law"]


def test_disposed_warns_suppressed_in_audit_view(monkeypatch, tmp_path):
    """2026-07-08 (Shane): dispositions must SUPPRESS — the page-7 session
    disposed 9 WARNs and warnings_by_rule never moved."""
    _iso(monkeypatch, tmp_path)
    from src.canvas_copilot.blockers import blocker_response

    wtc = {"rule": "wire-through-component", "severity": "WARN",
           "ids": ["edge-x", "node-cnv"], "detail": "T1 crosses CNV40"}
    lbl = {"rule": "component-label-not-printed", "severity": "WARN",
           "ids": ["node-cnv"], "detail": "no printed designator within 60px"}
    audit = {"violations": [wtc, lbl], "counts": {"ERROR": 0, "WARN": 2}}
    before = blocker_response(audit, SNAP)
    assert before["warnings_by_rule"] == {"wire-through-component": 1,
                                          "component-label-not-printed": 1}
    assert before["clean"] is False
    blockers.dispose_ticket("wire-through-component", "edge-x",
                            "accepted-as-is", "chat-quote", SNAP)
    mid = blocker_response(audit, SNAP)
    assert mid["warnings_by_rule"] == {"component-label-not-printed": 1}
    assert mid["disposed_warnings"] == 1
    blockers.dispose_ticket("component-label-not-printed", "node-cnv",
                            "accepted-as-is", "chat-quote", SNAP)
    after = blocker_response(audit, SNAP)
    assert "warnings_by_rule" not in after
    assert after["disposed_warnings"] == 2
    assert after["clean"] is True  # all WARNs disposed -> page reads clean


def test_open_issue_cards_shape_and_disposition_filter(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    from src.canvas_copilot.blockers import open_issue_cards

    wtc = {"rule": "wire-through-component", "severity": "WARN",
           "ids": ["edge-x", "node-cnv"], "detail": "T1 crosses CNV40"}
    audit = {"violations": [TRUNC, wtc], "counts": {"ERROR": 1, "WARN": 1}}
    cards = open_issue_cards(audit, SNAP)
    assert [c["severity"] for c in cards] == ["ERROR", "WARN"]  # errors first
    assert cards[0]["element_id"] == "node-cnv" and cards[0]["state"] == "open"
    assert cards[0]["element_label"] == "CNV40"
    blockers.dispose_ticket("wire-through-component", "edge-x",
                            "accepted-as-is", "shane-issues-panel", SNAP)
    cards2 = open_issue_cards(audit, SNAP)
    assert [c["rule"] for c in cards2] == ["bbox-truncation-floor"]  # WARN dropped


def test_lessons_mint_and_retrieval(monkeypatch, tmp_path):
    from src.canvas_copilot import lessons

    monkeypatch.setattr(lessons, "_ROOT", tmp_path)
    monkeypatch.setattr(lessons, "_LESSONS_FILE", tmp_path / "lessons.jsonl")
    monkeypatch.setattr(lessons, "_GALLERY_FILE", tmp_path / "LESSONS.md")
    assert lessons.prompt_block() == ""
    e = lessons.mint("wire-through-component",
                     "Crossing is not connecting: only wires entering at real "
                     "terminals (K/L) connect; phases crossing a CT box without "
                     "terminals are correct-as-drawn — dispose, don't rewire.",
                     "at ct10, notice how R1 enters the bbox for CT10 at K and L?",
                     page=7, element_ids=["edge-x"])
    assert e["id"].startswith("ls-")
    got = lessons.for_rules(["wire-through-component", "naming"])
    assert len(got) == 1 and "Crossing is not connecting" in got[0]["lesson"]
    assert lessons.for_rules(["naming"]) == []
    block = lessons.prompt_block()
    assert "LESSONS" in block and "wire-through-component" in block
    assert (tmp_path / "LESSONS.md").exists()


def test_full_audit_view_carries_disposition_state(monkeypatch, tmp_path):
    """2026-07-08: the copilot read raw-inclusion in full:true as 'Shane's
    drawer clears didn't propagate' — annotate each violation with its
    disposition and make `clean` agree with the summary view."""
    _iso(monkeypatch, tmp_path)
    import asyncio
    import json as _json
    from src.canvas_copilot import bridge, tools

    contref = {"rule": "continuation-refs-unrepresented", "severity": "WARN",
               "ids": ["contref-1469-2339"], "detail": "printed ref 2/4 unannotated"}
    audit = {"page": 7, "counts": {"ERROR": 0, "WARN": 1, "INFO": 0},
             "violations": [contref]}

    async def fake_audit():
        return _json.loads(_json.dumps(audit))  # fresh copy per call

    monkeypatch.setattr(tools, "compute_page_audit", fake_audit)
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": SNAP, "snapshot_seq": 1,
                                      "snapshot_age_s": 0.1})
    before = _json.loads(asyncio.run(tools.audit_page.handler({"full": True}))["content"][0]["text"])
    assert before["clean"] is False
    assert "disposition" not in before["violations"][0]
    # Shane clicks False-positive on the drawer (stable contref id)
    blockers.dispose_ticket("continuation-refs-unrepresented", "contref-1469-2339",
                            "false-positive", "shane-issues-panel", SNAP)
    after = _json.loads(asyncio.run(tools.audit_page.handler({"full": True}))["content"][0]["text"])
    assert after["clean"] is True  # agrees with the summary view now
    assert "shane-disposed" in after["violations"][0]["disposition"]


def test_custom_verdict_and_answer_unlocks_geometry(monkeypatch, tmp_path):
    """2026-07-09 (Shane, CONNECTOR session): 'Something Else' is a third
    verdict — his typed instruction IS the ruling — and an ANSWERED card must
    unlock geometry (the lock refusing the authorized apply forced a reopen
    workaround)."""
    _iso(monkeypatch, tmp_path)
    blockers.park_ticket("connector-is-terminal", "node-conn",
                         "Re-parent A/B/C onto FAN?", "test")
    assert "node-conn" in blockers.parked_elements()  # awaiting-shane locks
    entry = blockers.answer_ticket("connector-is-terminal", "node-conn",
                                   "custom", "Keep the box; IN terminals left border, OUT wires right.",
                                   provenance="shane-issues-panel")
    assert entry["answer"]["answer"] == "custom"
    assert "IN terminals" in entry["answer"]["note"]
    # answered -> geometry UNLOCKED (apply proceeds without reopen)…
    assert "node-conn" not in blockers.parked_elements()
    # …but the card still blocks done / rides the Table until resolved.
    assert blockers.list_issues(None), "answered card stays on the Table"
    removed = blockers.resolve_answered("connector-is-terminal", "node-conn",
                                        provenance="copilot applied")
    assert removed and removed["answer"]["answer"] == "custom"
    assert not blockers.list_issues(None)


def test_yolo_evidence_never_gates_wiring():
    """Shane 2026-07-09: 'the yolo data is just evidence, not a gate.'
    yolo-extent-mismatch fires as a WARN (fix or disposition) but must NEVER
    sit in the box-gate rule set — gating on unreviewed detector proposals
    deadlocked page 8's wiring behind verdict round-trips."""
    from src.canvas_copilot.tools import _BOX_GATE_RULES

    assert "yolo-extent-mismatch" not in _BOX_GATE_RULES
    # the true box-geometry classes still hold the gate
    assert "sibling-overlap" in _BOX_GATE_RULES
    assert "bbox-truncation-floor" in _BOX_GATE_RULES
