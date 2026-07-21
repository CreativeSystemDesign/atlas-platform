"""Boxless-mint receipt debt — coord-keyed re-verification (2026-07-06).

Evidence: the Sonnet-4.6 page-11 leg ended holding ~34 undisposed
"terminal minted at (x,y) has no component box here" warnings for
LEGITIMATE continuation stubs. The note carries coordinates, never an
element id, so slate 6.10's moot pass could not re-verify it — the one
warning class with no clearing path. Calibration: complete page-11 legs
(sonnet5/opus48) keep every ~CONT~ stub within 181px of a continuation;
gold v1.4 has NO ~CONT~ stubs and its ground stubs (T~G~E) sit up to
383px from any continuation — ground/tap debt must stay unmooted.
"""

from __future__ import annotations

from src.canvas_copilot import bridge

NOTE = "warning: terminal minted at (363,1518) has no component box here — box first?"


def _fresh_ledger(monkeypatch):
    monkeypatch.setattr(bridge, "_warning_ledger", [])
    monkeypatch.setattr(bridge, "_warning_dispositions", [])


def _ack(page, notes):
    bridge.put_state(None, [{"kind": "annotate_applied", "key": f"k-{notes[0][:12]}",
                             "page": page, "notes": notes}])


def _snap(ports=(), continuations=()):
    return {"nodes": [], "edges": [], "ports": list(ports),
            "continuations": list(continuations)}


def _stub(label, x=363, y=1518, parent=None, ptype="terminal"):
    return {"id": "port-abcd1234", "type": ptype, "parentId": parent,
            "label": label, "point": {"x": x, "y": y}}


def test_stub_deleted_moots_as_entity_gone(monkeypatch):
    _fresh_ledger(monkeypatch)
    _ack(11, [NOTE])
    assert bridge.moot_stale_warnings(_snap()) == 1
    assert "entity-gone" in bridge.warning_dispositions()[0]["disposition"]


def test_stub_later_parented_moots(monkeypatch):
    _fresh_ledger(monkeypatch)
    _ack(11, [NOTE])
    assert bridge.moot_stale_warnings(_snap([_stub("T-96", parent="node-x")])) == 1
    assert "condition-cleared" in bridge.warning_dispositions()[0]["disposition"]


def test_stub_converted_to_junction_moots(monkeypatch):
    _fresh_ledger(monkeypatch)
    _ack(11, [NOTE])
    assert bridge.moot_stale_warnings(_snap([_stub("J-3", ptype="junction")])) == 1


def test_cont_declared_stub_near_continuation_moots(monkeypatch):
    _fresh_ledger(monkeypatch)
    _ack(11, [NOTE])
    snap = _snap([_stub("T~CONT~T1")],
                 [{"id": "cont-1", "point": {"x": 363 + 150, "y": 1518}}])
    assert bridge.moot_stale_warnings(snap) == 1
    assert "CONT-declared" in bridge.warning_dispositions()[0]["disposition"]


def test_cont_declared_stub_with_no_continuation_in_range_persists(monkeypatch):
    # Accountability: declaring ~CONT~ is not enough — the continuation must
    # actually exist within range at re-verification (done-time debt is real
    # until the marker is drawn).
    _fresh_ledger(monkeypatch)
    _ack(11, [NOTE])
    snap = _snap([_stub("T~CONT~T1")],
                 [{"id": "cont-1", "point": {"x": 363 + 500, "y": 1518}}])
    assert bridge.moot_stale_warnings(snap) == 0
    assert len(bridge.warning_ledger()) == 1


def test_undeclared_auto_named_stub_persists(monkeypatch):
    # A stub still wearing its auto-name (never renamed, never boxed) is the
    # exact accident class the mint warning exists for.
    _fresh_ledger(monkeypatch)
    _ack(11, [NOTE])
    snap = _snap([_stub("T-96")],
                 [{"id": "cont-1", "point": {"x": 363, "y": 1518}}])
    assert bridge.moot_stale_warnings(snap) == 0


def test_gold_style_ground_stub_stays_unmooted(monkeypatch):
    # Gold-conservatism floor: gold v1.4 ground stubs (T~G~E) are boxless and
    # far from continuations by design — the CONT-scoped moot must NOT swallow
    # their debt class (only Shane's disposition or a real fix clears them).
    _fresh_ledger(monkeypatch)
    _ack(11, [NOTE])
    snap = _snap([_stub("T~G~E")],
                 [{"id": "cont-1", "point": {"x": 363 + 50, "y": 1518}}])
    assert bridge.moot_stale_warnings(snap) == 0
    assert len(bridge.warning_ledger()) == 1


def test_lookup_tolerance_is_tight(monkeypatch):
    # A port 20px away is NOT the minted stub — the entry moots as
    # entity-gone rather than binding to an unrelated nearby terminal.
    _fresh_ledger(monkeypatch)
    _ack(11, [NOTE])
    snap = _snap([_stub("T~CONT~T1", x=383)],
                 [{"id": "cont-1", "point": {"x": 383, "y": 1518}}])
    n = bridge.moot_stale_warnings(snap)
    assert n == 1
    assert "entity-gone" in bridge.warning_dispositions()[0]["disposition"]
