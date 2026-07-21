"""Fast-mode toggle (Shane 2026-07-06) — for A/B-ing speed vs the 2x price.

Rides the runtime's fastMode settings key via the SDK settings pass-through:
per-session, panel-controlled, never the project settings file (cold runs
must not inherit a 2x-burn default). Opus-only enforcement is the runtime's
job; the server just plumbs the flag.
"""

from __future__ import annotations

import asyncio
import json


def _session(monkeypatch, tmp_path):
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    s = cp.CopilotSession()
    return s


def test_default_off_and_patch_toggles(monkeypatch, tmp_path):
    s = _session(monkeypatch, tmp_path)
    assert s.settings.get("fast_mode") is False

    async def no_broadcast(msg):
        return None
    monkeypatch.setattr(s, "_broadcast", no_broadcast)

    async def no_shutdown():
        return None
    monkeypatch.setattr(s, "shutdown", no_shutdown)
    asyncio.run(s.set_settings({"fast_mode": True}))
    assert s.settings["fast_mode"] is True
    # persists like every other setting (survives restarts / handoffs)
    from src.canvas_copilot import copilot as cp
    saved = json.loads((tmp_path / "session.json").read_text())
    assert saved["settings"]["fast_mode"] is True


def test_options_pass_fastmode_settings_only_when_on(monkeypatch, tmp_path):
    s = _session(monkeypatch, tmp_path)
    opts_off = s._options()
    assert getattr(opts_off, "settings", None) in (None, "")

    s.settings["fast_mode"] = True
    opts_on = s._options()
    assert json.loads(opts_on.settings) == {"fastMode": True}
    # the rest of the options are unaffected by the flag
    assert opts_on.setting_sources == opts_off.setting_sources
