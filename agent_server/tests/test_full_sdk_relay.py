"""Full-SDK panel (2026-07-07) — the relay stops dropping the stream.

Before this change the panel showed tool CALLS but never their results, no
subagent attribution, no background tasks, no rate-limit transitions, and
approvals were Allow/Deny on raw JSON. These tests pin the widened wire
contract: every SDK message class maps to a panel kind, and the approval
round-trip carries the CLI's context out and Shane's richer verdicts back.
"""

from __future__ import annotations

import asyncio

from claude_agent_sdk import (
    AssistantMessage,
    PermissionResultAllow,
    PermissionResultDeny,
    PermissionUpdate,
    RateLimitEvent,
    ResultMessage,
    SystemMessage,
    TaskNotificationMessage,
    TaskStartedMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from claude_agent_sdk.types import PermissionRuleValue, RateLimitInfo

from src.canvas_copilot.copilot import CopilotSession, _norm_queued


def _session(monkeypatch, tmp_path):
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp, "_SPILL_DIR", tmp_path / "spill")
    s = CopilotSession()
    events: list[dict] = []

    async def record(payload):
        events.append(payload)

    s._broadcast = record  # type: ignore[method-assign]
    return s, events


def _kinds(events):
    return [e["kind"] for e in events]


# --- relay: tool results ------------------------------------------------------

def test_tool_results_reach_the_panel(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    msg = UserMessage(
        content=[ToolResultBlock(tool_use_id="tu-1", is_error=False,
                                 content=[{"type": "text", "text": "42 components"},
                                          {"type": "image", "source": {}}])],
        parent_tool_use_id=None)
    asyncio.run(s._relay(msg))
    assert _kinds(events) == ["tool_result"]
    ev = events[0]
    assert ev["tool_use_id"] == "tu-1" and ev["is_error"] is False
    assert "42 components" in ev["preview"] and ev["images"] == 1


def test_huge_tool_result_spills_and_previews(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    big = "x" * 5000
    msg = UserMessage(content=[ToolResultBlock(tool_use_id="tu-2", content=big)])
    asyncio.run(s._relay(msg))
    ev = events[0]
    assert len(ev["preview"]) <= 401  # 400 + ellipsis
    assert ev.get("preview_path") and (tmp_path / "spill").exists()


def test_plain_string_user_echo_is_not_relayed(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    asyncio.run(s._relay(UserMessage(content="shane's own text")))
    assert events == []  # our own bubbles are broadcast at send time already


# --- relay: subagent attribution ----------------------------------------------

def test_subagent_messages_carry_parent_id_and_model(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    msg = AssistantMessage(
        content=[TextBlock(text="sub says hi"),
                 ToolUseBlock(id="tu-3", name="Grep", input={"pattern": "x"})],
        model="claude-sonnet-5", parent_tool_use_id="task-99")
    asyncio.run(s._relay(msg))
    text_ev = next(e for e in events if e["kind"] == "assistant_text")
    tool_ev = next(e for e in events if e["kind"] == "tool_use")
    assert text_ev["parent_tool_use_id"] == "task-99"
    assert text_ev["model"] == "claude-sonnet-5"
    assert tool_ev["parent_tool_use_id"] == "task-99" and tool_ev["id"] == "tu-3"
    # subagent text must NOT clobber the main thread's last-text telemetry
    assert s._turn_last_text == ""


def test_assistant_error_code_surfaces(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    msg = AssistantMessage(content=[], model="m", error="rate_limit")
    asyncio.run(s._relay(msg))
    assert events and events[0]["kind"] == "error" and events[0]["code"] == "rate_limit"


# --- relay: tasks / rate limits / system events --------------------------------

def test_task_lifecycle_events(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    started = TaskStartedMessage(subtype="task_started", data={}, task_id="t1",
                                 description="verify page", uuid="u1", session_id="s1")
    done = TaskNotificationMessage(subtype="task_notification", data={}, task_id="t1",
                                   status="completed", output_file="/tmp/x",
                                   summary="all good", uuid="u2", session_id="s1")
    asyncio.run(s._relay(started))
    asyncio.run(s._relay(done))
    assert _kinds(events) == ["task", "task"]
    assert events[0]["event"] == "started" and events[0]["description"] == "verify page"
    assert events[1]["event"] == "notification" and events[1]["status"] == "completed"


def test_rate_limit_event(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    ev = RateLimitEvent(rate_limit_info=RateLimitInfo(status="allowed_warning",
                                                      resets_at=1234, utilization=0.9),
                        uuid="u", session_id="s")
    asyncio.run(s._relay(ev))
    assert events[0]["kind"] == "rate_limit"
    assert events[0]["status"] == "allowed_warning" and events[0]["resets_at"] == 1234


def test_non_init_system_message_relays_as_system_event(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    asyncio.run(s._relay(SystemMessage(subtype="compact_boundary", data={"trigger": "auto"})))
    assert events[0]["kind"] == "system_event"
    assert events[0]["subtype"] == "compact_boundary"


def test_init_captures_capabilities(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    asyncio.run(s._relay(SystemMessage(subtype="init", data={
        "session_id": "sess-1", "model": "claude-opus-4-8",
        "tools": ["Read", "Bash"], "slash_commands": ["compact"]})))
    assert s.session_id == "sess-1"
    assert s.last_init and s.last_init["tools"] == ["Read", "Bash"]
    assert "init_info" in _kinds(events)


# --- relay: enriched result -----------------------------------------------------

def test_result_carries_error_forensics(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    msg = ResultMessage(subtype="success", duration_ms=100, duration_api_ms=80,
                        is_error=True, num_turns=3, session_id="s1",
                        stop_reason="max_tokens", total_cost_usd=1.25,
                        usage={"input_tokens": 10, "output_tokens": 5},
                        errors=["boom"], api_error_status=529,
                        model_usage={"claude-opus-4-8": {"outputTokens": 5}})
    asyncio.run(s._relay(msg))
    ev = next(e for e in events if e["kind"] == "result")
    assert ev["ok"] is False  # is_error overrides the success subtype
    assert ev["stop_reason"] == "max_tokens" and ev["api_error_status"] == 529
    assert ev["errors"] == ["boom"] and ev["duration_api_ms"] == 80
    assert ev["model_usage"]  # per-model accounting rides


# --- approvals ------------------------------------------------------------------

class _Ctx:
    """Stand-in for ToolPermissionContext (attribute access only)."""

    def __init__(self, **kw):
        self.suggestions = kw.pop("suggestions", [])
        self.tool_use_id = kw.pop("tool_use_id", "tu-9")
        self.agent_id = None
        self.blocked_path = kw.pop("blocked_path", None)
        self.decision_reason = kw.pop("decision_reason", None)
        self.title = kw.pop("title", None)
        self.display_name = kw.pop("display_name", None)
        self.description = None


def _approve_later(s, events, **answer):
    async def run():
        task = asyncio.create_task(
            s._can_use_tool("Bash", {"command": "git push"}, _Ctx(
                title="Claude wants to run git push",
                suggestions=[PermissionUpdate(
                    type="addRules",
                    rules=[PermissionRuleValue(tool_name="Bash", rule_content="git push:*")],
                    behavior="allow", destination="userSettings")])))
        await asyncio.sleep(0.01)
        req = next(e for e in events if e["kind"] == "approval_request")
        s.resolve_approval(req["id"], **answer)
        return await task, req
    return asyncio.run(run())


def test_approval_card_carries_cli_context(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    result, req = _approve_later(s, events, allow=True)
    assert req["title"] == "Claude wants to run git push"
    assert req["tool_use_id"] == "tu-9"
    assert req["suggestions"] and req["suggestions"][0]["type"] == "addRules"
    assert isinstance(result, PermissionResultAllow)
    assert result.updated_permissions is None  # plain allow persists nothing


def test_always_allow_uses_suggestions_but_forces_session_scope(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    result, _ = _approve_later(s, events, allow=True, always_allow=True)
    assert isinstance(result, PermissionResultAllow)
    ups = result.updated_permissions
    assert ups and ups[0].rules[0].rule_content == "git push:*"
    # A panel click must NEVER write Shane's settings files.
    assert all(u.destination == "session" for u in ups)


def test_allow_with_edited_input(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    result, _ = _approve_later(s, events, allow=True,
                               updated_input={"command": "git push --dry-run"})
    assert isinstance(result, PermissionResultAllow)
    assert result.updated_input == {"command": "git push --dry-run"}


def test_deny_with_reason_and_interrupt(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    result, _ = _approve_later(s, events, allow=False,
                               message="wrong branch — use v9-fix", interrupt=True)
    assert isinstance(result, PermissionResultDeny)
    assert "wrong branch" in result.message and result.interrupt is True


# --- queue + permission mode -----------------------------------------------------

def test_queue_normalizer_and_image_drain_boundary(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    assert _norm_queued("old string") == {"text": "old string"}
    s._queued_messages.append({"text": "plain"})
    s._queued_messages.append({"text": "with pic", "images": [{"data": "abc"}]})
    s._queued_messages.append({"text": "after pic"})
    drained = s.drain_midturn_messages()
    # drain stops at the image-bearing entry — order preserved for the boundary
    assert drained == ["plain"]
    assert len(s._queued_messages) == 2


def test_remove_queued_and_broadcast(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    s._queued_messages.append({"text": "keep"})
    s._queued_messages.append({"text": "cancel me"})
    assert s.remove_queued(1) is True
    assert [q["text"] for q in s._queued_messages] == ["keep"]
    assert s.remove_queued(7) is False


def test_persist_strips_image_bytes(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    s._queued_messages.append({"text": "pic msg", "images": [{"data": "A" * 100_000}]})
    s._persist()
    raw = (tmp_path / "session.json").read_text()
    assert "pic msg" in raw and "A" * 1000 not in raw


def test_set_permission_mode_live_validates_and_persists(monkeypatch, tmp_path):
    s, events = _session(monkeypatch, tmp_path)
    asyncio.run(s.set_permission_mode_live("plan"))
    assert s.settings["permission_mode"] == "plan"
    assert s._options().permission_mode == "plan"
    asyncio.run(s.set_permission_mode_live("nonsense"))
    assert s.settings["permission_mode"] == "plan"  # unchanged
    assert any(e["kind"] == "error" for e in events)


def test_options_default_mode_is_accept_edits(monkeypatch, tmp_path):
    s, _ = _session(monkeypatch, tmp_path)
    assert s._options().permission_mode == "acceptEdits"
