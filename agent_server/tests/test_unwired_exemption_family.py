"""Slate 2.3 — the unwired-node exemption family (Shane rulings 2026-07-05/06).

Three species, each exempting on GEOMETRIC corroboration, never a blanket
label pass:
  (1) plug/terminator mating (CON40 class) — a foreign module's terminal
      within MATING_TOL of the bbox border;
  (2) pass-through ferrites (LNF/FR-BLF) — electrically transparent, zero
      taps correct, but only while conductors actually run through the box;
  (3) interim cable wire-edges — cables are EDGES under the multipath model
      (nothing to exempt; the gold graph proves the shape).
Acceptance: the 3 residual ERRORs in gold-master-v1.1-audit.json go silent;
synthetic true-positives (genuinely forgotten cable/plug) still convict.
"""

from __future__ import annotations

import json

from src.canvas_copilot.audit import audit_graph

GOLD = "../.atlas/experiment-archive/probe-yolo-page10/gold-master-v1.4.json"


def _unwired(res):
    return [v for v in res["violations"] if v["rule"] == "unwired-node"]


def _snap(nodes, ports=None, edges=None):
    return {"nodes": nodes, "ports": ports or [], "edges": edges or [],
            "continuations": []}


# --- acceptance: the sealed gold master reads silent ------------------------

def test_gold_master_v11_unwired_errors_go_silent():
    g = json.load(open(GOLD))["graph"]
    res = audit_graph(g)
    assert not _unwired(res), (
        "LNF40/LNF41 (pass-through ferrites) and CON40 (mated plug) are "
        f"Shane-ruled correct; still firing: {_unwired(res)}")
    # species 3: cables live as EDGES (CAB40/41/42), never component nodes
    cab_nodes = [n for n in g["nodes"] if str(n.get("label", "")).startswith("CAB")]
    cab_edges = [e for e in g["edges"] if str(e.get("label", "")).startswith("CAB")]
    assert not cab_nodes and len(cab_edges) == 3


# --- species 1: mating ------------------------------------------------------

PLUG = {"id": "plug", "label": "CON99", "bbox": {"x": 1480, "y": 1000, "width": 94, "height": 84}}
MODULE = {"id": "mod", "label": "INV40", "bbox": {"x": 1574, "y": 542, "width": 250, "height": 1719}}


def test_mated_plug_exempt_at_the_face():
    # mate terminal ON the plug's right face (CON40's measured gold case: d=0)
    mate = {"id": "pm", "label": "T~CN40B~CN40B", "type": "terminal",
            "parentId": "mod", "point": {"x": 1574, "y": 1043}}
    res = audit_graph(_snap([PLUG, MODULE], ports=[mate]))
    assert not [v for v in _unwired(res) if "plug" in v["ids"]]


def test_forgotten_plug_still_convicts():
    # no terminal anywhere near the box — the genuine 34%-class defect
    res = audit_graph(_snap([PLUG]))
    fired = _unwired(res)
    assert fired and fired[0]["severity"] == "ERROR"


def test_unparented_terminal_is_not_a_mate():
    # a stray tap/pseudo-pin near the face must NOT exempt (keeps conviction
    # power; T~CONT~ continuation stubs are unparented by design)
    stray = {"id": "ps", "label": "T~CONT~X", "type": "terminal",
             "parentId": None, "point": {"x": 1574, "y": 1043}}
    res = audit_graph(_snap([PLUG], ports=[stray]))
    assert _unwired(res)


def test_mate_beyond_tolerance_does_not_exempt():
    far = {"id": "pf", "label": "T~1~X", "type": "terminal",
           "parentId": "mod", "point": {"x": 1594, "y": 1043}}  # 20px off the face
    res = audit_graph(_snap([PLUG, MODULE], ports=[far]))
    assert [v for v in _unwired(res) if "plug" in v["ids"]]


def test_forgotten_cable_component_still_convicts():
    # interim CAB* component with no mating terminals: doubly wrong under the
    # multipath model — must stay ERROR
    cab = {"id": "cab", "label": "CAB99", "bbox": {"x": 300, "y": 300, "width": 200, "height": 40}}
    res = audit_graph(_snap([cab]))
    fired = _unwired(res)
    assert fired and fired[0]["severity"] == "ERROR"
    # mated at one end (any-end matching) -> exempt
    mate = {"id": "pm", "label": "T~CN40~CN40", "type": "terminal",
            "parentId": "mod", "point": {"x": 300, "y": 320}}
    res2 = audit_graph(_snap([cab, MODULE], ports=[mate]))
    assert not [v for v in _unwired(res2) if "cab" in v["ids"]]


# --- species 2: pass-through ferrites ----------------------------------------

FERRITE = {"id": "fer", "label": "LNF99", "bbox": {"x": 912, "y": 606, "width": 31, "height": 208}}
_PORTS_RS = [
    {"id": "pa", "label": "T~R~R404", "type": "terminal", "parentId": "left", "point": {"x": 800, "y": 668}},
    {"id": "pb", "label": "T~L1~R404", "type": "terminal", "parentId": "right", "point": {"x": 989, "y": 668}},
]
_THROUGH = {"id": "w1", "label": "R404", "sourcePortId": "pa", "targetPortId": "pb",
            "path": [{"x": 800, "y": 668}, {"x": 989, "y": 668}]}


def test_ferrite_exempt_only_with_conductor_through():
    res = audit_graph(_snap([FERRITE], ports=_PORTS_RS, edges=[_THROUGH]))
    assert not _unwired(res), "transparent ferrite with a conductor through it is correct"
    # no conductors yet -> unworked region, keep flagging (ERROR tier kept)
    bare = audit_graph(_snap([FERRITE]))
    assert _unwired(bare) and _unwired(bare)[0]["severity"] == "ERROR"


def test_ferrite_wire_stopping_short_does_not_exempt():
    short = {"id": "w1", "label": "R404", "sourcePortId": "pa", "targetPortId": "pb",
             "path": [{"x": 800, "y": 668}, {"x": 905, "y": 668}]}  # ends before the box
    res = audit_graph(_snap([FERRITE], ports=_PORTS_RS, edges=[short]))
    assert _unwired(res)


def test_fr_blf_label_family_also_exempts():
    fer = dict(FERRITE, label="FR-BLF")
    res = audit_graph(_snap([fer], ports=_PORTS_RS, edges=[_THROUGH]))
    assert not _unwired(res)


def test_ferrite_with_stray_unwired_ports_keeps_warn():
    # zero taps is the sanctioned state — a ferrite that grew terminals stays
    # visible even with conductors through it
    stray = {"id": "pt", "label": "T~1~R404", "type": "terminal",
             "parentId": "fer", "point": {"x": 920, "y": 668}}
    res = audit_graph(_snap([FERRITE], ports=_PORTS_RS + [stray], edges=[_THROUGH]))
    fired = _unwired(res)
    assert fired and fired[0]["severity"] == "WARN"
