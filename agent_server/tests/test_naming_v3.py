"""Naming v3 (Shane-ruled 2026-07-07): T~<owner>~[<pin>~]<net>.

Ruling verbatim: "T-CT50-K-S500 is the right convention. i made a mistake
in my earlier correction" — first slot is the OWNER (parent component's
printed designator; pseudo-owners CONT/TAP/G for unparented stubs), pin
slot only where the print shows one, SPARE in the net slot for unwired
spare pins. Tilde separator kept from v2 (printed pins contain -/+).
"""

from __future__ import annotations

import importlib.util
import pathlib

from src.canvas_copilot.audit import (NAME_RE, fabricated_name_tokens,
                                      terminal_name_ok)

_spec = importlib.util.spec_from_file_location(
    "naming_v3_migrate",
    pathlib.Path(__file__).resolve().parents[2] / "scripts" / "naming-v3-migrate.py")
_mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mig)


def test_v3_full_and_short_forms_are_legal():
    assert terminal_name_ok("T~CT50~K~S500")      # Shane's example, tilde form
    assert terminal_name_ok("T~ELB53~R503")       # pin-less short form
    assert terminal_name_ok("T~TB50~7~SPARE")     # unwired spare pin
    assert terminal_name_ok("T~CONT~R1")          # pseudo-owner stub (unchanged)
    assert terminal_name_ok("T~K~S500")           # legacy v2 stays legal in migration


def test_malformed_shapes_still_flag():
    assert not terminal_name_ok("T~CT50~K~S500~X")  # too many segments
    assert not terminal_name_ok("T~~R503")          # empty owner
    assert not terminal_name_ok("CT50-K-S500")      # no T prefix
    assert not NAME_RE.match("T~CT50~")             # empty net


def test_fabricated_tokens_checked_across_all_v3_segments():
    # invented lowercase run in the pin slot of a FULL v3 name
    assert fabricated_name_tokens("T~CT50~junction~S500") == ["junction"]
    # owner designators and printed pins pass
    assert fabricated_name_tokens("T~CT50~K~S500") == []
    # SPARE is controlled vocabulary, not a placeholder
    assert fabricated_name_tokens("T~TB50~7~SPARE") == []


def _graph(ports, nodes=None):
    return {"nodes": nodes or [{"id": "n1", "label": "ELB50"}],
            "ports": ports, "edges": [], "continuations": []}


def test_migrate_pin_class_inserts_owner():
    g, renames = _mig.migrate(_graph(
        [{"id": "p1", "type": "terminal", "parentId": "n1", "label": "T~K~S500"}]))
    assert renames == [("T~K~S500", "T~ELB50~K~S500")]


def test_migrate_repeat_class_collapses():
    g, renames = _mig.migrate(_graph(
        [{"id": "p1", "type": "terminal", "parentId": "n1", "label": "T~R1~R1"}]))
    assert renames == [("T~R1~R1", "T~ELB50~R1")]


def test_migrate_already_owner_form_unchanged():
    g, renames = _mig.migrate(_graph(
        [{"id": "p1", "type": "terminal", "parentId": "n1", "label": "T~ELB50~R1"}]))
    assert renames == []


def test_migrate_leaves_stubs_and_junctions_alone():
    g, renames = _mig.migrate(_graph(
        [{"id": "p1", "type": "terminal", "parentId": None, "label": "T~CONT~R1"},
         {"id": "p2", "type": "junction", "parentId": "n1", "label": "J-3"},
         {"id": "p3", "type": "terminal", "parentId": "n1", "label": "T~ELB50~K~R1"}]))
    assert renames == []


def test_migrate_is_idempotent():
    ports = [{"id": "p1", "type": "terminal", "parentId": "n1", "label": "T~K~S500"}]
    g, r1 = _mig.migrate(_graph(ports))
    g, r2 = _mig.migrate(g)
    assert r1 and not r2
