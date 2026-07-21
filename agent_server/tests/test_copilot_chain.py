"""Chain mechanics: message queueing, autonomous gate, error-result retry.

All from 2026-07-05 field events: Shane's mid-run corrections bounced off the
busy chain (intervention gap), his one-off WIPE command triggered the chain,
and four chains died on instant error_during_execution results.
"""

from __future__ import annotations

import asyncio

import pytest

from src.canvas_copilot.copilot import CopilotSession


class Harness:
    """CopilotSession with the SDK turn replaced by a scripted recorder."""

    def __init__(self, session: CopilotSession, script=None):
        self.session = session
        self.turns: list[str] = []
        self.events: list[dict] = []
        self.gate: asyncio.Event | None = None
        self._script = list(script or [])
        session._broadcast = self._broadcast  # type: ignore[method-assign]
        session._context_block = lambda: ""  # type: ignore[method-assign]
        session._run_turn = self._run_turn  # type: ignore[method-assign]
        session.shutdown = self._shutdown  # type: ignore[method-assign]
        # 6.7 made handle_user_message persist at cycle end — the harness must
        # never write test-mutated state into the REAL session file.
        session._persist = lambda: None  # type: ignore[method-assign]

    async def _broadcast(self, payload):
        self.events.append(payload)

    async def _shutdown(self):
        pass

    async def _run_turn(self, full_text: str) -> None:
        self.turns.append(full_text)
        s = self.session
        s._turn_tool_calls = 1
        s._turn_errored = False
        s._turn_result_error = False
        if self._script:
            step = self._script.pop(0)
            s._turn_tool_calls = step.get("tool_calls", 1)
            s._turn_result_error = step.get("result_error", False)
        else:
            s._turn_tool_calls = 0  # default: talk-only, chain ends
        if self.gate is not None:
            await self.gate.wait()


def make(script=None, autonomous=False):
    s = CopilotSession()
    s.settings["autonomous"] = autonomous
    s._queued_messages.clear()
    s._pending_reset = None
    s._CHAIN_RETRY_BACKOFF_S = (0.0,)  # slate 6.8 backoff zeroed for test speed
    return Harness(s, script)


def test_message_while_busy_queues_and_injects():
    async def run():
        h = make(script=[{"tool_calls": 1}, {"tool_calls": 0}])
        h.gate = asyncio.Event()
        t = asyncio.create_task(h.session.handle_user_message("first"))
        await asyncio.sleep(0.01)  # first turn is now blocked on the gate
        await h.session.handle_user_message("correction from Shane")
        # Full-SDK panel (2026-07-07): live queue entries are {text, images?}.
        assert [q["text"] for q in h.session._queued_messages] == ["correction from Shane"]
        queued_notes = [e for e in h.events if "queued" in str(e.get("note", ""))]
        assert queued_notes, "panel must be told the message queued"
        h.gate.set()
        await asyncio.wait_for(t, 5)
        await asyncio.sleep(0.05)  # allow post-lock drain task, if any
        assert any(t.startswith("correction from Shane") for t in h.turns)
        assert not h.session._queued_messages

    asyncio.run(run())


def test_one_off_command_does_not_chain_when_autonomous_off():
    async def run():
        h = make(script=[{"tool_calls": 5}], autonomous=False)
        await asyncio.wait_for(h.session.handle_user_message("wipe page 10"), 5)
        assert len(h.turns) == 1, "no auto-continue without the autonomous flag"

    asyncio.run(run())


def test_autonomous_chains_until_talk_only():
    async def run():
        h = make(script=[{"tool_calls": 3}, {"tool_calls": 2}, {"tool_calls": 0}], autonomous=True)
        await asyncio.wait_for(h.session.handle_user_message("annotate page 10"), 5)
        assert len(h.turns) == 3
        # Slate 6.1: the tick self-identifies as machine — never a bare
        # "continue" that agents can cite as Shane's consent.
        assert h.turns[1].startswith("[AUTO-CONTINUE — harness, not Shane")
        assert "authorizes nothing" in h.turns[1]

    asyncio.run(run())


def test_error_result_retries_then_recovers():
    async def run():
        h = make(
            script=[
                {"tool_calls": 4},                 # healthy turn
                {"tool_calls": 0, "result_error": True},   # instant chain-stall
                {"tool_calls": 2},                 # retry succeeds
                {"tool_calls": 0},                 # natural end
            ],
            autonomous=True,
        )
        await asyncio.wait_for(h.session.handle_user_message("annotate page 10"), 5)
        assert len(h.turns) == 4, "the errored continue must be retried, not fatal"
        retry_notes = [e for e in h.events if "retrying" in str(e.get("note", ""))]
        assert retry_notes

    asyncio.run(run())


def test_error_result_gives_up_after_retries():
    async def run():
        h = make(
            script=[{"tool_calls": 4}] + [{"tool_calls": 0, "result_error": True}] * 5,
            autonomous=True,
        )
        await asyncio.wait_for(h.session.handle_user_message("annotate page 10"), 5)
        # initial + first errored continue + 2 retries = 4 turns, then break
        assert len(h.turns) == 4

    asyncio.run(run())


def test_done_gate_refuses_done_claim_with_open_blockers():
    async def run():
        # turn 1 does work; turn 2 is talk-only ("done") with blockers open;
        # turn 3 fixes; turn 4 talk-only with a CLEAN queue -> chain ends.
        h = make(
            script=[{"tool_calls": 3}, {"tool_calls": 0}, {"tool_calls": 2}, {"tool_calls": 0}],
            autonomous=True,
        )
        gates = iter(["[DONE-GATE] refused", None])

        async def fake_gate():
            return next(gates)

        h.session._done_gate_check = fake_gate  # type: ignore[method-assign]
        await asyncio.wait_for(h.session.handle_user_message("annotate page 10"), 5)
        assert len(h.turns) == 4
        assert h.turns[2].startswith("[DONE-GATE] refused")

    asyncio.run(run())


def test_done_gate_surfaces_to_shane_after_max_refusals():
    async def run():
        h = make(script=[{"tool_calls": 2}] + [{"tool_calls": 0}] * 6, autonomous=True)

        async def always_refuse():
            return "[DONE-GATE] refused"

        h.session._done_gate_check = always_refuse  # type: ignore[method-assign]
        await asyncio.wait_for(h.session.handle_user_message("annotate page 10"), 5)
        # initial(work) + auto-continue + 2 refusal turns, then break to Shane
        assert len(h.turns) == 4

    asyncio.run(run())


def test_done_gate_not_applied_outside_autonomous():
    async def run():
        h = make(script=[{"tool_calls": 0}], autonomous=False)
        called = []

        async def fake_gate():
            called.append(1)
            return "[DONE-GATE] refused"

        h.session._done_gate_check = fake_gate  # type: ignore[method-assign]
        await asyncio.wait_for(h.session.handle_user_message("quick question"), 5)
        assert len(h.turns) == 1 and not called

    asyncio.run(run())


def test_message_arriving_during_final_turn_still_processes():
    async def run():
        h = make(script=[{"tool_calls": 0}, {"tool_calls": 0}])
        h.gate = asyncio.Event()
        t = asyncio.create_task(h.session.handle_user_message("first"))
        await asyncio.sleep(0.01)
        await h.session.handle_user_message("late message")
        h.gate.set()
        await asyncio.wait_for(t, 5)
        await asyncio.sleep(0.05)  # drain task
        assert any(x.startswith("late message") for x in h.turns)

    asyncio.run(run())


def test_ingress_journaled_at_arrival_and_on_queue_paths():
    """Slate 6.4: every inbound message broadcasts an ingress frame at arrival;
    queued injections carry source=queue on the visible user frame."""
    async def run():
        h = make(script=[{"tool_calls": 1}, {"tool_calls": 0}], autonomous=False)
        h.gate = asyncio.Event()
        t = asyncio.create_task(h.session.handle_user_message("first"))
        await asyncio.sleep(0.01)
        await h.session.handle_user_message("second while busy")
        h.gate.set()
        await asyncio.wait_for(t, 5)
        await asyncio.sleep(0.05)

        ingress = [e for e in h.events if e.get("kind") == "ingress"]
        assert [e["text"] for e in ingress] == ["first", "second while busy"]
        assert all(e.get("source") == "panel" for e in ingress)
        queued_user = [e for e in h.events
                       if e.get("kind") == "user" and e.get("source") == "queue"]
        assert queued_user and queued_user[0]["text"].startswith("second while busy")

    asyncio.run(run())


def test_done_gate_latch_stops_refire_on_unchanged_state():
    """Slate 6.2: an unchanged blocker set with zero intervening ops is refused
    ONCE, then surfaced to Shane — never the 21x refire loop."""
    async def run():
        h = make(script=[{"tool_calls": 2}] + [{"tool_calls": 0}] * 6, autonomous=True)

        async def always_refuse():
            return "[DONE-GATE] refused"

        async def fixed_sig():
            return "ticketA|ticketB"

        h.session._done_gate_check = always_refuse  # type: ignore[method-assign]
        h.session._gate_state_sig = fixed_sig  # type: ignore[method-assign]
        await asyncio.wait_for(h.session.handle_user_message("annotate page 10"), 5)
        # work + auto-continue + ONE refusal, then latch breaks to Shane
        assert len(h.turns) == 3
        latched = [e for e in h.events
                   if "already refused once" in str(e.get("note", ""))]
        assert latched

    asyncio.run(run())


def test_done_claim_shadow_detector():
    from src.canvas_copilot.copilot import _detect_done_claim as d

    assert d("The page is complete — all components wired.")
    assert d("Everything finished; nothing left to do.")
    assert not d("Not a done claim on my part — just waiting on you.")
    assert not d("I won't claim done while blockers are open.")
    assert not d("Stopped. Standing by.")
    assert not d("Waiting for your call before any done claim.")
    assert d("MS349 wired. Page 10 annotation is now finished.")


def test_stop_message_preempts_and_reenters():
    """Slate 6.5: stop-class messages interrupt at the next boundary and then
    run as a fresh exchange; non-leading 'stop' does not cancel."""
    from src.canvas_copilot.copilot import _is_stop_message as s

    assert s("stop") and s("stop now") and s("now sstop") and s("please stop")
    assert not s("i need you to stop and follow my directions")
    assert not s("nonstop work ahead")

    async def run():
        h = make(script=[{"tool_calls": 1}, {"tool_calls": 0}], autonomous=False)
        h.gate = asyncio.Event()
        t = asyncio.create_task(h.session.handle_user_message("first"))
        await asyncio.sleep(0.01)
        await h.session.handle_user_message("stop now")
        assert h.session._stop_requested is True
        h.gate.set()
        await asyncio.wait_for(t, 5)
        await asyncio.sleep(0.05)
        # the stop message re-entered as its own turn via the post-lock drain
        assert any(turn.startswith("stop now") for turn in h.turns)

    asyncio.run(run())


def test_midturn_drain_labels_and_empties_queue():
    """Slate 6.5: non-stop queued messages drain into tool results mid-turn,
    tagged source=mid-turn; a pending stop freezes the drain."""
    async def run():
        h = make(script=[{"tool_calls": 1}], autonomous=False)
        h.session._queued_messages.append("those are terminal")
        msgs = h.session.drain_midturn_messages()
        assert msgs == ["those are terminal"]
        assert not h.session._queued_messages
        assert h.session._history[-1] == {
            "kind": "user", "text": "those are terminal", "source": "mid-turn"}

        h.session._queued_messages.append("stop")
        h.session._stop_requested = True
        assert h.session.drain_midturn_messages() == []
        assert len(h.session._queued_messages) == 1  # left for the post-lock drain

    asyncio.run(run())


def test_scoped_ask_pauses_the_chain_even_in_autonomous(monkeypatch):
    """Confirm-before-act belongs to the MARK, not a mode (Shane, 2026-07-08).
    A scoped ask runs ONE turn (tool work and all), then the chain STOPS and
    waits for Shane — even with autonomous ON (a mark pauses a live run)."""
    async def run():
        h = make(script=[{"tool_calls": 5}, {"tool_calls": 4}], autonomous=True)
        await asyncio.wait_for(
            h.session.handle_user_message("[SCOPED ASK] fix the marked area", scoped_ask=True), 5)
        assert len(h.turns) == 1  # no auto-continue tick fired; the mark paused it
        assert h.session._scoped_confirm_pending is True  # gate armed for the edit refusal
        notes = [e.get("note", "") for e in h.events if e.get("kind") == "status"]
        assert any("scoped ask" in n for n in notes)
        assert h.session.settings["autonomous"] is True  # mode untouched

    asyncio.run(run())


def test_shane_reply_disarms_gate_and_resumes():
    """Shane's own (non-scoped) message = his go: it disarms the confirm gate
    so the copilot may act. His queued words always deliver at the boundary."""
    async def run():
        h = make(script=[{"tool_calls": 2}, {"tool_calls": 1}], autonomous=False)
        await asyncio.wait_for(
            h.session.handle_user_message("[SCOPED ASK] box CT10", scoped_ask=True), 5)
        assert h.session._scoped_confirm_pending is True
        await asyncio.wait_for(h.session.handle_user_message("yes, go"), 5)
        assert h.session._scoped_confirm_pending is False  # his reply lifted it
        assert "yes, go" in h.turns[-1]

    asyncio.run(run())


def test_collaborative_is_one_turn_then_wait():
    """Collaborative mode == autonomous OFF: one turn per message, then wait
    (the historical default; the redundant 'collaborative' flag was retired)."""
    async def run():
        h = make(script=[{"tool_calls": 3}, {"tool_calls": 2}], autonomous=False)
        await asyncio.wait_for(h.session.handle_user_message("audit this page"), 5)
        assert len(h.turns) == 1  # no auto-continue when autonomous is off

    asyncio.run(run())
