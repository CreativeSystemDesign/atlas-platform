"""Blocker tickets — the audit as a work queue, not a report card.

Shane's design call (2026-07-05): dumping 29 ERRORs at once invited one
narrative to dismiss them all ("they're all the union artifact" — attempt 1's
laundering). Serialized blockers can't be batch-dismissed: the agent gets ONE
ticket at a time, fully detailed; the rest ride as counts. The server owns the
queue; handoff notes stop being the carrier (nothing to paraphrase or launder).

Classes:
- LIVE: fix-now geometry/electrical defects. Presented one at a time.
- END-STATE: legal mid-build, must be zero before any done claim
  (unwired components while wiring hasn't reached them, naming, receipt
  ledger). Enforced by the done-gate, not the live queue.

Law (calibrated 2026-07-05, Shane reviewed every flag of arm 2S″: ZERO false
positives): an ERROR leaves the queue by GEOMETRY CHANGE verified on re-audit,
or rides a handoff as OPEN. There is no agent-side false-positive disposition.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

from src.config import ATLAS_REPO_ROOT

# Rules that are legal while the page is mid-build; the done-gate owns them.
END_STATE_RULES = {
    "unwired-node",
    "orphan-terminal",
    "naming",
    "undisposed-warning",
    "segmented-conductor",
    # Naming-family sibling (Shane, 2026-07-10, page 11's T~T507~T507): the
    # owner slot must be TRUE, not just convention-shaped. Legal mid-build
    # (adoption happens as boxes land); gates done/seal.
    "terminal-owner-integrity",
    # Anchoring sibling (Shane, 2026-07-11, page 11's floating 6/1 refs): a
    # continuation with target:null links nothing — legal mid-build (chips
    # land before anchoring); gates done/seal.
    "continuation-unanchored",
    # The severed-edge guard (Shane, 2026-07-11, the MS2 33/4: an annotated
    # symbol with no link chip "can break the entire machine electrically").
    # Legal mid-build; gates done/seal.
    "continuation-unlinked",
    # cable-mating-incomplete was END-STATE here 2026-07-06..07-10, then
    # deregistered: YOLO detections never gate anything (Shane's law,
    # 2026-07-10) — the rule survives as INFO evidence in audit.py 17c.
    # Shane's directive 2026-07-09 (the MC-220 case): an uncovered printed
    # conductor between annotated elements changes the schematic electrically.
    # Legal mid-build (boxes and pins land before wires); gates done claims.
    "wire-coverage",
}

# Fix-now ordering: electrical breaks first, then extent truth, then borders.
_RULE_PRIORITY = [
    "degenerate-edge",
    "edge-port-missing",
    "junction-dangle",
    "terminal-mid-wire",
    "bbox-truncation-floor",
    "terminal-outside-parent",
    "terminal-interior",
    "duplicate-port",
    "box-overlap",
]


def _prio(rule: str) -> int:
    try:
        return _RULE_PRIORITY.index(rule)
    except ValueError:
        return len(_RULE_PRIORITY)


# --- Slate 6.3: the Shane ticket channel -------------------------------------
# Two mechanical Shane-facing states, keyed on (rule, element-id) — NEVER the
# aggregate md5 ticket hash (membership changes mint new hashes and would
# silently detach state, resurrecting the re-ask loop that asked the identical
# CNV40 question in 4 consecutive sessions, ~$1.80, never answered):
#   awaiting-shane: parked by the explicit raise_to_shane op. Suppresses
#     re-serves and gate refires; still BLOCKS done (else parking becomes a
#     laundering channel); locks agent geometry on the disputed element.
#   shane-disposed: Shane's verdict (panel endpoint, or his quoted chat
#     verdict until the panel button exists). Satisfies the done-gate but is
#     BOUND to the element's geometry at disposition — any later change
#     invalidates it (no laundering of a subsequently-real defect). Disposed
#     entries stay on file for detector calibration.

_TICKET_STATE_FILE = Path(ATLAS_REPO_ROOT) / ".atlas" / "copilot-ticket-states.json"
_ticket_states: dict[str, dict[str, Any]] | None = None


def _states() -> dict[str, dict[str, Any]]:
    global _ticket_states
    if _ticket_states is None:
        try:
            _ticket_states = json.loads(_TICKET_STATE_FILE.read_text())
        except (OSError, ValueError):
            _ticket_states = {}
    return _ticket_states


def _save_states() -> None:
    try:
        _TICKET_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _TICKET_STATE_FILE.write_text(json.dumps(_states(), ensure_ascii=False, indent=1))
    except OSError:
        pass


def _skey(rule: str, element_id: str) -> str:
    return f"{rule}|{element_id}"


def _element_geometry(snap: dict[str, Any] | None, element_id: str) -> dict[str, Any] | None:
    for n in (snap or {}).get("nodes") or []:
        if str(n.get("id")) == element_id:
            return dict(n.get("bbox") or {})
    for p in (snap or {}).get("ports") or []:
        if str(p.get("id")) == element_id:
            return dict(p.get("point") or {})
    # Edges too (2026-07-09): edge-keyed violations (degenerate-edge, edge-port-
    # missing — both ERROR — plus endpoint-drift, wire-through-component) render a
    # disposable flag pill on the wire. Without a geometry signature here their
    # disposition stored geometry=None, and _violation_state's guard then treats a
    # None disposition as PERMANENT — a re-routed wire's real defect could hide
    # behind a stale false-positive verdict forever. Bind to the path so any
    # re-route invalidates the verdict, exactly like a moved box does for a node.
    for e in (snap or {}).get("edges") or []:
        if str(e.get("id")) == element_id:
            return {"path": [[round(float(pt.get("x", 0)), 1), round(float(pt.get("y", 0)), 1)]
                             for pt in (e.get("path") or [])]}
    return None


def park_ticket(rule: str, element_id: str, question: str, provenance: str,
                *, page: int | None = None, element_label: str | None = None,
                yes_means: str | None = None, no_means: str | None = None,
                crop_path: str | None = None) -> dict[str, Any]:
    """Park awaiting-shane. Issues-panel fields (2026-07-07, Shane's design:
    self-sufficient runs surface ONLY absolute blocks, each framed yes/no with
    a crop): page scopes the panel view; yes_means/no_means make the buttons
    actionable; crop_path is the rendered region PNG."""
    entry: dict[str, Any] = {"state": "awaiting-shane", "question": str(question)[:400],
                             "provenance": str(provenance)[:200], "ts": time.time()}
    if page is not None:
        entry["page"] = int(page)
    if element_label:
        entry["element_label"] = str(element_label)[:80]
    if yes_means:
        entry["yes_means"] = str(yes_means)[:200]
    if no_means:
        entry["no_means"] = str(no_means)[:200]
    if crop_path:
        entry["crop_path"] = str(crop_path)
    _states()[_skey(rule, element_id)] = entry
    _save_states()
    return entry


def answer_ticket(rule: str, element_id: str, answer: str, note: str,
                  provenance: str) -> dict[str, Any] | None:
    """Shane's Table verdict on a parked issue: yes / no / CUSTOM (2026-07-09,
    Shane: the offered options may not match the instruction he needs to give
    — 'Something Else' carries his own instruction as the verdict; the note is
    the ruling). The entry moves to shane-answered — still on the Table (done
    blocked, not re-served) until the agent applies the input and resolves,
    but geometry UNLOCKS at answer time (his answer authorizes the fix; the
    lock refusing the authorized apply was the catch-22 in the 2026-07-09
    CONNECTOR session). Returns None when no awaiting-shane entry exists."""
    key = _skey(rule, element_id)
    entry = _states().get(key)
    if not entry or entry.get("state") not in ("awaiting-shane", "shane-answered"):
        return None
    a = str(answer).lower()
    entry["state"] = "shane-answered"
    entry["answer"] = {"answer": a if a in ("yes", "no", "custom") else "no",
                       "note": str(note or "")[:600],
                       "provenance": str(provenance)[:200], "ts": time.time()}
    _save_states()
    return entry


def resolve_answered(rule: str, element_id: str, provenance: str) -> dict[str, Any] | None:
    """Agent applied Shane's recorded answer → the issue clears from the
    panel. ONLY a shane-answered entry resolves (an unanswered park cannot be
    self-cleared — that would be the laundering channel 6.3 closed). The
    entry is REMOVED: the audit remains the truth — if the applied fix didn't
    actually clear the underlying flag, it resurfaces honestly on re-audit.
    Returns the removed entry (with Shane's answer) or None."""
    key = _skey(rule, element_id)
    entry = _states().get(key)
    if not entry or entry.get("state") != "shane-answered":
        return None
    removed = _states().pop(key)
    _states()[f"resolved:{key}:{int(time.time())}"] = {
        "state": "resolved", "prior": removed,
        "provenance": str(provenance)[:200], "ts": time.time()}
    _save_states()
    return removed


def set_issue_page(rule: str, element_id: str, page: int | None,
                   orphan: bool = False) -> bool:
    """Backfill for pre-page-tracking parks (2026-07-07): stamp the page the
    element actually lives on, or mark it orphan when it exists in NO saved
    graph (wiped experiment legs) — the panel says so instead of bouncing
    Shane between pages."""
    entry = _states().get(_skey(rule, element_id))
    if not entry or entry.get("state") not in ("awaiting-shane", "shane-answered"):
        return False
    if page is not None:
        entry["page"] = int(page)
        entry.pop("orphan", None)
    elif orphan:
        entry["orphan"] = True
    _save_states()
    return True


def list_issues(page: int | None = None) -> list[dict[str, Any]]:
    """Issues-panel view: every awaiting-shane / shane-answered entry, scoped
    to `page` when given. Entries parked before page-scoping existed carry no
    page — they ride along on every page (marked page=None) rather than
    becoming curl-only again."""
    out: list[dict[str, Any]] = []
    for key, entry in _states().items():
        if entry.get("state") not in ("awaiting-shane", "shane-answered") or "|" not in key:
            continue
        entry_page = entry.get("page")
        if page is not None and entry_page is not None and int(entry_page) != int(page):
            continue
        rule, eid = key.split("|", 1)
        out.append({"rule": rule, "element_id": eid, **entry})
    out.sort(key=lambda e: e.get("ts") or 0)
    return out


def reopen_ticket(rule: str, element_id: str, provenance: str) -> bool:
    key = _skey(rule, element_id)
    if key in _states():
        prior = _states().pop(key)
        _states()[f"reopened:{key}:{int(time.time())}"] = {
            "state": "reopened", "prior": prior,
            "provenance": str(provenance)[:200], "ts": time.time()}
        _save_states()
        return True
    return False


def dispose_ticket(rule: str, element_id: str, verdict: str, provenance: str,
                   snap: dict[str, Any] | None) -> dict[str, Any]:
    entry = {"state": "shane-disposed", "verdict": str(verdict)[:400],
             "provenance": str(provenance)[:200], "ts": time.time(),
             "geometry": _element_geometry(snap, element_id)}
    _states()[_skey(rule, element_id)] = entry
    _save_states()
    return entry


def element_state(rule: str, element_id: str) -> dict[str, Any] | None:
    return _states().get(_skey(rule, element_id))


# Shane's false-positive corpus (2026-07-09): every flag he checks off from the
# canvas pill is appended here, append-only, so he and Claude can mine it to
# calibrate the rules that cry wolf. This is the training signal for the audit
# — the same gold-factory loop pointed at the graders instead of the graph.
_FALSE_POSITIVE_CORPUS = Path(ATLAS_REPO_ROOT) / ".atlas" / "flag-false-positives.jsonl"


def record_false_positive(rule: str, element_id: str, verdict: str,
                          provenance: str, geometry: dict[str, Any] | None,
                          note: str | None, page: int | None) -> dict[str, Any]:
    row = {"ts": time.time(), "rule": rule, "element_id": element_id,
           "verdict": verdict, "provenance": provenance, "geometry": geometry,
           "note": note, "page": page}
    try:
        _FALSE_POSITIVE_CORPUS.parent.mkdir(parents=True, exist_ok=True)
        with _FALSE_POSITIVE_CORPUS.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except OSError:
        pass  # a lost corpus line must never fail the disposition itself
    return row


def parked_elements() -> dict[str, dict[str, Any]]:
    """element_id -> entry for GEOMETRY-LOCKED parks: awaiting-shane ONLY.
    A shane-answered entry no longer locks (2026-07-09): his verdict IS the
    authorization to apply — the lock refusing the authorized apply forced a
    reopen workaround (CONNECTOR session catch-22). Answered issues still
    block done and stay on the Table until the agent applies + resolves."""
    out: dict[str, dict[str, Any]] = {}
    for key, entry in _states().items():
        if entry.get("state") == "awaiting-shane" and "|" in key:
            out[key.split("|", 1)[1]] = entry
    return out


# --- Slate 4.6: extent stamps + the page-level (gold-master) lock ------------
# (a) Shane-authorized geometry / per-component "perfect" verdicts stamp the
#     node EXTENT-VERIFIED — scoped to the BOX EXTENT only (the same message
#     granting "perfect on ELB40" ordered THR349's terminals MOVED — praise
#     parsing is banned; stamps land only via explicit quoted verdicts or the
#     panel). Stamps are geometry-bound: any bbox change invalidates.
# (b) The PAGE lock is the only hard-refusing tier (pre-approved): a sealed
#     gold-master page refuses ALL mutating batches until Shane unlocks.
#     Per-component refusal stays unshipped (the law-vs-lock deadlock class).


def stamp_extent(node_id: str, bbox: dict[str, Any] | None, provenance: str) -> dict[str, Any]:
    entry = {"state": "extent-verified", "bbox": dict(bbox or {}),
             "provenance": str(provenance)[:200], "ts": time.time()}
    _states()[f"extent:{node_id}"] = entry
    _save_states()
    return entry


def extent_stamp(node_id: str, current_bbox: dict[str, Any] | None) -> dict[str, Any] | None:
    """Valid stamp for the node, or None. A bbox that moved since stamping
    invalidates ON THE SPOT (stamps bind to geometry like 6.3 dispositions)."""
    entry = _states().get(f"extent:{node_id}")
    if not entry:
        return None
    if current_bbox is not None and dict(current_bbox) != (entry.get("bbox") or {}):
        del _states()[f"extent:{node_id}"]
        _save_states()
        return None
    return entry


def list_extent_stamps() -> dict[str, dict[str, Any]]:
    """node_id -> stamp entry for every extent-verified node on file (Slate
    7.1: server-autofills the handoff's VERIFIED-EXTENTS table). Mirrors
    parked_elements()'s key-prefix scan; does NOT invalidate anything —
    callers resolve the node against a live snapshot themselves (a stamp
    for a node absent from that snapshot is a WARN, never a delete here)."""
    out: dict[str, dict[str, Any]] = {}
    for key, entry in _states().items():
        if key.startswith("extent:") and entry.get("state") == "extent-verified":
            out[key.split(":", 1)[1]] = entry
    return out


def set_page_lock(page: int, locked: bool, provenance: str) -> None:
    key = f"page-lock:{int(page)}"
    if locked:
        _states()[key] = {"state": "locked", "provenance": str(provenance)[:200],
                          "ts": time.time()}
    else:
        _states().pop(key, None)
    _save_states()


def page_locked(page: int | None) -> dict[str, Any] | None:
    if page is None:
        return None
    return _states().get(f"page-lock:{int(page)}")


def _violation_state(v: dict[str, Any], snap: dict[str, Any]) -> str | None:
    """None = actionable; 'parked' = awaiting-shane; 'disposed' = drop it.
    A disposed state whose element geometry CHANGED since disposition is
    invalidated on the spot (deleted, violation lives again)."""
    rule = str(v.get("rule"))
    for eid in (v.get("ids") or []):
        entry = _states().get(_skey(rule, str(eid)))
        if not entry:
            continue
        if entry.get("state") in ("awaiting-shane", "shane-answered"):
            return "parked"
        if entry.get("state") == "shane-disposed":
            geom_now = _element_geometry(snap, str(eid))
            if entry.get("geometry") is not None and geom_now != entry.get("geometry"):
                del _states()[_skey(rule, str(eid))]
                _save_states()
                return None  # geometry moved after the verdict: defect may be real now
            return "disposed"
    return None


def _element_y(ids: list[str], snap: dict[str, Any]) -> float:
    """Top-most element y for spatial ordering (fix things near each other)."""
    ys: list[float] = []
    by_id: dict[str, Any] = {}
    for n in snap.get("nodes") or []:
        by_id[str(n.get("id"))] = (n.get("bbox") or {}).get("y")
    for p in snap.get("ports") or []:
        by_id[str(p.get("id"))] = (p.get("point") or {}).get("y")
    for i in ids:
        v = by_id.get(str(i))
        if isinstance(v, (int, float)):
            ys.append(float(v))
    return min(ys) if ys else 1e9


def build_tickets(audit: dict[str, Any], snap: dict[str, Any]) -> dict[str, Any]:
    """Group audit violations into blocker tickets.

    One ticket per (rule) among ERROR violations — same-cause instances are one
    fact, not N tasks (18x unwired-node is one line). LIVE tickets order by
    rule priority then top-of-page y.
    """
    violations = audit.get("violations") or []
    errors = [v for v in violations if v.get("severity") == "ERROR"]
    # Slate 6.3: apply Shane-facing states at the VIOLATION level, keyed
    # (rule, element-id). Disposed drop out (geometry-bound); parked split
    # into their own lane — never re-served, still blocking done.
    actionable: list[dict[str, Any]] = []
    parked_vs: list[dict[str, Any]] = []
    for v in errors:
        st = _violation_state(v, snap)
        if st == "disposed":
            continue
        (parked_vs if st == "parked" else actionable).append(v)
    by_rule: dict[str, list[dict[str, Any]]] = {}
    for v in actionable:
        by_rule.setdefault(str(v.get("rule")), []).append(v)

    live: list[dict[str, Any]] = []
    end_state: list[dict[str, Any]] = []
    for rule, vs in by_rule.items():
        ids = [str(i) for v in vs for i in (v.get("ids") or []) if i]
        ticket = {
            "ticket_id": hashlib.md5((rule + "|" + "|".join(sorted(ids))).encode()).hexdigest()[:8],
            "rule": rule,
            "severity": "ERROR",
            "count": len(vs),
            "details": [str(v.get("detail"))[:220] for v in vs[:3]],
            "suggestions": [str(v.get("suggestion")) for v in vs[:2] if v.get("suggestion")],
            "ids": ids[:10],
        }
        (end_state if rule in END_STATE_RULES else live).append(ticket)

    live.sort(key=lambda t: (_prio(t["rule"]), _element_y(t["ids"], snap)))
    end_state.sort(key=lambda t: -t["count"])
    parked = [{"rule": str(v.get("rule")),
               "ids": [str(i) for i in (v.get("ids") or [])][:4],
               "detail": str(v.get("detail"))[:160]} for v in parked_vs]
    return {"live": live, "end_state": end_state, "parked": parked}


# Slate 6.3: the "zero false positives, human-calibrated" claim was FALSIFIED
# by the gold review (5 Shane-ruled FP classes) — the law's truth is narrower
# and stronger: flags may be wrong, but only Shane may dismiss them.
_LAW = (
    "BLOCKER LAW: this blocker leaves the queue ONLY by a geometry/graph change "
    "that clears it on re-audit, by riding your handoff as OPEN, or by Shane's "
    "own disposition. Flags MAY be wrong — but only Shane may dismiss them. If "
    "you believe this one is wrong, park it with raise_to_shane (states your "
    "case, stops the re-serves, locks the disputed geometry) and work the next "
    "ticket; never resize-to-appease and never dismiss in prose."
)


def blocker_response(audit: dict[str, Any], snap: dict[str, Any]) -> dict[str, Any]:
    """audit_page's reshaped response: ONE live blocker fully detailed, the
    rest as counts. Full violation dump stays server-side (handoffs attach it)."""
    tickets = build_tickets(audit, snap)
    live, end_state = tickets["live"], tickets["end_state"]
    counts = audit.get("counts") or {}
    out: dict[str, Any] = {
        "page": audit.get("page"),
        "counts": counts,
        "clean": not live and not end_state and not (counts.get("WARN") or 0),
    }
    if audit.get("disposed"):
        # Suppression stays visible (2026-07-09): without this the copilot
        # can't distinguish "my fix cleared it" from "Shane suppressed it"
        # and may narrate a repair it never made.
        out["disposed"] = audit["disposed"]
    if live:
        out["blocker"] = {**live[0], "law": _LAW}
        out["queue"] = [{"rule": t["rule"], "count": t["count"]} for t in live[1:]]
        out["queue_depth"] = len(live)
        out["next_action"] = (
            f"Fix blocker 1 of {len(live)} ({live[0]['rule']}), re-audit to verify "
            "it cleared, and the next ticket is served automatically."
        )
    if tickets.get("parked"):
        out["parked_awaiting_shane"] = tickets["parked"]
        out["parked_note"] = (
            f"{len(tickets['parked'])} flag(s) parked awaiting Shane's verdict — "
            "not re-served, geometry on those elements is LOCKED, and they still "
            "block done claims until he answers or disposes."
        )
    if end_state:
        out["end_state_gaps"] = [
            {"rule": t["rule"], "count": t["count"]} for t in end_state
        ]
        out["end_state_note"] = (
            "Legal mid-build; must be ZERO before any done/complete claim — "
            "the done-gate enforces this mechanically."
        )
    warn_rules: dict[str, int] = {}
    disposed_warns = 0
    for v in audit.get("violations") or []:
        if v.get("severity") == "WARN":
            # 2026-07-08 (Shane): dispositions must actually SUPPRESS — a
            # disposed WARN re-listing forever made his verdicts meaningless
            # (page-7 session disposed 9 flags; counts never moved).
            if _violation_state(v, snap) == "disposed":
                disposed_warns += 1
                continue
            warn_rules[str(v.get("rule"))] = warn_rules.get(str(v.get("rule")), 0) + 1
    if warn_rules:
        out["warnings_by_rule"] = warn_rules
    if disposed_warns:
        out["disposed_warnings"] = disposed_warns
    # clean was computed from raw counts; recompute WARN cleanliness from the
    # post-disposition view so disposed flags stop blocking a clean page.
    out["clean"] = not live and not end_state and not warn_rules and not (
        counts.get("ERROR") or 0)
    return out


def open_issue_cards(audit: dict[str, Any], snap: dict[str, Any]) -> list[dict[str, Any]]:
    """The drawer's OPEN-FLAG cards (Shane, 2026-07-08): every non-disposed
    audit violation as an issue card, so the drawer is the shared work surface
    while he and the copilot burn the page's issues down — not only the parked
    yes/no questions. Disposed drop (geometry-bound); parked are listed by
    list_issues separately."""
    labels = {str(n.get("id")): str(n.get("label") or "") for n in snap.get("nodes") or []}
    for p in snap.get("ports") or []:
        labels[str(p.get("id"))] = str(p.get("label") or "")
    out: list[dict[str, Any]] = []
    for v in audit.get("violations") or []:
        st = _violation_state(v, snap)
        if st in ("disposed", "parked"):
            continue
        rule = str(v.get("rule"))
        ids = [str(i) for i in (v.get("ids") or []) if i]
        eid = ids[0] if ids else f"{rule}-{hashlib.md5(str(v.get('detail'))[:120].encode()).hexdigest()[:8]}"
        out.append({
            "rule": rule,
            "element_id": eid,
            "element_ids": ids[:6],
            "element_label": next((labels[i] for i in ids if labels.get(i)), None),
            "state": "open",
            "severity": str(v.get("severity") or "WARN"),
            "detail": str(v.get("detail"))[:240],
            "suggestion": str(v.get("suggestion"))[:160] if v.get("suggestion") else None,
        })
    sev_rank = {"ERROR": 0, "WARN": 1, "INFO": 2}
    out.sort(key=lambda c: (sev_rank.get(c["severity"], 3), c["rule"]))
    return out


def open_blockers(audit: dict[str, Any] | None, snap: dict[str, Any] | None) -> dict[str, Any]:
    """Done-gate check: counts of what still blocks a done claim. Parked
    (awaiting-shane) flags still BLOCK — parking is not a laundering channel
    — but they are reported separately so the gate can say "waiting on Shane"
    instead of re-serving them."""
    if not audit or not snap:
        return {"live": 0, "end_state": 0, "parked": 0}
    t = build_tickets(audit, snap)
    return {"live": len(t["live"]), "end_state": len(t["end_state"]),
            "parked": len(t.get("parked") or []),
            "top": (t["live"] or t["end_state"] or [None])[0]}
