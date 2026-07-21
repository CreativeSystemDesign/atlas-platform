"""audit_page — the graph grades itself (R2.1, 2026-07-04).

Pure integrity lint over a canvas snapshot: milliseconds, no model. Every rule
here earned its place by catching a measured defect in the deliberation-frontier
experiment (see .atlas/experiment-archive/). Severities per the build decision
log: ERROR = electrical-truth breaks · WARN = convention/geometry drift ·
INFO = advisories.

v1 = snapshot-only rules. v2 (circles/enclosures/texts) lands in R2.2.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Any

# The authoritative set of rule names this audit can emit. Kept here so
# codify_lesson can validate a lesson's `rule` against it at mint time — a
# lesson keyed to a name NOT in this set has a dead `for_rules` recall path
# (it only rides the rotating recent-block). Two self-minted lessons carried
# dead names (connector-is-terminal, mate-terminal) before this guardrail; see
# docs/vault/Lesson Mining From Copilot Streams.md. Keep in sync when adding a
# rule (test_lesson_guardrails asserts every emitted rule is listed).
AUDIT_RULE_NAMES = frozenset({
    "bbox-truncation-floor", "box-includes-continuation", "box-overlap",
    "box-swallows-enclosures", "box-text-integrity", "cable-mating-incomplete",
    "component-label-is-part-number", "component-label-is-wire-name",
    "component-label-not-printed", "continuation-bundle-incomplete",
    "continuation-is-wire-label", "continuation-refs-unrepresented",
    "continuation-unanchored", "continuation-unlabeled", "continuation-unlinked",
    "degenerate-edge", "duplicate-port", "edge-port-missing", "endpoint-drift",
    "ground-glyph-uncovered", "ground-tap-unlabeled",
    "junction-dangle", "junction-no-dot",
    "label-check-skipped", "mate-face-drift", "missed-junction-dot", "naming",
    "orphan-terminal", "segmented-conductor", "sibling-overlap",
    "terminal-interior", "terminal-mid-wire", "terminal-name-fabrication",
    "terminal-off-border", "terminal-outside-parent", "terminal-owner-integrity",
    "undisposed-warning",
    "unwired-node", "wire-anonymous", "wire-coverage", "wire-name-vs-print",
    "wire-through-component",
    "yolo-evidence-unreviewed", "yolo-extent-mismatch", "yolo-unworked-region",
})

# Terminal naming v3 (Shane-ruled 2026-07-07: "T-CT50-K-S500 is the right
# convention"): T~<owner>~<pin>~<net>, pin slot omitted when the print shows
# none — T~ELB53~R503. The FIRST slot is the OWNER: the parent component's
# printed designator, or the pseudo-owner vocabulary (CONT/TAP/G) for
# unparented stubs — a bare name now locates the physical point (component,
# pin, wire) without the canvas. Unwired spare pins carry SPARE in the net
# slot (T~TB50~7~SPARE). Tilde separator kept from v2 (Shane-approved
# 2026-07-05): printed pins legitimately contain '-'/'+' (L+, L-) — the old
# hyphen format made T-L--PN40 unparseable. Segments are free to contain
# anything the manufacturer printed, except '~' itself.
NAME_RE = re.compile(r"^T~[^~]+~[^~]+(?:~[^~]+)?$")
# Legacy grace: pre-migration names stay legal; new mints should use '~'.
LEGACY_NAME_RE = re.compile(r"^T-[A-Za-z0-9]+-[A-Za-z0-9]+$")


def terminal_name_ok(label: str) -> bool:
    return bool(NAME_RE.match(label) or LEGACY_NAME_RE.match(label))


# Rule 22 (run-2 forensics, 2026-07-06): fabricated name tokens. Terminal-name
# accuracy read .27 cold and the dominant class was INVENTED vocabulary, not
# misread print — English placeholders (junction/ground/bus/bundle) where the
# pseudo-pin vocabulary applies, and in/out-suffixed wire names (FR40out,
# R403in) that exist nowhere on the artwork. Mechanical separation, verified
# against gold v1.4's full 126-terminal vocabulary: no legal token carries a
# lowercase alphabetic run of length >=2 (print is caps/digits/symbols;
# single lowercase pins like 'a'/'b'/'k' are real), and no legal token is an
# English placeholder word. IN/OUT stay OFF the word list — IN is a printed
# pin on gold (T~IN~CON4); only the lowercase form is fabrication evidence.
_FABRICATED_RUN_RE = re.compile(r"[a-z]{2,}")
_PLACEHOLDER_TOKENS = {
    "JUNCTION", "GROUND", "GND", "BUS", "BUNDLE", "WIRE", "NET", "TERM",
    "TERMINAL", "PIN", "PORT", "UNKNOWN", "NONE", "TBD", "MISC", "TEMP",
    "PLACEHOLDER", "XXX", "N/A",
}


def fabricated_name_tokens(label: str) -> list[str]:
    """Tokens in a T~<owner>~[<pin>~]<net> label that smell invented rather
    than printed (owner designators are printed tokens and pass the same way).

    Shared by audit rule 22 and the mint-time receipt note in tools.py —
    convention-SHAPED names pass rule 6 and the auto-namer skips compliant
    labels, so fabricated tokens need their own rail. Asymmetric trust: only
    positive fabrication evidence speaks; an odd but print-shaped token passes.
    """
    if not NAME_RE.match(label or ""):
        return []
    return [tok for tok in label.split("~")[1:]
            if _FABRICATED_RUN_RE.search(tok)
            or tok.strip().upper() in _PLACEHOLDER_TOKENS
            or "?" in tok or not tok.strip()]


def detection_testimony(bbox: dict[str, Any],
                        detections: list[dict[str, Any]] | None) -> dict[str, Any]:
    """The detector's one-line testimony for a freshly drawn box (Shane's
    answer-sheet accountability, 2026-07-06): every freehand component mint
    reports agreement, disagreement, or absence — so 'did it consult the
    detector' is readable in every receipt. Asymmetric trust: absence proves
    nothing and gates nothing."""
    best: dict[str, Any] | None = None
    try:
        bx, by = float(bbox["x"]), float(bbox["y"])
        bw, bh = float(bbox["width"]), float(bbox["height"])
    except (KeyError, TypeError, ValueError):
        return {"kind": "none"}
    for d in detections or []:
        if d.get("tier") != "strong" or str(d.get("class_name")) in ("CONTINUATION", "CAB"):
            continue
        db = d.get("bbox") or {}
        try:
            dx, dy = float(db["x"]), float(db["y"])
            dw, dh = float(db["width"]), float(db["height"])
        except (KeyError, TypeError, ValueError):
            continue
        ix = max(0.0, min(bx + bw, dx + dw) - max(bx, dx))
        iy = max(0.0, min(by + bh, dy + dh) - max(by, dy))
        inter = ix * iy
        union = bw * bh + dw * dh - inter
        iou = inter / union if union > 0 else 0.0
        if iou > 0 and (best is None or iou > best["iou"]):
            best = {"kind": "match", "class_name": str(d.get("class_name")),
                    "confidence": round(float(d.get("confidence") or 0.0), 2),
                    "iou": round(iou, 2), "id": str(d.get("id"))}
    return best or {"kind": "none"}


def detection_coverage_gaps(bbox: dict[str, Any],
                            detections: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Rule 17b's coverage grading at OP TIME (un-shelved 2026-07-06): strong
    detections the given box INTERSECTS but covers <50% of — the M40 class,
    where the printed cell never closes and the detector is the only
    mechanical extent witness. Shared by the annotate receipt note; the
    audit-time rule stays authoritative. CAB grades against edges (17c) and
    CONTINUATION has no box geometry — both excluded, mirroring 17b."""
    out: list[dict[str, Any]] = []
    try:
        bx, by = float(bbox["x"]), float(bbox["y"])
        bw, bh = float(bbox["width"]), float(bbox["height"])
    except (KeyError, TypeError, ValueError):
        return out
    for d in detections or []:
        if d.get("tier") != "strong" or str(d.get("class_name")) in ("CONTINUATION", "CAB"):
            continue
        db = d.get("bbox") or {}
        try:
            dx, dy = float(db["x"]), float(db["y"])
            dw, dh = float(db["width"]), float(db["height"])
        except (KeyError, TypeError, ValueError):
            continue
        ix = max(0.0, min(bx + bw, dx + dw) - max(bx, dx))
        iy = max(0.0, min(by + bh, dy + dh) - max(by, dy))
        frac = ix * iy / max(dw * dh, 1e-6)
        if 0.05 <= frac < 0.5:
            out.append({"class_name": str(d.get("class_name")), "frac": round(frac, 2),
                        "confidence": float(d.get("confidence") or 0.0),
                        "det_bbox": db, "id": str(d.get("id"))})
    return out
# (?![A-Za-z]) guards prefix greed: CN1/CON42 are connectors, CNV40 (converter)
# and CABINET-style labels are NOT — caught 2026-07-04 when CNV40 slipped the
# box-overlap net through this exact hole.
CONNECTOR_RE = re.compile(r"^(CN|CON|TB|MR-TB)(?![A-Za-z])", re.IGNORECASE)
# Connector family for box-overlap exemption (includes cables; see rule 7b).
_CONNECTOR_FAMILY = re.compile(r"^(CN|CON|CAB|TB|MR-TB)(?![A-Za-z])", re.IGNORECASE)
# Slate 2.3 unwired-node exemption family (Shane rulings 2026-07-05/06).
# Plug/terminator class connects by physical MATING, never wires; cables are
# wire-EDGES under the multipath model (a CAB* component is interim state and
# takes the same mating test). TB/terminal strips stay OUT — they must wire.
CABLE_RE = re.compile(r"^CAB(?![A-Za-z])", re.IGNORECASE)
PLUG_RE = re.compile(r"^(CN|CON)(?![A-Za-z])", re.IGNORECASE)
# LNF/FR-BLF line-noise-filter ferrites: electrically transparent, zero taps
# is the CORRECT state — conductors pass through, nothing lands on them.
FERRITE_RE = re.compile(r"^(LNF|FR-BLF)", re.IGNORECASE)
# Current-transformer ref designators (CT10, CT11): blessed CT doctrine — the
# primary conductor threads THROUGH the core without tapping, and the drawn CT
# box is wide enough that neighbouring bus conductors also cross it.
CT_LABEL_RE = re.compile(r"^CT\d", re.IGNORECASE)
MATING_TOL = 15.0  # px: mate terminal to plug/cable bbox border (slate k≈12–16)
SIBLING_EPS = 0.5  # px: non-nested sibling overlap band (slate 2.5; norm = exact abutment)
# Slate 6.10: element ids embedded in receipt-warning notes (owner attribution).
_WARN_ID_RE = re.compile(r"\b(?:node|port|edge|cont)-[0-9a-f][0-9a-f-]{3,}\b")
# Slate 3.1: printed wire-label shape — letters+digits, at least one digit
# (R404, U40, PC24, 1X048, FU040...). Pure numbers excluded (pin slots,
# continuation refs); pure letters excluded (designator fragments).
_NET_TOKEN_RE = re.compile(r"^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{2,6}$")
_NET_SEARCH_PX = 60.0
DUP_EPS = 2.0
ENDPOINT_TOL = 2.0
DIAG_TOL = 6.0


def _dist(a: dict[str, Any], b: dict[str, Any]) -> float:
    return math.hypot(float(a.get("x", 0)) - float(b.get("x", 0)),
                      float(a.get("y", 0)) - float(b.get("y", 0)))


_FAMILY_RE = re.compile(r"^([A-Za-z]+)")


def _on_printed_segment(x: float, y: float, segments: list[dict[str, Any]], tol: float = 4.0) -> bool:
    """Is (x,y) within tol px of any printed line segment?"""
    return _segment_orientations(x, y, segments, tol) >= 1


def _segment_orientations(x: float, y: float, segments: list[dict[str, Any]], tol: float = 4.0) -> int:
    """How many distinct orientations (H/V/diagonal) of printed segments pass
    within tol px of (x,y)? A net-join dot is a T/X — >=2 orientations; an
    ellipsis dot on a connector outline sees only one."""
    buckets: set[str] = set()
    for s in segments:
        try:
            x1, y1, x2, y2 = float(s["x1"]), float(s["y1"]), float(s["x2"]), float(s["y2"])
        except (KeyError, TypeError, ValueError):
            continue
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        if L2 < 1e-9:
            continue
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / L2))
        if math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= tol:
            if abs(dx) >= 3 * abs(dy):
                buckets.add("h")
            elif abs(dy) >= 3 * abs(dx):
                buckets.add("v")
            else:
                buckets.add("d")
    return len(buckets)


def _exit_orientations(x: float, y: float, bbox: dict[str, Any],
                       segments: list[dict[str, Any]], tol: float = 4.0,
                       slack: float = 2.0) -> int:
    """Like _segment_orientations, but count only printed segments at (x,y)
    that LEAVE bbox (an endpoint beyond the box + slack) — conductors of the
    outside world, as opposed to a component's interior artwork."""
    bx1 = float(bbox["x"]) - slack
    by1 = float(bbox["y"]) - slack
    bx2 = float(bbox["x"]) + float(bbox["width"]) + slack
    by2 = float(bbox["y"]) + float(bbox["height"]) + slack
    buckets: set[str] = set()
    for s in segments:
        try:
            x1, y1, x2, y2 = float(s["x1"]), float(s["y1"]), float(s["x2"]), float(s["y2"])
        except (KeyError, TypeError, ValueError):
            continue
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        if L2 < 1e-9:
            continue
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / L2))
        if math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) > tol:
            continue
        if (bx1 <= x1 <= bx2 and by1 <= y1 <= by2
                and bx1 <= x2 <= bx2 and by1 <= y2 <= by2):
            continue  # fully inside the box — interior artwork
        buckets.add("h" if abs(dx) >= 3 * abs(dy)
                    else ("v" if abs(dy) >= 3 * abs(dx) else "d"))
    return len(buckets)


def _is_ground_glyph(c: dict[str, Any], segments: list[dict[str, Any]]) -> bool:
    """Earth-ground symbol: a stroke-only circle with the stacked short
    horizontal bars of the ⏚ glyph at its center. Geometry-based because the
    'G' letters beside grounds are absent from the text layer entirely."""
    if c.get("filled") or not (18.0 <= float(c.get("d", 0)) <= 40.0):
        return False
    cx, cy, r = float(c["cx"]), float(c["cy"]), float(c["d"]) / 2
    bars = []
    for s in segments:
        try:
            x1, y1, x2, y2 = float(s["x1"]), float(s["y1"]), float(s["x2"]), float(s["y2"])
        except (KeyError, TypeError, ValueError):
            continue
        if abs(y2 - y1) > 2.0:
            continue  # bars are horizontal
        ln = abs(x2 - x1)
        if not (4.0 <= ln <= r * 2.2):
            continue
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        if math.hypot(mx - cx, my - cy) <= r * 1.1:
            bars.append((my, ln))
    return len(bars) >= 2


def _bbox_border_dist(pt: dict[str, Any], b: dict[str, Any]) -> float:
    """Distance from a point to a bbox PERIMETER (0 exactly on the border).
    Interior points measure to the nearest edge — a mating terminal sits AT
    the face (CON40's mate: d=0.0 on the gold page), never deep inside."""
    x0, y0 = float(b.get("x", 0)), float(b.get("y", 0))
    x1, y1 = x0 + float(b.get("width", 0)), y0 + float(b.get("height", 0))
    px, py = float(pt.get("x", 0)), float(pt.get("y", 0))
    if x0 <= px <= x1 and y0 <= py <= y1:
        return min(px - x0, x1 - px, py - y0, y1 - py)
    dx = max(x0 - px, 0.0, px - x1)
    dy = max(y0 - py, 0.0, py - y1)
    return math.hypot(dx, dy)


def _segment_crosses_bbox(p1: dict[str, Any], p2: dict[str, Any], b: dict[str, Any]) -> bool:
    """Liang–Barsky clip test: does the segment pass through the bbox?"""
    x0, y0 = float(b.get("x", 0)), float(b.get("y", 0))
    x1, y1 = x0 + float(b.get("width", 0)), y0 + float(b.get("height", 0))
    ax, ay = float(p1.get("x", 0)), float(p1.get("y", 0))
    dx, dy = float(p2.get("x", 0)) - ax, float(p2.get("y", 0)) - ay
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, ax - x0), (dx, x1 - ax), (-dy, ay - y0), (dy, y1 - ay)):
        if p == 0:
            if q < 0:
                return False
        else:
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
    return t0 < t1


def _boxes_intersect(a: dict[str, Any], b: dict[str, Any]) -> bool:
    if not a or not b:
        return False
    return (float(a.get("x", 0)) < float(b.get("x", 0)) + float(b.get("width", 0))
            and float(b.get("x", 0)) < float(a.get("x", 0)) + float(a.get("width", 0))
            and float(a.get("y", 0)) < float(b.get("y", 0)) + float(b.get("height", 0))
            and float(b.get("y", 0)) < float(a.get("y", 0)) + float(a.get("height", 0)))


# Rule 23 (wire-coverage) calibration constants — measured 2026-07-09 against
# gold pages 7+10 (zero fires, robust across min_gap 30-50 / anchor_tol 10-16 /
# lat_tol 5-8) and the page-8 MC-220 deleted-edge repro (fires at 905->998).
_WG_LAT_TOL = 6.0      # px: drawn-edge lateral tolerance to cover a printed run
_WG_CHAIN_GAP = 3.0    # px: collinear printed segments merge into one run
_WG_MIN_GAP = 40.0     # px: minimum uncovered span worth a violation
_WG_ANCHOR_TOL = 12.0  # px: gap end -> annotation-anchor distance
_WG_BORDER_TOL = 4.0   # px: run collinear with a box/enclosure border -> excluded


def _conductor_runs(segments: list[dict[str, Any]]) -> list[tuple[str, float, float, float]]:
    """Chain axis-aligned printed segments into maximal conductor runs for
    rule 23: (axis, lateral, start, end). The 3px chain gap is the dash
    discriminator — conductors print continuous (the MC-220 run is 864->1020.5
    in two abutting segments) while dashed borders gap ~33px (measured on
    INV40, see _bridge_dash_chains) and therefore never chain."""
    runs: list[tuple[str, float, float, float]] = []
    for axis in ("h", "v"):
        items: list[tuple[float, float, float]] = []  # (lateral, start, end)
        for s in segments:
            try:
                x1, y1, x2, y2 = float(s["x1"]), float(s["y1"]), float(s["x2"]), float(s["y2"])
            except (KeyError, TypeError, ValueError):
                continue
            if axis == "h" and abs(y2 - y1) <= 1.5 and abs(x2 - x1) > 1.5:
                items.append(((y1 + y2) / 2, min(x1, x2), max(x1, x2)))
            elif axis == "v" and abs(x2 - x1) <= 1.5 and abs(y2 - y1) > 1.5:
                items.append(((x1 + x2) / 2, min(y1, y2), max(y1, y2)))
        items.sort()
        i = 0
        while i < len(items):
            j = i
            line = [items[i]]
            while j + 1 < len(items) and abs(items[j + 1][0] - line[-1][0]) <= 1.5:
                j += 1
                line.append(items[j])
            line.sort(key=lambda t: t[1])
            k0 = 0
            while k0 < len(line):
                k1 = k0
                a, b = line[k0][1], line[k0][2]
                while k1 + 1 < len(line) and line[k1 + 1][1] - b <= _WG_CHAIN_GAP:
                    k1 += 1
                    b = max(b, line[k1][2])
                lat = sum(t[0] for t in line[k0:k1 + 1]) / (k1 - k0 + 1)
                runs.append((axis, lat, a, b))
                k0 = k1 + 1
            i = j + 1
    return runs


def _detector_corroborates(
    node: dict[str, Any],
    box: tuple[float, float, float, float],
    dets: list[dict[str, Any]] | None,
) -> bool:
    """Slate 2.1(a): a STRONG same-family YOLO detection at IoU>=0.5 with the
    drawn box vouches for a tight extent — the truncation floor stands down."""
    m = _FAMILY_RE.match(str(node.get("label") or ""))
    if not m or not dets:
        return False
    fam = m.group(1).upper()
    bx0, by0, bx1, by1 = box
    barea = max(1.0, (bx1 - bx0) * (by1 - by0))
    for d in dets:
        if d.get("tier") != "strong" or str(d.get("class_name", "")).upper() != fam:
            continue
        db = d.get("bbox") or {}
        dx0, dy0 = float(db.get("x", 0)), float(db.get("y", 0))
        dx1, dy1 = dx0 + float(db.get("width", 0)), dy0 + float(db.get("height", 0))
        inter = (max(0.0, min(bx1, dx1) - max(bx0, dx0))
                 * max(0.0, min(by1, dy1) - max(by0, dy0)))
        union = barea + max(1.0, (dx1 - dx0) * (dy1 - dy0)) - inter
        if union > 0 and inter / union >= 0.5:
            return True
    return False


def _cell_has_stacked_refs(eb: dict[str, Any], texts: list[dict[str, Any]]) -> bool:
    """Slate 2.1(b): boxed number-over-number continuation refs inside a
    candidate cell disqualify it as a component cell (RTC40's phantom cell)."""
    ex0, ey0 = float(eb.get("x", 0)), float(eb.get("y", 0))
    ex1, ey1 = ex0 + float(eb.get("width", 0)), ey0 + float(eb.get("height", 0))
    nums = []
    for t in texts:
        s = str(t.get("text") or "").strip()
        if not re.fullmatch(r"\d{1,3}", s):
            continue
        # text tokens key on cx/cy (2026-07-10: this read x/y — keys that
        # don't exist on tokens — so the guard had never matched anything)
        tx, ty = float(t.get("cx", -1)), float(t.get("cy", -1))
        if ex0 <= tx <= ex1 and ey0 <= ty <= ey1:
            nums.append((tx, ty))
    for i, (x1, y1) in enumerate(nums):
        for x2, y2 in nums[i + 1:]:
            if abs(x1 - x2) <= 10 and 0 < abs(y1 - y2) <= 45:
                return True
    return False


def _contained_frac(inner: dict[str, Any], outer: dict[str, Any]) -> float:
    """Fraction of inner's area that lies inside outer (0.0 for empty inner)."""
    ia = float(inner.get("width", 0)) * float(inner.get("height", 0))
    if ia <= 0 or not outer:
        return 0.0
    ix0 = max(float(inner.get("x", 0)), float(outer.get("x", 0)))
    iy0 = max(float(inner.get("y", 0)), float(outer.get("y", 0)))
    ix1 = min(float(inner.get("x", 0)) + float(inner.get("width", 0)),
              float(outer.get("x", 0)) + float(outer.get("width", 0)))
    iy1 = min(float(inner.get("y", 0)) + float(inner.get("height", 0)),
              float(outer.get("y", 0)) + float(outer.get("height", 0)))
    return max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0) / ia


def _clip_cell_to_siblings(
    cell: tuple[float, float, float, float],
    own: tuple[float, float, float, float],
    others: list[dict[str, Any]],
) -> tuple[float, float, float, float]:
    """Slate 2.1(c): a candidate cell never extends past a sibling component's
    claimed border — the detector merged across whitespace to the NEIGHBOR's
    printed wall on the gold page (CNV40 vs INV40 at x=1572/1573)."""
    cx0, cy0, cx1, cy1 = cell
    ox0, oy0, ox1, oy1 = own
    for mb in others:
        if not mb or float(mb.get("width", 0)) <= 0:
            continue
        mx0, my0 = float(mb.get("x", 0)), float(mb.get("y", 0))
        mx1, my1 = mx0 + float(mb.get("width", 0)), my0 + float(mb.get("height", 0))
        if mx1 <= cx0 or mx0 >= cx1 or my1 <= cy0 or my0 >= cy1:
            continue  # sibling outside the cell
        if min(my1, oy1) - max(my0, oy0) > 0:  # shares a horizontal band with us
            if mx0 >= ox1 and mx0 < cx1:
                cx1 = mx0  # sibling to our right: cell ends at its wall
            if mx1 <= ox0 and mx1 > cx0:
                cx0 = mx1  # sibling to our left
        if min(mx1, ox1) - max(mx0, ox0) > 0:  # shares a vertical band
            if my0 >= oy1 and my0 < cy1:
                cy1 = my0
            if my1 <= oy0 and my1 > cy0:
                cy0 = my1
    return cx0, cy0, cx1, cy1


def audit_graph(
    snap: dict[str, Any],
    warning_ledger: list[dict[str, Any]] | None = None,
    circles: list[dict[str, Any]] | None = None,
    enclosures: list[dict[str, Any]] | None = None,
    segments: list[dict[str, Any]] | None = None,
    texts: list[dict[str, Any]] | None = None,
    yolo_detections: list[dict[str, Any]] | None = None,
    graph_kind: str = "copilot",
) -> dict[str, Any]:
    """graph_kind scopes rules that are TRUE of copilot output but FALSE of
    Shane's gold-style hand labels (slate 2.5: his plugs straddle printed
    module borders ~20px at mating faces by design — 7 of 26 verified hand
    boxes overlap legitimately). Pass "hand-labels" when auditing annotation-
    corpus geometry; the dataset-export path must not call this at all."""
    nodes = snap.get("nodes") or []
    ports = snap.get("ports") or []
    edges = snap.get("edges") or []
    violations: list[dict[str, Any]] = []

    def add(rule: str, severity: str, ids: list[str], detail: str, suggestion: str = "") -> None:
        violations.append({"rule": rule, "severity": severity, "ids": ids,
                           "detail": detail, **({"suggestion": suggestion} if suggestion else {})})

    degree: dict[str, int] = {}
    for e in edges:
        for pid in (e.get("sourcePortId"), e.get("targetPortId")):
            degree[pid] = degree.get(pid, 0) + 1
    ports_by_node: dict[str, list[dict[str, Any]]] = {}
    for p in ports:
        if p.get("parentId"):
            ports_by_node.setdefault(p["parentId"], []).append(p)

    # 1. junction dangles — the arm-3 stranded-net defect (ERROR: breaks tracing)
    for p in ports:
        if p.get("type") == "junction" and degree.get(p.get("id"), 0) < 2:
            add("junction-dangle", "ERROR", [p["id"]],
                f"junction {p.get('label')} at ({p['point']['x']:.0f},{p['point']['y']:.0f}) "
                f"has degree {degree.get(p['id'], 0)} — its branch net is electrically stranded",
                "run {op:'normalize_taps'} or re-draw the tap")

    # 2. orphan terminals — no parent, no wires (WARN)
    for p in ports:
        if p.get("type") == "terminal" and not p.get("parentId") and degree.get(p.get("id"), 0) == 0:
            add("orphan-terminal", "WARN", [p["id"]],
                f"terminal {p.get('label')} at ({p['point']['x']:.0f},{p['point']['y']:.0f}) "
                "has no component and no wires")

    # 3. unwired nodes — exists but carries no electrical work (the 34% defect).
    #    Slate 2.3 exemption family: each species exempts on GEOMETRIC
    #    corroboration, never a blanket label pass, so a genuinely forgotten
    #    cable/plug still convicts:
    #    (1) plug/terminator mating (CON40 class): connects by CONTACT —
    #        exempt when another component's terminal sits within MATING_TOL
    #        of this bbox border (any-end matching: one mated face suffices;
    #        the far end may legitimately be a continuation).
    #    (2) pass-through ferrite (LNF/FR-BLF): zero taps is CORRECT — exempt
    #        only while conductors actually run through the box (none yet =
    #        unworked region, keep flagging). A ferrite with stray unwired
    #        ports keeps its WARN: ports on a transparent part are suspect.
    for n in nodes:
        nports = ports_by_node.get(n.get("id"), [])
        wired = any(degree.get(p["id"], 0) > 0 for p in nports)
        if wired:
            continue
        label = str(n.get("label") or "")
        nbox = n.get("bbox") or {}
        if nbox and (CABLE_RE.match(label) or PLUG_RE.match(label)) and any(
            p.get("type") == "terminal" and p.get("parentId")
            and p.get("parentId") != n.get("id")
            and _bbox_border_dist(p.get("point") or {}, nbox) <= MATING_TOL
            for p in ports
        ):
            continue  # mated: a live module terminal touches this face
        if nbox and not nports and FERRITE_RE.match(label) and any(
            _segment_crosses_bbox(a, c, nbox)
            for e in edges
            for a, c in zip(e.get("path") or [], (e.get("path") or [])[1:])
        ):
            continue  # transparent pass-through: conductors run through it
        if nports and CONNECTOR_RE.match(label):
            continue  # connector-strip spare pins are legal (rules line: add them anyway)
        sev = "WARN" if nports else "ERROR"
        add("unwired-node", sev, [n["id"]],
            f"component {label} has {len(nports)} terminal(s) and 0 wires — "
            + ("spare-strip exception not applicable (not a connector)" if nports else "entirely unwired"))

    # 4. edge endpoints must sit on their ports (drift up to 12px measured)
    port_by_id = {p.get("id"): p for p in ports}
    for e in edges:
        path = e.get("path") or []
        if len(path) < 2:
            add("degenerate-edge", "ERROR", [e["id"]], "edge has <2 path points")
            continue
        for pid, pt in ((e.get("sourcePortId"), path[0]), (e.get("targetPortId"), path[-1])):
            port = port_by_id.get(pid)
            if port is None:
                add("edge-port-missing", "ERROR", [e["id"], str(pid)],
                    f"edge {e.get('label') or e['id']} references a port that does not exist")
            elif _dist(port.get("point") or {}, pt) > ENDPOINT_TOL:
                add("endpoint-drift", "WARN", [e["id"], pid],
                    f"edge {e.get('label') or e['id']} endpoint is "
                    f"{_dist(port.get('point') or {}, pt):.1f}px from its port {port.get('label')}")

    # 5. conductor segmented at a terminal-typed port (should be a junction)
    for p in ports:
        if p.get("type") == "terminal" and not p.get("parentId") and degree.get(p.get("id"), 0) >= 2:
            # Slate 2.2 inline-circle exemption: the artwork itself prints a
            # terminal-class circle mid-run on some conductors (all six gold
            # false flags) — a terminal ON such a circle is faithful, not a
            # mis-typed tap.
            pt = p.get("point") or {}
            if circles and any(
                _dist(pt, {"x": c["cx"], "y": c["cy"]}) <= float(c.get("d", 0)) / 2 + 3.0
                for c in circles
            ):
                continue
            add("segmented-conductor", "WARN", [p["id"]],
                f"unparented terminal {p.get('label')} joins {degree[p['id']]} wires mid-run — "
                "taps are junctions, not terminals")

    # 5b. terminal parked ON another wire's interior — a ring where no component
    #     pin exists (arm-2S blind spot, Shane 2026-07-04). Incident edges exempt.
    for p in ports:
        if p.get("type") != "terminal":
            continue
        pt = p.get("point") or {}
        hit = False
        for e in edges:
            if e.get("sourcePortId") == p.get("id") or e.get("targetPortId") == p.get("id"):
                continue
            path = e.get("path") or []
            for k in range(len(path) - 1):
                x1, y1 = path[k]["x"], path[k]["y"]
                x2, y2 = path[k + 1]["x"], path[k + 1]["y"]
                dx, dy = x2 - x1, y2 - y1
                seg = math.hypot(dx, dy)
                if seg < 1:
                    continue
                t = ((pt.get("x", 0) - x1) * dx + (pt.get("y", 0) - y1) * dy) / (seg * seg)
                if 0 < t < 1 and t * seg > 10 and (1 - t) * seg > 10:
                    if math.hypot(pt.get("x", 0) - (x1 + t * dx), pt.get("y", 0) - (y1 + t * dy)) < 4.0:
                        add("terminal-mid-wire", "ERROR", [p["id"], e["id"]],
                            f"terminal {p.get('label')} sits mid-run on wire "
                            f"{e.get('label') or e['id']} — no component pin exists there "
                            "(taps are junctions; terminals live on component borders)")
                        hit = True
                        break
            if hit:
                break

    # 6. naming convention T~<owner>~[<pin>~]<net> (terminals only; junctions J-n exempt)
    bad_names = [p for p in ports if p.get("type") == "terminal"
                 and not terminal_name_ok(str(p.get("label") or ""))]
    if bad_names:
        add("naming", "WARN", [p["id"] for p in bad_names[:12]],
            f"{len(bad_names)}/{sum(1 for p in ports if p.get('type') == 'terminal')} terminals "
            f"violate T~<owner>~[<pin>~]<net> (sample: {[str(p.get('label')) for p in bad_names[:6]]})",
            "owner = the component designator (CONT/TAP/G for stubs); printed pin "
            "designators win where present; the wire name belongs to the net")

    # 6b. terminal-owner-integrity (Shane, 2026-07-10, page 11's T~T507~T507):
    #     rule 6 checks FORM only — a convention-shaped lie passes it. The
    #     owner slot must be TRUE ("Terminal names should be identifiable.
    #     all i know from that name is that it connects to the wire T507"):
    #     parented → owner == parent element's label; unparented → only CONT
    #     endpoints are ownerless by convention (gold p9). Everything else is
    #     a relic of the pre-parenting mint era (T~<net>~<net>, junk owners,
    #     right-looking labels with no parent link) — adopt into the component
    #     whose border it sits on, rename T~<component>~[pin~]<net>.
    parent_label_by_id: dict[str, str] = {}
    for _coll in (snap.get("nodes"), snap.get("grounds"), snap.get("cables")):
        for _el in _coll or []:
            parent_label_by_id[str(_el.get("id"))] = str(_el.get("label") or "")
    owner_bad: list[tuple[dict[str, Any], str]] = []
    for p in ports:
        if p.get("type") != "terminal":
            continue
        lab = str(p.get("label") or "")
        if not lab.startswith("T~"):
            continue
        _parts = lab.split("~")
        _owner = _parts[1] if len(_parts) > 1 else ""
        _pid = str(p.get("parentId") or "")
        if _pid and _pid in parent_label_by_id:
            _plabel = parent_label_by_id[_pid]
            if _plabel and _owner != _plabel:
                owner_bad.append((p, f"parented to {_plabel} but owner slot says '{_owner}'"))
        elif (_owner not in ("CONT", "TAP", "G", "SHLD")
              and _owner not in parent_label_by_id.values()
              and not (re.match(r"^C(?:N|ON)\d+[A-Z]?$", _owner)
                       and len(_parts) > 2 and _owner == _parts[-1])):
            # Unparented exemptions, all gold-calibrated (pages 8/10):
            #  - CONT/TAP/G stub owners (rule 6's sanctioned set) + SHLD
            #    (shield connection points — ownerless like TAP, p8's
            #    T~SHLD~6023 drain landings)
            #  - owner names a REAL element on the page (T~T50~S501 with a
            #    T50 node = correctly named, merely unlinked — certification seals
            #    accept these; adoption remains desirable, not demanded)
            #  - connector mating terminals named after the connector in
            #    BOTH slots (Shane's convention: "a connector will have a
            #    single terminal named after the connector" — p10's
            #    T~CON4~CON4). Everything else identifies nothing.
            _host = ""
            _pt = p.get("point") or {}
            for _n in snap.get("nodes") or []:
                _b = _n.get("bbox") or {}
                try:
                    _x0, _y0 = float(_b["x"]), float(_b["y"])
                    _x1, _y1 = _x0 + float(_b["width"]), _y0 + float(_b["height"])
                except (KeyError, TypeError, ValueError):
                    continue
                _px, _py = float(_pt.get("x", 0)), float(_pt.get("y", 0))
                _tol = 8.0
                _on_v = abs(_px - _x0) <= _tol or abs(_px - _x1) <= _tol
                _on_h = abs(_py - _y0) <= _tol or abs(_py - _y1) <= _tol
                if ((_on_v and _y0 - _tol <= _py <= _y1 + _tol)
                        or (_on_h and _x0 - _tol <= _px <= _x1 + _tol)):
                    _host = str(_n.get("label") or "")
                    break
            _hint = (f" — sits on {_host}'s border: adopt + rename T~{_host}~…"
                     if _host else " — no component border nearby; verify it belongs here")
            owner_bad.append((p, f"unparented, owner '{_owner}' is a claim with no parent link{_hint}"))
    if owner_bad:
        add("terminal-owner-integrity", "WARN",
            [p["id"] for p, _ in owner_bad[:12]],
            f"{len(owner_bad)} terminal(s) whose owner slot is not backed by a real "
            "parent link: "
            + "; ".join(f"{p.get('label')}: {why}" for p, why in owner_bad[:5])
            + (f" (+{len(owner_bad) - 5} more)" if len(owner_bad) > 5 else ""),
            "a terminal name must IDENTIFY the terminal — owner = the element it is "
            "parented to (T~T52~T507, never T~T507~T507); unparented is legal only "
            "for CONT endpoints. Adopt border terminals into their component, then "
            "rename T~<component>~[pin~]<net>")

    # 6c. continuation-unanchored (Shane, 2026-07-11 — page 11's R502/S502/
    #     T502): three 6/1 refs floated 42px from their endpoints with
    #     target:null — visually adjacent, mechanically linked to NOTHING,
    #     so the data never said the wires continue ("the continuation had
    #     to be placed on the wire endpoint for the data to show that it
    #     continued. these here are just close to it"). A continuation must
    #     be ANCHORED: target a port (wire-end) or a component (the device
    #     cross-ref use). Resolution UX ships with this rule: select the
    #     chip and drag it onto the endpoint (25px snap target-binds), or
    #     Ctrl+C / Ctrl+V to stamp anchored copies across a bundle.
    # Symbol-annotation exemption (Shane, 2026-07-11): a chip sitting ON the
    # printed continuation symbol is "merely annotating that symbol" —
    # training data, no electrical claim, no flag. The endpoint link chip is
    # a SEPARATE element (the two-chip model).
    _ref_tok_re = re.compile(r"^(?:\d{1,3}|\d{1,3}\s*[/-]\s*\d{1,3})$")
    _ref_toks: list[tuple[float, float]] = []
    for _t in texts or []:
        if _ref_tok_re.match(str(_t.get("text") or "").strip()):
            _ref_toks.append((float(_t.get("cx", -1e9)), float(_t.get("cy", -1e9))))
    def _ref_key(_cc: dict[str, Any]) -> str:
        _raw = str(_cc.get("rawRef") or "")
        _m = re.match(r"^(\d{1,3})\s*[/-]\s*(\d{1,3})", _raw)
        _sheet = str(_cc.get("sheet") or "").strip() or (_m.group(1) if _m else "")
        _zone = str(_cc.get("zone") or "").strip() or (_m.group(2) if _m else "")
        return f"{_sheet or '?'}/{_zone or '?'}"

    _symbol_chips: list[dict[str, Any]] = []
    for _c in snap.get("continuations") or []:
        if _c.get("target"):
            continue
        _cpt = _c.get("point") or {}
        _cx0, _cy0 = float(_cpt.get("x", 0)), float(_cpt.get("y", 0))
        if any((_tx - _cx0) ** 2 + (_ty - _cy0) ** 2 <= 28.0 ** 2 for _tx, _ty in _ref_toks):
            _symbol_chips.append(_c)
            continue  # on the printed symbol — an annotation, not a claim
        _cref = _c.get("rawRef") or (
            f"{_c.get('sheet')}/{_c.get('zone')}"
            if _c.get("sheet") or _c.get("zone") else "?")
        add("continuation-unanchored", "WARN", [str(_c.get("id"))],
            f"continuation {_cref} at ({float(_cpt.get('x', 0)):.0f},"
            f"{float(_cpt.get('y', 0)):.0f}) is anchored to nothing "
            "(target:null) — the data does not say any wire continues here",
            "a continuation states where a wire GOES; unanchored it is "
            "decoration. Drag the chip onto the wire ENDPOINT it continues "
            "(the snap binds it) or Ctrl+C/Ctrl+V anchored copies; the "
            "copilot passes target_id on add_continuation. Device cross-refs "
            "belong targeted at their component.")

    # 6e. continuation-unlinked (Shane, 2026-07-11 — the MS2 33/4: "there was
    #     a continuation symbol on the page that had been annotated but it
    #     wasnt linked to anything. that can break the entire machine
    #     electrically"): a printed symbol's annotation chip is quiet, but
    #     its REF must be carried by anchored link chips — count-based per
    #     ref: symbol chips with ref K vs anchored chips with ref K. The
    #     normal pair (one symbol chip on the print + one bound copy on the
    #     element, e.g. page 11's 32/12 symbol + its MC321-bound twin) counts
    #     1v1 and stays QUIET; only an uncarried ref flags — a severed
    #     inter-page edge can never hide behind a completed-looking symbol.
    if _symbol_chips:
        _anchored_by_key: dict[str, int] = {}
        for _c in snap.get("continuations") or []:
            if _c.get("target"):
                _k = _ref_key(_c)
                _anchored_by_key[_k] = _anchored_by_key.get(_k, 0) + 1
        _sym_by_key: dict[str, list[dict[str, Any]]] = {}
        for _c in _symbol_chips:
            _sym_by_key.setdefault(_ref_key(_c), []).append(_c)
        for _k, _chips in _sym_by_key.items():
            _missing = len(_chips) - _anchored_by_key.get(_k, 0)
            if _missing <= 0:
                continue
            add("continuation-unlinked", "WARN",
                [str(_c.get("id")) for _c in _chips[:6]],
                f"printed continuation {_k}: {len(_chips)} symbol annotation(s) but only "
                f"{_anchored_by_key.get(_k, 0)} anchored link chip(s) carry the ref — "
                f"{_missing} inter-page connection(s) are SEVERED in the data (the wire/"
                "component continues in the machine; the graph dead-ends)",
                "put a bound copy on everything the symbol continues: select the chip and "
                "Ctrl+click each element, or Shift+drag copies; the copilot uses "
                "add_continuation with target_id")

    # 6f. continuation-is-wire-label (Shane, 2026-07-11, the PLS24/X2315 pair
    #     the grey chips exposed): this print draws WIRE NUMBERS inside pill
    #     outlines — the same stadium glyph family as continuation refs — and
    #     a legacy run minted continuation chips from them, stranding the
    #     conductor's identity in a ref field ("collateral damage" from
    #     before the newer rules; Shane hand-fixed FU40/FV40/FW40 and still
    #     missed the pair one circuit up — the CLASS needs the tripwire, not
    #     the instances). Signature: the ref fails sheet/zone parsing AND is
    #     wire-label shaped (letters+digits, no slash/dash, not pure digits).
    _sheety_re = re.compile(r"^\d{1,3}\s*[/-]\s*\d{1,3}$")
    _netish_re = re.compile(r"^[A-Z]{0,4}\d{2,5}[A-Z]?$")
    for _c in snap.get("continuations") or []:
        _raw = str(_c.get("rawRef") or "").strip()
        _sh = str(_c.get("sheet") or "").strip()
        _zn = str(_c.get("zone") or "").strip()
        if _sheety_re.match(_raw) or (_sh.isdigit() and _zn):
            continue  # a real sheet/zone ref
        _cand = _raw or _sh
        if not _cand or not _netish_re.match(_cand) or _cand.isdigit():
            continue
        _pt = _c.get("point") or {}
        add("continuation-is-wire-label", "WARN", [str(_c.get("id"))],
            f"continuation chip at ({float(_pt.get('x', 0)):.0f},"
            f"{float(_pt.get('y', 0)):.0f}) carries the WIRE NUMBER '{_cand}', "
            "not a sheet ref — the printed pill around a wire label is not a "
            "continuation symbol (legacy-run collateral)",
            f"name the WIRE '{_cand}' (and its terminals per convention), then "
            "delete this chip — the identity belongs on the conductor, not in "
            "a ref field")

    # continuation-unlabeled (born WARN 2026-07-13, from the rawRef tax: 23
    # link chips landed sheet-less with ok:true receipts and a CLEAN audit —
    # presence was checked, labeling never was). A LINK chip (target set)
    # with NOTHING resolvable cannot cross-page resolve. Symbol chips (no
    # target) are excluded; wire-label chips are covered by
    # continuation-is-wire-label above. GOLD-CALIBRATED at birth: sealed
    # pages carry device cross-refs whose rawRef is the legend's PAGE-LINE
    # dash format ('34-22') with no sheet field — any parseable two-part ref
    # (N/Z or P-L) counts as labeled; only the truly-blank class fires.
    _parseable_ref_re = re.compile(r"^\s*[0-9A-Za-z.]+\s*[-/]\s*[0-9A-Za-z.]+\s*$")
    for _c in snap.get("continuations") or []:
        if not _c.get("target"):
            continue
        if str(_c.get("sheet") or "").strip():
            continue
        _raw = str(_c.get("rawRef") or "").strip()
        if _raw and _parseable_ref_re.match(_raw):
            continue
        _pt = _c.get("point") or {}
        add("continuation-unlabeled", "WARN", [str(_c.get("id"))],
            f"link continuation at ({float(_pt.get('x', 0)):.0f},"
            f"{float(_pt.get('y', 0)):.0f}) carries no sheet and no parseable "
            f"ref ({_raw!r}) — cross-page resolution cannot run; the badge "
            "reads ?/?",
            "set sheet + zone on the chip (or a parseable 'N/Z' raw_ref). "
            "add_continuation now warns loudly at add-time; this rule catches "
            "pre-fix chips and any future path that lands one unlabeled")

    # 6d. wire-anonymous (Shane, 2026-07-11 — the MS2/THR2 motor phases
    #     "slipped through our audit un-noticed"): a wire with NO label whose
    #     endpoint terminals name NO net is identity-less — nothing in the
    #     data says what conductor it is. Gold-calibrated: label-empty wires
    #     whose TERMINALS carry the net (T~CON24~220 <-> T~CNV1~CON24~220,
    #     the T~G~E drops) are the sealed-acceptable class and stay silent;
    #     junction-ended segments are excluded (split trunks carry the label
    #     on sibling segments). Draw-time inference (endpoint agreement /
    #     pass-through THR devices) prevents new ones.
    _net_slot_re = re.compile(r"^T~[^~]+~(?:[^~]+~)?([^~]+)$")

    def _port_net(pid: str | None) -> str | None:
        _p = next((q for q in ports if q.get("id") == pid), None)
        if not _p or _p.get("type") != "terminal":
            return "__NOT_TERMINAL__"
        _m = _net_slot_re.match(str(_p.get("label") or "").strip())
        return _m.group(1).strip() if _m else None

    _anon = []
    for e in edges:
        if str(e.get("label") or "").strip():
            continue
        _sn = _port_net(e.get("sourcePortId"))
        _tn = _port_net(e.get("targetPortId"))
        if _sn == "__NOT_TERMINAL__" or _tn == "__NOT_TERMINAL__":
            continue  # junction-ended: the run's label lives on a sibling segment
        if _sn or _tn:
            continue  # net carried by a terminal name — the certification-sealed class
        _anon.append(e)
    if _anon:
        add("wire-anonymous", "WARN", [str(e.get("id")) for e in _anon[:12]],
            f"{len(_anon)} wire(s) with no label AND no net in either terminal "
            "name — the data cannot say what conductor they are",
            "name the wire from the print; where the print carries no number, "
            "the net inherits through endpoint agreement or a pass-through "
            "device (THR class) — rename the wire and repair its terminals")

    # 6e. ground-tap-unlabeled (Shane, 2026-07-11, blessed ls-20260712-bless-02:
    #     "none of the ground tap wires to the ground glyphs were labeled as
    #     'G'... This slipped through the rules"). A ground-tap/stem wire running
    #     to a G terminal (T~*~G, e.g. T~T52~G <-> T~G~G) that is NOT itself
    #     labeled G never joins the named net, so the cross-sheet G continuation
    #     reads MISMATCH even though the earth tie is real. wire-anonymous (6d)
    #     EXEMPTS these because the terminal carries a net — which is precisely
    #     why they slipped through, so this is a distinct rule, not a widening of
    #     6d. Born WARN. Scoped to the net slot 'G' (the continuing ground net);
    #     local earth drops (T~G~E, net 'E') stay the sealed-acceptable silent
    #     class per 6d. Gold page 10 has ZERO unlabeled G-net wires -> silent.
    _gtap = []
    for e in edges:
        if str(e.get("label") or "").strip():
            continue
        _sn = _port_net(e.get("sourcePortId"))
        _tn = _port_net(e.get("targetPortId"))
        if _sn == "__NOT_TERMINAL__" or _tn == "__NOT_TERMINAL__":
            continue  # junction-ended: the run's label lives on a sibling segment
        if _sn == "G" or _tn == "G":
            _gtap.append(e)
    if _gtap:
        add("ground-tap-unlabeled", "WARN",
            [str(e.get("id")) for e in _gtap[:12]],
            f"{len(_gtap)} ground-tap/stem wire(s) run to a G terminal but are not "
            "labeled G — the earth glyph never joins the named net, so a cross-sheet "
            "G continuation will read MISMATCH though the tie is real",
            "label each ground-tap wire G; one ground-net mismatch means label ALL "
            "ground taps on the sheet, not just the flagged one")

    # 7. duplicates within ±2px
    seen_pts: list[dict[str, Any]] = []
    for p in ports:
        for q in seen_pts:
            if _dist(p.get("point") or {}, q.get("point") or {}) <= DUP_EPS:
                add("duplicate-port", "WARN", [q["id"], p["id"]],
                    f"ports {q.get('label')} and {p.get('label')} within {DUP_EPS}px")
        seen_pts.append(p)

    # 7b. component boxes overlapping — over-boxing invades neighbors' territory
    #     silently (arm-2S: CNV40 grew to cover 58% of RTC40 and 70% of R40 while
    #     the audit read clean). Over-boxing also mutes terminal-outside-parent,
    #     so this rule is the counterweight to the truncation floor.
    #     Calibrated against the 26 verified page-10 gold boxes (2026-07-04):
    #     ALL 11 gold overlaps involve connector-family labels (CN/CON/CAB nest
    #     inside module faces by nature) — exempt them, else the rule false-fires
    #     on truth.
    #     Slate 2.5 fold: a second, tighter band rides the same pairwise scan —
    #     non-nested sibling overlap deeper than SIBLING_EPS on BOTH axes. The
    #     Shane-verified end state is EXACT shared-edge abutment (INV40 at
    #     x=1573.5/1824.0, overlap exactly 0), and every calibrated tolerance
    #     in this file is >=2px, so 0.5px is stricter than anything shipped.
    #     Connector-family pairs are NOT exempt from this band — the blanket
    #     exemption blinded 7b to the ~9px INV40/CAB41-42 overlap Shane
    #     personally ordered cleared (L51). Nesting (containment) is excluded:
    #     the swallow class belongs to rule 12b. copilot-graph scope only.
    for i, na in enumerate(nodes):
        a = na.get("bbox") or {}
        a_conn = bool(_CONNECTOR_FAMILY.match(str(na.get("label") or "")))
        for nb2 in nodes[i + 1:]:
            b = nb2.get("bbox") or {}
            if not a or not b:
                continue
            b_conn = bool(_CONNECTOR_FAMILY.match(str(nb2.get("label") or "")))
            ix = max(0.0, min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"]))
            iy = max(0.0, min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"]))
            smaller = max(1.0, min(a["width"] * a["height"], b["width"] * b["height"]))
            inter = ix * iy
            frac = inter / smaller
            nested = inter >= 0.98 * smaller
            # Shane ruling 2026-07-06 (BAT40): a SMALL part fully contained in
            # a much larger unit is the mounted-part class — a real physical
            # component living inside a module (the MR-J3BAT battery inside
            # the servo amp), not an over-extended box. Exempt only when the
            # containment is total AND the inner part is tiny relative to the
            # outer (the arm-2S monster overlapped siblings 58-70% PARTIALLY,
            # and equal-size swallows keep firing).
            mounted_part = nested and inter <= 0.10 * max(
                a["width"] * a["height"], b["width"] * b["height"])
            if not a_conn and not b_conn and frac > 0.25 and not mounted_part:
                add("box-overlap", "WARN", [na["id"], nb2["id"]],
                    f"boxes {na.get('label')} and {nb2.get('label')} overlap "
                    f"{frac:.0%} of the smaller — one of them is over-extended "
                    "(a dashed combined assembly is ONE box, never nested boxes)")
            elif (graph_kind == "copilot" and not nested
                  and min(ix, iy) > SIBLING_EPS):
                add("sibling-overlap", "WARN", [na["id"], nb2["id"]],
                    f"boxes {na.get('label')} and {nb2.get('label')} overlap "
                    f"{ix:.1f}x{iy:.1f}px — the verified norm is EXACT "
                    "shared-edge abutment (overlap 0): align the shared edge "
                    "to the printed border")

    # 8. diagonal-segment rule REMOVED (Shane, 2026-07-06, gold review #8/#9):
    # the printed artwork itself runs diagonal leads throughout the document
    # family — the rule could only ever flag faithful tracing. Its own stats
    # agreed (11/13 fires were real printed leads).

    # 9. undisposed receipt warnings (server ledger). Slate 6.10: every entry
    #    quotes its parentId-DERIVED owner or states "no owner" — the dying
    #    page-10 session mis-attributed 19 WARNs to cable terminals when all
    #    19 sat on CNV40/INV40, and the wrong attribution rode two handoffs.
    #    Never infer nearest-component.
    _label_by_node = {str(n.get("id")): str(n.get("label") or "?") for n in nodes}
    _parent_by_port = {str(p.get("id")): p.get("parentId") for p in ports}
    for wentry in warning_ledger or []:
        note = str(wentry.get("note", ""))
        owner: str | None = None
        for wid in _WARN_ID_RE.findall(note):
            if wid in _parent_by_port:
                pid = _parent_by_port[wid]
                owner = _label_by_node.get(str(pid), "?") if pid else "unparented"
                break
            if wid in _label_by_node:
                owner = _label_by_node[wid]
                break
        cnt = int(wentry.get("count") or 1)
        # Stable id (2026-07-08): hash of the note keys this warning so Shane's
        # disposition (drawer/chat) can suppress it — id-less WARNs were
        # undisposable and re-listed forever after his verdict.
        wid_stable = "warn-" + hashlib.md5(note.encode()).hexdigest()[:10]
        add("undisposed-warning", "WARN", [wid_stable],
            "receipt warning never fixed or dispositioned"
            + (f" x{cnt}" if cnt > 1 else "")
            + (f" [owner: {owner}]" if owner else " [no owner]")
            + f": {note[:140]}")

    # ---- v2 rules (geometry-keyed; only run when the data is supplied) ---------

    # 10. terminal placement vs the box border. Slate 2.4 doctrine sync
    #     (Shane 2026-07-05): the terminal belongs where the external wire
    #     CROSSES the PRINTED border; printed circles may legitimately sit
    #     interior (R40 holds 6 of them 32-52px deep). Remedies never use
    #     circle-relative geometry and never stretch a box to reach a
    #     misplaced terminal. Resolution order: verify the terminal against
    #     its wire's border crossing FIRST; move the box edge only if it
    #     disagrees with the PRINTED border. on_circle survives as cited
    #     EVIDENCE only. Check logic and tiers unchanged.
    if circles is not None:
        term_circles = [c for c in circles if c.get("class") == "terminal"]
        node_by_id = {n.get("id"): n for n in nodes}
        for p in ports:
            if p.get("type") != "terminal" or not p.get("parentId"):
                continue
            pt = p.get("point") or {}
            on_circle = any(_dist(pt, {"x": c["cx"], "y": c["cy"]}) <= max(8.0, c["d"] / 2)
                            for c in term_circles)
            n = node_by_id.get(p["parentId"])
            if not n:
                continue
            b = n.get("bbox") or {}
            dx = max(b["x"] - pt["x"], 0, pt["x"] - (b["x"] + b["width"]))
            dy = max(b["y"] - pt["y"], 0, pt["y"] - (b["y"] + b["height"]))
            outside = math.hypot(dx, dy)
            inside = min(pt["x"] - b["x"], b["x"] + b["width"] - pt["x"],
                         pt["y"] - b["y"], b["y"] + b["height"] - pt["y"])
            if outside > 2.0:
                add("terminal-outside-parent", "ERROR", [p["id"], n["id"]],
                    f"terminal {p.get('label')} is {outside:.0f}px OUTSIDE its parent "
                    f"{n.get('label')}"
                    + (" (a printed circle sits under it)" if on_circle else "")
                    + " — verify the terminal against its wire's PRINTED-border "
                    "crossing FIRST: if the box edge sits on the printed border, "
                    "MOVE THE TERMINAL to the crossing — never stretch the box to "
                    "reach a misplaced terminal. Move the box edge only if it "
                    "disagrees with the printed border")
            elif inside > 40.0:
                # Deep interior is ERROR regardless of printed circles (Shane's
                # rule, 2026-07-04): terminals exist ONLY on the border. The old
                # on-circle waiver let the CNV40 monster box hide 15 of these.
                add("terminal-interior", "ERROR", [p["id"], n["id"]],
                    f"terminal {p.get('label')} sits {inside:.0f}px INSIDE {n.get('label')} — "
                    + ("a printed circle sits beneath, and circles legitimately "
                       "live interior: the terminal belongs where the external "
                       "wire crosses the PRINTED border — move the TERMINAL to "
                       "that crossing; touch the box edge only if it disagrees "
                       "with the printed border (never resize a border to meet "
                       "a circle)" if on_circle
                       else "no printed circle beneath either — misplaced "
                       "terminal; move it to its wire's printed-border crossing"))
            elif inside > 8.0:
                add("terminal-off-border", "WARN", [p["id"], n["id"]],
                    f"terminal {p.get('label')} sits {inside:.0f}px inside {n.get('label')} — "
                    "terminals belong ON the border (±8px), where the wire "
                    "crosses it"
                    + ("; the printed circle under it is legitimate interior "
                       "artwork — align the terminal to the border crossing, "
                       "not to the circle" if on_circle else ""))

        # 10b. mate terminals (Shane, 2026-07-09): ONE terminal owned by TWO
        #     flush-abutting components — connection by MATING. Integrity: a
        #     mate must sit on BOTH parents' borders (±8px); drifting off
        #     either face (or losing a parent) breaks the conduction claim.
        #     Born WARN per flag policy.
        for p in ports:
            if p.get("type") != "mate":
                continue
            pt = p.get("point") or {}
            pa = node_by_id.get(str(p.get("parentId") or ""))
            pb = node_by_id.get(str(p.get("parentId2") or ""))
            if not pa or not pb:
                add("mate-face-drift", "WARN", [p["id"]],
                    f"mate terminal {p.get('label')} is missing a parent "
                    f"({'first' if not pa else 'second'} parent not on this page) — "
                    "a mate binds exactly two components; reparent or convert to a terminal")
                continue
            da = _bbox_border_dist(pt, pa.get("bbox") or {})
            db = _bbox_border_dist(pt, pb.get("bbox") or {})
            if max(da, db) > 8.0:
                worst = pa if da >= db else pb
                add("mate-face-drift", "WARN", [p["id"], str(worst.get("id"))],
                    f"mate terminal {p.get('label')} sits {max(da, db):.0f}px off "
                    f"{worst.get('label')}'s border — a mate lives ON the shared flush "
                    "face of BOTH parents (±8px); realign it or the boxes")

        # 11. printed junction dot with no drawn junction (missed net-join),
        #     and drawn junction with no printed dot (crossing suspect)
        jports = [p for p in ports if p.get("type") == "junction"]
        conts_pts = [c.get("point") or {} for c in (snap.get("continuations") or [])]
        seen_dots: set[tuple[int, int]] = set()
        for c in circles:
            if c.get("class") != "junction":
                continue
            key = (round(float(c["cx"])), round(float(c["cy"])))
            if key in seen_dots:
                continue  # extractor yields duplicates from overlapping draws
            seen_dots.add(key)
            # Slate 2.3 (Shane-disposed FPs, 2026-07-09): a printed dot INSIDE
            # a component's bbox with fewer than TWO conductor orientations
            # LEAVING the box is the component's own interior artwork — a
            # pin/tap dot of its internal schematic (page 11's T50/T51/T52 G
            # pins: dot 4–10px inside the box, ONE conductor exits, the other
            # orientations are the printed internal circuit). Internals are
            # never modeled (manufacturer doctrine) and terminals live ON the border,
            # so no drawn join is owed there. NOT a blanket interior waiver:
            # a dot inside a bbox where >=2 conductors EXIT the box (page
            # 12's M7 pin U7 — supply wire + jumper geometry, measured 2
            # exiting orientations 7.6px inside the box) still owes a modeled
            # degree>=2 join and still audits.
            _cx, _cy = float(c["cx"]), float(c["cy"])
            if segments is not None and any(
                _exit_orientations(_cx, _cy, b, segments) < 2
                for n in nodes
                if (b := n.get("bbox")) and all(k in b for k in ("x", "y", "width", "height"))
                and float(b["x"]) <= _cx <= float(b["x"]) + float(b["width"])
                and float(b["y"]) <= _cy <= float(b["y"]) + float(b["height"])
            ):
                continue
            # Slate 2.2: a junction claim needs fill (classed upstream) AND
            # conductors from MULTIPLE directions — a net-join is a T/X of
            # lines. Connector-pinout ellipsis dots ride a SINGLE outline
            # line (22 of 31 on the gold page, the D-sub illustration).
            if segments is not None and _segment_orientations(
                    float(c["cx"]), float(c["cy"]), segments, tol=4.0) < 2:
                continue
            if not any(_dist({"x": c["cx"], "y": c["cy"]}, e.get("path", [{}])[i]) < 200
                       for e in edges for i in range(len(e.get("path") or []))):
                continue  # no drawn work near this dot yet — not a miss, just unannotated
            if any(_dist(pt, {"x": c["cx"], "y": c["cy"]}) <= 12.0 for pt in conts_pts):
                continue  # a drawn continuation at the dot satisfies the join
            # A modeled join is ANY port of degree>=2 at the dot (T-124/T-126
            # are terminal-typed and Shane-approved), or >=2 edge endpoints
            # meeting there — never only junction-typed ports.
            joined = any(
                _dist(p.get("point") or {}, {"x": c["cx"], "y": c["cy"]}) <= 8.0
                and degree.get(p.get("id"), 0) >= 2
                for p in ports
            ) or sum(
                1 for e in edges
                for pt in (e.get("path") or [{}])[:1] + (e.get("path") or [{}])[-1:]
                if _dist(pt, {"x": c["cx"], "y": c["cy"]}) <= 8.0
            ) >= 2
            if not joined:
                # Stable coordinate-keyed id (2026-07-09, contref- pattern):
                # empty ids made these undisposable from the canvas pill and
                # impossible to geometry-bind — the page-8 batch proved it.
                add("missed-junction-dot", "WARN",
                    [f"jdot-{c['cx']:.0f}-{c['cy']:.0f}"],
                    f"printed junction dot at ({c['cx']:.0f},{c['cy']:.0f}) has no drawn join — "
                    "wires joining there are not net-joined in the graph")
        for p in jports:
            pt = p.get("point") or {}
            if not any(_dist(pt, {"x": c["cx"], "y": c["cy"]}) <= 8.0
                       for c in circles if c.get("class") == "junction"):
                add("junction-no-dot", "INFO", [p["id"]],
                    f"drawn junction {p.get('label')} has no printed dot beneath — "
                    "crossing-not-connecting suspect; verify the artwork")

        # 11b. ground-glyph coverage (born WARN, 2026-07-06 — Shane found a
        # missed ground tap on the GOLD page after blessing; its detector hit
        # was evidence-tier so the strong-only cross-check stayed silent by
        # design). A printed earth-ground glyph = stroke-only circle with a
        # 'G' printed beside it; one with NO drawn annotation nearby is
        # unworked documentation.
        if texts:
            g_texts = [t for t in texts
                       if str(t.get("text") or "").strip().upper() == "G"]
            all_pts = ([p.get("point") or {} for p in ports]
                       + [c.get("point") or {} for c in (snap.get("continuations") or [])])
            grounds = snap.get("grounds") or []

            def _ground_box_covers(pt: dict[str, Any]) -> bool:
                # A first-class ground element (its snug box hugs the glyph's
                # enclosing circle) covers the glyph when the circle center sits
                # inside the box (+8px slack for the snap pad).
                for g in grounds:
                    b = g.get("bbox") or {}
                    try:
                        x, y, w, h = float(b["x"]), float(b["y"]), float(b["width"]), float(b["height"])
                    except (KeyError, TypeError, ValueError):
                        continue
                    if x - 8 <= pt["x"] <= x + w + 8 and y - 8 <= pt["y"] <= y + h + 8:
                        return True
                return False

            for c in circles:
                if c.get("filled") or not (18.0 <= float(c.get("d", 0)) <= 36.0):
                    continue
                cpt = {"x": c["cx"], "y": c["cy"]}
                # tokens key on cx/cy (2026-07-10: this read x/y — keys that
                # don't exist — so 11b could never match a G label and was dead)
                if not any(_dist(cpt, {"x": t.get("cx", -1e9), "y": t.get("cy", -1e9)}) <= 45.0
                           for t in g_texts):
                    continue  # not a ground glyph
                covered = (
                    _ground_box_covers(cpt)
                    or any(_dist(cpt, pt) <= 25.0 for pt in all_pts)
                    or any(_dist(cpt, e.get("path", [{}])[i]) <= 25.0
                           for e in edges for i in range(len(e.get("path") or [])))
                )
                if not covered:
                    # Synthetic location id so raise_to_shane dispose can bind
                    # (2026-07-12, ls-20260712-bless-01 follow-up: the flag had
                    # empty ids, so Shane's "accept the phantom ground" verdict
                    # could never clear it — it tallied forever). Same pattern
                    # as rule 20's contref-<x>-<y>. No graph element exists (that
                    # IS the flag), so the disposition is geometry-None → sticky.
                    add("ground-glyph-uncovered", "WARN",
                        [f"groundglyph-{c['cx']:.0f}-{c['cy']:.0f}"],
                        f"printed earth-ground glyph at ({c['cx']:.0f},{c['cy']:.0f}) has no "
                        "drawn annotation — mark it with a first-class ground element "
                        "(annotate add_ground / the Ground tool); annotate or dispose with reason")

        # 11c. bar-stack earth glyphs (Shane, 2026-07-10, page 11: "missing
        #      ground bboxes" on a page that showed SEALABLE). The IEC earth
        #      symbol here is not a circle at all — a stack of >=3 short
        #      horizontal bars with strongly shrinking widths (measured
        #      33→17→8px on page 11; YOLO also blind to them, and this is
        #      vector print geometry, so it MAY gate). Coverage for this form
        #      is a GROUND ELEMENT box over the glyph — wires legitimately
        #      END at the stem, so nearby geometry proves nothing about the
        #      element being drawn. Width-ratio filter (last <= 0.5 * first)
        #      rejects look-alike bar groups (a 33.5/28.5/28.7 stack in the
        #      page-11 title area is artwork, not earth).
        if segments is not None:
            _gnd_boxes = []
            for _g in snap.get("grounds") or []:
                _gb = _g.get("bbox") or {}
                try:
                    _gnd_boxes.append((float(_gb["x"]), float(_gb["y"]),
                                       float(_gb["width"]), float(_gb["height"])))
                except (KeyError, TypeError, ValueError):
                    continue

            def _gnd_covers(pt: dict[str, Any]) -> bool:
                return any(_gx - 8 <= pt["x"] <= _gx + _gw + 8
                           and _gy - 8 <= pt["y"] <= _gy + _gh + 8
                           for _gx, _gy, _gw, _gh in _gnd_boxes)

            _bars = []
            for _s in segments:
                try:
                    _sx1, _sy1, _sx2, _sy2 = (float(_s["x1"]), float(_s["y1"]),
                                              float(_s["x2"]), float(_s["y2"]))
                except (KeyError, TypeError, ValueError):
                    continue
                if abs(_sy1 - _sy2) <= 1.2 and 4.0 <= abs(_sx1 - _sx2) <= 60.0:
                    _bars.append(((_sx1 + _sx2) / 2, (_sy1 + _sy2) / 2, abs(_sx1 - _sx2)))
            _bars.sort(key=lambda b: (round(b[0] / 6), b[1]))
            _seen_bar = set()
            for _i, (_bx, _by, _bw) in enumerate(_bars):
                if _i in _seen_bar:
                    continue
                _stack = [(_bx, _by, _bw)]
                for _j in range(_i + 1, len(_bars)):
                    _gx, _gy, _gw = _bars[_j]
                    if _gy - _by > 30:
                        break
                    if abs(_gx - _bx) <= 6 and 0 < _gy - _stack[-1][1] <= 12:
                        _stack.append((_gx, _gy, _gw))
                if len(_stack) < 3:
                    continue
                _ws = [w for _, _, w in _stack]
                if not all(_ws[k] > _ws[k + 1] - 1 for k in range(len(_ws) - 1)):
                    continue
                if _ws[-1] > 0.5 * _ws[0]:
                    continue  # near-equal bars = artwork, not an earth symbol
                _seen_bar.update(range(_i, _i + len(_stack)))
                _gpt = {"x": _stack[0][0], "y": _stack[0][1]}
                if not _gnd_covers(_gpt):
                    add("ground-glyph-uncovered", "WARN",
                        [f"groundglyph-{_gpt['x']:.0f}-{_gpt['y']:.0f}"],
                        f"printed earth-ground glyph (bar-stack, widths "
                        f"{'/'.join(f'{w:.0f}' for w in _ws)}) at "
                        f"({_gpt['x']:.0f},{_gpt['y']:.0f}) has no ground element — "
                        "mark it with the Ground tool / annotate add_ground "
                        "(a wire ending at the stem does not count; the glyph "
                        "itself must be boxed); annotate or dispose with reason")

    # 12. gross truncation floor: box covers <30% of its containing enclosure
    if enclosures is not None:
        # CELLS ONLY, SMALLEST FIRST (2026-07-05): the interstitial RING between
        # cells (fill≈0.47 on p10, bbox spans everything) is not a component
        # boundary — citing it handed two runs their "false positive" alibi.
        # Sorting ascending means the first hit is the component's OWN cell.
        _cells = sorted(
            (e for e in enclosures if float(e.get("fill", 1) or 0) >= 0.55),
            key=lambda e: (e.get("bbox") or {}).get("width", 0)
            * (e.get("bbox") or {}).get("height", 0),
        )
        # CELL OWNERSHIP (2026-07-05, live catch minutes after the citation fix):
        # nested accessories (CAB40/RTC40/CON40 — part-numbered items with no
        # printed border of their own) sit INSIDE their parent module's cell; the
        # smallest cell containing them is the PARENT's, and a correctly-sized
        # small box covering 2% of it is not truncation. A cell may only convict
        # its OWNER: the node whose box covers most of it. Known limitation:
        # ownership is order-dependent while the parent is still unboxed.
        def _cell_owner_area(eb: dict[str, Any]) -> float:
            ex0, ey0 = eb["x"], eb["y"]
            ex1, ey1 = ex0 + eb["width"], ey0 + eb["height"]
            best = 0.0
            for m in nodes:
                mb = m.get("bbox") or {}
                mx0, my0 = mb.get("x", 0), mb.get("y", 0)
                mx1, my1 = mx0 + mb.get("width", 0), my0 + mb.get("height", 0)
                cov = max(0, min(mx1, ex1) - max(mx0, ex0)) * max(0, min(my1, ey1) - max(my0, ey0))
                best = max(best, cov)
            return best

        _owner_area = {id(e): _cell_owner_area(e.get("bbox") or {}) for e in _cells}
        for n in nodes:
            b = n.get("bbox") or {}
            bx0, by0 = b.get("x", 0), b.get("y", 0)
            bx1, by1 = bx0 + b.get("width", 0), by0 + b.get("height", 0)
            barea = max(1.0, (bx1 - bx0) * (by1 - by0))
            swallowed: list[dict[str, Any]] = []
            for enc in _cells:
                eb = enc.get("bbox") or {}
                ex0, ey0 = eb["x"], eb["y"]
                ex1, ey1 = ex0 + eb["width"], ey0 + eb["height"]
                ix = max(0, min(bx1, ex1) - max(bx0, ex0))
                iy = max(0, min(by1, ey1) - max(by0, ey0))
                earea = max(1.0, (ex1 - ex0) * (ey1 - ey0))
                if ix * iy / barea > 0.8 and barea / earea < 0.30 and earea > 60000:
                    if ix * iy < _owner_area.get(id(enc), 0.0):
                        # another component owns this cell — n is a nested
                        # accessory inside it, not a truncated module
                        break
                    # --- Slate 2.1 post-filters: each one cites a Shane-
                    # confirmed FALSE POSITIVE from the gold page (rule stays
                    # ERROR; these remove its false-fire paths). ---
                    # (a) DETECTOR CORROBORATION: a strong same-family
                    # detection agreeing with the box (IoU>=0.5) vouches for
                    # the tight extent — v8 was trained symbol-tight on
                    # exactly the class this floor false-fires on (CNV40).
                    if _detector_corroborates(n, (bx0, by0, bx1, by1), yolo_detections):
                        break
                    # (b) stacked boxed continuation-refs inside a cell mean
                    # it is NOT a component cell (RTC40's phantom cell
                    # swallowed the 49/19 refs) — reject cell, try the next.
                    if texts and _cell_has_stacked_refs(eb, texts):
                        continue
                    # (c) clip the candidate cell at sibling components'
                    # claimed borders (CNV40's "cell" merged across
                    # whitespace to INV40's printed wall); re-test coverage.
                    cx0, cy0, cx1, cy1 = _clip_cell_to_siblings(
                        (ex0, ey0, ex1, ey1), (bx0, by0, bx1, by1),
                        [m.get("bbox") or {} for m in nodes if m is not n],
                    )
                    if barea / max(1.0, (cx1 - cx0) * (cy1 - cy0)) >= 0.30:
                        break  # box covers enough of the sibling-clipped cell
                    # (e) GROUP-REGION REJECT (Shane-disposed FP, p8 CON23
                    # 2026-07-09: "the detector is absolutely wrong here...
                    # the Print overrides the detector. its plain to see that
                    # it covers the entire area"): an IRREGULAR enclosure
                    # (fill<0.9 — its bounding rect overstates the true
                    # region) that fully swallows a DISJOINT sibling
                    # component is a group/wiring region spanning several
                    # peers (the MC322+CON23+CON24 column), not any single
                    # component's cell — reject the cell, try the next.
                    # Deliberately narrow: a truncated LONE box in a real
                    # module cell has no swallowed disjoint sibling, and a
                    # truncated parent whose rectangular printed cell
                    # (fill>=0.9) holds nested accessories both still convict.
                    if float(enc.get("fill", 1) or 0) < 0.9 and any(
                        m is not n
                        and _contained_frac(m.get("bbox") or {}, eb) >= 0.8
                        and not _boxes_intersect(m.get("bbox") or {}, b)
                        for m in nodes
                    ):
                        continue
                    # (d) HYPOTHESIS ticket, sibling-aware — never the old
                    # unconditional imperative (which ordered the CAB40/CON40/
                    # CON42 swallow; three sessions resisted only because
                    # Shane had already ruled it false).
                    siblings = [
                        str(m.get("label") or "?") for m in nodes
                        if m is not n and _boxes_intersect(m.get("bbox") or {}, eb)
                    ]
                    lshape = float(enc.get("fill", 1) or 0) < 0.9
                    remedy = (
                        f"CAUTION: sibling component(s) {siblings[:4]} sit inside this "
                        "candidate cell — likely shared or L-shaped; verify the printed "
                        "border against artwork before ANY extension"
                        if siblings else
                        "hypothesis: confirm no sibling components inside the cell, "
                        "then extend to its printed border"
                    )
                    add("bbox-truncation-floor", "ERROR", [n["id"]],
                        f"{n.get('label')} covers only {barea / earea:.0%} of a candidate "
                        f"printed cell ({eb['width']:.0f}x{eb['height']:.0f} at {ex0:.0f},{ey0:.0f}"
                        + ("; fill<0.9 — possibly L-shaped, its bounding rect overstates it"
                           if lshape else "")
                        + f") — {remedy}")
                    break
                # enclosure ≥80% swallowed by this box → over-boxing candidate
                if earea > 25000 and ix * iy / earea >= 0.8:
                    swallowed.append(eb)
            # 12b. over-boxing ceiling (arm-2S CNV40 monster): a box that fully
            #      contains ≥2 SEPARATE substantial module interiors owns other
            #      components' territory. Nested interiors (tables inside one
            #      module) don't count — only non-nested ones.
            top: list[dict[str, Any]] = []
            for eb in sorted(swallowed, key=lambda r: -(r["width"] * r["height"])):
                inside_counted = False
                for tb in top:
                    ix = max(0, min(eb["x"] + eb["width"], tb["x"] + tb["width"]) - max(eb["x"], tb["x"]))
                    iy = max(0, min(eb["y"] + eb["height"], tb["y"] + tb["height"]) - max(eb["y"], tb["y"]))
                    if ix * iy / max(1.0, eb["width"] * eb["height"]) > 0.7:
                        inside_counted = True
                        break
                if not inside_counted:
                    top.append(eb)
            if len(top) >= 2:
                add("box-swallows-enclosures", "WARN", [n["id"]],
                    f"{n.get('label')} fully contains {len(top)} separate printed module "
                    "interiors — over-extended box owning neighbors' territory "
                    "(shrink to ONE module; dashed combined assemblies excepted)")

    # ---- v4 identity rules (Shane's decision tree, arm-2S' post-mortem) --------
    # Identity comes from the PRINT: designators name components; part numbers
    # are specs; wire labels name nets; continuations are wire-end markers.

    # 13. component label not printed near its own box (invented/misassigned).
    #     Labels may split across text runs ('ELB'+'41') and the print mixes
    #     full-width glyphs — match against the NFKC-normalized concatenation
    #     of nearby runs. Flood guard: if >80% of nodes flag, the text layer is
    #     mismatched (units/shape), not 80% invented — suppress with one INFO.
    if texts is not None and nodes:
        import unicodedata

        def _norm(s: str) -> str:
            return unicodedata.normalize("NFKC", s).replace(" ", "").upper()

        flags: list[tuple[str, str]] = []
        for n in nodes:
            lbl = _norm(str(n.get("label") or "").strip())
            b = n.get("bbox") or {}
            if not lbl or not b:
                continue
            pad = 60.0
            nearby = []
            band_exact = False
            for t in texts:
                cx, cy = t.get("cx"), t.get("cy")
                if cx is None or cy is None:
                    tb = t.get("bbox")
                    if isinstance(tb, (list, tuple)) and len(tb) == 4:
                        cx, cy = (tb[0] + tb[2]) / 2, (tb[1] + tb[3]) / 2  # page-px bbox
                if cx is None or cy is None:
                    continue
                if (b["x"] - pad <= cx <= b["x"] + b["width"] + pad
                        and b["y"] - pad <= cy <= b["y"] + b["height"] + pad):
                    nearby.append((round(cy / 24), cx, str(t.get("text") or "")))
                    continue
                # Shane-confirmed FP class (2026-07-09 gold-page calibration):
                # designators print in READING-DIRECTION bands beyond the 60px
                # radial pad — beside the box on its own row (gold p7: CT11
                # 221px left, MCB10 133px right; p8: CON20 73px left) or
                # immediately above it (p11: T50/T51/T52, 67px up). A band run
                # counts ONLY on an exact whole-run designator hit (all six
                # confirmed FPs print the designator as its own run) — band
                # runs NEVER join the concat, because the row band sweeps in
                # neighboring NET labels and 'R501S501…T501' would mask an
                # invented 'T50'/'S50'/'T501' identity (wire labels name nets,
                # never components; measured on p11). Diagonal text stays
                # excluded, so the p8 'CONNECTOR' placeholder (nearest run
                # 80px left AND 25px below — a part callout) still fires.
                in_row_band = (b["y"] <= cy <= b["y"] + b["height"]
                               and b["x"] - 250 <= cx <= b["x"] + b["width"] + 250)
                in_above_band = (b["x"] <= cx <= b["x"] + b["width"]
                                 and b["y"] - 90 <= cy <= b["y"])
                if ((in_row_band or in_above_band)
                        and _norm(str(t.get("text") or "")) == lbl):
                    band_exact = True
            joined = _norm("".join(txt for _, _, txt in sorted(nearby)))
            if lbl not in joined and not band_exact:
                flags.append((n["id"], str(n.get("label"))))
        if len(flags) > 0.8 * len(nodes):
            add("label-check-skipped", "INFO", [],
                f"{len(flags)}/{len(nodes)} labels unmatched — text layer mismatch "
                "suspected; component-label-not-printed suppressed this run")
        else:
            for nid, lbl in flags:
                add("component-label-not-printed", "WARN", [nid],
                    f"component label '{lbl}' does not appear in the printed text layer "
                    f"near its box (60px pad; same-row/above bands accept the exact "
                    "designator run) — invented or misassigned identity "
                    "(designators name components; read the print)")

    # 14. component labeled with a part number (MR-RB136-4 class): part numbers
    #     are specs/attachments, never designators.
    _part_re = re.compile(r"^[A-Za-z]{1,4}\d*-[A-Za-z0-9][A-Za-z0-9-]{2,}$")
    for n in nodes:
        lbl = str(n.get("label") or "").strip()
        if lbl and _part_re.match(lbl) and not terminal_name_ok(lbl):
            add("component-label-is-part-number", "WARN", [n["id"]],
                f"component labeled '{lbl}' — that is a manufacturer part-number string; "
                "part numbers are specs (attach them), the printed DESIGNATOR names the component")

    # 15. component named after a wire: label equals a drawn edge's net name
    #     (THR349 split into 'FU040/FV040/FW040' — wires name nets, not devices).
    edge_labels = {str(e.get("label") or "").strip().upper() for e in edges if e.get("label")}

    def _same_label_edge_near_box(lbl_u: str, b: dict[str, Any], pad: float = 150.0) -> bool:
        """Does any edge labeled lbl_u pass within pad px of bbox b?

        pad=150 (not 60) on purpose: wire tags print ~25px off their conductor
        (p7: S1 tag x=468 vs bus x=445), so a 60px clearance leaves a window
        where the WIRE'S OWN tag sits in the box's 60px text band while the
        conductor clears 60px — a box misnamed after the adjacent bus would
        slip the exemption. 150px closes that window for tags within 90px of
        their wire; the S1 gold FP (nearest edge 222px) stays exempt."""
        x0, y0 = b["x"] - pad, b["y"] - pad
        x1, y1 = b["x"] + b["width"] + pad, b["y"] + b["height"] + pad
        for e in edges:
            if str(e.get("label") or "").strip().upper() != lbl_u:
                continue
            pts = [(p.get("x"), p.get("y")) for p in (e.get("path") or [])
                   if p.get("x") is not None and p.get("y") is not None]
            if len(pts) == 1 and x0 <= pts[0][0] <= x1 and y0 <= pts[0][1] <= y1:
                return True  # degenerate single-point path still counts as near
            for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                dx, dy = bx - ax, by - ay  # Liang-Barsky segment-vs-rect
                t0, t1, hit = 0.0, 1.0, True
                for pc, qc in ((-dx, ax - x0), (dx, x1 - ax), (-dy, ay - y0), (dy, y1 - ay)):
                    if pc == 0:
                        if qc < 0:
                            hit = False
                            break
                    else:
                        r = qc / pc
                        if pc < 0:
                            t0 = max(t0, r)
                        else:
                            t1 = min(t1, r)
                        if t0 > t1:
                            hit = False
                            break
                if hit:
                    return True
        return False

    def _label_printed_at_box(lbl_raw: str, b: dict[str, Any]) -> bool:
        """Is the label printed within the 60px radial pad of the box? Same
        center test / NFKC join / row sort as rule 13, but DELIBERATELY only
        the radial pad — not rule 13's wider reading-direction bands, which
        would let a wire tag 200px away on the same row grant the exemption.
        None texts → False (never exempt on missing evidence)."""
        if texts is None or not b:
            return False
        import unicodedata

        def _nrm(s: str) -> str:
            return unicodedata.normalize("NFKC", s).replace(" ", "").upper()

        lbl_n = _nrm(lbl_raw)
        pad = 60.0
        nearby: list[tuple[int, float, str]] = []
        for t in texts:
            cx, cy = t.get("cx"), t.get("cy")
            if cx is None or cy is None:
                tb = t.get("bbox")
                if isinstance(tb, (list, tuple)) and len(tb) == 4:
                    cx, cy = (tb[0] + tb[2]) / 2, (tb[1] + tb[3]) / 2
            if cx is None or cy is None:
                continue
            if (b["x"] - pad <= cx <= b["x"] + b["width"] + pad
                    and b["y"] - pad <= cy <= b["y"] + b["height"] + pad):
                nearby.append((round(cy / 24), cx, str(t.get("text") or "")))
        joined = _nrm("".join(txt for _, _, txt in sorted(nearby)))
        return bool(lbl_n) and lbl_n in joined

    for n in nodes:
        lbl = str(n.get("label") or "").strip().upper()
        if lbl and lbl in edge_labels:
            # Post-filter (page-7 GOLD, component S1 / node-ccda6850, 2026-07-09):
            # a designator printed AT the device may equal a phase-conductor net
            # name drawn ELSEWHERE on the sheet — switch S1 beside MCB10 (print
            # 'S1' 19px from its box) vs the S-phase wire S1 whose nearest edge
            # is 222px away. Identity comes from the print: exempt ONLY when the
            # label is printed in the 60px band at the box AND no same-named
            # edge comes within 150px of the box. The THR349 class (component
            # named after the wire running through it) keeps firing — there the
            # same-named edge touches the box.
            b = n.get("bbox") or {}
            if (b and _label_printed_at_box(str(n.get("label") or "").strip(), b)
                    and not _same_label_edge_near_box(lbl, b)):
                continue
            add("component-label-is-wire-name", "WARN", [n["id"]],
                f"component labeled '{n.get('label')}' — identical to a drawn wire's net name; "
                "designators name components, wire labels belong to nets")

    # 16. continuation point inside a component box: continuations are wire-end
    #     markers at region edges — a box containing one is over-extended.
    for c in snap.get("continuations") or []:
        cpt = c.get("point") or {}
        for n in nodes:
            b = n.get("bbox") or {}
            if not b:
                continue
            if (b["x"] + 4 < cpt.get("x", -1e9) < b["x"] + b["width"] - 4
                    and b["y"] + 4 < cpt.get("y", -1e9) < b["y"] + b["height"] - 4):
                add("box-includes-continuation", "WARN", [n["id"], str(c.get("id") or "")],
                    f"continuation ref sits INSIDE component {n.get('label')} — "
                    "the box swallowed a sheet/zone marker; shrink to the printed border")

    # 17. yolo-unworked-region (2026-07-05, integration design): STRONG-tier
    #     detector evidence with no graph component overlapping it while work
    #     is claimed complete elsewhere. ONE aggregated WARN per page —
    #     calibration first (earned-blocker principle); promotion to ERROR is
    #     Shane's call after live data. CONTINUATION detections deferred until
    #     snapshot continuations carry comparable geometry. Asymmetric trust:
    #     this rule only ever says "look here", never "nothing is there".
    if yolo_detections:
        def _cover_frac(db: dict[str, Any]) -> tuple[float, str | None, str | None]:
            """Best drawn-box coverage of the DETECTION's area → (frac, node_id,
            label). Any-overlap 'coverage' was the blind spot Shane's eyes found
            (2026-07-06): run 2 drew M40 at 17.8% of its true extent, and the
            strong 0.90 M-detection spanning the real motor read as 'covered'
            because the stub box grazed it — the audit had the truth and ignored
            it. Returns the node ID (2026-07-09) because violations must carry
            DISPOSABLE ids — emitting the label made Shane's false-positive
            verdicts unmatchable and the box-gate re-listed disposed flags
            forever (the page-8 CNV1/G/CON20 hang)."""
            dx, dy = float(db["x"]), float(db["y"])
            dw, dh = float(db["width"]), float(db["height"])
            best, best_id, best_lab = 0.0, None, None
            for n in nodes:
                b = n.get("bbox") or {}
                if not b:
                    continue
                ix = max(0.0, min(dx + dw, float(b["x"]) + float(b["width"])) - max(dx, float(b["x"])))
                iy = max(0.0, min(dy + dh, float(b["y"]) + float(b["height"])) - max(dy, float(b["y"])))
                frac = (ix * iy) / max(dw * dh, 1e-6)
                if frac > best:
                    best, best_id, best_lab = frac, str(n.get("id")), str(n.get("label") or n.get("id"))
            return best, best_id, best_lab

        def _covered(db: dict[str, Any]) -> bool:
            return _cover_frac(db)[0] >= 0.5

        def _touched(db: dict[str, Any]) -> bool:
            # the evidence-tier glance keeps its original any-overlap
            # calibration (the gold exit-gate INFO is pinned to it)
            return _cover_frac(db)[0] > 0.0

        def _cable_det_covered(db: dict[str, Any]) -> bool:
            # A CAB detection is represented two ways, either satisfies:
            #  (1) CABLE ELEMENT (the 2026-07-10 doctrine, ratified): cables
            #      are first-class NON-CONDUCTING boxes (graph.cables[]) hugging
            #      the printed bar. A cable box overlapping the detection IS the
            #      mating — this is now the primary/expected form. (Mirrors
            #      _ground_covered: element boxes aren't nodes, so _cover_frac
            #      never sees them.) Overlap grades against the SMALLER of the
            #      two boxes: the detection is loose (oval label + bar + P/N,
            #      ~290x100) while the element is a tight training-data bar
            #      (~267x26 on page 8) — a tight bar fully inside a loose
            #      detection covers only ~21% of IT and must still satisfy.
            #  (2) legacy CAB-labeled EDGE crossing it — kept for pages modeled
            #      before cables became elements (gold's CAB42 bar era).
            dx, dy = float(db.get("x", 0)), float(db.get("y", 0))
            dw, dh = float(db.get("width", 0)), float(db.get("height", 0))
            for cab in snap.get("cables") or []:
                b = cab.get("bbox") or {}
                try:
                    x, y, w, h = (float(b["x"]), float(b["y"]),
                                  float(b["width"]), float(b["height"]))
                except (KeyError, TypeError, ValueError):
                    continue
                ix = max(0.0, min(dx + dw, x + w) - max(dx, x))
                iy = max(0.0, min(dy + dh, y + h) - max(dy, y))
                if (ix * iy) / max(min(dw * dh, w * h), 1e-6) >= 0.5:
                    return True
            for e in edges:
                if not CABLE_RE.match(str(e.get("label") or "")):
                    continue
                path = e.get("path") or []
                if any(_segment_crosses_bbox(a, c, db) for a, c in zip(path, path[1:])):
                    return True
            return False

        def _ground_covered(db: dict[str, Any]) -> bool:
            # Grounds-are-coverage (Shane's gold p7 PE×2 + p8 G×2 disposals,
            # 2026-07-09): first-class ground elements (graph.grounds[]) are
            # drawn work, but _cover_frac only scans nodes — every PE/G glyph
            # Shane marked with the Ground tool graded "unworked" (measured
            # 0.63–0.94 covered by its ground box, 0.00 by any node). Callers
            # scope this to the ground-glyph classes (PE/G) — a non-ground
            # detection over a ground stem is NOT waived — and a ground box
            # is glyph-sized (~49px), so >=0.5 coverage cannot mask a
            # module-scale detection; an unmarked ground glyph still fires.
            dx, dy = float(db.get("x", 0)), float(db.get("y", 0))
            dw, dh = float(db.get("width", 0)), float(db.get("height", 0))
            for gnd in snap.get("grounds") or []:
                b = gnd.get("bbox") or {}
                try:
                    x, y, w, h = (float(b["x"]), float(b["y"]),
                                  float(b["width"]), float(b["height"]))
                except (KeyError, TypeError, ValueError):
                    continue
                ix = max(0.0, min(dx + dw, x + w) - max(dx, x))
                iy = max(0.0, min(dy + dh, y + h) - max(dy, y))
                if (ix * iy) / max(dw * dh, 1e-6) >= 0.5:
                    return True
            return False

        def _busbar_det_covered(db: dict[str, Any]) -> bool:
            # Busbars-are-edges (Shane's p8 disposals, 2026-07-09: "module
            # boxes correctly exclude inter-module busbars/ground stems"): a
            # PP detection is the inter-module bus bar, drawn as a LABELED
            # edge (PP20/PN20, best box coverage 7%/9%) — the same multipath
            # law that grades CAB against edges, never boxes. The edge must
            # run ALONG the bar (>=0.5 of the detection's long axis inside
            # the bbox; the real busbar edges measure 0.86/0.89), not merely
            # cross it — a perpendicular labeled crossover wire tops out at
            # short/long ≈ 0.34 on these detections, so an UNDRAWN busbar
            # under a crossover still fires. Unlabeled edges never count.
            dx, dy = float(db.get("x", 0)), float(db.get("y", 0))
            dw, dh = float(db.get("width", 0)), float(db.get("height", 0))
            long_axis = max(dw, dh)
            if long_axis <= 0:
                return False
            for e in edges:
                if not str(e.get("label") or "").strip():
                    continue
                path = e.get("path") or []
                inside = 0.0
                for a, c in zip(path, path[1:]):
                    ax, ay = float(a.get("x", 0)), float(a.get("y", 0))
                    cx, cy = float(c.get("x", 0)), float(c.get("y", 0))
                    vx, vy = cx - ax, cy - ay
                    t0, t1, ok = 0.0, 1.0, True
                    for p, q in ((-vx, ax - dx), (vx, dx + dw - ax),
                                 (-vy, ay - dy), (vy, dy + dh - ay)):
                        if abs(p) < 1e-9:
                            if q < 0:
                                ok = False
                                break
                            continue
                        t = q / p
                        if p < 0:
                            t0 = max(t0, t)
                        else:
                            t1 = min(t1, t)
                        if t0 > t1:
                            ok = False
                            break
                    if ok:
                        inside += math.hypot(vx, vy) * max(0.0, t1 - t0)
                if inside >= 0.5 * long_axis:
                    return True
            return False

        def _union_cover(db: dict[str, Any]) -> float:
            # Flush-mating waiver input (Shane's p8 CON20 disposal, 2026-07-09:
            # "dont overlap INV1, i said to sit flush with it. the right side
            # is CN40"): grid-sampled fraction of the DETECTION under the
            # union of ALL drawn boxes. A detection straddling two flush-mated,
            # correctly-drawn components is accounted for by the print even
            # though no single box reaches 0.5 (CON20 measured 0.81 union vs
            # 0.45 best-single). M40-class truncation stays caught: a stub box
            # over a lone detection leaves the spill on empty canvas (union ≈
            # single-box coverage), far below the 0.7 line.
            dx, dy = float(db.get("x", 0)), float(db.get("y", 0))
            dw, dh = float(db.get("width", 0)), float(db.get("height", 0))
            if dw <= 0 or dh <= 0:
                return 0.0
            boxes = []
            for n in nodes:
                b = n.get("bbox") or {}
                if not b:
                    continue
                boxes.append((float(b["x"]), float(b["y"]),
                              float(b["width"]), float(b["height"])))
            hit = 0
            for i in range(12):
                for j in range(12):
                    px = dx + (i + 0.5) * dw / 12.0
                    py = dy + (j + 0.5) * dh / 12.0
                    if any(x <= px <= x + w and y <= py <= y + h
                           for x, y, w, h in boxes):
                        hit += 1
            return hit / 144.0

        # 17b. yolo-extent-mismatch (2026-07-06, from Shane's review of cold
        #      run 2): a STRONG detection only fractionally covered by its
        #      best drawn box is truncation EVIDENCE the enclosure layer
        #      cannot supply (M40's printed cell never closes in the flood
        #      fill — the detector is the only mechanical extent witness for
        #      that class). Born WARN; the >=0.5 line clears every gold box.
        #      DEMOTED TO INFO 2026-07-10 (Shane: "YOLO boxes arent to be
        #      used to gate anything at all! they're only evidence for the
        #      copilot to use when its not sure") — detections may inform,
        #      never block clean/seal/done. INFO is the ceiling for every
        #      yolo_detections-fed rule.
        for d in yolo_detections:
            if d.get("tier") != "strong" or str(d.get("class_name")) == "CONTINUATION":
                continue
            if str(d.get("class_name")) == "CAB":
                continue  # cables graded by rule 17c (_cable_det_covered:
                          # cable element box, or legacy CAB edge), not by
                          # node-coverage here
            if str(d.get("class_name")) == "PP" and _busbar_det_covered(d.get("bbox") or {}):
                continue  # busbars-are-edges FP class (see _busbar_det_covered)
            if (str(d.get("class_name")) in ("PE", "G")
                    and _ground_covered(d.get("bbox") or {})):
                continue  # grounds-are-coverage FP class (see _ground_covered)
            frac, nid, lab = _cover_frac(d.get("bbox") or {})
            db0 = d.get("bbox") or {}
            # The flush-mating union waiver additionally requires the detection
            # CENTER to sit inside some drawn box (verify pass, 2026-07-09): two
            # PEER boxes flanking an UNDRAWN component can union past 0.7 while
            # the center — where the missing component lives — is bare canvas
            # (proven repro: MC322+CON24 drawn, CON23 forgotten → zero flags).
            # CON20's disposed FP stays dead: its center lies inside CON20's
            # own box (measured (1564,919) in (1531,877)45x83).
            _ctr_x = float(db0.get("x", 0)) + float(db0.get("width", 0)) / 2
            _ctr_y = float(db0.get("y", 0)) + float(db0.get("height", 0)) / 2
            _ctr_covered = any(
                (bb := m.get("bbox") or {})
                and float(bb.get("x", 0)) <= _ctr_x <= float(bb.get("x", 0)) + float(bb.get("width", 0))
                and float(bb.get("y", 0)) <= _ctr_y <= float(bb.get("y", 0)) + float(bb.get("height", 0))
                for m in nodes
            )
            if 0.05 <= frac < 0.5 and not (_union_cover(db0) >= 0.7 and _ctr_covered):
                db = db0
                add("yolo-extent-mismatch", "INFO",
                    [str(d.get("id"))] + ([str(nid)] if nid else []),
                    f"strong {d.get('class_name')} detection "
                    f"({db.get('x', 0):.0f},{db.get('y', 0):.0f} "
                    f"{db.get('width', 0):.0f}x{db.get('height', 0):.0f}, "
                    f"conf {float(d.get('confidence') or 0):.2f}) is only "
                    f"{frac:.0%} covered by {lab}'s box — the component likely "
                    "extends FAR beyond the drawn extent (tall-module class); "
                    "re-derive the box from the artwork before wiring it")

        # 17c. cable-mating-incomplete (run-2 RUN-NOTES item b, 2026-07-06):
        #      a STRONG CAB detection with no cable representation over it is
        #      evidence of a missing mating bridge between mated modules (all
        #      three cables were missed cold in run 2). Born ERROR/END-STATE;
        #      DEMOTED TO INFO 2026-07-10 after it held page 8's gold re-seal
        #      hostage over overlap geometry (Shane: "YOLO boxes arent to be
        #      used to gate anything at all! they're only evidence for the
        #      copilot to use when its not sure") — also deregistered from
        #      blockers.END_STATE_RULES. Scoped to the CAB class ONLY, where
        #      "represented" is mechanical (_cable_det_covered: cable element
        #      box, or legacy CAB edge).
        cab_unworked = [d for d in yolo_detections
                        if d.get("tier") == "strong"
                        and str(d.get("class_name")) == "CAB"
                        and not _cable_det_covered(d.get("bbox") or {})]
        if cab_unworked:
            add("cable-mating-incomplete", "INFO",
                [str(d["id"]) for d in cab_unworked],
                f"{len(cab_unworked)} strong CAB detection(s) have no cable element "
                "box (or legacy CAB-labeled edge) over them — evidence the mating "
                "bridge between modules may be absent from the graph. Advisory only "
                "(a detection is a proposal, not truth): verify against the artwork "
                "and add_cable a tight box on the printed bar if a cable is real "
                "there, or state why the detection is wrong",
                "detect_components for coords; a cable is a first-class bbox element "
                "hugging the printed bar — it never conducts")

        unworked = [
            d for d in yolo_detections
            if d.get("tier") == "strong"
            and str(d.get("class_name")) not in ("CONTINUATION", "CAB")  # CAB = 17c
            and _cover_frac(d.get("bbox") or {})[0] < 0.05  # 0.05-0.5 = 17b
            and not (str(d.get("class_name")) in ("PE", "G")
                     and _ground_covered(d.get("bbox") or {}))  # grounds-are-coverage
            and not (str(d.get("class_name")) == "PP"
                     and _busbar_det_covered(d.get("bbox") or {}))  # busbars-are-edges
        ]
        if unworked:
            fams: dict[str, int] = {}
            for d in unworked:
                fams[str(d["class_name"])] = fams.get(str(d["class_name"]), 0) + 1
            fam_txt = " ".join(f"{k}×{v}" for k, v in sorted(fams.items(), key=lambda kv: -kv[1]))
            # DEMOTED TO INFO 2026-07-10 (Shane: YOLO never gates — see 17b/17c)
            add("yolo-unworked-region", "INFO", [str(d["id"]) for d in unworked],
                f"{len(unworked)} strong detector hit(s) with NO graph component over them: "
                f"{fam_txt} — evidence something exists there unworked "
                "(capture show_yolo:true to see; detect_components for coords). "
                "Absence of a detection elsewhere proves nothing.",
                "verify each region against the artwork: mint what is real, or dispose "
                "this warning stating why the detection is not a component")
        # Slate 2.2 addendum (Shane's gold-page ground-tap miss, 2026-07-06):
        # evidence-tier leftovers get a parting glance, never a blocker.
        ev_unworked = [
            d for d in yolo_detections
            if d.get("tier") != "strong"
            and str(d.get("class_name")) != "CONTINUATION"
            and not _touched(d.get("bbox") or {})
        ]
        if ev_unworked:
            add("yolo-evidence-unreviewed", "INFO", [str(d["id"]) for d in ev_unworked[:12]],
                f"{len(ev_unworked)} evidence-tier detection(s) remain unreviewed — advisory "
                "only (absence proves nothing), but a missed ground tap hid in this tier "
                "on the gold page: give them a parting glance before any done claim")

    # 18. wire-name-vs-print (slate 3.1, born WARN — genuinely new surface):
    #     a drawn net name self-propagates today (_near_net resolves from
    #     drawn labels only), so a wrong label survives every rail. Compare
    #     each parented terminal's NET segment against printed wire-label
    #     tokens nearby: fire ONLY when the terminal's own net string is
    #     ABSENT in radius AND different net-shaped print is present
    #     (found-and-mismatched; silent on absence — parallel three-phase
    #     runs 30-50px apart make the nearest token ambiguous). Evidence:
    #     MS349's left terminals carried right-side net names — labeled
    #     FU040 while sitting on the printed FR40 segment.
    if texts is not None:
        import unicodedata

        toks: list[tuple[str, float, float]] = []
        for t in texts:
            s = unicodedata.normalize("NFKC", str(t.get("text") or "")).strip().upper()
            if s:
                toks.append((s, float(t.get("cx", 0)), float(t.get("cy", 0))))
        # Calibration (gold, 2026-07-06): shape alone false-fired 21x — nearby
        # print is mostly pin designators (L1/G3/X0), component labels and
        # ratings. The conflicting token must be a KNOWN DRAWN NET (an edge
        # label in this graph) that is not the terminal's own — the actual
        # evidence shape (FU040 drawn on the printed FR40 run; both real nets).
        drawn_nets = {unicodedata.normalize("NFKC", str(e.get("label"))).strip().upper()
                      for e in edges if e.get("label")}
        for p in ports:
            if p.get("type") != "terminal" or not p.get("parentId"):
                continue
            m = re.match(r"^T~.+~([^~]+)$", str(p.get("label") or ""))
            if not m:
                continue
            net = unicodedata.normalize("NFKC", m.group(1)).strip().upper()
            if not _NET_TOKEN_RE.match(net):
                continue  # pseudo-nets (CONT refs etc.) have no printed twin
            pt = p.get("point") or {}
            px, py = float(pt.get("x", 0)), float(pt.get("y", 0))
            near = [(s, x, y) for s, x, y in toks
                    if abs(x - px) <= _NET_SEARCH_PX and abs(y - py) <= _NET_SEARCH_PX]
            if any(s == net for s, _, _ in near):
                continue  # the print backs the drawn name
            others = sorted({s for s, _, _ in near
                             if s in drawn_nets and s != net and _NET_TOKEN_RE.match(s)})
            if others:
                add("wire-name-vs-print", "WARN", [p["id"]],
                    f"terminal {p.get('label')} carries net '{m.group(1)}' but the print "
                    f"within {_NET_SEARCH_PX:.0f}px shows the drawn net(s) "
                    f"{', '.join(others[:3])} and not '{m.group(1)}' — wire names change "
                    "across switching components; verify against the printed conductor label")

    # 19. box-text-integrity (slate 3.2, born WARN): a component border
    #     BISECTING a printed text run is dataset poison — CON40 was widened
    #     leftward purely to clear a label WARN, swallowing the コネクタ/ーTM
    #     glyphs, and it survived receipts and audits. Classification is
    #     geometric, never content-regex (an ASCII part-number regex misses
    #     the katakana half of its own evidence). Exemptions at birth:
    #     pin/terminal-class short tokens (the M40 BU/BV/BW class — FP class
    #     3 redux), any component designator (labels legitimately print ON
    #     borders — the extent-engine finding), and runs at the node's own
    #     ports. Anti-gaming rider on the remedy: never resize TOWARD text.
    if texts is not None and any("x0" in t for t in texts):
        import unicodedata as _ud

        comp_labels = {_ud.normalize("NFKC", str(n.get("label") or "")).strip().upper()
                       for n in nodes}
        for n in nodes:
            b = n.get("bbox") or {}
            if not b:
                continue
            bx0, by0 = float(b["x"]), float(b["y"])
            bx1, by1 = bx0 + float(b["width"]), by0 + float(b["height"])
            own_ports = [p.get("point") or {} for p in ports_by_node.get(n.get("id"), [])]
            cut: list[str] = []
            for t in texts:
                if "x0" not in t:
                    continue
                s = _ud.normalize("NFKC", str(t.get("text") or "")).strip()
                if len(s) <= 3 or s.upper() in comp_labels:
                    continue
                tx0, ty0, tx1, ty1 = (float(t["x0"]), float(t["y0"]),
                                      float(t["x1"]), float(t["y1"]))
                ix = max(0.0, min(bx1, tx1) - max(bx0, tx0))
                iy = max(0.0, min(by1, ty1) - max(by0, ty0))
                area = (tx1 - tx0) * (ty1 - ty0)
                if area <= 0 or ix <= 0 or iy <= 0:
                    continue
                frac = ix * iy / area
                # Calibration (gold, 2026-07-06): border-hugging annotations
                # graze verified boxes at 18-19% (CON40's part label, ELB40's
                # "(PP)") — the bisection band starts above the graze zone.
                if not (0.25 <= frac <= 0.85):
                    continue  # fully in or out (or a border graze) is not a bisection
                if any(abs(float(pp.get("x", 0)) - (tx0 + tx1) / 2) <= 25
                       and abs(float(pp.get("y", 0)) - (ty0 + ty1) / 2) <= 25
                       for pp in own_ports):
                    continue  # terminal-adjacent print belongs to the border
                cut.append(f"'{s[:16]}' ({frac:.0%} inside)")
            if cut:
                add("box-text-integrity", "WARN", [n["id"]],
                    f"{n.get('label')}'s border cuts through printed text: "
                    + "; ".join(cut[:4])
                    + " — text is either fully in or fully out of an enclosure; "
                    "NEVER resize toward text to satisfy a label check "
                    "(dataset-grade poison either way)")

    # 20. continuation-refs-unrepresented (cold-run-1 finding, born WARN):
    #     continuation recall measured .545 cold — the printed refs live in
    #     the text layer as STACKED digit runs (sheet over zone; multi-digit
    #     refs split into adjacent digit columns: '4','9' over '2','0' =
    #     49/20). Calibrated signature (gold v1.3 = 0 fires): isolated
    #     stacked pairs only (pinout columns chain and are excluded), digit
    #     columns within 16px merge into one ref, and tokens inside a small
    #     printed rect TOUCHING a component box are that component's pin
    #     table (CON41's 20/EM1, 3/COM), never a ref.
    if texts is not None and segments is not None:
        import unicodedata as _ud2

        _numtok = [( _ud2.normalize("NFKC", str(t.get("text") or "")).strip(),
                     float(t.get("cx", 0)), float(t.get("cy", 0))) for t in texts]
        _numtok = [(s, x, y) for s, x, y in _numtok if re.match(r"^\d{1,3}$", s)]
        _hsegs = [(min(s["x1"], s["x2"]), max(s["x1"], s["x2"]), (s["y1"] + s["y2"]) / 2)
                  for s in segments if abs(s["y1"] - s["y2"]) <= 1]
        _vsegs = [(min(s["y1"], s["y2"]), max(s["y1"], s["y2"]), (s["x1"] + s["x2"]) / 2)
                  for s in segments if abs(s["x1"] - s["x2"]) <= 1]

        def _in_table_cell(x: float, y: float) -> bool:
            """Pin-table cells are LINE-DRAWN (no rect shapes): the token is
            walled on all four sides within 30px, and the enclosure touches a
            component box. Real refs (even boxed ones) float at wire ends."""
            above = [ys for x0, x1, ys in _hsegs if x0 - 3 <= x <= x1 + 3 and 0 < y - ys <= 30]
            below = [ys for x0, x1, ys in _hsegs if x0 - 3 <= x <= x1 + 3 and 0 < ys - y <= 30]
            left = [xs for y0, y1, xs in _vsegs if y0 - 3 <= y <= y1 + 3 and 0 < x - xs <= 30]
            right = [xs for y0, y1, xs in _vsegs if y0 - 3 <= y <= y1 + 3 and 0 < xs - x <= 30]
            if not (above and below and left and right):
                return False
            rx0, rx1 = max(left), min(right)
            ry0, ry1 = max(above), min(below)
            for n in nodes:
                b = n.get("bbox") or {}
                if not b:
                    continue
                if (rx0 - 5 <= b["x"] + b["width"] and rx1 + 5 >= b["x"]
                        and ry0 - 5 <= b["y"] + b["height"] and ry1 + 5 >= b["y"]):
                    return True
            return False

        # RUN-CLUSTER pairing (2026-07-10, Shane's page-11 catch): the old
        # per-digit 6px column pairing was calibrated on column-aligned refs
        # ('4','9' over '2','0' = 49/20) and was BLIND to centered fractions —
        # a 2-digit sheet over a 1-digit zone (32 over 9: the 9 centers under
        # the whole "32", 6.4px off either digit; ELB50/THR2 escaped exactly
        # here). Cluster digits into horizontal NUMBER RUNS first, then pair
        # runs vertically by CENTER; column refs pair as before, and the old
        # column-merge step is subsumed. Single-digit-over-single-digit pairs
        # keep the old midpoint formula, so page-7/8 contref-x-y disposition
        # ids stay stable.
        _runs: list[dict[str, Any]] = []
        for s, x, y in sorted(_numtok, key=lambda t: (t[2], t[1])):
            r = _runs[-1] if _runs else None
            if (r is not None and abs(r["y"] - y) <= 4 and 0 < x - r["x1"] <= 16):
                r["s"] += s
                r["x1"] = x
                r["pts"].append((x, y))
            else:
                _runs.append({"s": s, "x0": x, "x1": x, "y": y, "pts": [(x, y)]})
        for r in _runs:
            r["cx"] = (r["x0"] + r["x1"]) / 2

        def _partners(i: int) -> list[int]:
            r = _runs[i]
            return [j for j, o in enumerate(_runs)
                    if j != i and abs(o["cx"] - r["cx"]) <= 8
                    and 14 <= abs(o["y"] - r["y"]) <= 42]

        _pairs = []
        for i in range(len(_runs)):
            ni = _partners(i)
            if len(ni) != 1:
                continue  # 0 = no ref; 2+ = pinout column chain, never a ref
            j = ni[0]
            if j <= i or len(_partners(j)) != 1:
                continue
            r1, r2 = _runs[i], _runs[j]
            top, bot = (r1, r2) if r1["y"] < r2["y"] else (r2, r1)
            _pairs.append({"top": top["s"], "bot": bot["s"],
                           "x": (top["cx"] + bot["cx"]) / 2,
                           "y": (top["y"] + bot["y"]) / 2,
                           "pts": top["pts"] + bot["pts"]})
        # Dash-form refs (Shane, page 11 MS2: '33- 4' prints as ONE token):
        # a bare NN-M token is a complete sheet-zone ref, same downstream
        # guards (table-cell, nearby-continuation, disposition) apply.
        for t in texts:
            _ds = _ud2.normalize("NFKC", str(t.get("text") or "")).strip()
            _dm = re.match(r"^(\d{1,3})-\s?(\d{1,3})$", _ds)
            if _dm:
                _pairs.append({"top": _dm.group(1), "bot": _dm.group(2),
                               "x": float(t.get("cx", 0)), "y": float(t.get("cy", 0)),
                               "pts": [(float(t.get("cx", 0)), float(t.get("cy", 0)))]})
        conts_pts2 = [c.get("point") or {} for c in (snap.get("continuations") or [])]
        for p in _pairs:
            # per-TOKEN cell test: the pair midpoint sits on the shared cell
            # wall (CON41's 20/3 table), so the wall itself defeats a
            # center-based check
            if any(_in_table_cell(tx, ty) for tx, ty in p["pts"]):
                continue
            if any(math.hypot(float(c.get("x", 0)) - p["x"],
                              float(c.get("y", 0)) - p["y"]) <= 60 for c in conts_pts2):
                continue
            # Shane-disposed FP class (page 7 gold, 2026-07-09): ONE printed
            # ref serves a stacked 3-phase bundle (2/4 for R102/S102/T102;
            # 4/4 for R103/S103/T103) — the ref prints BESIDE the bundle's
            # middle continuation (measured dx=64, |dy|<=3; stack pitch 84).
            # Accept row-aligned side-printed refs out to 90px horizontally,
            # but ONLY when the satisfying continuation is a member of a
            # vertical stack (a sibling continuation at the same x within one
            # pitch) — the bundle signature that defines this FP class. The
            # |dy|<=20 band keeps the 84px-pitch NEIGHBOR row's continuation
            # from satisfying a genuinely missing ref; the stack-membership
            # test keeps a side-by-side SINGLE continuation from doing the
            # same (page 10 gold prints paired refs whose own continuations
            # sit dx=86, dy=1 apart — without this test, losing one would be
            # silently masked by the other).
            def _in_bundle(c: dict[str, Any]) -> bool:
                return any(o is not c
                           and abs(float(o.get("x", 0)) - float(c.get("x", 0))) <= 6
                           and 0 < abs(float(o.get("y", 0)) - float(c.get("y", 0))) <= 100
                           for o in conts_pts2)
            if any(abs(float(c.get("y", 0)) - p["y"]) <= 20
                   and abs(float(c.get("x", 0)) - p["x"]) <= 90
                   and _in_bundle(c)
                   for c in conts_pts2):
                continue
            # Stable coordinate-keyed id (2026-07-08) so a disposition sticks.
            add("continuation-refs-unrepresented", "WARN",
                [f"contref-{p['x']:.0f}-{p['y']:.0f}"],
                f"printed continuation ref {p['top']}/{p['bot']} at "
                f"({p['x']:.0f},{p['y']:.0f}) has no continuation annotation within 60px — "
                "the page's off-sheet story is incomplete (cold-run recall was .545); "
                "verify the artwork and add_continuation, or this is debt at done time")

        # 20b. continuation-bundle-incomplete (Shane-taught LIVE on page 10
        #     gold, 2026-07-09 — lessons ls-20260709-210015/ls-20260709-210529,
        #     born WARN): ONE printed continuation ref serving a stacked GROUP
        #     of wire endpoints applies to ALL of them — every wire in the
        #     bundle owes its OWN continuation element, placed ON its endpoint.
        #     The proven miss: R103/S103/T103 endpoints stacked at x~280
        #     (y 626/710/793, pitch 83-84), the 1/21 bracket printed beside
        #     S103 only; rule 20 stayed SILENT (the ref HAD a continuation
        #     within 60px) while R103/T103 owed theirs — Shane caught it by
        #     eye. Reuses rule 20's `_pairs` refs + `_in_table_cell`, PLUS a
        #     supplemental extraction: 1/21 prints as one digit over a
        #     two-digit row whose token centers land 6.2px apart in x,
        #     defeating rule 20's |dx|<=6 pair test — merging same-row
        #     adjacent digits FIRST (measured intra-row center gap 12.5px),
        #     THEN stacking rows (|dx|<=8, same 14..42 dy band, same
        #     unique-partner pinout-chain exclusion) recovers odd-over-even
        #     digit-count refs. Bundle geometry per this morning's
        #     calibration: column |dx|<=25 (S103's endpoint sits 21px off the
        #     R/T column), chained stack pitch <=100 (measured 31-100).
        #     Satisfying continuation: targets the endpoint's port, or sits
        #     within the 60px circle AND this endpoint is its NEAREST bundle
        #     member (radius safely under the 83px pitch; nearest-assignment
        #     keeps one sibling's element from masking another at small
        #     pitches, while page 11's bracket-placed elements at 42px still
        #     count as present — placement drift is not a MISSING element).
        #     Single-endpoint refs (the normal case) are skipped untouched —
        #     rule 20's business. Calibration 2026-07-09: gold 7/8/10 + pages
        #     11/12/13/100 fire 0; synthetic page 10 minus the R103/T103
        #     elements fires exactly contbundle-280-626 + contbundle-280-793
        #     (and NOT S103); page 9 (known-incomplete) fires 3 real
        #     candidates (Y1501/Y1502/Y1503 at x=1494, refs 75/5-75/7).
        _cb_rows: list[dict[str, Any]] = []
        for s, x, y in sorted(_numtok, key=lambda t: (round(t[2] / 4), t[1])):
            if (_cb_rows and abs(_cb_rows[-1]["y"] - y) <= 4
                    and 0 < x - _cb_rows[-1]["pts"][-1][0] <= 16):
                r = _cb_rows[-1]
                r["s"] += s
                r["pts"].append((x, y))
                r["x"] = sum(px for px, _ in r["pts"]) / len(r["pts"])
            else:
                _cb_rows.append({"s": s, "x": x, "y": y, "pts": [(x, y)]})

        def _cb_rstack(i: int) -> list[int]:
            return [j for j, r2 in enumerate(_cb_rows)
                    if j != i and abs(_cb_rows[i]["x"] - r2["x"]) <= 8
                    and 14 <= abs(_cb_rows[i]["y"] - r2["y"]) <= 42]

        _cb_refs = [p for p in _pairs
                    if not any(_in_table_cell(tx, ty) for tx, ty in p["pts"])]
        for i in range(len(_cb_rows)):
            ni = _cb_rstack(i)
            if len(ni) != 1:
                continue
            j = ni[0]
            if j <= i or len(_cb_rstack(j)) != 1:
                continue
            a, b = _cb_rows[i], _cb_rows[j]
            rx, ry = (a["x"] + b["x"]) / 2, (a["y"] + b["y"]) / 2
            if any(math.hypot(m["x"] - rx, m["y"] - ry) <= 20 for m in _pairs):
                continue  # rule 20's extraction already carries this ref
            if any(_in_table_cell(px, py) for px, py in a["pts"] + b["pts"]):
                continue
            top, bot = (a, b) if a["y"] < b["y"] else (b, a)
            _cb_refs.append({"top": top["s"], "bot": bot["s"], "x": rx, "y": ry})

        # free wire ends: drawn edge path endpoints whose port is an
        # UNPARENTED terminal (the T~CONT~* stub class) — the parentage gate
        # keeps component pin columns (which stack at the same pitches) from
        # being mistaken for off-page bundles.
        _cb_port_by_id = {p.get("id"): p for p in ports}
        _cb_eps: list[dict[str, Any]] = []
        for e in edges:
            path = e.get("path") or []
            if len(path) < 2:
                continue
            for k, key in ((0, "sourcePortId"), (-1, "targetPortId")):
                prt = _cb_port_by_id.get(e.get(key)) or {}
                if prt.get("type") == "terminal" and not prt.get("parentId"):
                    _cb_eps.append({"x": float(path[k].get("x", 0)),
                                    "y": float(path[k].get("y", 0)),
                                    "label": str(e.get("label") or e.get("id")),
                                    "pid": prt.get("id")})
        _cb_conts = snap.get("continuations") or []
        _cb_seen: set[str] = set()
        for p in _cb_refs:
            # anchor: the ref's nearest free end in rule 20's side-print band
            # (|dy|<=20 row alignment, out to 90px horizontally; page 10's
            # 1/21 sits dx=21/dy=1 from S103's endpoint)
            band = [ep for ep in _cb_eps
                    if abs(ep["y"] - p["y"]) <= 20 and abs(ep["x"] - p["x"]) <= 90]
            if not band:
                continue
            anchor = min(band, key=lambda ep: math.hypot(ep["x"] - p["x"],
                                                         ep["y"] - p["y"]))
            col = sorted((ep for ep in _cb_eps if abs(ep["x"] - anchor["x"]) <= 25),
                         key=lambda ep: ep["y"])
            ai = col.index(anchor)
            bundle = [anchor]
            for i in range(ai - 1, -1, -1):
                if bundle[0]["y"] - col[i]["y"] > 100:
                    break
                bundle.insert(0, col[i])
            for i in range(ai + 1, len(col)):
                if col[i]["y"] - bundle[-1]["y"] > 100:
                    break
                bundle.append(col[i])
            if len(bundle) < 2:
                continue  # single-wire refs stay exactly rule 20's business
            for ep in bundle:
                satisfied = False
                for c in _cb_conts:
                    tgt = c.get("target") or {}
                    if tgt.get("kind") == "port" and tgt.get("id") == ep["pid"]:
                        satisfied = True
                        break
                    cp = c.get("point") or {}
                    d = math.hypot(float(cp.get("x", 0)) - ep["x"],
                                   float(cp.get("y", 0)) - ep["y"])
                    if d <= 60 and d <= min(
                            math.hypot(float(cp.get("x", 0)) - o["x"],
                                       float(cp.get("y", 0)) - o["y"])
                            for o in bundle) + 1e-6:
                        satisfied = True
                        break
                if satisfied:
                    continue
                fid = f"contbundle-{ep['x']:.0f}-{ep['y']:.0f}"
                if fid in _cb_seen:
                    continue  # sibling refs re-anchor the same bundle
                _cb_seen.add(fid)
                add("continuation-bundle-incomplete", "WARN", [fid],
                    f"wire {ep['label']} ends at ({ep['x']:.0f},{ep['y']:.0f}) inside "
                    f"the endpoint bundle served by printed ref {p['top']}/{p['bot']} "
                    f"at ({p['x']:.0f},{p['y']:.0f}) but has NO continuation element of "
                    "its own — one printed bracket near a group of endpoints applies to "
                    "EVERY wire in the group (Shane, page 10: R103/S103/T103 all "
                    "continue at 1/21)",
                    "add_continuation ON this endpoint with the bracket's sheet/zone")

    # 21. wire-through-component (cold-run-1 finding, born WARN): a conductor
    #     drawn THROUGH a device bridges its poles — the R103/S103 crossover
    #     class (gold models the two sides of a switching device as separate
    #     nets, both printed with the same wire number). Exemptions at birth:
    #     ferrites (pass-through is their RULED-correct state), the edge's own
    #     parent boxes, and edges with an endpoint in/on the box (internal
    #     wiring — the BAT40 lead lives entirely inside INV40).
    port_by_id2 = {p.get("id"): p for p in ports}
    for e in edges:
        path = e.get("path") or []
        if len(path) < 2:
            continue
        own_parents = {str((port_by_id2.get(e.get(k)) or {}).get("parentId"))
                       for k in ("sourcePortId", "targetPortId")}
        endpoints = [path[0], path[-1]]
        for n in nodes:
            if str(n.get("id")) in own_parents:
                continue
            if FERRITE_RE.match(str(n.get("label") or "")):
                continue
            b = n.get("bbox") or {}
            if not b or b.get("width", 0) <= 6 or b.get("height", 0) <= 6:
                continue
            if any(_bbox_border_dist(pt, b) <= 5.0
                   or (b["x"] <= float(pt.get("x", 0)) <= b["x"] + b["width"]
                       and b["y"] <= float(pt.get("y", 0)) <= b["y"] + b["height"])
                   for pt in endpoints):
                continue  # terminates at/inside the box: not a pass-through
            shrunk = {"x": b["x"] + 3, "y": b["y"] + 3,
                      "width": b["width"] - 6, "height": b["height"] - 6}
            if CT_LABEL_RE.match(str(n.get("label") or "")):
                # Shane-confirmed FP class (page 7 GOLD, 2026-07-09): T1/S1
                # through CT10, G through CT11 — blessed CT doctrine says the
                # primary threads THROUGH the core without tapping, and the
                # wide-drawn CT bbox also spans neighbouring straight bus
                # conductors (measured: every crossing segment has BOTH of its
                # endpoints outside the full box). Exempt ONLY such clean
                # thread-throughs; a wire that bends or stops INSIDE a CT box
                # still fires, and non-CT devices keep the crossover check.
                def _out(pt: dict[str, Any]) -> bool:
                    return not (b["x"] <= float(pt.get("x", 0)) <= b["x"] + b["width"]
                                and b["y"] <= float(pt.get("y", 0)) <= b["y"] + b["height"])
                if all(_out(a) and _out(c) for a, c in zip(path, path[1:])
                       if _segment_crosses_bbox(a, c, shrunk)):
                    continue
            if any(_segment_crosses_bbox(a, c, shrunk) for a, c in zip(path, path[1:])):
                add("wire-through-component", "WARN", [e["id"], n["id"]],
                    f"wire {e.get('label') or e['id']} passes THROUGH {n.get('label')} "
                    "without terminating — a conductor drawn through a device bridges "
                    "its poles (the crossover class); wire each side to the device's "
                    "border terminals instead")
                break

    # 22. terminal-name-fabrication (run-2 forensics, born WARN): name
    #     accuracy read .27 cold while locations held .53 — the agent found
    #     the pins and INVENTED what to call them. Convention-shaped labels
    #     (T~junction~403) pass rule 6 and skip the mint-time auto-namer;
    #     this rule is the counterweight. Calibrated on gold v1.4: 0/126
    #     terminals carry a >=2-char lowercase run or a placeholder word.
    for p in ports:
        if p.get("type") != "terminal":
            continue
        lbl = str(p.get("label") or "")
        fab = fabricated_name_tokens(lbl)
        if fab:
            add("terminal-name-fabrication", "WARN", [p["id"]],
                f"terminal {lbl} carries invented-looking token(s) "
                f"{', '.join(repr(t) for t in fab[:3])} — print is the only source. "
                "Owner slot = the parent component's printed designator; pseudo-owners "
                "for unparented stubs: CONT (continuation/off-page exit), TAP (tap). "
                "No printed pin → OMIT the pin slot (T~ELB53~R503); unwired spare "
                "pins carry SPARE in the net slot. The net slot is the net's PRINTED "
                "wire label — trace the conductor to it; never coin in/out variants",
                "if the token IS genuinely printed at the terminal, keep it and "
                "disposition this flag citing the print")

    # 23. wire-coverage (Shane's directive, 2026-07-09): a printed conductor
    #     with no drawn wire covering it "changes the schematic electrically —
    #     it should be a blocker". The proven case (found by Shane on page 8,
    #     since fixed on canvas): the print ran a straight conductor from
    #     T~MC~220 (870,1324) to CON24's pin-3 row (998,1325) — ~128px, BOTH
    #     endpoints annotated — with no drawn edge, and nothing fired: the
    #     audit had recall for components/grounds/junction dots/continuation
    #     refs but never for printed-conductor coverage. Mechanics: chain
    #     axis-aligned printed segments into runs (_conductor_runs), subtract
    #     coverage — drawn edge segments within 6px lateral, plus component/
    #     ground interiors (internals are never modeled, manufacturer doctrine) — and
    #     grade each uncovered gap >=40px. ERROR when BOTH gap ends land on
    #     annotation points (ports / edge endpoints / continuations, ±12px)
    #     that are not already net-joined in the graph (union-find over edges)
    #     and not pins of one component (interior artwork): the annotations
    #     themselves testify it is a conductor. WARN (born-WARN doctrine) when
    #     one end is anchored and the other dies on a component border — the
    #     wire-stops-short class. Runs collinear with drawn-box/enclosure
    #     borders or dashed-assembly chains are excluded outright (border
    #     linework, not conductors). Calibration 2026-07-09: gold 7+10 fire
    #     ZERO on both tiers, robust across min_gap 30-50 / anchor_tol 10-16 /
    #     lat_tol 5-8 AND with each exclusion ablated; the deleted-edge repro
    #     fires at (905->998, y1325); first live catches: MC322->CON23 net 210
    #     on page 8 (the proven case's unfixed sibling, 79px) and two 417px
    #     J-66/J-67->T~CONT~S610/T610 vertical drops on page 12. END-STATE
    #     class (blockers.END_STATE_RULES): a missing wire is legal mid-build —
    #     it gates done claims with the same teeth as cable-mating-incomplete.
    if segments is not None:
        _wg_runs = _conductor_runs(segments)
        try:
            from src.canvas_copilot.vectors import _bridge_dash_chains
            _wg_bridges = _bridge_dash_chains(segments)
        except Exception:
            _wg_bridges = []  # degrade: dash exclusion is defense-in-depth only

        # border lines whose collinear runs are excluded (axis, lateral, a, b)
        _wg_borders: list[tuple[str, float, float, float]] = []
        _wg_boxes: list[tuple[float, float, float, float]] = []
        for n in nodes:
            b = n.get("bbox") or {}
            if all(k in b for k in ("x", "y", "width", "height")):
                _wg_boxes.append((float(b["x"]), float(b["y"]),
                                  float(b["x"]) + float(b["width"]),
                                  float(b["y"]) + float(b["height"])))
        _wg_gboxes: list[tuple[float, float, float, float]] = []
        for g in snap.get("grounds") or []:
            b = g.get("bbox") or {}
            if all(k in b for k in ("x", "y", "width", "height")):
                _wg_gboxes.append((float(b["x"]), float(b["y"]),
                                   float(b["x"]) + float(b["width"]),
                                   float(b["y"]) + float(b["height"])))
        _wg_encl: list[tuple[float, float, float, float]] = []
        for enc in enclosures or []:
            b = enc.get("bbox") or {}
            if all(k in b for k in ("x", "y", "width", "height")):
                _wg_encl.append((float(b["x"]), float(b["y"]),
                                 float(b["x"]) + float(b["width"]),
                                 float(b["y"]) + float(b["height"])))
        for x0, y0, x1, y1 in _wg_boxes + _wg_encl:
            _wg_borders.extend((("h", y0, x0, x1), ("h", y1, x0, x1),
                                ("v", x0, y0, y1), ("v", x1, y0, y1)))
        for s in _wg_bridges:
            if abs(s["y2"] - s["y1"]) <= 1.5:
                _wg_borders.append(("h", (s["y1"] + s["y2"]) / 2,
                                    min(s["x1"], s["x2"]), max(s["x1"], s["x2"])))
            elif abs(s["x2"] - s["x1"]) <= 1.5:
                _wg_borders.append(("v", (s["x1"] + s["x2"]) / 2,
                                    min(s["y1"], s["y2"]), max(s["y1"], s["y2"])))

        # coverage intervals from drawn edges, keyed by axis
        _wg_edge_ivals: dict[str, list[tuple[float, float, float]]] = {"h": [], "v": []}
        _wg_anchors: list[tuple[float, float, str]] = []  # (x, y, human name)
        for e in edges:
            pts = [(float(p.get("x", 0)), float(p.get("y", 0)))
                   for p in (e.get("path") or [])]
            for pt in (pts[:1] + pts[-1:] if pts else []):
                _wg_anchors.append((pt[0], pt[1],
                                    f"wire {e.get('label') or e.get('id')} endpoint"))
            for (ax_, ay), (bx, by) in zip(pts, pts[1:]):
                if abs(by - ay) <= _WG_LAT_TOL and abs(bx - ax_) > 1.0:
                    _wg_edge_ivals["h"].append(((ay + by) / 2, min(ax_, bx), max(ax_, bx)))
                if abs(bx - ax_) <= _WG_LAT_TOL and abs(by - ay) > 1.0:
                    _wg_edge_ivals["v"].append(((ax_ + bx) / 2, min(ay, by), max(ay, by)))
        _wg_port_pts: list[tuple[float, float, str]] = []
        for p in ports:
            pt = p.get("point") or {}
            _wg_port_pts.append((float(pt.get("x", 0)), float(pt.get("y", 0)), str(p.get("id"))))
            _wg_anchors.append((float(pt.get("x", 0)), float(pt.get("y", 0)),
                                f"{p.get('type') or 'port'} {p.get('label') or p.get('id')}"))
        for c in snap.get("continuations") or []:
            pt = c.get("point") or {}
            _wg_anchors.append((float(pt.get("x", 0)), float(pt.get("y", 0)),
                                f"continuation {c.get('label') or c.get('id')}"))

        # net connectivity (union-find over ports via edges): a gap whose two
        # anchors are already on one net is represented, just routed elsewhere
        _wg_uf: dict[str, str] = {}

        def _wg_find(a: str) -> str:
            while _wg_uf.setdefault(a, a) != a:
                _wg_uf[a] = _wg_uf[_wg_uf[a]]
                a = _wg_uf[a]
            return a

        for e in edges:
            s, t = str(e.get("sourcePortId")), str(e.get("targetPortId"))
            if s and t:
                _wg_uf[_wg_find(s)] = _wg_find(t)
        _wg_parent = {str(p.get("id")): str(p.get("parentId") or "") for p in ports}

        def _wg_nearest_port(x: float, y: float) -> str | None:
            best, bid = _WG_ANCHOR_TOL, None
            for px, py, pid in _wg_port_pts:
                d = math.hypot(px - x, py - y)
                if d <= best:
                    best, bid = d, pid
            return bid

        def _wg_border_dist(x: float, y: float) -> float:
            best = 1e9
            for x0, y0, x1, y1 in _wg_boxes:
                if x0 <= x <= x1 and y0 <= y <= y1:
                    d = min(x - x0, x1 - x, y - y0, y1 - y)
                else:
                    d = math.hypot(max(x0 - x, 0.0, x - x1), max(y0 - y, 0.0, y - y1))
                best = min(best, d)
            return best

        for _wg_axis, _wg_lat, _wg_a, _wg_b in _wg_runs:
            if _wg_b - _wg_a < _WG_MIN_GAP:
                continue
            if any(bax == _wg_axis and abs(blat - _wg_lat) <= _WG_BORDER_TOL
                   and ba - 12.0 <= _wg_a and _wg_b <= bb + 12.0
                   for bax, blat, ba, bb in _wg_borders):
                continue  # border linework, not a conductor. Containment, not
                # %-overlap: the border must explain the WHOLE run (±12px box-
                # vs-print slack). Verified 2026-07-09: a ≥50%-overlap test ate
                # the real missing R610 drop on page 12 (printed run x739,
                # y877-2379 overhangs an unrelated enclosure border at x736,
                # y956-2212 by 167px — J-65 -> T~CONT~R610 stayed silent while
                # its S610/T610 siblings fired). Border linework coincides with
                # the border; conductors overshoot it.
            _wg_cov: list[tuple[float, float]] = []
            for elat, ea, eb in _wg_edge_ivals[_wg_axis]:
                if abs(elat - _wg_lat) <= _WG_LAT_TOL and min(_wg_b, eb) > max(_wg_a, ea):
                    _wg_cov.append((max(_wg_a, ea), min(_wg_b, eb)))
            for bx0, by0, bx1, by1 in _wg_boxes + _wg_gboxes:
                if _wg_axis == "h" and by0 - 1 <= _wg_lat <= by1 + 1 and min(_wg_b, bx1) > max(_wg_a, bx0):
                    _wg_cov.append((max(_wg_a, bx0), min(_wg_b, bx1)))
                elif _wg_axis == "v" and bx0 - 1 <= _wg_lat <= bx1 + 1 and min(_wg_b, by1) > max(_wg_a, by0):
                    _wg_cov.append((max(_wg_a, by0), min(_wg_b, by1)))
            _wg_cov.sort()
            _wg_merged: list[tuple[float, float]] = []
            for s0, s1 in _wg_cov:
                if _wg_merged and s0 <= _wg_merged[-1][1]:
                    _wg_merged[-1] = (_wg_merged[-1][0], max(_wg_merged[-1][1], s1))
                else:
                    _wg_merged.append((s0, s1))
            _wg_gaps: list[tuple[float, float]] = []
            _wg_cur = _wg_a
            for s0, s1 in _wg_merged:
                if s0 - _wg_cur >= _WG_MIN_GAP:
                    _wg_gaps.append((_wg_cur, s0))
                _wg_cur = max(_wg_cur, s1)
            if _wg_b - _wg_cur >= _WG_MIN_GAP:
                _wg_gaps.append((_wg_cur, _wg_b))
            for g0, g1 in _wg_gaps:
                if _wg_axis == "h":
                    gp0, gp1 = (g0, _wg_lat), (g1, _wg_lat)
                else:
                    gp0, gp1 = (_wg_lat, g0), (_wg_lat, g1)
                _wg_hits: list[tuple[float, str] | None] = []
                for gx, gy in (gp0, gp1):
                    best: tuple[float, str] | None = None
                    for ax_, ay, name in _wg_anchors:
                        d = math.hypot(ax_ - gx, ay - gy)
                        if d <= _WG_ANCHOR_TOL and (best is None or d < best[0]):
                            best = (d, name)
                    _wg_hits.append(best)
                _wg_gap_id = (f"wire-gap-{gp0[0]:.0f}-{gp0[1]:.0f}"
                              f"-{gp1[0]:.0f}-{gp1[1]:.0f}")
                if _wg_hits[0] and _wg_hits[1] and _wg_hits[0][1] != _wg_hits[1][1]:
                    pa = _wg_nearest_port(*gp0)
                    pb = _wg_nearest_port(*gp1)
                    if pa and pb and (pa == pb or _wg_find(pa) == _wg_find(pb)):
                        continue  # already one net — routed via another path
                    if (pa and pb and _wg_parent.get(pa)
                            and _wg_parent.get(pa) == _wg_parent.get(pb)):
                        continue  # both pins of one component: interior artwork
                    add("wire-coverage", "ERROR", [_wg_gap_id],
                        f"printed conductor from ({gp0[0]:.0f},{gp0[1]:.0f}) to "
                        f"({gp1[0]:.0f},{gp1[1]:.0f}) ({g1 - g0:.0f}px) has NO drawn "
                        f"wire covering it, yet both ends land on annotated elements "
                        f"— {_wg_hits[0][1]} and {_wg_hits[1][1]} — which are not "
                        "net-joined in the graph: the missing wire changes the "
                        "schematic electrically. Legal mid-build; must be ZERO at done",
                        "trace the printed run and draw the wire between the two "
                        "elements (or dispose with reason if the print is not a "
                        "conductor there)")
                elif ((_wg_hits[0] or _wg_hits[1])
                      and _wg_border_dist(*(gp1 if _wg_hits[0] else gp0)) <= 8.0):
                    _wg_an = _wg_hits[0] or _wg_hits[1]
                    add("wire-coverage", "WARN", [_wg_gap_id],
                        f"printed conductor from ({gp0[0]:.0f},{gp0[1]:.0f}) to "
                        f"({gp1[0]:.0f},{gp1[1]:.0f}) ({g1 - g0:.0f}px) is uncovered: "
                        f"one end sits at {_wg_an[1]}, the other dies on a component "
                        "border with no terminal there — a wire likely stops short; "
                        "verify the artwork and extend or dispose with reason")

    # Slate 2.1: when truncation and terminal-placement flags collide on one
    # node they merge into ONE fact with both geometries named — satisfying
    # either blindly is how the 3-resize churn cycles started. Stays ERROR
    # (terminals-on-the-false-border is the canonical TRUE-positive signature).
    _term_rules = {"terminal-interior", "terminal-outside-parent"}
    _term_nodes = {vid for v in violations if v["rule"] in _term_rules for vid in v["ids"]}
    for v in violations:
        if v["rule"] == "bbox-truncation-floor" and any(i in _term_nodes for i in v["ids"]):
            v["detail"] += (
                " (CONFLICT: terminal-placement also flagged this node — the two "
                "flags carry opposing candidate geometries; resolve from the printed "
                "artwork, never by satisfying either flag blindly)"
            )

    counts = {"ERROR": 0, "WARN": 0, "INFO": 0}
    for v in violations:
        counts[v["severity"]] += 1
    return {
        "clean": counts["ERROR"] == 0 and counts["WARN"] == 0,
        "counts": counts,
        "violations": violations,
        "graph_stats": {"components": len(nodes), "terminals":
                        sum(1 for p in ports if p.get("type") == "terminal"),
                        "junctions": sum(1 for p in ports if p.get("type") == "junction"),
                        "wires": len(edges)},
    }
