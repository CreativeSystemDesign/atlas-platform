"""YOLO sidecar loader + detect_components tool — lookup semantics only.

The sidecar is precomputed; these tests fabricate one in tmp_path and point
the module at it. No inference anywhere.
"""

import asyncio
import json

import pytest

from src.canvas_copilot import yolo


DETS = [
    {"id": "y010-000", "class_name": "MC", "confidence": 0.81, "tier": "strong",
     "bbox": {"x": 100, "y": 100, "width": 50, "height": 80}},
    {"id": "y010-001", "class_name": "SR", "confidence": 0.31, "tier": "evidence",
     "bbox": {"x": 300, "y": 100, "width": 40, "height": 40}},
    {"id": "y010-002", "class_name": "MC", "confidence": 0.44, "tier": "evidence",
     "bbox": {"x": 120, "y": 90, "width": 60, "height": 100}},
]


@pytest.fixture()
def sidecar(tmp_path, monkeypatch):
    (tmp_path / "manifest.json").write_text(json.dumps({
        "model_sha256": "abcd1234" + "0" * 56,
        "strong_tier_conf": 0.5,
    }))
    (tmp_path / "yolo-page-010.json").write_text(json.dumps({
        "page": 10, "detections": DETS,
    }))
    monkeypatch.setattr(yolo, "_SIDECAR_DIR", tmp_path)
    yolo._reset_cache()
    yield tmp_path
    yolo._reset_cache()


def test_missing_sidecar_degrades_to_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(yolo, "_SIDECAR_DIR", tmp_path / "nowhere")
    yolo._reset_cache()
    assert yolo.manifest() is None
    assert yolo.page_detections(10) == []
    assert yolo.context_line(10) == ""
    yolo._reset_cache()


def test_page_and_roster(sidecar):
    assert len(yolo.page_detections(10)) == 3
    assert yolo.page_detections(99) == []
    r = yolo.roster(10)
    assert (r["total"], r["strong"], r["evidence"]) == (3, 1, 2)
    assert r["families"]["MC"] == {"strong": 1, "evidence": 1}
    assert r["model_sha"] == "abcd1234"


def test_region_lookup_confidence_ordered(sidecar):
    hits = yolo.in_region(10, {"x": 90, "y": 90, "width": 100, "height": 100})
    assert [h["id"] for h in hits] == ["y010-000", "y010-002"]  # .81 before .44
    assert yolo.in_region(10, {"x": 1000, "y": 1000, "width": 10, "height": 10}) == []


def test_identify_covers_point_best_first(sidecar):
    hits = yolo.identify(10, 130, 120)  # inside both MC boxes
    assert [h["id"] for h in hits] == ["y010-000", "y010-002"]
    assert yolo.identify(10, 5, 5) == []


def test_context_line_carries_doctrine_hooks(sidecar):
    line = yolo.context_line(10)
    assert "3 dets (1 strong)" in line
    assert "MC×2" in line and "SR×1" in line
    assert "NOT truth" in line and "detect_components" in line and "show_yolo" in line


def _tool_result(payload):
    return json.loads(payload["content"][0]["text"])


def test_detect_components_tool_modes(sidecar, monkeypatch):
    from src.canvas_copilot import bridge, tools

    monkeypatch.setattr(
        bridge, "get_state", lambda: {"snapshot": {"page": 10}}
    )

    async def run():
        page = _tool_result(await tools.detect_components.handler({}))
        assert page["ok"] and page["mode"] == "page"
        assert len(page["detections"]) == 3
        assert page["roster"]["strong"] == 1

        filtered = _tool_result(await tools.detect_components.handler({"min_conf": 0.5}))
        assert [d["id"] for d in filtered["detections"]] == ["y010-000"]

        region = _tool_result(await tools.detect_components.handler(
            {"region": {"x": 290, "y": 90, "width": 60, "height": 60}}
        ))
        assert region["mode"] == "region"
        assert [d["id"] for d in region["detections"]] == ["y010-001"]

        ident = _tool_result(await tools.detect_components.handler(
            {"identify": {"x": 130, "y": 120}}
        ))
        assert ident["mode"] == "identify"
        assert [d["id"] for d in ident["matches"]] == ["y010-000", "y010-002"]
        assert "NOTHING" in ident["note"]

    asyncio.run(run())


def test_detect_components_no_page_or_sidecar(monkeypatch, tmp_path):
    from src.canvas_copilot import bridge, tools

    async def run():
        monkeypatch.setattr(bridge, "get_state", lambda: {"snapshot": {}})
        res = _tool_result(await tools.detect_components.handler({}))
        assert res["ok"] is False and "page open" in res["note"]

        monkeypatch.setattr(bridge, "get_state", lambda: {"snapshot": {"page": 10}})
        monkeypatch.setattr(yolo, "_SIDECAR_DIR", tmp_path / "nowhere")
        yolo._reset_cache()
        res = _tool_result(await tools.detect_components.handler({}))
        assert res["ok"] is False and "sidecar" in res["note"]
        yolo._reset_cache()

    asyncio.run(run())


# --- audit rule 17: yolo-unworked-region ------------------------------------

def _audit(snap, dets):
    from src.canvas_copilot.audit import audit_graph
    return audit_graph(snap, yolo_detections=dets)


def _warns(res):
    return [v for v in res["violations"] if v["rule"] == "yolo-unworked-region"]


STRONG_UNCOVERED = {"id": "y010-100", "class_name": "ELB", "confidence": 0.9,
                    "tier": "strong", "bbox": {"x": 2000, "y": 2000, "width": 100, "height": 100}}
STRONG_COVERED = {"id": "y010-101", "class_name": "MC", "confidence": 0.8,
                  "tier": "strong", "bbox": {"x": 100, "y": 100, "width": 50, "height": 80}}
EVIDENCE_UNCOVERED = {"id": "y010-102", "class_name": "SR", "confidence": 0.3,
                      "tier": "evidence", "bbox": {"x": 2200, "y": 2200, "width": 40, "height": 40}}
CONT_UNCOVERED = {"id": "y010-103", "class_name": "CONTINUATION", "confidence": 0.9,
                  "tier": "strong", "bbox": {"x": 2400, "y": 2400, "width": 40, "height": 40}}
SNAP = {"nodes": [{"id": "n1", "label": "MC348",
                   "bbox": {"x": 90, "y": 90, "width": 100, "height": 120}}],
        "ports": [], "edges": []}


def test_unworked_region_flags_only_uncovered_strong_components():
    res = _audit(SNAP, [STRONG_UNCOVERED, STRONG_COVERED, EVIDENCE_UNCOVERED, CONT_UNCOVERED])
    warns = _warns(res)
    assert len(warns) == 1  # ONE aggregated flag per page
    # INFO ceiling (Shane 2026-07-10): YOLO evidence never gates clean/seal.
    assert warns[0]["severity"] == "INFO"
    assert warns[0]["ids"] == ["y010-100"]  # covered/evidence/continuation all excluded
    assert "ELB×1" in warns[0]["detail"]
    assert "proves nothing" in warns[0]["detail"]


def test_unworked_region_silent_when_covered_or_absent():
    assert _warns(_audit(SNAP, [STRONG_COVERED])) == []
    assert _warns(_audit(SNAP, None)) == []
    assert _warns(_audit(SNAP, [])) == []
