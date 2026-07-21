"""cable-mating-incomplete accepts the 2026-07-10 cable ELEMENT (box).

Ratified doctrine: cables are first-class NON-CONDUCTING boxes (graph.cables[])
hugging the printed bar — never edges. Before this fix, rule 17c only counted a
CAB-labeled EDGE as covering a CAB detection, so a correctly boxed cable left
the flag firing forever (page-8 CAB20/CAB22 could never reach gold). These
tests pin both the new element path and the retained legacy-edge path.

Severity is INFO — the ceiling for every YOLO-fed rule (Shane, 2026-07-10:
"YOLO boxes arent to be used to gate anything at all! they're only evidence
for the copilot to use when its not sure about something").
"""

from __future__ import annotations

from src.canvas_copilot.audit import audit_graph

# A strong CAB detection between two modules.
_CAB_DET = {
    "id": "y-cab-1",
    "class_name": "CAB",
    "tier": "strong",
    "bbox": {"x": 1300.0, "y": 740.0, "width": 290.0, "height": 100.0},
}


def _cable_flags(snap: dict) -> list[dict]:
    r = audit_graph(snap, None, None, None, None, None, [_CAB_DET])
    return [v for v in r["violations"] if v["rule"] == "cable-mating-incomplete"]


def test_missing_cable_fires():
    # No cable box, no CAB edge → the INFO evidence still fires (regression guard).
    snap = {"nodes": [], "ports": [], "edges": [], "cables": []}
    flags = _cable_flags(snap)
    assert flags and flags[0]["severity"] == "INFO", flags


def test_cable_box_overlapping_detection_satisfies():
    # A cable ELEMENT box covering the detection IS the mating (primary form).
    snap = {
        "nodes": [], "ports": [], "edges": [],
        "cables": [{"id": "cable-1", "label": "CAB20",
                    "bbox": {"x": 1310.0, "y": 745.0, "width": 270.0, "height": 90.0}}],
    }
    assert _cable_flags(snap) == []


def test_tight_bar_inside_loose_detection_satisfies():
    # REAL page-8 geometry (the case the first fix missed): the detection is
    # loose (label + bar + P/N) while the drawn element is a tight
    # training-data bar covering only ~19% of the detection's area — but 100%
    # of the BAR sits inside the detection. Grading against the smaller box,
    # this is fully mated and must not fire.
    snap = {
        "nodes": [], "ports": [], "edges": [],
        "cables": [{"id": "cable-1", "label": "CAB20",
                    "bbox": {"x": 1360.0, "y": 784.0, "width": 215.0, "height": 25.0}}],
    }
    assert _cable_flags(snap) == []


def test_legacy_cab_edge_still_satisfies():
    # Pages modeled before cables were elements used a CAB-labeled edge; keep it.
    snap = {
        "nodes": [], "ports": [], "edges": [
            {"id": "e1", "label": "CAB20",
             "path": [{"x": 1290, "y": 790}, {"x": 1600, "y": 790}]}
        ],
        "cables": [],
    }
    assert _cable_flags(snap) == []


def test_far_cable_box_does_not_mask():
    # A cable box elsewhere on the page must NOT satisfy this detection.
    snap = {
        "nodes": [], "ports": [], "edges": [],
        "cables": [{"id": "cable-2", "label": "CAB99",
                    "bbox": {"x": 100.0, "y": 100.0, "width": 90.0, "height": 90.0}}],
    }
    flags = _cable_flags(snap)
    assert flags and flags[0]["severity"] == "INFO", flags
