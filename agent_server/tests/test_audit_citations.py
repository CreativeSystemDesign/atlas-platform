"""Truncation-floor citations: cells only, smallest first — never the ring.

2026-07-05: the interstitial ring between cells (fill≈0.47, bbox spans nearly
the whole page) was winning every truncation citation, which read as absurd
("covers 2% of a 1644x1856 enclosure") and handed two runs their
false-positive alibi. The flags were RIGHT; the citation was the exploit.
"""

from __future__ import annotations

from src.canvas_copilot.audit import audit_graph


RING = {"bbox": {"x": 472, "y": 548, "width": 1644, "height": 1856}, "fill": 0.47}
CELL = {"bbox": {"x": 996, "y": 548, "width": 576, "height": 1160}, "fill": 1}
SMALL_CELL = {"bbox": {"x": 1000, "y": 560, "width": 400, "height": 400}, "fill": 0.9}


def _snap(node_bbox):
    return {
        "nodes": [{"id": "n1", "label": "CNV40", "bbox": node_bbox}],
        "ports": [],
        "edges": [],
    }


def _trunc(violations):
    return [v for v in violations if v["rule"] == "bbox-truncation-floor"]


def test_ring_never_cited_even_when_it_contains_the_box():
    # box is truncated relative to its cell; both ring and cell contain it
    snap = _snap({"x": 1000, "y": 560, "width": 150, "height": 150})
    res = audit_graph(snap, enclosures=[RING, CELL])
    t = _trunc(res["violations"])
    assert t, "truncation must still fire against the real cell"
    assert "576x1160" in t[0]["detail"]
    assert "1644x1856" not in t[0]["detail"]


def test_smallest_containing_cell_wins_citation():
    snap = _snap({"x": 1010, "y": 570, "width": 90, "height": 90})
    res = audit_graph(snap, enclosures=[RING, CELL, SMALL_CELL])
    t = _trunc(res["violations"])
    assert t and "400x400" in t[0]["detail"]


def test_box_only_inside_ring_raises_nothing():
    # a box in interstitial space (between cells) has no cell to be truncated
    # against — the ring alone must not manufacture an ERROR
    snap = _snap({"x": 480, "y": 2200, "width": 100, "height": 100})
    res = audit_graph(snap, enclosures=[RING])
    assert not _trunc(res["violations"])


def test_full_coverage_box_is_clean():
    snap = _snap({"x": 996, "y": 548, "width": 576, "height": 1160})
    res = audit_graph(snap, enclosures=[RING, CELL])
    assert not _trunc(res["violations"])


def test_nested_accessory_inside_owned_cell_not_flagged():
    # live catch 2026-07-05: CAB40 (no printed border of its own) sits inside
    # CNV40's cell; CNV40's box owns that cell — CAB40 is not "truncated"
    snap = {
        "nodes": [
            {"id": "cnv", "label": "CNV40", "bbox": {"x": 996, "y": 548, "width": 576, "height": 1160}},
            {"id": "cab", "label": "CAB40", "bbox": {"x": 1100, "y": 990, "width": 120, "height": 60}},
        ],
        "ports": [],
        "edges": [],
    }
    res = audit_graph(snap, enclosures=[RING, CELL])
    flagged = {i for v in _trunc(res["violations"]) for i in v["ids"]}
    assert "cab" not in flagged


def test_truncated_owner_still_flagged_with_nested_sibling_present():
    # the parent's own truncation must still fire even while accessories exist
    snap = {
        "nodes": [
            {"id": "cnv", "label": "CNV40", "bbox": {"x": 1000, "y": 560, "width": 150, "height": 150}},
            {"id": "cab", "label": "CAB40", "bbox": {"x": 1300, "y": 990, "width": 120, "height": 60}},
        ],
        "ports": [],
        "edges": [],
    }
    res = audit_graph(snap, enclosures=[RING, CELL])
    flagged = {i for v in _trunc(res["violations"]) for i in v["ids"]}
    assert "cnv" in flagged and "cab" not in flagged


# --- Slate 2.1 post-filters (each encodes a Shane-confirmed false positive) --

GOLD_CNV_BOX = {"x": 989, "y": 542, "width": 251, "height": 776}
CNV_DET = {"id": "y1", "class_name": "CNV", "confidence": 0.72, "tier": "strong",
           "bbox": {"x": 968, "y": 532, "width": 305, "height": 780}}
LCELL = {"bbox": {"x": 996, "y": 548, "width": 576, "height": 1160}, "fill": 0.71}


def test_detector_corroboration_stands_down_the_floor():
    snap = {"nodes": [{"id": "n1", "label": "CNV40", "bbox": GOLD_CNV_BOX}],
            "ports": [], "edges": []}
    fired = _trunc(audit_graph(snap, enclosures=[LCELL],
                               yolo_detections=[CNV_DET])["violations"])
    assert not fired, "Shane-correct box with agreeing strong detection must pass"
    # without the detection the floor still convicts (rule keeps its teeth)
    assert _trunc(audit_graph(snap, enclosures=[LCELL])["violations"])


def test_stacked_refs_disqualify_the_cell():
    snap = _snap({"x": 1000, "y": 560, "width": 150, "height": 150})
    # tokens key on cx/cy (2026-07-10: fixture mirrored the dead x/y read)
    texts = [{"text": "49", "cx": 1300, "cy": 900}, {"text": "19", "cx": 1300, "cy": 930}]
    assert not _trunc(audit_graph(snap, enclosures=[CELL], texts=texts)["violations"])
    # refs outside the cell leave conviction intact
    far = [{"text": "49", "cx": 100, "cy": 100}, {"text": "19", "cx": 100, "cy": 130}]
    assert _trunc(audit_graph(snap, enclosures=[CELL], texts=far)["violations"])


def test_sibling_clip_exonerates_shared_cell():
    # our box fills the left third; a sibling occupies the right half of the
    # "cell" — clipped at the sibling's wall, our coverage clears the floor.
    snap = {"nodes": [
        {"id": "n1", "label": "CNV40", "bbox": {"x": 1000, "y": 560, "width": 180, "height": 1100}},
        {"id": "n2", "label": "INV40", "bbox": {"x": 1200, "y": 560, "width": 360, "height": 1100}},
    ], "ports": [], "edges": []}
    assert not _trunc(audit_graph(snap, enclosures=[CELL])["violations"])


def test_group_region_reject_stands_down_the_lshaped_swallow():
    # The original CAB40 fixture, superseded by post-filter (e) (p8 CON23,
    # Shane 2026-07-09: "the Print overrides the detector... it covers the
    # entire area"): an IRREGULAR cell (fill<0.9) fully swallowing a DISJOINT
    # sibling is a group/wiring region, not any single component's cell —
    # the floor no longer fires here at all.
    snap = {"nodes": [
        {"id": "n1", "label": "CNV40", "bbox": {"x": 1000, "y": 560, "width": 150, "height": 150}},
        {"id": "n2", "label": "CAB40", "bbox": {"x": 1100, "y": 900, "width": 60, "height": 40}},
    ], "ports": [], "edges": []}
    assert not _trunc(audit_graph(snap, enclosures=[LCELL])["violations"])


def test_ticket_is_hypothesis_and_names_siblings():
    # A RECTANGULAR printed cell (fill>=0.9) holding a nested accessory still
    # convicts — and the ticket stays a hypothesis that names the sibling,
    # never the old unconditional swallow imperative.
    snap = {"nodes": [
        {"id": "n1", "label": "CNV40", "bbox": {"x": 1000, "y": 560, "width": 150, "height": 150}},
        {"id": "n2", "label": "CAB40", "bbox": {"x": 1100, "y": 900, "width": 60, "height": 40}},
    ], "ports": [], "edges": []}
    t = _trunc(audit_graph(snap, enclosures=[CELL])["violations"])
    assert t
    d = t[0]["detail"]
    assert "before any done claim" not in d          # imperative is dead
    assert "CAB40" in d and "L-shaped" in d          # sibling named in the CAUTION
    assert "verify the printed border" in d


def test_contradiction_merges_into_one_fact():
    # truncated box AND an interior terminal on the same node
    snap = {"nodes": [{"id": "n1", "label": "CNV40",
                       "bbox": {"x": 1000, "y": 560, "width": 150, "height": 150}}],
            "ports": [{"id": "p1", "label": "T~1~X1", "type": "terminal",
                       "parentId": "n1", "point": {"x": 1075, "y": 635}}],
            "edges": []}
    res = audit_graph(snap, enclosures=[CELL],
                      circles=[])
    t = _trunc(res["violations"])
    if t and any(v["rule"] in ("terminal-interior", "terminal-outside-parent")
                 for v in res["violations"]):
        assert "CONFLICT" in t[0]["detail"]


# --- Slate 2.2: printed-circle corroboration layer --------------------------

SEG = [{"x1": 1900, "y1": 900, "x2": 2100, "y2": 900},   # conductor through
       {"x1": 2000, "y1": 900, "x2": 2000, "y2": 800}]  # branch = a real T-join
DOT_ON = {"cx": 2000, "cy": 901, "d": 12.0, "filled": True, "class": "junction"}
DOT_BLANK = {"cx": 2000, "cy": 700, "d": 12.0, "filled": True, "class": "junction"}  # ellipsis dot
WIRE = {"id": "e1", "label": "R401", "sourcePortId": "pA", "targetPortId": "pB",
        "path": [{"x": 1900, "y": 900}, {"x": 2100, "y": 900}]}


def _mjd(res):
    return [v for v in res["violations"] if v["rule"] == "missed-junction-dot"]


def _base_snap(extra_ports=None, conts=None):
    return {"nodes": [], "edges": [WIRE], "continuations": conts or [],
            "ports": [{"id": "pA", "type": "terminal", "point": {"x": 1900, "y": 900}},
                      {"id": "pB", "type": "terminal", "point": {"x": 2100, "y": 900}}]
            + (extra_ports or [])}


def test_junction_claim_needs_conductor_under_the_dot():
    snap = _base_snap()
    on = audit_graph(snap, circles=[DOT_ON], segments=SEG)
    assert _mjd(on), "filled dot ON a printed conductor with drawn work near must fire"
    blank = audit_graph(snap, circles=[DOT_BLANK], segments=SEG)
    assert not _mjd(blank), "pinout ellipsis dot in blank space must stay silent"


def test_continuation_at_dot_satisfies_junction_rule():
    snap = _base_snap(conts=[{"id": "c1", "point": {"x": 2003, "y": 903}}])
    assert not _mjd(audit_graph(snap, circles=[DOT_ON], segments=SEG))


def test_segmented_conductor_exempts_printed_inline_circle():
    ring = {"cx": 2000, "cy": 900, "d": 16.8, "filled": False, "class": "terminal"}
    mid = {"id": "pM", "type": "terminal", "point": {"x": 2001, "y": 901}}
    wires = [
        {"id": "e1", "sourcePortId": "pA", "targetPortId": "pM",
         "path": [{"x": 1900, "y": 900}, {"x": 2001, "y": 901}]},
        {"id": "e2", "sourcePortId": "pM", "targetPortId": "pB",
         "path": [{"x": 2001, "y": 901}, {"x": 2100, "y": 900}]},
    ]
    snap = {"nodes": [], "continuations": [],
            "ports": [{"id": "pA", "type": "terminal", "point": {"x": 1900, "y": 900}},
                      {"id": "pB", "type": "terminal", "point": {"x": 2100, "y": 900}}, mid],
            "edges": wires}
    seg = [v for v in audit_graph(snap, circles=[ring])["violations"]
           if v["rule"] == "segmented-conductor"]
    assert not seg, "terminal on a PRINTED inline circle is faithful annotation"
    seg2 = [v for v in audit_graph(snap, circles=[])["violations"]
            if v["rule"] == "segmented-conductor"]
    assert seg2, "same terminal with no printed circle is still a mis-typed tap"


def test_ground_glyph_uncovered_fires_and_clears():
    glyph = {"cx": 2033, "cy": 901, "d": 26.8, "filled": False, "class": "terminal"}
    # tokens key on cx/cy (2026-07-10: fixture mirrored the dead x/y read)
    texts = [{"text": "G", "cx": 2055, "cy": 915}]
    empty = {"nodes": [], "ports": [], "edges": [], "continuations": []}
    fired = [v for v in audit_graph(empty, circles=[glyph], texts=texts)["violations"]
             if v["rule"] == "ground-glyph-uncovered"]
    assert fired and "first-class ground element" in fired[0]["detail"]
    # A wire-end terminal at the glyph still counts as covered.
    covered = {"nodes": [], "continuations": [], "edges": [],
               "ports": [{"id": "g1", "type": "terminal", "point": {"x": 2035, "y": 905}}]}
    assert not [v for v in audit_graph(covered, circles=[glyph], texts=texts)["violations"]
                if v["rule"] == "ground-glyph-uncovered"]
    # A first-class ground element whose snug box hugs the glyph also covers it.
    grounded = {"nodes": [], "continuations": [], "edges": [], "ports": [],
                "grounds": [{"id": "ground-1", "type": "ground", "label": "GND",
                             "bbox": {"x": 2013, "y": 881, "width": 40, "height": 40}}]}
    assert not [v for v in audit_graph(grounded, circles=[glyph], texts=texts)["violations"]
                if v["rule"] == "ground-glyph-uncovered"]


def test_ground_glyph_uncovered_carries_a_bindable_id():
    # ls-20260712-bless-01 follow-up: the flag used to emit empty ids, so
    # Shane's "accept the phantom ground" dispose could never bind and clear it.
    glyph = {"cx": 2033, "cy": 901, "d": 26.8, "filled": False, "class": "terminal"}
    texts = [{"text": "G", "cx": 2055, "cy": 915}]
    empty = {"nodes": [], "ports": [], "edges": [], "continuations": []}
    fired = [v for v in audit_graph(empty, circles=[glyph], texts=texts)["violations"]
             if v["rule"] == "ground-glyph-uncovered"]
    assert fired and fired[0]["ids"], "flag must carry a bindable id for dispose"
    assert fired[0]["ids"][0].startswith("groundglyph-")


def test_ground_tap_unlabeled_fires_and_scopes_to_G():
    # ls-20260712-bless-02: a ground-tap wire between G terminals that is not
    # itself labeled G must WARN (it slipped through wire-anonymous, which
    # exempts net-bearing terminals). Scoped to net 'G'; local 'E' drops silent.
    snap = {"nodes": [], "continuations": [], "grounds": [],
            "ports": [
                {"id": "pa", "type": "terminal", "label": "T~T52~G", "point": {"x": 100, "y": 100}},
                {"id": "pb", "type": "terminal", "label": "T~G~G", "point": {"x": 100, "y": 160}}],
            "edges": [{"id": "e1", "label": "", "sourcePortId": "pa", "targetPortId": "pb",
                       "path": [{"x": 100, "y": 100}, {"x": 100, "y": 160}]}]}
    fired = [v for v in audit_graph(snap)["violations"] if v["rule"] == "ground-tap-unlabeled"]
    assert fired and fired[0]["ids"] == ["e1"]
    # labeling the wire G clears it
    snap["edges"][0]["label"] = "G"
    assert not [v for v in audit_graph(snap)["violations"] if v["rule"] == "ground-tap-unlabeled"]
    # a local earth drop (net 'E') is the sealed-acceptable silent class (6d)
    snap["edges"][0]["label"] = ""
    snap["ports"][0]["label"] = "T~G~E"
    snap["ports"][1]["label"] = "T~G~E"
    assert not [v for v in audit_graph(snap)["violations"] if v["rule"] == "ground-tap-unlabeled"]


# --- Slate 2.4: terminal-placement doctrine sync (remedy text only) ---------

def test_rule10_remedies_speak_border_doctrine_not_circle():
    """Shane 2026-07-05: terminal belongs at the wire's PRINTED-border crossing;
    circles legitimately sit interior. The old on-circle remedies ('resize until
    the border meets the circle', 'the border should move to it') were doctrinal
    traps under FLAGS-ARE-LAW — they'd wreck R40's verified box."""
    node = {"id": "n1", "label": "R40", "bbox": {"x": 874, "y": 1471, "width": 251, "height": 147}}
    circle_at = lambda x, y: [{"cx": x, "cy": y, "d": 16.0, "filled": False, "class": "terminal"}]

    def flags(pt, circles):
        snap = {"nodes": [node], "edges": [], "continuations": [],
                "ports": [{"id": "p1", "label": "T~C~R40", "type": "terminal",
                           "parentId": "n1", "point": pt}]}
        return audit_graph(snap, circles=circles)["violations"]

    # deep interior ON a printed circle: ERROR kept, remedy is border-crossing
    deep = flags({"x": 990, "y": 1540}, circle_at(990, 1540))
    ti = [v for v in deep if v["rule"] == "terminal-interior"]
    assert ti and ti[0]["severity"] == "ERROR"
    assert "resize until" not in ti[0]["detail"]
    assert "never resize a border to meet a circle" in ti[0]["detail"]
    # outside parent: no more unconditional 'box too small (extend it)'
    out = flags({"x": 860, "y": 1540}, [])
    top = [v for v in out if v["rule"] == "terminal-outside-parent"]
    assert top and "box too small" not in top[0]["detail"]
    assert "never stretch the box" in top[0]["detail"]
    # off-border on a circle: circle no longer commands the border
    off = flags({"x": 890, "y": 1540}, circle_at(890, 1540))
    tob = [v for v in off if v["rule"] == "terminal-off-border"]
    assert tob and "border should move to it" not in tob[0]["detail"]
    assert "not to the circle" in tob[0]["detail"]


# --- Slate 2.5: sibling-overlap band folded into 7b -------------------------

def _sib(res):
    return [v for v in res["violations"] if v["rule"] == "sibling-overlap"]


def _pair_snap(b1, b2, l1="INV40", l2="CAB41"):
    return {"nodes": [{"id": "a", "label": l1, "bbox": b1},
                      {"id": "b", "label": l2, "bbox": b2}],
            "ports": [], "edges": [], "continuations": []}


def test_sibling_overlap_convicts_the_shane_ordered_case():
    # ~9px connector overlap (the INV40/CAB41-42 class Shane ordered cleared,
    # L51) — the old blanket connector exemption hid exactly this
    snap = _pair_snap({"x": 1573.5, "y": 542, "width": 250.5, "height": 1719},
                      {"x": 1815, "y": 1200, "width": 60, "height": 50})
    fired = _sib(audit_graph(snap))
    assert fired and fired[0]["severity"] == "WARN"
    assert "abutment" in fired[0]["detail"]


def test_sibling_overlap_passes_exact_abutment_and_hand_labels():
    # exact shared edge (the verified norm): overlap 0 — silent
    abut = _pair_snap({"x": 989, "y": 538, "width": 251, "height": 756},
                      {"x": 1240, "y": 600, "width": 92, "height": 188})
    assert not _sib(audit_graph(abut))
    # same overlapping pair, hand-label scope: band scoped out entirely
    overlap = _pair_snap({"x": 1573.5, "y": 542, "width": 250.5, "height": 1719},
                         {"x": 1815, "y": 1200, "width": 60, "height": 50})
    assert not _sib(audit_graph(overlap, graph_kind="hand-labels"))


def test_sibling_overlap_excludes_nesting_and_respects_box_overlap_band():
    # full containment = the swallow class (rule 12b territory), not abutment
    nest = _pair_snap({"x": 0, "y": 0, "width": 500, "height": 500},
                      {"x": 100, "y": 100, "width": 50, "height": 50})
    assert not _sib(audit_graph(nest))
    # non-connector deep overlap keeps firing the calibrated 25% band, and the
    # pair never double-flags
    deep = _pair_snap({"x": 0, "y": 0, "width": 100, "height": 100},
                      {"x": 50, "y": 0, "width": 100, "height": 100},
                      l1="CNV40", l2="RTC40")
    res = audit_graph(deep)
    assert [v for v in res["violations"] if v["rule"] == "box-overlap"]
    assert not _sib(res)


def test_evidence_tier_gets_parting_glance_info():
    dets = [{"id": "y1", "class_name": "G", "confidence": 0.34, "tier": "evidence",
             "bbox": {"x": 2020, "y": 890, "width": 30, "height": 30}}]
    empty = {"nodes": [], "ports": [], "edges": [], "continuations": []}
    info = [v for v in audit_graph(empty, yolo_detections=dets)["violations"]
            if v["rule"] == "yolo-evidence-unreviewed"]
    assert info and info[0]["severity"] == "INFO" and "parting glance" in info[0]["detail"]


def test_mate_face_drift_fires_and_clears():
    """Mate terminals (Shane 2026-07-09): one dual-parent terminal at the shared
    flush border. Off either parent's border -> WARN; on both -> silent."""
    con20 = {"id": "n-con20", "label": "CON20", "bbox": {"x": 1531, "y": 877, "width": 45, "height": 83}}
    inv1 = {"id": "n-inv1", "label": "INV1", "bbox": {"x": 1576, "y": 500, "width": 500, "height": 1500}}
    ok_mate = {"id": "p-m1", "label": "T~CON20+INV1~MO1", "type": "mate",
               "parentId": "n-con20", "parentId2": "n-inv1", "point": {"x": 1576, "y": 919}}
    snap = {"nodes": [con20, inv1], "ports": [ok_mate], "edges": [], "continuations": []}
    fired = [v for v in audit_graph(snap, circles=[])["violations"] if v["rule"] == "mate-face-drift"]
    assert not fired, "mate on both borders is clean"
    drifted = {**ok_mate, "point": {"x": 1550, "y": 919}}  # 26px off INV1's border
    snap2 = {"nodes": [con20, inv1], "ports": [drifted], "edges": [], "continuations": []}
    fired2 = [v for v in audit_graph(snap2, circles=[])["violations"] if v["rule"] == "mate-face-drift"]
    assert fired2 and "off" in fired2[0]["detail"]
    lost = {**ok_mate, "parentId2": "n-gone"}
    snap3 = {"nodes": [con20, inv1], "ports": [lost], "edges": [], "continuations": []}
    fired3 = [v for v in audit_graph(snap3, circles=[])["violations"] if v["rule"] == "mate-face-drift"]
    assert fired3 and "missing a parent" in fired3[0]["detail"]


def test_yolo_extent_mismatch_carries_disposable_node_id():
    """2026-07-09 (page-8 hang): 17b emitted [det_id, LABEL] — Shane's
    false-positive verdicts keyed on node ids never matched, so the box-gate
    re-listed disposed flags forever. The violation must carry the node ID."""
    node = {"id": "node-cnv1", "label": "CNV1",
            "bbox": {"x": 1300, "y": 400, "width": 60, "height": 200}}
    det = {"id": "y008-031", "class_name": "PP", "tier": "strong", "confidence": 0.88,
           "bbox": {"x": 1330, "y": 450, "width": 100, "height": 100}}  # ~30% covered
    snap = {"nodes": [node], "ports": [], "edges": [], "continuations": []}
    fired = [v for v in audit_graph(snap, circles=[], yolo_detections=[det])["violations"]
             if v["rule"] == "yolo-extent-mismatch"]
    assert fired, "fractional coverage fires 17b"
    assert "node-cnv1" in fired[0]["ids"], f"node ID must be disposable: {fired[0]['ids']}"
    assert "CNV1" not in fired[0]["ids"], "label is prose, never an id"


def test_continuation_unlabeled_fires_only_on_truly_blank_link_chips():
    """Born-WARN 2026-07-13 (the rawRef tax): a LINK chip with nothing
    resolvable fires; device cross-refs (dash PAGE-LINE), fraction refs,
    sheet-carrying chips, and symbol chips stay silent."""
    from src.canvas_copilot.audit import audit_graph

    snap = {
        "page": 15, "nodes": [], "ports": [], "edges": [], "grounds": [],
        "continuations": [
            # the incident class: target set, nothing parseable -> FIRES
            {"id": "cont-blank", "point": {"x": 100, "y": 100},
             "target": {"kind": "port", "id": "port-1"},
             "sheet": None, "zone": None, "rawRef": None},
            # device cross-ref, dash format, sheet-less -> silent (gold class)
            {"id": "cont-device", "point": {"x": 200, "y": 100},
             "target": {"kind": "component", "id": "node-1"},
             "sheet": None, "zone": None, "rawRef": "34-22"},
            # fraction rawRef -> silent
            {"id": "cont-frac", "point": {"x": 300, "y": 100},
             "target": {"kind": "port", "id": "port-2"},
             "sheet": None, "zone": None, "rawRef": "8/24"},
            # sheet set -> silent
            {"id": "cont-labeled", "point": {"x": 400, "y": 100},
             "target": {"kind": "port", "id": "port-3"},
             "sheet": "9", "zone": "1", "rawRef": None},
            # symbol chip (no target) -> silent regardless
            {"id": "cont-symbol", "point": {"x": 500, "y": 100},
             "target": None, "sheet": None, "zone": None, "rawRef": None},
        ],
    }
    res = audit_graph(snap)
    hits = [v for v in res["violations"] if v["rule"] == "continuation-unlabeled"]
    assert len(hits) == 1
    assert hits[0]["ids"] == ["cont-blank"]
    assert hits[0]["severity"] == "WARN"
