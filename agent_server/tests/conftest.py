"""Test isolation from LIVE copilot state (2026-07-06).

The conscience persists real state under .atlas/ (session file, ticket
states — including the live PAGE 10 GOLD-MASTER SEAL). Tests must neither
read that state (the live page-10 lock would refuse every test annotate on
page 10) nor write to it (a chain-test run once flipped the live autonomous
flag). Every test gets throwaway state files and a clean in-memory cache;
tests that need specific state set it explicitly.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _isolate_live_state(tmp_path, monkeypatch):
    from src.canvas_copilot import blockers

    monkeypatch.setattr(blockers, "_TICKET_STATE_FILE", tmp_path / "ticket-states.json")
    monkeypatch.setattr(blockers, "_ticket_states", None)
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "copilot-session.json")
    # The SINGLETON was constructed at import from the REAL session file —
    # whatever gate state the live copilot last persisted (needs_audit,
    # bound_page...) would leak into every annotate-path test. Normalize to
    # neutral; tests that exercise a gate arm it explicitly.
    monkeypatch.setattr(cp.copilot_session, "needs_audit", False)
    monkeypatch.setattr(cp.copilot_session, "unaudited_ops", 0)
    monkeypatch.setattr(cp.copilot_session, "bound_page", None)
    monkeypatch.setattr(cp.copilot_session, "_geo_batch_used", False)
    monkeypatch.setitem(cp.copilot_session.settings, "guided", False)
    yield
