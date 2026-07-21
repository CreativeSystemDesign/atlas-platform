"""Wave-2 exit gate (standing): the full-geometry audit on the sealed GOLD
MASTER is FULLY SILENT except Shane-ruled INFO advisories.

Replays audit_page's exact assembly (segments/circles/enclosures/texts/yolo
from the real page-10 artwork) over the archived answer key. Expected
residual: zero ERROR, zero WARN, and INFO limited to the 4 junction-no-dot
advisories (J-42 errata precedent: as-wired beats as-printed — Shane ruled
these stay as advisories) plus the yolo evidence-tier parting glance.

The GOLD fixture tracks live sealed gold page 10 (sheet 4): when Shane's
canvas fixes advance the sealed page past the fixture, re-export live via
/experimental-v2/graph?page_num=10 as the next gold-master-vN.json — v1.6
(2026-07-11) is v1.5 plus his post-seal continuation link chips.

Any new rule that fires here false-fires on truth. This is the calibration
floor for every future conscience change.
"""

from __future__ import annotations

import asyncio
import json
from collections import Counter

from src.canvas_copilot.audit import audit_graph

GOLD = "../.atlas/experiment-archive/probe-yolo-page10/gold-master-v1.6.json"
SHANE_RULED_INFO = {"junction-no-dot", "yolo-evidence-unreviewed"}


def test_gold_master_v11_fully_silent_except_shane_ruled_info():
    from src.canvas_copilot import vectors, yolo

    g = json.load(open(GOLD))["graph"]
    segments = asyncio.run(vectors.page_segments(10))
    circles = vectors.page_circles(10)
    enclosures = vectors.page_enclosures(10)
    texts = asyncio.run(vectors.page_texts(10))
    try:
        dets = yolo.page_detections(10)
    except Exception:
        dets = None

    r = audit_graph(g, None, circles, enclosures, segments, texts, dets)
    sev = Counter(v["severity"] for v in r["violations"])
    offenders = [v for v in r["violations"] if v["severity"] != "INFO"]
    assert not offenders, f"gold must be silent, got: {offenders}"
    stray_info = [v for v in r["violations"] if v["rule"] not in SHANE_RULED_INFO]
    assert not stray_info, f"unruled INFO on gold: {stray_info}"
    assert sev.get("INFO", 0) >= 4  # the 4 J-4x advisories persist by ruling


def test_slate31_wire_name_vs_print_gold_silent_and_convicts():
    """Born-WARN calibration: 0 fires on gold with the REAL text layer (the
    naive shape-only form false-fired 21x on pin designators/component
    labels); the conflicting token must be a KNOWN DRAWN NET. Convicts the
    exact MS349 evidence shape (drawn FU040 on the printed FR40 run)."""
    from src.canvas_copilot import vectors

    g = json.load(open(GOLD))["graph"]
    texts = asyncio.run(vectors.page_texts(10))
    r = audit_graph(g, texts=texts)
    assert not [v for v in r["violations"] if v["rule"] == "wire-name-vs-print"]
    snap = {"nodes": [{"id": "n1", "label": "MS349",
                       "bbox": {"x": 100, "y": 100, "width": 80, "height": 200}}],
            "ports": [{"id": "p1", "label": "T~1~FU040", "type": "terminal",
                       "parentId": "n1", "point": {"x": 100, "y": 150}}],
            "edges": [{"id": "e1", "label": "FR40", "sourcePortId": "p1", "targetPortId": "px",
                       "path": [{"x": 100, "y": 150}, {"x": 40, "y": 150}]},
                      {"id": "e2", "label": "FU040", "sourcePortId": "pz", "targetPortId": "pw",
                       "path": [{"x": 300, "y": 150}, {"x": 400, "y": 150}]}],
            "continuations": []}
    r2 = audit_graph(snap, texts=[{"text": "FR40", "cx": 70, "cy": 140}])
    fired = [v for v in r2["violations"] if v["rule"] == "wire-name-vs-print"]
    assert fired and fired[0]["severity"] == "WARN" and "FR40" in fired[0]["detail"]


def test_slate32_box_text_integrity_gold_silent_and_convicts():
    """Born-WARN calibration: 0 fires on gold (border-hugging annotations
    graze verified boxes at 18-19% — the bisection band starts at 25%);
    convicts a katakana label cut in half (geometric, never content-regex);
    short pin tokens and component designators are exempt at birth."""
    from src.canvas_copilot import vectors

    g = json.load(open(GOLD))["graph"]
    texts = asyncio.run(vectors.page_texts(10))
    r = audit_graph(g, texts=texts)
    assert not [v for v in r["violations"] if v["rule"] == "box-text-integrity"]
    snap = {"nodes": [{"id": "n1", "label": "CON40",
                       "bbox": {"x": 1450, "y": 1000, "width": 120, "height": 80}}],
            "ports": [], "edges": [], "continuations": []}
    cut = [{"text": "コネクタ-TM", "cx": 1450, "cy": 1040,
            "x0": 1420, "y0": 1032, "x1": 1480, "y1": 1048}]
    fired = [v for v in audit_graph(snap, texts=cut)["violations"]
             if v["rule"] == "box-text-integrity"]
    assert fired and "never resize toward text" in fired[0]["detail"].lower()
    exempt = [{"text": "BU", "cx": 1450, "cy": 1040,
               "x0": 1440, "y0": 1032, "x1": 1460, "y1": 1048},
              {"text": "CON40", "cx": 1450, "cy": 1010,
               "x0": 1425, "y0": 1002, "x1": 1475, "y1": 1018}]
    assert not [v for v in audit_graph(snap, texts=exempt)["violations"]
                if v["rule"] == "box-text-integrity"]


def test_gold_master_v11_naming_rail_reads_zero():
    """Slate §5.1 audit-side verification (2026-07-06): the 28/133 tap-count
    inflation is MOOT on sealed gold — tilde v2 + the supervised repair pass
    left zero naming-convention violations, so no tap-separation counter is
    needed. If this ever fires again, revisit §5.1 before adding surface."""
    g = json.load(open(GOLD))["graph"]
    r = audit_graph(g)
    assert not [v for v in r["violations"] if v["rule"] == "naming"]


def test_coldrun1_rules_gold_silent_and_convict():
    """Cold-run-1 findings mechanized (rules 20+21, born WARN), calibrated:
    gold v1.3 stays silent; the archived candidate's 3 genuinely missed refs
    convict; a wire drawn through a device convicts (the R103/S103 crossover
    class — the candidate's merge came via the UNBOXED plug, but the through
    class is the same electrical crime)."""
    from src.canvas_copilot import vectors

    texts = asyncio.run(vectors.page_texts(10))
    segs = asyncio.run(vectors.page_segments(10))
    g = json.load(open(GOLD))["graph"]
    r = audit_graph(g, texts=texts, segments=segs)
    assert not [v for v in r["violations"]
                if v["rule"] in ("continuation-refs-unrepresented", "wire-through-component")]
    cand = json.load(open(
        "../.atlas/experiment-archive/cold-prompt-1-page10/graph-candidate-final.json"))["graph"]
    rc = audit_graph(cand, texts=texts, segments=segs)
    refs = [v for v in rc["violations"] if v["rule"] == "continuation-refs-unrepresented"]
    # 3 -> 5 with the rule-20 run-cluster rewrite (2026-07-11): the per-digit
    # 6px column pairing missed the centered stacked fractions 34/22 and
    # 49/21 at the sheet's bottom row — verified printed tokens at
    # (1317-1329, 2536/2559) and (1359-1371, 2536/2559). Same candidate,
    # better recall.
    assert len(refs) == 5, [v["detail"][:60] for v in refs]
    snap = {"nodes": [{"id": "n1", "label": "R40",
                       "bbox": {"x": 874, "y": 1471, "width": 251, "height": 147}}],
            "ports": [{"id": "pa", "type": "terminal", "label": "T~1~X", "parentId": None,
                       "point": {"x": 700, "y": 1540}},
                      {"id": "pb", "type": "terminal", "label": "T~2~X", "parentId": None,
                       "point": {"x": 1300, "y": 1540}}],
            "edges": [{"id": "e1", "label": "X", "sourcePortId": "pa", "targetPortId": "pb",
                       "path": [{"x": 700, "y": 1540}, {"x": 1300, "y": 1540}]}],
            "continuations": []}
    assert [v for v in audit_graph(snap)["violations"]
            if v["rule"] == "wire-through-component"]


def test_yolo_extent_mismatch_gold_silent_and_catches_m40():
    """Shane's eyeball review of cold run 2 (2026-07-06): M40 drawn at 17.8%
    of true extent, CNV40 close-but-short — and the audit fired NOTHING. The
    blind spot: rule 17 counted ANY overlap as coverage, so the strong 0.90
    M-detection spanning the real motor read as covered by the stub. 17b
    grades coverage as a fraction (>=0.5 clears every gold box), and CAB
    detections grade against EDGES per the multipath law (gold's CAB42 bar
    false-fired when graded against boxes)."""
    from src.canvas_copilot import vectors, yolo

    texts = asyncio.run(vectors.page_texts(10))
    segs = asyncio.run(vectors.page_segments(10))
    dets = yolo.page_detections(10)
    args = (None, vectors.page_circles(10), vectors.page_enclosures(10), segs, texts, dets)
    g = json.load(open(GOLD))["graph"]
    r = audit_graph(g, *args)
    assert not [v for v in r["violations"] if v["severity"] != "INFO"]
    cand = json.load(open(
        "../.atlas/experiment-archive/cold-prompt-2-page10/graph-candidate-final.json"))["graph"]
    rc = audit_graph(cand, *args)
    mm = [v for v in rc["violations"] if v["rule"] == "yolo-extent-mismatch"]
    assert any("M40" in v["detail"] and "16%" in v["detail"] for v in mm), mm
    # Run-2 item b: missing cables are rule 17c. Was END-STATE ERROR
    # 2026-07-06..07-10, demoted to INFO (Shane: YOLO never gates — evidence
    # for the copilot only). 2 of the 3 missed cables carry strong-tier
    # detections; the third rides the evidence-tier parting glance.
    cables = [v for v in rc["violations"] if v["rule"] == "cable-mating-incomplete"]
    assert cables and cables[0]["severity"] == "INFO", rc["violations"]
    assert "2 strong CAB" in cables[0]["detail"] and len(cables[0]["ids"]) == 2, cables
