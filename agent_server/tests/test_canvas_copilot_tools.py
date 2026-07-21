"""Unit tests for canvas copilot tool helpers."""

from src.canvas_copilot.tools import _clean_reason


def test_clean_reason_strips_trailing_quote_tic() -> None:
    assert _clean_reason('Aligning wire to printed conductor"') == "Aligning wire to printed conductor"


def test_clean_reason_strips_fully_quoted() -> None:
    assert _clean_reason('"Boxing MC323"') == "Boxing MC323"
    assert _clean_reason("“Boxing MC323”") == "Boxing MC323"


def test_clean_reason_keeps_interior_quotes() -> None:
    assert _clean_reason('Rename per Shane\'s "T-K-T1" convention') == 'Rename per Shane\'s "T-K-T1" convention'


def test_clean_reason_handles_non_strings() -> None:
    assert _clean_reason(None) is None
    assert _clean_reason(42) is None
    assert _clean_reason('  "  ') is None


def test_scoped_get_state_filters_and_stays_small(monkeypatch):
    import asyncio
    import json

    from src.canvas_copilot import bridge, tools

    nodes = [
        {"id": f"node-{i}", "label": f"CN{i}", "bbox": {"x": 100 * i, "y": 50, "width": 60, "height": 40},
         "identity": None, "attachments": [{"id": f"att-{i}", "text": "junk", "bbox": {}}]}
        for i in range(30)
    ]
    ports = [
        {"id": f"port-{i}", "label": f"T-{i}", "type": "terminal", "parentId": f"node-{i}",
         "point": {"x": 100 * i + 10, "y": 60}}
        for i in range(30)
    ]
    edges = [
        {"id": f"edge-{i}", "label": f"10{i}K", "sourcePortId": f"port-{i}", "targetPortId": f"port-{i+1}",
         "path": [{"x": 100 * i + 10, "y": 60}, {"x": 100 * (i + 1) + 10, "y": 60}]}
        for i in range(29)
    ]
    snapshot = {"page": 7, "nodes": nodes, "ports": ports, "edges": edges, "continuations": []}
    monkeypatch.setattr(bridge, "get_state", lambda **kw: {"snapshot": snapshot, "snapshot_age_s": 0.1, "snapshot_seq": 1})

    async def run(args):
        result = await tools.get_state.handler(args)
        return json.loads(result["content"][0]["text"])

    # CN6 area: region around node-6 + label filter, ids only
    out = asyncio.run(run({
        "region": {"x": 580, "y": 0, "width": 140, "height": 200},
        "label": "CN6",
        "fields": "ids",
    }))
    assert out["counts"]["components"] == 1
    assert out["components"][0]["id"] == "node-6"
    assert "attachments" not in json.dumps(out)
    payload = json.dumps(out)
    assert len(payload) < 2048, f"scoped payload too big: {len(payload)}B"

    # region-only wires: path intersection
    out2 = asyncio.run(run({"region": {"x": 0, "y": 0, "width": 250, "height": 200}, "kinds": ["wires"], "fields": "ids"}))
    assert out2["counts"]["wires"] == 3  # edges 0-2 each have a path endpoint with x<=250
    assert out2["counts"]["components"] is None

    # stats only
    out3 = asyncio.run(run({"fields": "stats"}))
    assert "components" not in out3
    assert out3["counts"]["components"] == 30

    # no args -> full passthrough unchanged
    async def run_raw(args):
        result = await tools.get_state.handler(args)
        return json.loads(result["content"][0]["text"])
    full = asyncio.run(run_raw({}))
    assert full["snapshot"]["nodes"][0]["attachments"]


def test_page_circles_extraction_and_classes(tmp_path, monkeypatch):
    from src.canvas_copilot import vectors

    monkeypatch.setattr(vectors, "_CIRCLE_CACHE_DIR", tmp_path)
    vectors._circles_mem.clear()
    circles = vectors.page_circles(7)
    assert circles, "page 7 must yield printed circles"
    # fill-v2 (slate 2.2): every record carries fill state; junction class
    # REQUIRES filled — stroke-only rings/pins are terminal-class at any size.
    assert all("filled" in c for c in circles)
    junctions = [c for c in circles if c["class"] == "junction"]
    assert junctions, "true filled dots must classify as junctions"
    assert all(c["filled"] and c["d"] <= 30 for c in junctions)
    assert all(not (c["filled"] and c["d"] <= 30) for c in circles if c["class"] == "terminal")
    # sidecar cache written and reused
    assert (tmp_path / "circles-page-007.json").exists()
    vectors._circles_mem.clear()
    again = vectors.page_circles(7)
    assert again == circles

    kept, dropped = vectors.circles_in_region(circles, {"x": 0, "y": 0, "width": 2481, "height": 3509})
    assert len(kept) == len(circles) and dropped == 0
    # junctions sort first
    assert kept[0]["class"] == "junction"


def test_page_enclosures_find_module_interiors(tmp_path, monkeypatch):
    import json as _json

    from src.canvas_copilot import vectors

    monkeypatch.setattr(vectors, "_CIRCLE_CACHE_DIR", tmp_path)
    vectors._circles_mem.clear()
    vectors._enclosures_mem.clear()
    segs = _json.load(open("../.atlas/experiment-archive/arm1-page10/vectors.json"))
    for s in segs:
        s["length"] = 0.0
    monkeypatch.setitem(vectors._cache, 10, (None, segs))
    enc = vectors.page_enclosures(10)
    assert enc, "no enclosures found on p10"
    # Airtight semantics (dash-v2, Shane's rule 2026-07-04): CNV40's interior is
    # found EXACTLY (y548-1708 = ground truth; the k=4 era reported a degenerate
    # sliver instead). INV40 must NOT enclose: its printed top border has a real
    # 292px opening where BAT40/CON4 (own part number = separate component)
    # notches into it — a genuine connection area, not a dash gap.
    cnv = [e for e in enc if 960 <= e["bbox"]["x"] <= 1020 and 1100 <= e["bbox"]["height"] <= 1220]
    assert cnv, f"CNV40 interior not found; got {[e['bbox'] for e in enc[:6]]}"
    assert abs(cnv[0]["bbox"]["y"] - 548) <= 12
    inv_sliver = [e for e in enc if 1540 <= e["bbox"]["x"] <= 1660 and e["bbox"]["height"] > 1200
                  and e["bbox"]["width"] < 200]
    assert not inv_sliver, "the k=4 degenerate INV40 sliver is back — sealing regressed"
    # region filter: a crop of CNV40's TOP must report extends_beyond_frame
    top_crop = {"x": 950, "y": 520, "width": 400, "height": 300}
    kept, _ = vectors.enclosures_in_region(enc, top_crop)
    hit = [e for e in kept if e["bbox"].get("height", 0) > 1000]
    assert hit and hit[0].get("extends_beyond_frame") is True
    # cache round-trip (versioned payload)
    assert (tmp_path / "enclosures-page-010.json").exists()


def test_audit_graph_reproduces_grader_counts_on_archived_arms():
    import json as _json

    from src.canvas_copilot.audit import audit_graph

    # arm 3: 7 junction dangles, 10 unwired nodes, naming 92/120 non-compliant
    g3 = _json.load(open("../.atlas/experiment-archive/arm3-page10/graph.json"))
    g3 = g3.get("graph", g3)
    r3 = audit_graph(g3)
    by_rule = {}
    for v in r3["violations"]:
        by_rule.setdefault(v["rule"], []).append(v)
    assert len(by_rule.get("junction-dangle", [])) == 7
    assert len(by_rule.get("unwired-node", [])) == 10
    naming = by_rule.get("naming", [])
    # graders hand-scored 92/120; the deterministic strict regex says 94/120
    # (2-label rubric drift) — the rule's own arithmetic is canonical.
    assert naming and "94/120" in naming[0]["detail"]
    assert r3["clean"] is False

    # arm 1: naming 0/135 compliant -> 135 violations
    g1 = _json.load(open("../.atlas/experiment-archive/arm1-page10/graph.json"))
    g1 = g1.get("graph", g1)
    r1 = audit_graph(g1)
    n1 = [v for v in r1["violations"] if v["rule"] == "naming"]
    assert n1 and "135/135" in n1[0]["detail"]


def test_audit_graph_clean_on_healthy_graph():
    from src.canvas_copilot.audit import audit_graph

    snap = {
        "nodes": [{"id": "n1", "label": "F1", "bbox": {"x": 0, "y": 0, "width": 40, "height": 40}}],
        "ports": [
            {"id": "p1", "label": "T-1-R103", "type": "terminal", "parentId": "n1", "point": {"x": 40, "y": 20}},
            {"id": "p2", "label": "T-2-R103", "type": "terminal", "parentId": "n1", "point": {"x": 400, "y": 20}},
        ],
        "edges": [{"id": "e1", "label": "R103", "sourcePortId": "p1", "targetPortId": "p2",
                   "path": [{"x": 40, "y": 20}, {"x": 400, "y": 20}]}],
        "continuations": [],
    }
    r = audit_graph(snap)
    assert r["clean"] is True, r["violations"]

    # ledger entries surface as undisposed warnings
    r2 = audit_graph(snap, [{"page": 10, "note": "warning: test debt"}])
    assert any(v["rule"] == "undisposed-warning" for v in r2["violations"])


def test_audit_v2_rules_catch_truncation_and_circle_misses():
    from src.canvas_copilot.audit import audit_graph

    snap = {
        "nodes": [{"id": "n1", "label": "INV40", "bbox": {"x": 1580, "y": 548, "width": 300, "height": 300}}],
        "ports": [
            # parented terminal far below the truncated box, ON a printed circle -> outside-parent ERROR
            {"id": "p1", "label": "L11", "type": "terminal", "parentId": "n1", "point": {"x": 1573, "y": 1711}},
            # junction drawn where no printed dot exists -> INFO
            {"id": "j1", "label": "J-1", "type": "junction", "point": {"x": 900, "y": 900}},
        ],
        "edges": [
            {"id": "e1", "label": "R401", "sourcePortId": "p1", "targetPortId": "j1",
             "path": [{"x": 1573, "y": 1711}, {"x": 900, "y": 1711}, {"x": 900, "y": 900}]},
            {"id": "e2", "label": "S401", "sourcePortId": "j1", "targetPortId": "p1",
             "path": [{"x": 900, "y": 900}, {"x": 1573, "y": 1711}]},
        ],
        "continuations": [],
    }
    circles = [
        {"cx": 1573, "cy": 1711, "d": 45, "class": "terminal", "filled": False},
        # printed dot near drawn work, no drawn join (filled + T-of-conductors)
        {"cx": 850, "cy": 850, "d": 17, "class": "junction", "filled": True},
    ]
    enclosures = [{"bbox": {"x": 1560, "y": 540, "width": 340, "height": 1700}, "area_px": 500000, "fill": 0.9}]
    segs = [{"x1": 700, "y1": 850, "x2": 1000, "y2": 850},
            {"x1": 850, "y1": 850, "x2": 850, "y2": 700}]
    r = audit_graph(snap, circles=circles, enclosures=enclosures, segments=segs)
    rules = {v["rule"] for v in r["violations"]}
    assert "terminal-outside-parent" in rules
    assert "bbox-truncation-floor" in rules
    assert "missed-junction-dot" in rules
    assert "junction-no-dot" in rules
    # the terminal ON its printed circle must NOT get the off-border nag
    assert "terminal-off-border" not in rules


# --- R3.2/R3.3: reset_session handoff + context nudges + thinking knob ---------

def test_compose_handoff_prompt_shape():
    from src.canvas_copilot.copilot import compose_handoff_prompt

    prompt = compose_handoff_prompt(
        {
            "done_summary": "left half audited clean, 41 elements",
            "open_items": ["box INV40 full height", "wire the CN15 strip"],
            "unresolved_warnings": ["T-K-102 pin unverified"],
            "next_action": "extend INV40 bbox to y=2900",
        },
        [{"page": 10, "note": "warning: unparented terminal near (900,1200)"}],
        audit={"page": 10, "counts": {"ERROR": 1, "WARN": 2, "INFO": 0},
               "violations": [
                   {"severity": "ERROR", "rule": "terminal-interior", "detail": "terminal T-9 sits 120px INSIDE CNV40"},
                   {"severity": "WARN", "rule": "box-overlap", "detail": "boxes CNV40 and R40 overlap 70%"},
               ]},
    )
    assert "SESSION HANDOFF" in prompt
    # slate 6.11 honesty fix: free prose is a CLAIM, never server-stamped
    assert "NOT server-verified" in prompt
    assert "left half audited clean, 41 elements" in prompt
    assert "predecessor-verified" not in prompt
    assert "1. box INV40 full height" in prompt and "2. wire the CN15 strip" in prompt
    assert "- T-K-102 pin unverified" in prompt
    assert "[server ledger, page 10] warning: unparented terminal near (900,1200)" in prompt
    # rec #5: server-computed audit rides verbatim
    assert "AUDIT AT HANDOFF" in prompt and "ERROR:1 WARN:2" in prompt
    assert "[ERROR] terminal-interior: terminal T-9 sits 120px INSIDE CNV40" in prompt
    # rec #9: successor's first move is mandated
    assert "FIRST ACTION (mandatory" in prompt
    assert prompt.rstrip().endswith("THEN: extend INV40 bbox to y=2900")


def test_ctx_nudge_thresholds():
    from src.canvas_copilot.copilot import _ctx_nudge

    assert _ctx_nudge(None) == ""
    assert _ctx_nudge({"total": 0}) == ""
    plain = _ctx_nudge({"total": 120_000, "max": 500_000})
    assert plain == "ctx=120k/500k"
    soft = _ctx_nudge({"total": 310_000, "max": 500_000})
    assert "plan a reset_session handoff" in soft and "HARD" not in soft
    hard = _ctx_nudge({"total": 390_000, "max": 500_000})
    assert "HARD" in hard and "reset_session" in hard


def test_queue_reset_attaches_ledger_audit_and_queues(monkeypatch):
    import asyncio

    from src.canvas_copilot import bridge
    from src.canvas_copilot.copilot import CopilotSession

    monkeypatch.setattr(
        bridge, "_warning_ledger",
        [{"page": 10, "note": "warning: junction J-3 degree 1", "ts": 0.0}],
    )
    # no live canvas snapshot in tests -> compute_page_audit returns None;
    # the handoff must still compose (audit section simply absent).
    session = CopilotSession()
    result = asyncio.run(session.queue_reset(
        {"done_summary": "d", "open_items": ["a"], "next_action": "n"}
    ))
    assert result["queued"] is True
    assert result["ledger_warnings_attached"] == 1
    assert result["audit_violations_attached"] == 0
    assert "junction J-3 degree 1" in result["resume_prompt"]
    assert "FIRST ACTION (mandatory" in result["resume_prompt"]
    assert session._pending_reset == result["resume_prompt"]


def test_reset_session_tool_registered():
    from src.canvas_copilot.tools import ALLOWED_CANVAS_TOOLS

    assert "mcp__canvas__reset_session" in ALLOWED_CANVAS_TOOLS


def test_thinking_knob_mapping():
    from src.canvas_copilot.copilot import CopilotSession

    session = CopilotSession()
    session.settings["thinking"] = "off"
    assert session._options().thinking == {"type": "disabled"}
    # 5-family omits thinking text unless summarized display is requested —
    # show_thinking drives it (the 'working with no thoughts' fix, 2026-07-04).
    session.settings["thinking"] = None
    session.settings["show_thinking"] = True
    assert session._options().thinking == {"type": "adaptive", "display": "summarized"}
    session.settings["show_thinking"] = False
    assert session._options().thinking is None


def test_ctx_nudge_scales_to_small_windows():
    """Caught live 2026-07-04: Haiku's 200k window at 81% full got no nudge from
    absolute 300k/380k thresholds. Fractions of max (60%/76%) must fire."""
    from src.canvas_copilot.copilot import _ctx_nudge

    hard = _ctx_nudge({"total": 162_000, "max": 200_000})
    assert "HARD" in hard
    soft = _ctx_nudge({"total": 130_000, "max": 200_000})
    assert "plan a reset_session handoff" in soft and "HARD" not in soft
    assert _ctx_nudge({"total": 100_000, "max": 200_000}) == "ctx=100k/200k"


# --- Audit v3: the arm-2S blind spots (Shane's catch, 2026-07-04) ---------------

def _load_graph(path):
    import json as _json
    g = _json.load(open(path))
    return g.get("graph", g)


def _page10_geometry():
    import json as _json
    c = _json.load(open("../.atlas/page-geometry/circles-page-010.json"))
    e = _json.load(open("../.atlas/page-geometry/enclosures-page-010.json"))
    circles = c if isinstance(c, list) else c.get("circles")
    encs = e if isinstance(e, list) else e.get("enclosures")
    return circles, encs


def test_audit_v3_screams_on_arm2s_overboxing():
    """The CNV40 monster box read audit-clean live; these rules end that."""
    from src.canvas_copilot.audit import audit_graph

    circles, encs = _page10_geometry()
    r = audit_graph(_load_graph("../.atlas/experiment-archive/arm2s-page10/graph-final.json"),
                    circles=circles, enclosures=encs)
    by = {}
    for v in r["violations"]:
        by.setdefault(v["rule"], []).append(v)
    # CNV40 x RTC40 (58%) and CNV40 x R40 (70%) — non-connector overlaps
    assert len(by.get("box-overlap", [])) == 2
    # 15 terminals >40px interior (CON42 table rows etc.), now ERRORs
    interior = by.get("terminal-interior", [])
    assert len(interior) == 15
    assert all(v["severity"] == "ERROR" for v in interior)
    assert r["clean"] is False


def test_audit_v3_box_overlap_silent_on_gold_boxes():
    """Standing calibration gate: the 26 verified page-10 hand boxes contain
    11 connector-family nestings (legitimate) AND ~7 mating-face straddles of
    ~20px (plugs cross printed module borders by design). box-overlap must
    stay silent, and the slate-2.5 sibling-overlap band must stay SCOPED OUT
    of hand labels (it exists to police copilot abutment, where the verified
    norm is exact shared edges — Shane's own labeling style is different truth)."""
    import json as _json
    import urllib.request

    from src.canvas_copilot.audit import audit_graph

    try:
        d = _json.load(urllib.request.urlopen(
            "http://127.0.0.1:8123/workbench/documents/schematic_<drawing-no>/pages/10/annotations?annotationMode=training_dataset",
            timeout=5))
    except Exception:
        import pytest
        pytest.skip("agent_server not running")
    anns = (d.get("annotations") if isinstance(d, dict) else d) or []
    nodes = [{"id": f"g{i}", "label": a.get("label"), "bbox": a["bbox"]}
             for i, a in enumerate(anns) if a.get("type") == "component" and a.get("bbox")]
    snap = {"nodes": nodes, "ports": [], "edges": [], "continuations": []}
    r = audit_graph(snap, graph_kind="hand-labels")
    assert not [v for v in r["violations"] if v["rule"] in ("box-overlap", "sibling-overlap")]
    # positive control: unscoped, the band DOES see the mating-face straddles —
    # proof the graph_kind scoping is load-bearing, not decorative
    r2 = audit_graph(snap)
    assert [v for v in r2["violations"] if v["rule"] == "sibling-overlap"]


def test_audit_v3_mid_wire_terminal_and_swallow_synthetic():
    from src.canvas_copilot.audit import audit_graph

    snap = {
        "nodes": [
            {"id": "n1", "label": "F1", "bbox": {"x": 0, "y": 0, "width": 40, "height": 40}},
            {"id": "n2", "label": "MONSTER", "bbox": {"x": 500, "y": 0, "width": 800, "height": 800}},
        ],
        "ports": [
            {"id": "p1", "label": "T-1-R1", "type": "terminal", "parentId": "n1", "point": {"x": 40, "y": 20}},
            {"id": "p2", "label": "T-2-R1", "type": "terminal", "parentId": "n2", "point": {"x": 500, "y": 20}},
            # rides wire e1's interior, incident to nothing
            {"id": "p3", "label": "T-9-R1", "type": "terminal", "parentId": "n2", "point": {"x": 200, "y": 20}},
        ],
        "edges": [{"id": "e1", "label": "R1", "sourcePortId": "p1", "targetPortId": "p2",
                   "path": [{"x": 40, "y": 20}, {"x": 500, "y": 20}]}],
        "continuations": [],
    }
    encs = [
        {"bbox": {"x": 520, "y": 20, "width": 300, "height": 300}},
        {"bbox": {"x": 900, "y": 400, "width": 300, "height": 300}},
    ]
    r = audit_graph(snap, enclosures=encs)
    rules = {v["rule"] for v in r["violations"]}
    assert "terminal-mid-wire" in rules
    assert "box-swallows-enclosures" in rules


def test_reference_sheet_tool_registered_and_loads():
    from src.canvas_copilot.tools import ALLOWED_CANVAS_TOOLS, _REFERENCE_SHEET

    assert "mcp__canvas__reference_sheet" in ALLOWED_CANVAS_TOOLS
    assert _REFERENCE_SHEET.exists(), "rosetta sheet missing — run scripts/build-rosetta-sheet.py"
    assert _REFERENCE_SHEET.stat().st_size > 50_000


def test_auto_continue_state_and_stop_conditions():
    """Shane 2026-07-05: after a self-handoff the server supplies the 'go'.
    Verify the per-turn telemetry fields exist and interrupt() arms the stop."""
    import asyncio

    from src.canvas_copilot.copilot import CopilotSession

    s = CopilotSession()
    assert s._turn_tool_calls == 0 and s._turn_last_text == ""
    assert s._turn_errored is False and s._stop_requested is False
    assert s._AUTO_CONTINUE_CAP >= 10
    asyncio.run(s.interrupt())  # no client connected — must not raise
    assert s._stop_requested is True


def test_truncation_floor_is_error_severity():
    """Promoted WARN->ERROR 2026-07-05 (Shane): dash-v2 enclosures are exact,
    so a box covering <30% of its module is a broken component boundary."""
    from src.canvas_copilot.audit import audit_graph

    snap = {"nodes": [{"id": "n1", "label": "CNV40",
                       "bbox": {"x": 100, "y": 100, "width": 300, "height": 300}}],
            "ports": [], "edges": [], "continuations": []}
    encs = [{"bbox": {"x": 90, "y": 90, "width": 320, "height": 1200}}]
    r = audit_graph(snap, enclosures=encs)
    hits = [v for v in r["violations"] if v["rule"] == "bbox-truncation-floor"]
    assert hits and hits[0]["severity"] == "ERROR"


def test_naming_guard_v2_rename_and_mint_paths(monkeypatch):
    """Grader finding (arm 2S'): the old guard required a net at mint time but
    build order is box->terminal->wire — structurally inert. v2: print check
    fires netless; renames with unbacked numeric pins earn ledger warnings."""
    import asyncio
    import json as _json

    from src.canvas_copilot import bridge, tools, vectors

    snapshot = {
        "page": 10,
        "nodes": [{"id": "n1", "label": "MS349", "bbox": {"x": 80, "y": 80, "width": 120, "height": 120}}],
        "ports": [{"id": "p1", "label": "t1", "type": "terminal", "parentId": "n1",
                   "point": {"x": 100, "y": 100}}],
        "edges": [], "continuations": [],
        "graph_stats": {"components": 1, "terminals": 1, "wires": 0, "continuations": 0},
    }
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": snapshot, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    async def fake_texts(page):
        return [{"text": "L1", "cx": 400, "cy": 400}]  # nothing near (100,100)
    monkeypatch.setattr(vectors, "page_texts", fake_texts)
    sent = {}
    monkeypatch.setattr(bridge, "send_commands", lambda cmds: sent.update(cmd=cmds[0]) or [1])
    async def fake_ack(key, timeout_s):
        return {"kind": "annotate_applied", "key": key, "page": 10, "ops": 1, "notes": [], "minted": {}}
    monkeypatch.setattr(bridge, "wait_for_annotate_applied", fake_ack)

    async def run(ops):
        res = await tools.annotate.handler({"ops": ops, "reason": "test"})
        return _json.loads(res["content"][0]["text"]), sent["cmd"]

    # rename with numeric pin, no printed backing -> unbacked warning in notes
    summary, cmd = asyncio.run(run([{"op": "rename", "id": "p1", "label": "T-101-R403"}]))
    joined = _json.dumps(summary)
    assert "invented-pin suspect" in joined
    # mint with no printed pin nearby and no net -> unverified warning (netless!)
    summary2, cmd2 = asyncio.run(run([{"op": "add_terminal", "component_id": "n1",
                                       "point": {"x": 110, "y": 110}}]))
    assert "unverified against the print" in _json.dumps(summary2)


def test_cab_endpoint_gate_and_plug_note(monkeypatch):
    """Slate 2.3 executor half: add_wire endpoints in/on CAB* boxes refuse
    pre-dispatch (cables connect by MATING, never wires — both measured
    violations landed at the mating faces); wires CROSSING a cable box stay
    legal; plug (CON*) boxes never refuse, but an endpoint away from the
    plug's own terminals draws a receipt note."""
    import asyncio
    import json as _json

    from src.canvas_copilot import bridge, tools, vectors

    snapshot = {
        "page": 10,
        "nodes": [
            {"id": "cab", "label": "CAB40", "bbox": {"x": 1240, "y": 880, "width": 333.5, "height": 55}},
            {"id": "con", "label": "CON41", "bbox": {"x": 1824, "y": 1586, "width": 62, "height": 83}},
        ],
        "ports": [{"id": "pc", "label": "T~A~CAB41", "type": "terminal", "parentId": "con",
                   "point": {"x": 1824, "y": 1600}}],
        "edges": [], "continuations": [],
        "graph_stats": {"components": 2, "terminals": 1, "wires": 0, "continuations": 0},
    }
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": snapshot, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    async def fake_texts(page):
        return []
    monkeypatch.setattr(vectors, "page_texts", fake_texts)
    sent = {"n": 0}
    monkeypatch.setattr(bridge, "send_commands", lambda cmds: sent.update(n=sent["n"] + 1) or [1])
    async def fake_ack(key, timeout_s):
        return {"kind": "annotate_applied", "key": key, "page": 10, "ops": 1, "notes": [], "minted": {}}
    monkeypatch.setattr(bridge, "wait_for_annotate_applied", fake_ack)
    # Box gate (2026-07-07) holds add_wire closed without a clean audit
    # certificate — this test exercises CABLE semantics, so certify the page.
    import time as _time

    monkeypatch.setattr(bridge, "_node_mutation_ts", {})
    tools._last_audit_flag_list.clear()
    tools._last_audit_flag_list.update(
        {"page": 10, "snapshot_seq": 1, "ts": _time.time(), "entries": []})

    async def run(ops):
        res = await tools.annotate.handler({"ops": ops, "reason": "test"})
        return _json.loads(res["content"][0]["text"])

    # endpoint exactly at the mating face (measured violation class) -> refused
    r1 = asyncio.run(run([{"op": "add_wire", "label": "X",
                           "path": [{"x": 1240, "y": 908}, {"x": 1100, "y": 908}]}]))
    assert r1["ok"] is False and r1["refused"] == "cable-mating-doctrine"
    assert sent["n"] == 0, "refusal must happen BEFORE dispatch"
    # 0.5px outside the far face (the CAB40-labeled re-add at (1574,920)) -> refused
    r2 = asyncio.run(run([{"op": "add_wire", "label": "X",
                           "path": [{"x": 1574, "y": 920}, {"x": 1700, "y": 920}]}]))
    assert r2["ok"] is False and sent["n"] == 0
    # crossing OVER the cable box with endpoints clear -> applies (killed
    # "through" clause: conductors legitimately cross the inter-module bar)
    r3 = asyncio.run(run([{"op": "add_wire", "label": "U40",
                           "path": [{"x": 1100, "y": 900}, {"x": 1700, "y": 900}]}]))
    assert r3["ok"] is True and sent["n"] == 1
    # plug box: endpoint at the plug's OWN terminal -> no note; endpoint on
    # the box away from terminals -> receipt note, never a refusal
    r4 = asyncio.run(run([{"op": "add_wire", "label": "Y",
                           "path": [{"x": 1824, "y": 1600}, {"x": 1900, "y": 1600}]}]))
    assert r4["ok"] is True and "plugs mate by contact" not in _json.dumps(r4)
    r5 = asyncio.run(run([{"op": "add_wire", "label": "Y",
                           "path": [{"x": 1850, "y": the reference machine}, {"x": 1900, "y": the reference machine}]}]))
    assert r5["ok"] is True and "plugs mate by contact" in _json.dumps(r5)


def test_audit_v4_identity_rules_on_arm2sr():
    """Shane's identity decision tree as audit rules, calibrated on arm 2S':
    every hit maps to a logged observation (ARM-LOG.md obs #5/#6/#7/#10)."""
    import json as _json

    from src.canvas_copilot.audit import audit_graph

    g = _json.load(open("../.atlas/experiment-archive/arm2sr-page10/graph-final.json"))["graph"]
    texts = _json.load(open("../.atlas/experiment-archive/arm2sr-page10/texts.json"))
    r = audit_graph(g, texts=texts)
    by = {}
    for v in r["violations"]:
        by.setdefault(v["rule"], []).append(v["detail"])
    part = by.get("component-label-is-part-number", [])
    assert len(part) == 2 and any("MR-CCN1" in d for d in part)  # graders' 10th find
    unprinted = by.get("component-label-not-printed", [])
    assert len(unprinted) >= 6
    assert any("CON40" in d for d in unprinted)       # obs #7: table labeled CON40
    assert any("FU040" in d for d in unprinted)       # obs #5: THR349 3-way split
    assert "label-check-skipped" not in by            # flood guard must NOT trip here


def test_audit_v4_flood_guard_and_wire_name_rule():
    from src.canvas_copilot.audit import audit_graph

    # systematic text mismatch: 2 nodes, no matching text -> suppressed + INFO
    snap = {"nodes": [{"id": "a", "label": "X1", "bbox": {"x": 0, "y": 0, "width": 50, "height": 50}},
                      {"id": "b", "label": "X2", "bbox": {"x": 200, "y": 0, "width": 50, "height": 50}}],
            "ports": [], "edges": [], "continuations": []}
    r = audit_graph(snap, texts=[{"text": "zzz", "cx": 9000, "cy": 9000}])
    rules = {v["rule"] for v in r["violations"]}
    assert "label-check-skipped" in rules and "component-label-not-printed" not in rules

    # component named after a drawn wire's net
    snap2 = {"nodes": [{"id": "n", "label": "FU040", "bbox": {"x": 0, "y": 0, "width": 50, "height": 50}}],
             "ports": [{"id": "p1", "label": "t", "type": "terminal", "parentId": None, "point": {"x": 500, "y": 500}},
                       {"id": "p2", "label": "t2", "type": "terminal", "parentId": None, "point": {"x": 900, "y": 500}}],
             "edges": [{"id": "e", "label": "FU040", "sourcePortId": "p1", "targetPortId": "p2",
                        "path": [{"x": 500, "y": 500}, {"x": 900, "y": 500}]}],
             "continuations": [{"id": "c1", "point": {"x": 25, "y": 25}}]}
    r2 = audit_graph(snap2)
    rules2 = {v["rule"] for v in r2["violations"]}
    assert "component-label-is-wire-name" in rules2
    assert "box-includes-continuation" in rules2
