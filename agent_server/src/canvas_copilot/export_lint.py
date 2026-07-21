"""Slate §5 — dataset export lint. ADVISORIES ONLY, never rejects.

The export REJECT tier was killed on born-WARN policy (it would block export
on legitimate continuation stubs whose canonical form is invented, not
Shane-ratified). Every check here rides as an advisory the dataset factory
(or Shane) reads before blessing a page. The gold master is the calibration
floor: v1.1 must lint CLEAN.

Checks (each encodes a measured defect):
- gauge-shaped NET name: "T-a-14AWG"/"T-b-14AWG" used the printed wire gauge
  as a net name on two DISTINCT conductors, falsely implying one net
  (crop-verified; fullwidth １４ＡＷＧ prints exist — NFKC first; the regex
  is ANCHORED on the full net name because "4 AWG" legitimately coexists on
  conductors carrying real nets U40/V40/W40).
- pin == parent designator: T-R402-R402 class — the component's own
  designator laundered into the pin slot. Terminal strips/connectors exempt
  (TB pins legitimately take wire numbers).
- bare T-<n> and non-two-segment names: continuation stubs and half-built
  names are LEGAL mid-build; at export they are debt worth a glance.
- border-straddling text (slate 3.2's export half): reuses the calibrated
  audit rule verbatim — no parallel geometry.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from src.canvas_copilot.audit import CONNECTOR_RE, audit_graph

GAUGE_RE = re.compile(r"^\d+(\.\d+)?\s*(AWG|SQ|MM2)$", re.IGNORECASE)
BARE_T_RE = re.compile(r"^T-?\d+$", re.IGNORECASE)
TILDE_RE = re.compile(r"^T~([^~]+)~([^~]+)$")
LEGACY_RE = re.compile(r"^T-([A-Za-z0-9]+)-([A-Za-z0-9]+)$")


def _n(s: Any) -> str:
    return unicodedata.normalize("NFKC", str(s or "")).strip()


def lint_graph(graph: dict[str, Any], texts: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    advisories: list[dict[str, Any]] = []

    def add(check: str, detail: str, ids: list[str] | None = None) -> None:
        advisories.append({"check": check, "severity": "ADVISORY",
                           "detail": detail, "ids": ids or []})

    nodes = {str(n.get("id")): n for n in graph.get("nodes") or []}

    for e in graph.get("edges") or []:
        lbl = _n(e.get("label"))
        if lbl and GAUGE_RE.match(lbl):
            add("gauge-as-net-name",
                f"edge {e.get('id')} is named '{e.get('label')}' — that is a printed "
                "WIRE GAUGE, not a net; two conductors sharing a gauge string would "
                "falsely read as one net", [str(e.get("id"))])

    for p in graph.get("ports") or []:
        if p.get("type") not in ("terminal", "mate"):
            continue  # junctions are structural; grounds have no nets to lint
        lbl = _n(p.get("label"))
        if not lbl:
            add("unnamed-terminal", f"terminal {p.get('id')} has no name", [str(p.get("id"))])
            continue
        m = TILDE_RE.match(lbl) or LEGACY_RE.match(lbl)
        if not m:
            if BARE_T_RE.match(lbl):
                add("bare-terminal-name",
                    f"terminal '{lbl}' is a bare T-<n> — legal mid-build (continuation "
                    "stubs), debt at export", [str(p.get("id"))])
            else:
                add("non-two-segment-name",
                    f"terminal '{lbl}' does not parse as T~pin~wire", [str(p.get("id"))])
            continue
        pin, net = _n(m.group(1)), _n(m.group(2))
        if GAUGE_RE.match(net):
            add("gauge-as-net-name",
                f"terminal '{lbl}' carries the printed wire GAUGE '{net}' as its net "
                "segment — distinct conductors would falsely share a net", [str(p.get("id"))])
        parent = nodes.get(str(p.get("parentId") or ""))
        if parent is not None:
            plabel = _n(parent.get("label"))
            if (plabel and pin.upper() == plabel.upper()
                    and not CONNECTOR_RE.match(plabel)):
                add("pin-is-parent-designator",
                    f"terminal '{lbl}' uses its parent's designator '{plabel}' as the "
                    "PIN segment — the print is the only pin source (terminal strips "
                    "exempt: their pins legitimately take wire numbers)",
                    [str(p.get("id")), str(parent.get("id"))])

    if texts:
        r = audit_graph(graph, texts=texts)
        for v in r.get("violations") or []:
            if v.get("rule") == "box-text-integrity":
                add("border-straddling-text (export half of slate 3.2)",
                    str(v.get("detail")), [str(i) for i in v.get("ids") or []])

    return advisories
