"""Slate 6.9 — the phantom-200k context meter.

Root cause: get_context_usage() reports maxTokens=200000 unaware of the
shipped 1M beta. The verbatim phantom "ctx=219k/200k — over the ceiling"
self-terminated three healthy sessions in 8.5 minutes (each a $2-3 dedicated
reset turn) while execution ran fine past 219k. The correction is keyed to
the long_context toggle plus either the empirically-confirmed model family
or the crossing proof (total past the reported max is impossible under a
truthful max) — never a blind bump, which would kill the nudges on a genuine
200k model (the Haiku arm-6 lesson, '81% with the nudge mathematically
unable to fire').
"""

from __future__ import annotations

import asyncio

from src.canvas_copilot.copilot import CopilotSession, _ctx_nudge


class _StubClient:
    def __init__(self, total, mx, pct=0.0):
        self._usage = {"totalTokens": total, "maxTokens": mx, "percentage": pct}

    async def get_context_usage(self):
        return self._usage


def _session(monkeypatch, tmp_path, model=None):
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    s = CopilotSession()
    s.settings["model"] = model
    return s


def test_sonnet_meter_corrects_the_phantom(monkeypatch, tmp_path):
    s = _session(monkeypatch, tmp_path, model="claude-sonnet-5")
    asyncio.run(s._refresh_context_meter(_StubClient(219_000, 200_000, 109.5)))
    assert s.last_context["max"] == 1_000_000
    assert s.last_context["pct"] == 21.9
    # the corrected meter no longer panics: 219k/1000k is below the soft line
    assert "HARD LIMIT" not in _ctx_nudge(s.last_context)
    assert "plan a reset" not in _ctx_nudge(s.last_context)


def test_unconfirmed_model_keeps_sdk_max_until_crossing(monkeypatch, tmp_path):
    s = _session(monkeypatch, tmp_path, model="claude-haiku-4-5")
    asyncio.run(s._refresh_context_meter(_StubClient(150_000, 200_000)))
    assert s.last_context["max"] == 200_000  # genuine 200k window: nudges stay live
    assert "HARD LIMIT" in _ctx_nudge({"total": 160_000, "max": 200_000, "pct": 80.0})
    # crossing proof: total past the reported max means the report lied
    asyncio.run(s._refresh_context_meter(_StubClient(219_000, 200_000)))
    assert s.last_context["max"] == 1_000_000
    # and the proof is STICKY for the session (compaction may shrink total)
    asyncio.run(s._refresh_context_meter(_StubClient(150_000, 200_000)))
    assert s.last_context["max"] == 1_000_000


def test_toggle_off_governs_only_the_speculative_path(monkeypatch, tmp_path):
    # Shane 2026-07-08: "Opus 4.8 in this app will always presume the window
    # is 1M" — a CONFIRMED family is corrected unconditionally; the toggle
    # can never demote it back to the SDK's phantom 200k.
    s = _session(monkeypatch, tmp_path, model="claude-sonnet-5")
    s.settings["long_context"] = False
    asyncio.run(s._refresh_context_meter(_StubClient(219_000, 200_000)))
    assert s.last_context["max"] == 1_000_000
    # For an UNKNOWN model the toggle governs the crossing-proof path: off,
    # the SDK's number stands even when total sails past it.
    u = _session(monkeypatch, tmp_path, model="mystery-lab-model")
    u.settings["long_context"] = False
    asyncio.run(u._refresh_context_meter(_StubClient(219_000, 200_000)))
    assert u.last_context["max"] == 200_000


def test_crossing_proof_dies_with_the_session(monkeypatch, tmp_path):
    s = _session(monkeypatch, tmp_path, model="claude-haiku-4-5")
    asyncio.run(s._refresh_context_meter(_StubClient(219_000, 200_000)))
    assert s._ctx_beta_confirmed
    s._pending_reset = "note"
    s._take_reset_prompt()
    assert not s._ctx_beta_confirmed


# --- 6.9 handoff composer: queued Shane instructions ride as ITEM 1 ---------

def test_queued_messages_fold_into_handoff_as_item_1(monkeypatch, tmp_path):
    s = _session(monkeypatch, tmp_path)
    s._pending_reset = "[SESSION HANDOFF] the note"
    s._queued_messages.append("shane: fix CON42 first")
    s._queued_messages.append("then look at M40")
    prompt = s._take_reset_prompt()
    assert prompt.index("QUEUED SHANE INSTRUCTIONS") < prompt.index("the note")
    assert "- shane: fix CON42 first" in prompt and "- then look at M40" in prompt
    assert "ITEM 1" in prompt
    assert not s._queued_messages and s._pending_reset is None


def test_ctx_band_note_fires_only_past_hard_line(monkeypatch):
    from src.canvas_copilot import tools
    from src.canvas_copilot.copilot import copilot_session

    monkeypatch.setattr(copilot_session, "last_context",
                        {"total": 800_000, "max": 1_000_000, "pct": 80.0})
    notes = tools._ctx_band_note()
    assert notes and "HARD context line" in notes[0] and "ctx=800k/1000k" in notes[0]
    monkeypatch.setattr(copilot_session, "last_context",
                        {"total": 300_000, "max": 1_000_000, "pct": 30.0})
    assert tools._ctx_band_note() == []
