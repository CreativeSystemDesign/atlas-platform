"""Issues panel (Shane's design, 2026-07-07) — the blocked-issues lifecycle.

The copilot runs self-sufficiently; ABSOLUTE blocks park as yes/no issues with
crops on Shane's panel. His answer records mechanically (shane-answered — the
element stays parked/locked until applied); the agent resolves ONLY answered
issues (an unanswered park cannot be self-cleared — the 6.3 laundering channel
stays closed); resolution is journaled and the audit stays the truth.
"""

from __future__ import annotations

import importlib

import src.canvas_copilot.blockers as blockers


def _fresh(monkeypatch, tmp_path):
    importlib.reload(blockers)
    monkeypatch.setattr(blockers, "_TICKET_STATE_FILE", tmp_path / "states.json")
    monkeypatch.setattr(blockers, "_ticket_states", None)
    return blockers


def test_park_carries_issue_fields_and_lists_by_page(monkeypatch, tmp_path):
    b = _fresh(monkeypatch, tmp_path)
    b.park_ticket("ambiguous-enclosure", "node-1", "Is the dashed enclosure one assembly?",
                  "copilot raise_to_shane", page=12, element_label="MMS7",
                  yes_means="box the whole enclosure", no_means="box the switch alone",
                  crop_path="/tmp/x.png")
    b.park_ticket("terminal-off-border", "port-9", "old-style park", "copilot raise_to_shane")
    p12 = b.list_issues(12)
    assert len(p12) == 2  # page-12 issue + the page-less legacy park rides along
    tagged = next(i for i in p12 if i["element_id"] == "node-1")
    assert tagged["page"] == 12 and tagged["element_label"] == "MMS7"
    assert tagged["yes_means"] == "box the whole enclosure"
    # a different page excludes the page-tagged issue but keeps the legacy one
    p7 = b.list_issues(7)
    assert [i["element_id"] for i in p7] == ["port-9"]


def test_answer_then_resolve_lifecycle(monkeypatch, tmp_path):
    b = _fresh(monkeypatch, tmp_path)
    b.park_ticket("r", "node-1", "q?", "copilot", page=12)
    # agent cannot clear an UNANSWERED park
    assert b.resolve_answered("r", "node-1", "copilot") is None
    entry = b.answer_ticket("r", "node-1", "yes", "box it like MMS4", "shane-issues-panel")
    assert entry is not None and entry["state"] == "shane-answered"
    assert entry["answer"]["answer"] == "yes" and "MMS4" in entry["answer"]["note"]
    # answered: still on the Table and blocks done (state reads "parked"),
    # but the GEOMETRY lock releases — his answer authorizes the fix
    # (2026-07-09 CONNECTOR catch-22: the lock refused the authorized apply)
    assert "node-1" not in b.parked_elements()
    assert b._violation_state({"rule": "r", "ids": ["node-1"]}, {}) == "parked"
    # applying resolves: entry removed, journaled, panel list empties
    removed = b.resolve_answered("r", "node-1", "copilot applied")
    assert removed is not None and removed["answer"]["answer"] == "yes"
    assert b.list_issues(12) == []
    assert "node-1" not in b.parked_elements()
    journal = [k for k in b._states() if k.startswith("resolved:")]
    assert len(journal) == 1


def test_answer_unknown_issue_is_refused(monkeypatch, tmp_path):
    b = _fresh(monkeypatch, tmp_path)
    assert b.answer_ticket("r", "ghost", "yes", "", "shane-issues-panel") is None


def test_answer_is_idempotent_and_overwritable(monkeypatch, tmp_path):
    b = _fresh(monkeypatch, tmp_path)
    b.park_ticket("r", "node-1", "q?", "copilot", page=3)
    b.answer_ticket("r", "node-1", "yes", "", "shane-issues-panel")
    # Shane changes his mind before the agent applies — the answer updates
    entry = b.answer_ticket("r", "node-1", "no", "actually leave it", "shane-issues-panel")
    assert entry is not None and entry["answer"]["answer"] == "no"
    assert b.list_issues(3)[0]["answer"]["note"] == "actually leave it"
