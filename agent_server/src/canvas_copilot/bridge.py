"""Live-canvas bridge state.

Single-user, in-memory, ephemeral by design: the graph of record lives in Neon
via the existing v2 persistence path; this module only mirrors *live* UI state
(what page/viewport/tool Shane is on, what his pen just touched) and fans agent
commands out to the browser.

Everything here runs on the FastAPI event loop — no locks needed, but keep
handlers non-blocking.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import re
import time
from collections import deque
from typing import Any

# --- Canvas -> agent: state snapshots + event ring ----------------------------

_EVENT_RING_SIZE = 300

_snapshot: dict[str, Any] = {}
_snapshot_seq: int = 0
_snapshot_at: float = 0.0
_snapshot_canvas: str | None = None
_events: deque[dict[str, Any]] = deque(maxlen=_EVENT_RING_SIZE)
_event_seq = itertools.count(1)

# Multi-canvas hardening (2026-07-12, after the page-13 desync): every canvas
# mount mints an id and stamps its POSTs and its SSE subscription with it.
# Snapshots are PINNED to the elected writer (the same canvas annotates go to,
# so the copilot reads and writes the SAME surface); a second live canvas
# alternating overwrites of the one global _snapshot was the page flip-flop.
# Rejected posters are ledgered and every canvas gets a loud toast, throttled.
#
# The election is STICKY and FOCUS-FOLLOWING, never newest-subscriber-wins:
# a frozen tab's browser-native SSE reconnect re-subscribes without running
# any JS, and under newest-wins that zombie would steal the pin from the
# canvas Shane is actually using. Takeover happens only on (a) a post that
# declares focused=true — Shane's eyes are the election, (b) liveness: the
# current writer hasn't posted inside the window and someone else has, or
# (c) the writer's last subscription disappearing.
_posters: dict[str, dict[str, Any]] = {}
# Liveness window: the canvas heartbeats every ~25s even when idle, so a
# writer with no post inside 90s has missed 3+ beats — dead or frozen, not
# merely idle. (Adversarial review 2026-07-12: post-driven liveness without a
# client heartbeat expired healthy idle writers.)
_POSTER_WINDOW_S = 90.0
# A writer that has NEVER posted holds the pin only this long past its
# ELECTION — just enough for the subscribe→onopen→re-seed hop. Anchored to a
# fixed election timestamp, never to subscription recency: a frozen tab's SSE
# churn re-subscribes forever and would re-arm any subscription-based grace
# (review finding: the immortal zombie writer).
_WRITER_GRACE_S = 15.0
_writer_id: str | None = None
_writer_elected_ts: float = 0.0
_snapshot_rejections: deque[dict[str, Any]] = deque(maxlen=50)
_last_dup_toast_ts: float = 0.0
_DUP_TOAST_EVERY_S = 60.0


def writer_canvas_id() -> str | None:
    """The sticky elected writer's canvas id (None = no identified canvas)."""
    return _writer_id


def _set_writer(canvas_id: str | None) -> None:
    global _writer_id, _writer_elected_ts
    _writer_id = canvas_id
    _writer_elected_ts = time.time()


def _writer_subscribed() -> bool:
    return any(s.get("canvas_id") == _writer_id for s in _subscribers)


def _elect_on_post(canvas_id: str, focused: bool | None) -> None:
    """Election at post time. Sticky: an unfocused poster only takes the pin
    when there is no living writer; a focused poster always takes it."""
    if _writer_id == canvas_id:
        return
    if focused:
        _set_writer(canvas_id)
        return
    if _writer_id is None or not _writer_subscribed():
        _set_writer(canvas_id)
        return
    now = time.time()
    last = _posters.get(_writer_id)
    if last is not None:
        writer_alive = now - float(last.get("ts") or 0) <= _POSTER_WINDOW_S
    else:
        writer_alive = now - _writer_elected_ts <= _WRITER_GRACE_S
    if not writer_alive:
        _set_writer(canvas_id)


def active_posters(window_s: float = _POSTER_WINDOW_S) -> dict[str, dict[str, Any]]:
    now = time.time()
    return {cid: p for cid, p in _posters.items() if now - float(p.get("ts") or 0) <= window_s}


def _maybe_toast_duplicate() -> None:
    global _last_dup_toast_ts
    now = time.time()
    if now - _last_dup_toast_ts < _DUP_TOAST_EVERY_S:
        return
    _last_dup_toast_ts = now
    page = (_posters.get(_writer_id) or {}).get("page") if _writer_id else None
    who = (f"canvas {_writer_id[:11]}" + (f" (page {page})" if page is not None else "")
           if _writer_id else "the active canvas")
    send_commands([{
        "type": "toast",
        "message": (f"⚠ two canvases are posting to the copilot bridge — state is "
                    f"pinned to {who}; click into the canvas that should win the "
                    "pin, or close the duplicate"),
    }])


def put_state(snapshot: dict[str, Any] | None, events: list[dict[str, Any]] | None,
              canvas_id: str | None = None, focused: bool | None = None) -> dict[str, Any]:
    """Store the latest canvas snapshot and append new events. Returns cursors.

    Snapshot writes are pinned: when an identified writer exists, only that
    canvas may overwrite the snapshot — posts from any other id (or from an
    anonymous stale build) are ledgered and dropped. The election is sticky
    and focus-following (see above). Events pass for every poster: gestures
    come from whatever surface Shane touched, and receipts must never be lost
    to an election."""
    global _snapshot, _snapshot_seq, _snapshot_at, _snapshot_canvas
    accepted = True
    if canvas_id:
        _posters[str(canvas_id)] = {
            "ts": time.time(),
            "focused": bool(focused) if focused is not None else None,
            "page": (snapshot or {}).get("page") if snapshot is not None
            else (_posters.get(str(canvas_id)) or {}).get("page"),
        }
        _elect_on_post(str(canvas_id), focused)
    if snapshot is not None:
        writer = writer_canvas_id()
        if writer is not None and canvas_id != writer:
            accepted = False
            _snapshot_rejections.append({"canvas_id": canvas_id, "ts": time.time(),
                                         "page": snapshot.get("page")})
            _maybe_toast_duplicate()
        else:
            _snapshot = snapshot
            _snapshot_seq += 1
            _snapshot_at = time.time()
            _snapshot_canvas = str(canvas_id) if canvas_id else None
    for ev in events or []:
        _events.append({**ev, "seq": next(_event_seq), "server_ts": time.time()})
        # Bless (Shane's playbook, 2026-07-06): card minting is SERVER-automatic
        # — never dependent on the agent noticing the event. Off-thread: the
        # crop render is heavy and put_state sits on the canvas's POST path.
        if ev.get("kind") == "bless":
            import threading

            snap_now = dict(_snapshot or {})
            ev_copy = dict(ev)

            def _mint() -> None:
                try:
                    from src.canvas_copilot import playbook

                    playbook.mint(ev_copy, snap_now)
                except Exception:
                    logging.getLogger(__name__).warning(
                        "playbook mint failed", exc_info=True)
            threading.Thread(target=_mint, daemon=True).start()
        # Track acked annotate keys so replay never re-delivers applied work to
        # a DIFFERENT canvas (cross-canvas duplicates bypass per-canvas dedupe).
        if ev.get("kind") == "annotate_applied" and ev.get("key"):
            _acked_annotate_keys.append(str(ev["key"]))
            # Warning ledger: receipt warnings live until fixed or dispositioned —
            # the debts that kept escaping through session handoffs.
            # Slate 6.10: dedupe by (page, note) — the page-10 run accumulated
            # literal duplicate rows (T-124 x3, T-126 x3, T-131 x2).
            page = ev.get("page")
            for note in ev.get("notes") or []:
                if isinstance(note, str) and note.startswith("warning:"):
                    dup = next((w for w in _warning_ledger
                                if w.get("page") == page and w.get("note") == note), None)
                    if dup is not None:
                        dup["count"] = int(dup.get("count") or 1) + 1
                        dup["ts"] = time.time()
                    else:
                        _warning_ledger.append({"page": page, "note": note,
                                                "ts": time.time(), "count": 1})
    return {"snapshot_seq": _snapshot_seq,
            "last_event_seq": _events[-1]["seq"] if _events else 0,
            "snapshot_accepted": accepted,
            "writer_canvas": writer_canvas_id()}


def get_state(since_event: int = 0) -> dict[str, Any]:
    """Latest snapshot plus events newer than `since_event` (oldest first)."""
    return {
        "snapshot": _snapshot,
        "snapshot_seq": _snapshot_seq,
        "snapshot_age_s": round(time.time() - _snapshot_at, 3) if _snapshot_at else None,
        "snapshot_canvas": _snapshot_canvas,
        "events": [ev for ev in _events if ev["seq"] > since_event],
    }


def recent_events(kinds: set[str] | None = None, limit: int = 20) -> list[dict[str, Any]]:
    """Newest-last slice of the ring, optionally filtered by event kind."""
    picked = [ev for ev in _events if kinds is None or ev.get("kind") in kinds]
    return picked[-limit:]


# --- Agent -> canvas: command fan-out ------------------------------------------

# Seeded from the clock so ids stay monotonic across server restarts — the
# canvas dedupes replays by "id <= last seen", and a counter reset to 1 after
# a restart made every fresh command look like a replay (silently dropped).
_command_seq = itertools.count(int(time.time() * 1000))
# Ordered: newest subscriber last. Graph-mutating commands go ONLY to the
# newest canvas (single-writer election) — with two canvases connected, both
# applying the same annotate persisted duplicate elements to Neon (observed
# 2026-07-03). View/highlight/toast still fan out to all. Each entry:
# {"q": Queue, "canvas_id": str|None, "since": float} — the id ties the
# election to snapshot pinning above (reads and writes on ONE surface).
_subscribers: list[dict[str, Any]] = []
_acked_annotate_keys: deque[str] = deque(maxlen=500)
_warning_ledger: list[dict[str, Any]] = []


def warning_ledger(page: int | None = None) -> list[dict[str, Any]]:
    return [w for w in _warning_ledger if page is None or w.get("page") == page]


def dispose_warnings(page: int | None = None, reason: str = "") -> int:
    """Acknowledge current warnings (reason recorded by the caller's receipt/text)."""
    global _warning_ledger
    keep = [w for w in _warning_ledger if page is not None and w.get("page") != page]
    n = len(_warning_ledger) - len(keep)
    _warning_ledger = keep
    return n


# --- Slate 4.2: see-do freshness (born WARN, warn-and-ledger) ---------------
# The bridge stamps every capture (page, region, overlay state, ts) and every
# node geometry mutation. The zombie class: capture ev1129 served 10 ops over
# 79.6 minutes including 5 consecutive resizes of a node it PREDATED — your
# own mutation stales your own picture, by definition. Killed predicates stay
# dead: no 180s wall clock (0/59 supporting instances), no global event-count
# threshold (bleeds unrelated regions).
_capture_log: list[dict[str, Any]] = []
_node_mutation_ts: dict[str, float] = {}
_node_resize_ts: dict[str, list[float]] = {}


def log_capture(page: int | None, region: dict[str, Any] | None, overlay_on: bool) -> None:
    if not region:
        return
    # Slate 7.1: stamp the event-ring position alongside the wall clock — the
    # handoff's PINNED LOOKS section reports staleness in events (the proven
    # 4.2 predicate), not just seconds.
    _capture_log.append({"page": page, "region": dict(region),
                         "overlay_on": bool(overlay_on), "ts": time.time(),
                         "event_seq": _events[-1]["seq"] if _events else 0})
    del _capture_log[:-300]


def recent_captures(limit: int = 4) -> list[dict[str, Any]]:
    """Slate 7.1: newest-first capture references for the handoff's PINNED
    LOOKS section (page, region, overlay, staleness AS OF NOW). Age alone is
    not a verdict — 4.2 killed a global event-count threshold as cross-region
    noise — so this reports the raw numbers and leaves "re-look before you
    act" to the prompt text, never a computed stale/fresh flag here."""
    if limit <= 0:
        return []
    now_seq = _events[-1]["seq"] if _events else 0
    now_ts = time.time()
    out: list[dict[str, Any]] = []
    for entry in reversed(_capture_log):
        out.append({
            "page": entry.get("page"),
            "region": dict(entry.get("region") or {}),
            "overlay_on": bool(entry.get("overlay_on")),
            "age_events": max(0, now_seq - int(entry.get("event_seq") or 0)),
            "age_s": round(now_ts - float(entry.get("ts") or now_ts), 1),
        })
        if len(out) >= limit:
            break
    return out


def note_geometry_mutation(node_id: str, resize: bool = False) -> None:
    now = time.time()
    _node_mutation_ts[str(node_id)] = now
    if resize:
        _node_resize_ts.setdefault(str(node_id), []).append(now)
        del _node_resize_ts[str(node_id)][:-10]


def newest_node_mutation_ts(node_ids: list[str] | None = None) -> float:
    """Newest geometry-mutation stamp across the given nodes (all stamped
    nodes when None). 0.0 when nothing is stamped — the box gate treats that
    as 'no mutation since the audit' (restart-safe: an empty stamp log must
    not permanently refuse wiring)."""
    stamps = (_node_mutation_ts.values() if node_ids is None
              else [_node_mutation_ts[i] for i in map(str, node_ids)
                    if i in _node_mutation_ts])
    return max(stamps, default=0.0)


def newest_covering_capture(page: int | None, x: float, y: float) -> dict[str, Any] | None:
    for entry in reversed(_capture_log):
        if page is not None and entry.get("page") not in (None, page):
            continue
        r = entry["region"]
        if (float(r.get("x", 0)) <= x <= float(r.get("x", 0)) + float(r.get("width", 0))
                and float(r.get("y", 0)) <= y <= float(r.get("y", 0)) + float(r.get("height", 0))):
            return entry
    return None


def freshness_verdict(page: int | None, node_id: str | None,
                      x: float, y: float) -> str | None:
    """None = fresh enough; else the WARN text (never a refusal at birth)."""
    look = newest_covering_capture(page, x, y)
    if look is None:
        return (f"see-do: no capture on record covers ({x:.0f},{y:.0f}) — you are "
                "acting on a region you have not looked at (or looked at before "
                "this server started); take a tight covering look")
    if node_id and _node_mutation_ts.get(str(node_id), 0.0) > look["ts"]:
        return (f"see-do: your newest look at ({x:.0f},{y:.0f}) PREDATES this "
                "element's last geometry change — your own mutation staled your "
                "own picture (the zombie-capture class served 10 ops over 79.6 "
                "min); recapture before further geometry")
    if node_id:
        resizes_since = [t for t in _node_resize_ts.get(str(node_id), []) if t > look["ts"]]
        if resizes_since:
            return (f"see-do: {len(resizes_since)} resize(s) of this element since "
                    "your newest covering look — the resize-recapture interlock "
                    "wants an intervening look before the next resize")
    return None


def add_warning(page: int | None, note: str) -> None:
    """Server-side entry into the receipt-warning ledger (deduped like
    canvas-note ingestion) — 4.2 warns ride the same disposition chain."""
    dup = next((w for w in _warning_ledger
                if w.get("page") == page and w.get("note") == note), None)
    if dup is not None:
        dup["count"] = int(dup.get("count") or 1) + 1
        dup["ts"] = time.time()
    else:
        _warning_ledger.append({"page": page, "note": note, "ts": time.time(), "count": 1})


# --- Slate 3.3: three-strike false-positive escalation -----------------------
# 7 CNV40 resizes nudged 2-10px against what Shane later ruled a false
# positive (~100 minutes; 6/7 reused one stale capture). Strikes count
# per NODE, never per (node, flag_id) — the verified churn SWAPPED flags
# between attempts (truncation -> terminal-outside-parent -> terminal-
# interior). A resize "cleared nothing" when the node still carries ANY
# geometry-clearable flag at the next audit. unwired-node is legal
# mid-build and never counts.
GEO_CLEARABLE_RULES = frozenset({
    "bbox-truncation-floor", "box-swallows-enclosures", "terminal-outside-parent",
    "terminal-interior", "terminal-off-border", "box-overlap", "sibling-overlap",
})
_resize_pending: dict[str, bool] = {}
_resize_strikes: dict[str, int] = {}


def note_resize_under_flags(node_id: str, had_geo_flags: bool) -> None:
    if had_geo_flags:
        _resize_pending[str(node_id)] = True


def judge_resize_strike(node_id: str, still_flagged: bool) -> int:
    """Called at audit time for nodes with a pending resize judgment."""
    if not _resize_pending.pop(str(node_id), False):
        return _resize_strikes.get(str(node_id), 0)
    if still_flagged:
        _resize_strikes[str(node_id)] = _resize_strikes.get(str(node_id), 0) + 1
    else:
        _resize_strikes[str(node_id)] = 0
    return _resize_strikes[str(node_id)]


def pending_strike_nodes() -> list[str]:
    return list(_resize_pending.keys())


# --- Slate 3.4: the Shane-delete memorial ------------------------------------
# DIRECT delete targets removed under Shane-attributed authority (never
# cascades — REBUILD-ORDER batches legally re-add cascade victims). An op in a
# LATER batch that re-creates an equivalent entity draws a receipt warning
# quoting the deletion. Evidence: 2.5 minutes after executing Shane's "remove
# the CN40B wire", an auto-continue turn re-added it justified by a fabricated
# diagonal; the same wire recurred across a session boundary as CAB40 sharing
# only endpoint (1574,920).
_delete_memorials: list[dict[str, Any]] = []


def add_delete_memorial(entry: dict[str, Any]) -> None:
    _delete_memorials.append({**entry, "ts": time.time()})
    del _delete_memorials[:-100]


def match_delete_memorial(kind: str, label: str | None, geometry: dict[str, Any]) -> dict[str, Any] | None:
    """Equivalence matcher (slate-tuned): components by label+center, points
    by the 12px port-reuse radius, wires by one endpoint at 12px AND the
    other within 60px (the CAB40 re-add shared only one exact endpoint —
    both-endpoint matching missed the slate's own second evidence case)."""
    def _d(a, b):
        return ((float(a.get("x", 0)) - float(b.get("x", 0))) ** 2
                + (float(a.get("y", 0)) - float(b.get("y", 0))) ** 2) ** 0.5

    for m in reversed(_delete_memorials):
        if m.get("kind") != kind:
            continue
        if kind == "component":
            if (label and str(m.get("label") or "").upper() == str(label).upper()
                    and _d(m.get("center") or {}, geometry.get("center") or {}) <= 40):
                return m
        elif kind == "terminal":
            if _d(m.get("point") or {}, geometry.get("point") or {}) <= 12:
                return m
        elif kind == "wire":
            ma, mb = m.get("a") or {}, m.get("b") or {}
            na, nb = geometry.get("a") or {}, geometry.get("b") or {}
            for x, y in ((na, nb), (nb, na)):
                if (_d(ma, x) <= 12 and _d(mb, y) <= 60) or (_d(mb, x) <= 12 and _d(ma, y) <= 60):
                    return m
    return None


# Slate 6.10: reviewable moot log — flags-as-law's SANCTIONED clearing path,
# but every moot is auditable (anti-laundering). Warning classes without a
# re-verification predicate default to PERSIST.
_warning_dispositions: list[dict[str, Any]] = []
_ELEMENT_ID_RE = re.compile(r"\b(?:node|port|edge|cont)-[0-9a-f][0-9a-f-]{3,}\b")
# Boxless-mint receipts carry coordinates, never an element id — without a
# coord-keyed predicate they were the one warning class that could NEVER moot
# (the 4.6 leg ended holding ~34 of them for LEGITIMATE continuation stubs).
_BOXLESS_MINT_RE = re.compile(
    r"terminal minted at \((-?\d+),(-?\d+)\) has no component box here")
_BOXLESS_MINT_LOOKUP_PX = 6.0
# A completed page keeps its CONT stubs close to their continuation markers —
# measured max 181px across the two complete page-11 legs (sonnet5/opus48,
# 2026-07-06); gold v1.4 has no ~CONT~ stubs at all, so ground/tap stub debt
# (T~G~E sits up to 383px out) stays conservatively unmooted.
_CONT_STUB_MOOT_RADIUS_PX = 200.0


def warning_dispositions() -> list[dict[str, Any]]:
    return list(_warning_dispositions)


def moot_stale_warnings(snap: dict[str, Any] | None) -> int:
    """Slate 6.10 per-audit re-verification: moot ledger entries whose entity
    no longer exists ("reused unparented terminal port-4ad1aeb9" persisted a
    whole segment after the port was deleted — no removal path existed), and
    entries of the unparented-terminal class whose condition no longer
    reproduces (the port is now parented or is a continuation target — the
    13->52 WARN climb was legitimate continuation endpoints minting permanent
    noise). Boxless-mint receipts ("terminal minted at (x,y) has no component
    box here") carry coordinates instead of ids and are re-verified by coord
    lookup: mooted when the stub is gone, parented, a continuation target, a
    junction now, or ~CONT~-declared with a continuation in range (the 4.6-leg
    ~34-warning debt class, 2026-07-06). Other entries with no extractable
    entity PERSIST. Returns moot count."""
    global _warning_ledger
    if not snap:
        return 0
    live_ids = {str(x.get("id")) for coll in ("nodes", "ports", "edges", "continuations")
                for x in (snap.get(coll) or [])}
    ports_by_id = {str(p.get("id")): p for p in snap.get("ports") or []}
    cont_targets = {str((c.get("target") or {}).get("id"))
                    for c in snap.get("continuations") or [] if c.get("target")}
    kept: list[dict[str, Any]] = []
    mooted = 0
    for w in _warning_ledger:
        ids = _ELEMENT_ID_RE.findall(str(w.get("note") or ""))
        verdict: str | None = None
        if ids and not any(i in live_ids for i in ids):
            verdict = "entity-gone (no referenced element exists on re-audit)"
        elif ids and "unparented terminal" in str(w.get("note")):
            hit = next((i for i in ids if i in ports_by_id), None)
            if hit is not None and (ports_by_id[hit].get("parentId") or hit in cont_targets):
                verdict = "condition-cleared (terminal now parented or a continuation target)"
        elif (bm := _BOXLESS_MINT_RE.search(str(w.get("note") or ""))) is not None:
            mx, my = float(bm.group(1)), float(bm.group(2))
            port = None
            best_d = _BOXLESS_MINT_LOOKUP_PX + 1.0
            for p in snap.get("ports") or []:
                pt = p.get("point") or {}
                d = max(abs(float(pt.get("x", 0)) - mx), abs(float(pt.get("y", 0)) - my))
                if d <= _BOXLESS_MINT_LOOKUP_PX and d < best_d:
                    port, best_d = p, d
            if port is None:
                verdict = "entity-gone (no port remains at the minted coordinates)"
            elif (port.get("parentId") or str(port.get("id")) in cont_targets
                  or port.get("type") == "junction"):
                verdict = ("condition-cleared (stub now parented, a continuation "
                           "target, or converted to a junction)")
            elif "~CONT~" in str(port.get("label") or ""):
                ppt = port.get("point") or {}
                if any(
                    (abs(float((c.get("point") or {}).get("x", 0)) - float(ppt.get("x", 0))) ** 2
                     + abs(float((c.get("point") or {}).get("y", 0)) - float(ppt.get("y", 0))) ** 2)
                    ** 0.5 <= _CONT_STUB_MOOT_RADIUS_PX
                    for c in snap.get("continuations") or []
                ):
                    verdict = ("condition-cleared (CONT-declared stub with a continuation "
                               f"within {int(_CONT_STUB_MOOT_RADIUS_PX)}px — legitimate "
                               "off-page stub, boxless by doctrine)")
        if verdict:
            mooted += 1
            _warning_dispositions.append({**w, "disposition": verdict, "mooted_ts": time.time()})
        else:
            kept.append(w)
    _warning_ledger = kept
    return mooted
# Late-joiner replay: canvases that (re)connect within the TTL still receive
# commands issued moments before (e.g. agent highlighted right as HMR reloaded).
# Annotates replay MUCH longer: losing one costs real drawn work, and the canvas
# makes redelivery safe (idempotency keys + content dedupe in v2-bridge-ops).
# Exception: an annotate carrying `clear` keeps the short window — a stale
# replayed clear arriving after fresh drawing would wipe it.
_recent_commands: deque[dict[str, Any]] = deque(maxlen=50)
_REPLAY_TTL_S = 10.0
_ANNOTATE_REPLAY_TTL_S = 600.0


def _replay_ttl(cmd: dict[str, Any]) -> float:
    if cmd.get("type") != "annotate":
        return _REPLAY_TTL_S
    if any(op.get("op") == "clear" for op in cmd.get("ops") or []):
        return _REPLAY_TTL_S
    return _ANNOTATE_REPLAY_TTL_S


def send_commands(commands: list[dict[str, Any]]) -> list[int]:
    """Assign ids and fan commands out. Annotates go only to the elected writer
    (sticky focus-following election); everything else to every connected
    canvas. Returns ids."""
    ids: list[int] = []
    for cmd in commands:
        cid = next(_command_seq)
        payload = {**cmd, "id": cid, "server_ts": time.time()}
        ids.append(cid)
        _recent_commands.append(payload)
        writer_only = cmd.get("type") == "annotate"
        # Annotates follow the SAME election as snapshot pinning — the copilot
        # writes to the surface it reads. Every subscription bearing the
        # writer's id gets the command (a canvas can hold two subscriptions
        # briefly mid-reconnect; client-side id dedupe makes that safe). No
        # elected writer (legacy / not yet posted): newest subscriber, as before.
        if writer_only and _writer_id is not None:
            targets = [s for s in _subscribers if s.get("canvas_id") == _writer_id] or _subscribers[-1:]
        elif writer_only:
            targets = _subscribers[-1:]
        else:
            targets = _subscribers
        for sub in list(targets):
            q = sub["q"]
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                # Slow consumer: drop oldest to keep the stream live.
                try:
                    q.get_nowait()
                    q.put_nowait(payload)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass
    return ids


def subscribe(last_seen_id: int = 0,
              canvas_id: str | None = None) -> tuple[asyncio.Queue[dict[str, Any]], list[dict[str, Any]]]:
    """Register a canvas listener (it becomes the elected annotate writer);
    returns (queue, missed-commands replay). Annotates that already carry an
    apply-receipt are never replayed — redelivering applied work to a different
    canvas would duplicate elements past per-canvas idempotency."""
    q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
    _subscribers.append({"q": q, "canvas_id": str(canvas_id) if canvas_id else None,
                         "since": time.time()})
    # First identified subscriber becomes the writer immediately so annotates
    # have a target before the first post lands (post-restart re-seed comes
    # AFTER the SSE opens). A later subscriber never steals the pin here —
    # takeover is post-driven (focus/liveness) or via unsubscribe fallback.
    if canvas_id and _writer_id is None:
        _set_writer(str(canvas_id))
    now = time.time()
    acked = set(_acked_annotate_keys)
    replay = [
        c for c in _recent_commands
        if c["id"] > last_seen_id
        and now - c["server_ts"] <= _replay_ttl(c)
        and not (c.get("type") == "annotate" and str(c.get("idempotency_key")) in acked)
        # Annotate replay follows the same election as live delivery: a
        # non-writer (zombie reconnect with a stale cursor) must never receive
        # graph-mutating work the writer already executed but hasn't acked yet
        # (review finding: the duplicate-Neon-rows class rides the replay path).
        and not (c.get("type") == "annotate" and _writer_id is not None
                 and (str(canvas_id) if canvas_id else None) != _writer_id)
    ]
    return q, replay


def unsubscribe(q: asyncio.Queue[dict[str, Any]]) -> None:
    for sub in list(_subscribers):
        if sub["q"] is q:
            _subscribers.remove(sub)
    # Writer's last subscription gone: fall back to the remaining identified
    # subscriber with the freshest POST (posting is the liveness evidence — a
    # never-posting subscription may be a frozen tab). Nobody posted recently:
    # clear the pin, so the real canvas's 2s SSE retry reclaims it at
    # subscribe time (review finding: a transient blip on the writer must not
    # hand the pin to a zombie it can never win back from).
    if _writer_id is not None and not _writer_subscribed():
        now = time.time()
        recent = [(float((_posters.get(str(s["canvas_id"])) or {}).get("ts") or 0), str(s["canvas_id"]))
                  for s in _subscribers if s.get("canvas_id")]
        recent = [(ts, cid) for ts, cid in recent if now - ts <= _POSTER_WINDOW_S]
        _set_writer(max(recent)[1] if recent else None)


async def wait_for_annotate_applied(key: str, timeout_s: float) -> dict[str, Any] | None:
    """Block until the canvas acks an annotate command (apply-receipt event
    matched by idempotency key), or return None on timeout. Receipts arrive
    through the ordinary events channel (POST /bridge/state), so they survive
    SSE trouble — the canvas can ack even when the command stream is flaky."""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout_s
    while True:
        for ev in reversed(_events):
            if ev.get("kind") == "annotate_applied" and ev.get("key") == key:
                return ev
        if loop.time() >= deadline:
            return None
        await asyncio.sleep(0.2)


def bridge_stats() -> dict[str, Any]:
    now = time.time()
    posters = active_posters()
    return {
        "snapshot_seq": _snapshot_seq,
        "events_buffered": len(_events),
        "canvases_connected": len(_subscribers),
        "canvas_ids": [s.get("canvas_id") for s in _subscribers],
        "writer_canvas": writer_canvas_id(),
        "snapshot_canvas": _snapshot_canvas,
        "posting_canvases": {cid: {"age_s": round(now - float(p.get("ts") or now), 1),
                                   "page": p.get("page"), "focused": p.get("focused")}
                             for cid, p in posters.items()},
        "snapshot_rejections_recent": len(
            [r for r in _snapshot_rejections if now - float(r.get("ts") or 0) <= 300]),
    }
