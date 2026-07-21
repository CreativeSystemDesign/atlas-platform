"""Rule 22 — terminal-name-fabrication (run-2 forensics, 2026-07-06).

Cold run 2 read terminal-name accuracy .27 while location F1 held .53: the
agent FOUND the pins and INVENTED what to call them (junction/ground/bus/
bundle placeholders, FR40out/R403in suffixes, positional fuse pins). All
convention-SHAPED, so rule 6 and the mint-time auto-namer both passed them.

Calibration contract (the standing floor): gold v1.4 is SILENT — its full
126-terminal vocabulary carries no >=2-char lowercase run and no placeholder
word — while the archived run-2 candidate and synthetic true-positives
convict.
"""

from __future__ import annotations

import json

from src.canvas_copilot.audit import audit_graph, fabricated_name_tokens

GOLD = "../.atlas/experiment-archive/probe-yolo-page10/gold-master-v1.4.json"
RUN2 = "../.atlas/experiment-archive/cold-prompt-2-page10/graph-candidate-final.json"
RULE = "terminal-name-fabrication"


def _fires(graph):
    return [v for v in audit_graph(graph)["violations"] if v["rule"] == RULE]


def test_helper_separates_fabricated_from_printed():
    # run-2's actual fabrications convict
    assert fabricated_name_tokens("T~junction~403") == ["junction"]
    assert fabricated_name_tokens("T~ground~E") == ["ground"]
    assert fabricated_name_tokens("T~bus~R48") == ["bus"]
    assert fabricated_name_tokens("T~bundle~P24") == ["bundle"]
    assert fabricated_name_tokens("T~1~FR40out") == ["FR40out"]
    assert fabricated_name_tokens("T~1~R403in") == ["R403in"]
    assert fabricated_name_tokens("T~out~PLC") == ["out"]
    # uppercase placeholders convict too (the word list, not the case rule)
    assert fabricated_name_tokens("T~JUNCTION~R401") == ["JUNCTION"]
    assert fabricated_name_tokens("T~?~R401") == ["?"]
    # gold vocabulary passes: pseudo-pins, designator-repeat, single lowercase
    for legal in ("T~CONT~PC24", "T~TAP~R103", "T~FU040~FU040", "T~k~102K",
                  "T~a~COM", "T~L+~PP40", "T~IN~CON4", "T~13~R401"):
        assert fabricated_name_tokens(legal) == [], legal
    # non-conforming names are rule 6's business, not ours
    assert fabricated_name_tokens("junction") == []
    assert fabricated_name_tokens("") == []


def test_rule22_gold_v14_fully_silent():
    g = json.load(open(GOLD))["graph"]
    assert _fires(g) == []


def test_rule22_convicts_run2_candidate_fabrications():
    g = json.load(open(RUN2))["graph"]
    fired = _fires(g)
    # 16 of run 2's 46 name misses were pure fabrication-by-form; at least the
    # canonical classes must convict from the archived graph as-is.
    details = " ".join(v["detail"] for v in fired)
    assert len(fired) >= 10, [v["detail"][:60] for v in fired]
    for token in ("junction", "ground", "bus", "bundle", "FR40out", "R403in"):
        assert f"'{token}'" in details, f"{token} not convicted"
    assert all(v["severity"] == "WARN" for v in fired)


def test_rule22_detail_teaches_the_vocabulary():
    snap = {"nodes": [], "edges": [], "continuations": [],
            "ports": [{"id": "p1", "type": "terminal", "label": "T~junction~403",
                       "point": {"x": 10, "y": 10}}]}
    fired = _fires(snap)
    assert len(fired) == 1
    d = fired[0]["detail"]
    assert "CONT" in d and "TAP" in d and "print is the only source" in d
    # junction-typed ports (J-n) are exempt — the rule reads terminals only
    snap["ports"][0]["type"] = "junction"
    assert _fires(snap) == []
