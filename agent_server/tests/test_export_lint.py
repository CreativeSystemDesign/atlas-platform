"""Slate §5 — dataset export lint (advisories only; gold lints CLEAN)."""

from __future__ import annotations

import asyncio
import json

from src.canvas_copilot.export_lint import lint_graph

GOLD = "../.atlas/experiment-archive/probe-yolo-page10/gold-master-v1.1.json"


def test_gold_v11_shows_the_errata_and_v12_lints_clean():
    """FINDING (2026-07-06, first run of this lint): sealed gold v1.1 carried
    T~a~14AWG / T~b~14AWG on DBU40's left border — the printed wire GAUGE in
    the net slot, while their own edges carry the true nets R402/S402. The
    naming rail cannot see it; this advisory is the first rail that can.
    AMENDED to v1.2 under Shane's ruling + overnight delegation: print-true
    renames T~a~R402 / T~b~S402 (colors deliberately OMITTED — no color
    notation exists anywhere in the 129-page document; they land as one-line
    renames when Shane supplies them). v1.1 stays on file as the errata
    record; v1.2 is the answer key and lints CLEAN."""
    from src.canvas_copilot import vectors

    texts = asyncio.run(vectors.page_texts(10))
    v11 = json.load(open(GOLD))["graph"]
    advisories = lint_graph(v11, texts=texts)
    assert len(advisories) == 2, advisories
    assert all(a["check"] == "gauge-as-net-name" and "14AWG" in a["detail"]
               for a in advisories)
    v12 = json.load(open(GOLD.replace("v1.1", "v1.4")))["graph"]
    assert lint_graph(v12, texts=texts) == []


def test_gauge_as_net_name_both_homes():
    g = {"nodes": [], "continuations": [],
         "ports": [{"id": "p1", "type": "terminal", "label": "T~a~14AWG",
                    "parentId": None, "point": {"x": 0, "y": 0}}],
         "edges": [{"id": "e1", "label": "１４ＡＷＧ",  # fullwidth print — NFKC
                    "sourcePortId": "p1", "targetPortId": "p2",
                    "path": [{"x": 0, "y": 0}, {"x": 10, "y": 0}]}]}
    checks = [a["check"] for a in lint_graph(g)]
    assert checks.count("gauge-as-net-name") == 2
    # a REAL net coexisting with a printed "4 AWG" marking never fires —
    # the regex anchors on the full net string
    g2 = {"nodes": [], "continuations": [], "ports": [],
          "edges": [{"id": "e1", "label": "U40", "sourcePortId": "a",
                     "targetPortId": "b", "path": [{"x": 0, "y": 0}, {"x": 9, "y": 0}]}]}
    assert lint_graph(g2) == []


def test_pin_is_parent_designator_with_strip_exemption():
    def graph(parent_label):
        return {"nodes": [{"id": "n1", "label": parent_label,
                           "bbox": {"x": 0, "y": 0, "width": 50, "height": 50}}],
                "continuations": [], "edges": [],
                "ports": [{"id": "p1", "type": "terminal",
                           "label": f"T~{parent_label}~{parent_label}",
                           "parentId": "n1", "point": {"x": 0, "y": 25}}]}
    assert any(a["check"] == "pin-is-parent-designator" for a in lint_graph(graph("R402")))
    # terminal strips legitimately name pins after wire numbers — exempt
    assert not any(a["check"] == "pin-is-parent-designator" for a in lint_graph(graph("TB1")))


def test_bare_and_malformed_names_are_advisories_never_rejects():
    g = {"nodes": [], "continuations": [], "edges": [],
         "ports": [{"id": "p1", "type": "terminal", "label": "T-3",
                    "parentId": None, "point": {"x": 0, "y": 0}},
                   {"id": "p2", "type": "terminal", "label": "weird name",
                    "parentId": None, "point": {"x": 9, "y": 0}}]}
    checks = {a["check"] for a in lint_graph(g)}
    assert "bare-terminal-name" in checks and "non-two-segment-name" in checks
    assert all(a["severity"] == "ADVISORY" for a in lint_graph(g))
