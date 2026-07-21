"""Multi-canvas hardening (2026-07-12, after the page-13 desync).

Two live canvases alternately overwriting the one global snapshot made the
copilot's page state flip-flop. The fix: every canvas mount mints an id;
snapshots are pinned to a STICKY, FOCUS-FOLLOWING elected writer (the same
canvas annotates go to); rejected posters are ledgered + toasted; counts are
surfaced in stats/[canvas now].

Election rules under test: first identified subscriber takes the pin; a later
subscriber NEVER steals it by subscribing (a frozen tab's browser-native SSE
reconnect re-subscribes without running JS — newest-wins would hand the pin
to a zombie); takeover happens only via a focused=true post, writer liveness
expiry, or the writer's last subscription disappearing.
"""

from collections import deque

import pytest

from src.canvas_copilot import bridge


@pytest.fixture(autouse=True)
def _reset_bridge(monkeypatch):
    monkeypatch.setattr(bridge, "_subscribers", [])
    monkeypatch.setattr(bridge, "_posters", {})
    monkeypatch.setattr(bridge, "_writer_id", None)
    monkeypatch.setattr(bridge, "_writer_elected_ts", 0.0)
    monkeypatch.setattr(bridge, "_snapshot", {})
    monkeypatch.setattr(bridge, "_snapshot_seq", 0)
    monkeypatch.setattr(bridge, "_snapshot_at", 0.0)
    monkeypatch.setattr(bridge, "_snapshot_canvas", None)
    monkeypatch.setattr(bridge, "_snapshot_rejections", deque(maxlen=50))
    monkeypatch.setattr(bridge, "_last_dup_toast_ts", 0.0)
    monkeypatch.setattr(bridge, "_recent_commands", deque(maxlen=50))
    monkeypatch.setattr(bridge, "_events", deque(maxlen=300))


def test_first_identified_subscriber_holds_the_pin_against_later_subscribers():
    bridge.subscribe(0, canvas_id="cv-live")
    assert bridge.writer_canvas_id() == "cv-live"
    bridge.subscribe(0, canvas_id="cv-dup")  # a duplicate opening never steals
    assert bridge.writer_canvas_id() == "cv-live"

    live = bridge.put_state({"page": 13}, [], canvas_id="cv-live")
    assert live["snapshot_accepted"] is True
    dup = bridge.put_state({"page": 7}, [], canvas_id="cv-dup")
    assert dup["snapshot_accepted"] is False
    assert bridge.get_state()["snapshot"] == {"page": 13}  # never flips back


def test_focused_post_takes_the_pin():
    bridge.subscribe(0, canvas_id="cv-a")
    bridge.subscribe(0, canvas_id="cv-b")
    assert bridge.writer_canvas_id() == "cv-a"
    # Shane focuses canvas B: its next post carries focused=true and wins.
    res = bridge.put_state({"page": 13}, [], canvas_id="cv-b", focused=True)
    assert res["snapshot_accepted"] is True
    assert bridge.writer_canvas_id() == "cv-b"
    # A's unfocused posts are now the rejected ones.
    assert bridge.put_state({"page": 7}, [], canvas_id="cv-a")["snapshot_accepted"] is False
    assert bridge.get_state()["snapshot"] == {"page": 13}


def test_zombie_reconnect_of_another_canvas_never_steals_the_pin():
    qa, _ = bridge.subscribe(0, canvas_id="cv-live")
    bridge.put_state({"page": 13}, [], canvas_id="cv-live", focused=True)
    # A frozen duplicate's browser-native SSE retry re-subscribes (no JS runs,
    # so it never posts). Under newest-wins it would steal the pin; not here.
    bridge.subscribe(0, canvas_id="cv-zombie")
    assert bridge.writer_canvas_id() == "cv-live"
    assert bridge.put_state({"page": 13}, [], canvas_id="cv-live")["snapshot_accepted"] is True


def test_liveness_takeover_when_writer_goes_silent(monkeypatch):
    bridge.subscribe(0, canvas_id="cv-old")
    bridge.subscribe(0, canvas_id="cv-new")
    bridge.put_state({"page": 7}, [], canvas_id="cv-old")
    assert bridge.writer_canvas_id() == "cv-old"
    # The writer's last post ages past the window; an unfocused poster may
    # then take over (the old tab is dead/frozen, the new one is alive).
    bridge._posters["cv-old"]["ts"] -= bridge._POSTER_WINDOW_S + 1
    res = bridge.put_state({"page": 13}, [], canvas_id="cv-new")
    assert bridge.writer_canvas_id() == "cv-new"
    assert res["snapshot_accepted"] is True


def test_anonymous_posts_accepted_until_an_identified_writer_exists():
    # Legacy build (no id anywhere): behave exactly as before.
    res = bridge.put_state({"page": 7}, [], canvas_id=None)
    assert res["snapshot_accepted"] is True
    bridge.subscribe(0, canvas_id=None)
    assert bridge.put_state({"page": 9}, [])["snapshot_accepted"] is True
    # Once an identified writer exists, an anonymous poster is a stale
    # pre-reload build and its snapshots are rejected.
    bridge.subscribe(0, canvas_id="cv-live")
    assert bridge.put_state({"page": 8}, [], canvas_id=None)["snapshot_accepted"] is False
    assert bridge.get_state()["snapshot"] == {"page": 9}


def test_events_pass_from_non_writer_canvases():
    bridge.subscribe(0, canvas_id="cv-live")
    bridge.subscribe(0, canvas_id="cv-dup")
    bridge.put_state(None, [{"kind": "annotate_applied", "key": "k1"}], canvas_id="cv-dup")
    assert any(ev.get("key") == "k1" for ev in bridge.recent_events())


def test_rejected_poster_toasts_every_canvas_throttled():
    qa, _ = bridge.subscribe(0, canvas_id="cv-a")
    qb, _ = bridge.subscribe(0, canvas_id="cv-b")

    bridge.put_state({"page": 8}, [], canvas_id="cv-b")  # non-writer -> rejected -> toast
    toasts_a = [qa.get_nowait() for _ in range(qa.qsize())]
    toasts_b = [qb.get_nowait() for _ in range(qb.qsize())]
    assert any(c.get("type") == "toast" for c in toasts_a)
    assert any(c.get("type") == "toast" for c in toasts_b)

    bridge.put_state({"page": 8}, [], canvas_id="cv-b")  # inside throttle window
    assert qa.qsize() == 0 and qb.qsize() == 0


def test_annotates_go_to_every_subscription_of_the_writer_only():
    qa1, _ = bridge.subscribe(0, canvas_id="cv-live")
    qa2, _ = bridge.subscribe(0, canvas_id="cv-live")  # brief mid-reconnect double
    qb, _ = bridge.subscribe(0, canvas_id="cv-dup")
    bridge.send_commands([{"type": "annotate", "ops": []}])
    assert qa1.qsize() == 1  # both of the writer's subscriptions get it
    assert qa2.qsize() == 1  # (client-side id dedupe makes that safe)
    assert qb.qsize() == 0
    # Non-annotate commands still fan out to everyone.
    bridge.send_commands([{"type": "toast", "message": "hi"}])
    assert qa1.qsize() == 2 and qa2.qsize() == 2 and qb.qsize() == 1


def test_annotates_fall_back_to_newest_subscriber_without_an_election():
    qa, _ = bridge.subscribe(0, canvas_id=None)
    qb, _ = bridge.subscribe(0, canvas_id=None)
    bridge.send_commands([{"type": "annotate", "ops": []}])
    assert qa.qsize() == 0
    assert qb.qsize() == 1


def test_stats_surface_identity_focus_and_rejections():
    bridge.subscribe(0, canvas_id="cv-a")
    bridge.subscribe(0, canvas_id="cv-b")
    bridge.put_state({"page": 13}, [], canvas_id="cv-a", focused=True)
    bridge.put_state({"page": 7}, [], canvas_id="cv-b")  # rejected

    stats = bridge.bridge_stats()
    assert stats["canvases_connected"] == 2
    assert stats["canvas_ids"] == ["cv-a", "cv-b"]
    assert stats["writer_canvas"] == "cv-a"
    assert stats["snapshot_canvas"] == "cv-a"
    assert set(stats["posting_canvases"]) == {"cv-a", "cv-b"}
    assert stats["posting_canvases"]["cv-a"]["focused"] is True
    assert stats["posting_canvases"]["cv-b"]["page"] == 7
    assert stats["snapshot_rejections_recent"] == 1


def test_unsubscribe_falls_back_to_the_freshest_remaining_poster():
    qa, _ = bridge.subscribe(0, canvas_id="cv-a")
    bridge.subscribe(0, canvas_id="cv-b")
    bridge.put_state(None, [], canvas_id="cv-b")  # b is a live poster
    assert bridge.writer_canvas_id() == "cv-a"
    bridge.unsubscribe(qa)
    assert bridge.writer_canvas_id() == "cv-b"
    assert bridge.put_state({"page": 13}, [], canvas_id="cv-b")["snapshot_accepted"] is True


def test_writer_blip_with_a_never_posting_zombie_clears_the_pin_for_reclaim():
    # Review finding: a transient SSE blip on the writer must not hand the pin
    # to a frozen duplicate the writer can never win back from unfocused.
    qa, _ = bridge.subscribe(0, canvas_id="cv-live")
    bridge.subscribe(0, canvas_id="cv-zombie")  # never posts
    bridge.put_state({"page": 13}, [], canvas_id="cv-live", focused=True)
    bridge.unsubscribe(qa)  # the blip: server reaps before the 2s retry
    # No remaining subscriber has ever posted: the pin clears...
    assert bridge.writer_canvas_id() is None
    # ...so the returning canvas reclaims it at subscribe time.
    bridge.subscribe(0, canvas_id="cv-live")
    assert bridge.writer_canvas_id() == "cv-live"
    assert bridge.put_state({"page": 13}, [], canvas_id="cv-live")["snapshot_accepted"] is True
    qz = next(s["q"] for s in bridge._subscribers if s["canvas_id"] == "cv-zombie")
    ql = next(s["q"] for s in bridge._subscribers if s["canvas_id"] == "cv-live")
    bridge.send_commands([{"type": "annotate", "ops": []}])
    assert ql.qsize() == 1 and qz.qsize() == 0


def test_never_posted_writer_grace_is_bounded_by_election_time(monkeypatch):
    # Review finding: grace anchored to subscription recency made a zombie
    # writer immortal under SSE reconnect churn. It is now anchored to the
    # election timestamp, so churn cannot re-arm it.
    qz1, _ = bridge.subscribe(0, canvas_id="cv-zombie")  # wins the restart race
    bridge.subscribe(0, canvas_id="cv-live")
    assert bridge.writer_canvas_id() == "cv-zombie"
    # Zombie's SSE churns: fresh subscriptions, still zero posts.
    bridge.subscribe(0, canvas_id="cv-zombie")
    bridge.unsubscribe(qz1)
    # Inside the grace window an unfocused post is still rejected...
    assert bridge.put_state({"page": 13}, [], canvas_id="cv-live")["snapshot_accepted"] is False
    # ...but once the ELECTION ages past the grace, liveness fails despite the
    # churn and the live canvas takes the pin without needing focus.
    monkeypatch.setattr(bridge, "_writer_elected_ts",
                        bridge._writer_elected_ts - bridge._WRITER_GRACE_S - 1)
    assert bridge.put_state({"page": 13}, [], canvas_id="cv-live")["snapshot_accepted"] is True
    assert bridge.writer_canvas_id() == "cv-live"


def test_annotate_replay_is_writer_only():
    # Review finding: replay-on-subscribe bypassed the writer election — a
    # zombie reconnect with a stale cursor received unacked annotates the
    # writer had already executed (the duplicate-Neon-rows class).
    bridge.subscribe(0, canvas_id="cv-live")
    bridge.put_state({"page": 13}, [], canvas_id="cv-live", focused=True)
    bridge.send_commands([{"type": "annotate", "ops": [], "idempotency_key": "k9"}])
    _, replay_zombie = bridge.subscribe(0, canvas_id="cv-zombie")
    assert not any(c.get("type") == "annotate" for c in replay_zombie)
    _, replay_writer = bridge.subscribe(0, canvas_id="cv-live")
    assert any(c.get("type") == "annotate" for c in replay_writer)


def test_duplicate_toast_names_the_pinned_canvas():
    qa, _ = bridge.subscribe(0, canvas_id="cv-live")
    bridge.subscribe(0, canvas_id="cv-dup")
    bridge.put_state({"page": 13}, [], canvas_id="cv-live", focused=True)
    while qa.qsize():
        qa.get_nowait()
    bridge.put_state({"page": 7}, [], canvas_id="cv-dup")  # rejected -> toast
    toasts = [qa.get_nowait() for _ in range(qa.qsize())]
    msg = next(c["message"] for c in toasts if c.get("type") == "toast")
    assert "cv-live" in msg and "page 13" in msg  # names the actual writer,
    # never the old "pinned to the newest" guidance (review finding).


def test_heartbeat_post_defends_the_pin_without_a_snapshot():
    bridge.subscribe(0, canvas_id="cv-live")
    bridge.subscribe(0, canvas_id="cv-dup")
    bridge.put_state({"page": 13}, [], canvas_id="cv-live", focused=True)
    # Writer's snapshot post ages past the liveness window, but its idle
    # heartbeats (no snapshot) keep arriving — the pin holds.
    bridge._posters["cv-live"]["ts"] -= bridge._POSTER_WINDOW_S + 10
    bridge.put_state(None, [], canvas_id="cv-live")  # heartbeat
    assert bridge.put_state({"page": 7}, [], canvas_id="cv-dup")["snapshot_accepted"] is False
    assert bridge.writer_canvas_id() == "cv-live"


def test_same_canvas_reconnect_keeps_the_pin_through_the_double_subscription():
    q1, _ = bridge.subscribe(0, canvas_id="cv-live")
    # Reconnect: new subscription up before the old is reaped.
    q2, _ = bridge.subscribe(0, canvas_id="cv-live")
    bridge.unsubscribe(q1)
    assert bridge.writer_canvas_id() == "cv-live"
    assert bridge.put_state({"page": 13}, [], canvas_id="cv-live")["snapshot_accepted"] is True
