"""Playbook — blessed plays as retrievable doctrine (Shane's design, 2026-07-06).

The learning apparatus was failure-driven (audit rules from defects, rulebook
lessons from traps); excellence evaporated at session end. Shane's bless tool
captures it: he taps excellent work on the canvas, says WHY in his own words,
and a card mints here — situation key, verbatim directive, crop pair, the ops
that built it. Future sessions retrieve the play at the moment the situation
recurs (mint-time receipt injection + the playbook tool).

Scale contract (agreed 2026-07-06 — "build it so it scales without rewriting"):
- The CORPUS is the asset; the machinery is replaceable. Cards over-capture
  (references to durable sources: page, region, element ids, snapshot seq,
  detector version) so future retrieval tiers re-derive richer views.
- Two stable interfaces: mint(bless_event, snap) and lookup(situation).
  v1 lookup = class/label-family key match (plain code, microseconds).
  Declared upgrade path: v2 embedding cosine over stored crops; v3 model/agent
  retriever (Shane expects this). Callers never change.
- Storage: git-tracked flat files (docs/playbook/), record shape table-ready
  for the eventual Neon lift (source-of-truth doctrine, offline-first cache).
- Governance: ONLY the bless event mints (the praise-parse ban extends here —
  nothing self-blesses); cards are curated at run debriefs like rulebook
  deltas. Full contract: docs/vault/PLAYBOOK-SCHEMA.md.
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Any

from src.config import ATLAS_REPO_ROOT

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
_ROOT = Path(ATLAS_REPO_ROOT) / "docs" / "playbook"
_CARDS = _ROOT / "cards"
_FAMILY_RE = re.compile(r"^([A-Za-z]+)")

# Crop padding around the blessed element (px) — enough context to read the
# situation, tight enough that the card is about THIS element.
_CROP_PAD = 60.0
_POINT_HALF = 140.0  # bless on empty canvas/point: fixed window half-size


def _situation_region(snap: dict[str, Any], ev: dict[str, Any]) -> tuple[dict[str, float], dict[str, Any]]:
    """Resolve the blessed element(s) + crop region from the event.

    Multi-select (2026-07-08) wins first: bless can carry several `targets`
    (a ground + its two border terminals) — the crop spans them all and the card
    records the primary element's family plus the full id set. Falls back to the
    single-target paths (component, ground, then a fixed window)."""
    tgt = ev.get("target") or {}
    x, y = float(ev.get("x") or 0), float(ev.get("y") or 0)
    nodes = {str(n.get("id")): n for n in snap.get("nodes") or []}

    # Multi-target bless: union every selected element's extent (bbox if boxed,
    # else a small window around its point) and crop the whole pattern.
    targets = ev.get("targets") or []
    if targets:
        boxes: list[tuple[float, float, float, float]] = []
        for t in targets:
            b = t.get("bbox")
            if b:
                bx, by = float(b["x"]), float(b["y"])
                boxes.append((bx, by, bx + float(b["width"]), by + float(b["height"])))
            elif t.get("x") is not None and t.get("y") is not None:
                tx, ty = float(t["x"]), float(t["y"])
                boxes.append((tx - 22.0, ty - 22.0, tx + 22.0, ty + 22.0))
        if boxes:
            minx = min(b[0] for b in boxes)
            miny = min(b[1] for b in boxes)
            maxx = max(b[2] for b in boxes)
            maxy = max(b[3] for b in boxes)
            region = {"x": minx - _CROP_PAD, "y": miny - _CROP_PAD,
                      "width": (maxx - minx) + 2 * _CROP_PAD,
                      "height": (maxy - miny) + 2 * _CROP_PAD}
            primary = targets[0]
            return region, {
                "element_id": str(primary.get("element_id") or "") or None,
                "element_label": primary.get("element_label"),
                "element_kind": primary.get("element_kind"),
                "element_count": len(targets),
                "element_ids": [str(t.get("element_id")) for t in targets if t.get("element_id")],
                "element_kinds": [t.get("element_kind") for t in targets],
            }

    # component hit: the component's bbox padded
    cid = str(tgt.get("component_id") or "")
    if cid in nodes and nodes[cid].get("bbox"):
        b = nodes[cid]["bbox"]
        region = {"x": float(b["x"]) - _CROP_PAD, "y": float(b["y"]) - _CROP_PAD,
                  "width": float(b["width"]) + 2 * _CROP_PAD,
                  "height": float(b["height"]) + 2 * _CROP_PAD}
        return region, {"element_id": cid, "element_label": nodes[cid].get("label"),
                        "element_kind": "component"}
    # ground hit (Shane 2026-07-08): a ground is a first-class BOXED element, not
    # a point — crop its bbox padded and record its label/family, same as a
    # component, so a blessed ground is categorized (PE/GND/…) and retrievable.
    grounds = {str(g.get("id")): g for g in snap.get("grounds") or []}
    gid = str(tgt.get("element_id") or "")
    if tgt.get("element_kind") == "ground" and gid in grounds and grounds[gid].get("bbox"):
        b = grounds[gid]["bbox"]
        region = {"x": float(b["x"]) - _CROP_PAD, "y": float(b["y"]) - _CROP_PAD,
                  "width": float(b["width"]) + 2 * _CROP_PAD,
                  "height": float(b["height"]) + 2 * _CROP_PAD}
        return region, {"element_id": gid, "element_label": grounds[gid].get("label"),
                        "element_kind": "ground"}
    eid = str(tgt.get("element_id") or "")
    region = {"x": x - _POINT_HALF, "y": y - _POINT_HALF,
              "width": 2 * _POINT_HALF, "height": 2 * _POINT_HALF}
    return region, {"element_id": eid or None,
                    "element_label": tgt.get("element_label") or tgt.get("component_label"),
                    "element_kind": tgt.get("element_kind")}


def _best_detection(region: dict[str, float], page: int) -> dict[str, Any] | None:
    try:
        from src.canvas_copilot import yolo

        rx, ry = region["x"], region["y"]
        rx1, ry1 = rx + region["width"], ry + region["height"]
        best = None
        for d in yolo.page_detections(page):
            if d.get("tier") != "strong":
                continue
            b = d.get("bbox") or {}
            cx = float(b.get("x", 0)) + float(b.get("width", 0)) / 2
            cy = float(b.get("y", 0)) + float(b.get("height", 0)) / 2
            if rx <= cx <= rx1 and ry <= cy <= ry1:
                if best is None or float(d.get("confidence") or 0) > float(best.get("confidence") or 0):
                    best = d
        if best:
            return {"id": str(best.get("id")), "class_name": str(best.get("class_name")),
                    "confidence": round(float(best.get("confidence") or 0), 2),
                    "tier": str(best.get("tier"))}
    except Exception:
        logger.debug("playbook detection context unavailable", exc_info=True)
    return None


def mint(ev: dict[str, Any], snap: dict[str, Any]) -> dict[str, Any] | None:
    """Assemble + persist a card from a bless event. Deterministic — no model
    interprets anything; Shane's verbatim text IS the directive."""
    text = str(ev.get("text") or "").strip()
    if not text:
        return None  # the WHY is the card; no text, no card (canvas enforces too)
    page = int(ev.get("page") or (snap.get("page") or 0))
    region, element = _situation_region(snap, ev)
    label = str(element.get("element_label") or "")
    fam = (_FAMILY_RE.match(label).group(1).upper() if label and _FAMILY_RE.match(label) else None)
    card_id = f"pb-{time.strftime('%Y%m%d-%H%M%S')}"
    _CARDS.mkdir(parents=True, exist_ok=True)

    assets: dict[str, str] = {}
    try:
        from src.canvas_copilot.capture import render_capture

        for name, overlay in (("overlay", True), ("print", False)):
            pk = render_capture(region=region, max_px=560, show_graph_overlay=overlay,
                                show_grid_overlay=False, include_text_layer=False,
                                show_ask_marks=False, encode_b64=False)
            src = Path(str(pk.get("debug_path") or ""))
            if src.exists():
                dst = _CARDS / f"{card_id}-{name}.png"
                dst.write_bytes(src.read_bytes())
                assets[f"crop_{name}"] = f"cards/{dst.name}"
    except Exception:
        logger.warning("playbook crop render failed — card mints without images",
                       exc_info=True)

    ops: list[dict[str, Any]] = []
    try:
        from src.canvas_copilot.copilot import copilot_session

        ref_keys = {k for k in (label, str(element.get("element_id") or "")) if k}
        ops = [r for r in copilot_session.receipt_log
               if any(k and k in str(r.get("ref") or "") for k in ref_keys)][-12:]
    except Exception:
        logger.debug("playbook receipt-log context unavailable", exc_info=True)

    det_version = None
    try:
        from src.canvas_copilot import yolo

        det_version = yolo.model_sha()
    except Exception:
        pass

    from src.canvas_copilot import bridge

    card = {
        "schema_version": SCHEMA_VERSION,
        "id": card_id,
        "blessed_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "shane_text": text[:600],
        "situation": {
            "page": page,
            "region": {k: round(float(v), 1) for k, v in region.items()},
            "tap": {"x": ev.get("x"), "y": ev.get("y")},
            **element,
            "label_family": fam,
            "det": _best_detection(region, page),
            "snapshot_seq": bridge.get_state().get("snapshot_seq"),
            "detector_version": det_version,
        },
        "action": {"ops": ops},
        "assets": assets,
        "embedding": None,  # v2: computed retroactively from stored crops
    }
    (_CARDS / f"{card_id}.json").write_text(
        json.dumps(card, indent=1, ensure_ascii=False))
    _update_index(card)
    logger.info("playbook card minted: %s (%s)", card_id, fam or "no-family")
    return card


def _update_index(card: dict[str, Any]) -> None:
    """Human-browsable gallery line for Shane (and the git diff reviewers)."""
    try:
        _ROOT.mkdir(parents=True, exist_ok=True)
        idx = _ROOT / "INDEX.md"
        header = ("# Playbook — blessed plays\n\nMinted by Shane's canvas bless tool; "
                  "curated at run debriefs. Contract: docs/vault/PLAYBOOK-SCHEMA.md\n\n")
        line = (f"- **{card['id']}** [{card['situation'].get('label_family') or '—'}] "
                f"{card['situation'].get('element_label') or 'point'} (p{card['situation']['page']}): "
                f"\"{card['shane_text'][:100]}\"\n")
        existing = idx.read_text() if idx.exists() else header
        idx.write_text(existing + line)
    except OSError:
        logger.warning("playbook index update failed", exc_info=True)


def load_cards() -> list[dict[str, Any]]:
    if not _CARDS.exists():
        return []
    out = []
    for f in sorted(_CARDS.glob("pb-*.json")):
        try:
            out.append(json.loads(f.read_text()))
        except (OSError, ValueError):
            logger.warning("unreadable playbook card %s", f, exc_info=True)
    return out


def lookup(situation: dict[str, Any]) -> list[dict[str, Any]]:
    """v1 retrieval: class/label-family key match, most recent first.
    The situation dict may carry more than v1 reads (bbox, page, crop) —
    richer tiers use it without any caller changing."""
    fam = str(situation.get("label_family") or "").upper()
    cls = str(situation.get("class_name") or "").upper()
    if not fam and not cls:
        return []
    hits = []
    for c in load_cards():
        s = c.get("situation") or {}
        cf = str(s.get("label_family") or "").upper()
        cc = str(((s.get("det") or {}).get("class_name")) or "").upper()
        if (fam and fam == cf) or (cls and cls == cc) or (fam and fam == cc) or (cls and cls == cf):
            hits.append(c)
    hits.sort(key=lambda c: str(c.get("blessed_at") or ""), reverse=True)
    return hits[:2]
