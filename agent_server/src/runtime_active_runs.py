from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Callable

SseFrame = dict[str, str]


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class QueuedRunRequest:
    kind: str
    payload: Any
    config: dict[str, Any]
    resolved_model: str
    assistant_id: str
    run_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    multitask_strategy: str = "enqueue"


@dataclass
class ActiveThreadRun:
    thread_id: str
    requests: deque[QueuedRunRequest] = field(default_factory=deque)
    history: list[SseFrame] = field(default_factory=list)
    subscribers: dict[str, asyncio.Queue[SseFrame | None]] = field(default_factory=dict)
    task: asyncio.Task[Any] | None = None
    current_run_id: str | None = None
    status: str = "idle"
    live_phase: str = "ended"
    updated_at: str = field(default_factory=_utcnow_iso)
    stop_requested: bool = False


class ActiveRunManager:
    def __init__(self, history_limit: int = 4000) -> None:
        self._sessions: dict[str, ActiveThreadRun] = {}
        self._history_limit = history_limit
        self._lock = asyncio.Lock()

    async def get(self, thread_id: str) -> ActiveThreadRun | None:
        async with self._lock:
            return self._sessions.get(thread_id)

    async def enqueue(
        self,
        thread_id: str,
        request: QueuedRunRequest,
        runner_factory: Callable[[ActiveThreadRun], asyncio.Task[Any] | Any],
    ) -> tuple[ActiveThreadRun, bool]:
        async with self._lock:
            session = self._sessions.get(thread_id)
            if session is None or (
                session.task is None
                and not session.requests
                and session.status in {"completed", "failed", "stopped", "idle"}
            ):
                session = ActiveThreadRun(thread_id=thread_id)
                self._sessions[thread_id] = session
            session.requests.append(request)
            session.updated_at = _utcnow_iso()
            started = session.task is None
            if started:
                session.stop_requested = False
                session.status = "running"
                session.live_phase = "starting"
                task_or_coro = runner_factory(session)
                if isinstance(task_or_coro, asyncio.Task):
                    session.task = task_or_coro
                else:
                    session.task = asyncio.create_task(task_or_coro, name=f"active-run-{thread_id[:8]}")
            return session, started

    async def pop_next_request(self, thread_id: str) -> QueuedRunRequest | None:
        async with self._lock:
            session = self._sessions.get(thread_id)
            if not session or not session.requests:
                return None
            session.updated_at = _utcnow_iso()
            return session.requests.popleft()

    async def has_pending_requests(self, thread_id: str) -> bool:
        async with self._lock:
            session = self._sessions.get(thread_id)
            return bool(session and session.requests)

    async def set_current_run_id(self, thread_id: str, run_id: str | None) -> None:
        async with self._lock:
            session = self._sessions.get(thread_id)
            if not session:
                return
            session.current_run_id = run_id
            session.updated_at = _utcnow_iso()

    async def publish(self, thread_id: str, frame: SseFrame) -> None:
        async with self._lock:
            session = self._sessions.get(thread_id)
            if not session:
                return
            session.history.append(frame)
            if frame.get("event") == "run.state":
                try:
                    import json

                    payload = json.loads(frame.get("data", "{}"))
                except Exception:
                    payload = {}
                state = str(payload.get("state", "") or "").strip().lower()
                if state == "starting":
                    session.live_phase = "starting"
                elif state in {"running", "waiting_on_model", "waiting_on_tool", "interrupted"}:
                    session.live_phase = "active"
                elif state in {"completed", "failed"}:
                    session.live_phase = "ended"
            if len(session.history) > self._history_limit:
                del session.history[: len(session.history) - self._history_limit]
            session.updated_at = _utcnow_iso()
            subscribers = list(session.subscribers.values())
        for queue in subscribers:
            await queue.put(frame)

    async def set_status(self, thread_id: str, status: str) -> None:
        async with self._lock:
            session = self._sessions.get(thread_id)
            if not session:
                return
            session.status = status
            session.updated_at = _utcnow_iso()

    async def stop(self, thread_id: str) -> ActiveThreadRun | None:
        async with self._lock:
            session = self._sessions.get(thread_id)
            if not session:
                return None
            session.stop_requested = True
            session.status = "stopping"
            task = session.task
        if task is not None:
            task.cancel()
        return session

    async def subscribe(
        self, thread_id: str, *, replay_history: bool = True
    ) -> tuple[ActiveThreadRun | None, str | None, asyncio.Queue[SseFrame | None] | None, list[SseFrame]]:
        async with self._lock:
            session = self._sessions.get(thread_id)
            if not session:
                return None, None, None, []
            sub_id = _utcnow_iso() + f":{len(session.subscribers) + 1}"
            queue: asyncio.Queue[SseFrame | None] = asyncio.Queue()
            session.subscribers[sub_id] = queue
            history = list(session.history) if replay_history else []
            return session, sub_id, queue, history

    async def unsubscribe(self, thread_id: str, subscriber_id: str | None) -> None:
        if subscriber_id is None:
            return
        async with self._lock:
            session = self._sessions.get(thread_id)
            if not session:
                return
            session.subscribers.pop(subscriber_id, None)
            should_drop = (
                not session.subscribers
                and session.task is None
                and not session.requests
                and session.status in {"completed", "failed", "stopped"}
            )
            if should_drop:
                self._sessions.pop(thread_id, None)

    async def close_streams(self, thread_id: str) -> None:
        async with self._lock:
            session = self._sessions.get(thread_id)
            if not session:
                return
            subscribers = list(session.subscribers.values())
        for queue in subscribers:
            await queue.put(None)

    async def discard(self, thread_id: str) -> None:
        async with self._lock:
            session = self._sessions.pop(thread_id, None)
            if not session:
                return
            subscribers = list(session.subscribers.values())
        for queue in subscribers:
            await queue.put(None)

    async def finish(self, thread_id: str, status: str) -> None:
        async with self._lock:
            session = self._sessions.get(thread_id)
            if not session:
                return
            session.status = status
            session.task = None
            session.current_run_id = None
            session.live_phase = "ended"
            session.updated_at = _utcnow_iso()
            should_drop = (
                not session.subscribers and not session.requests and status in {"completed", "failed", "stopped"}
            )
            if should_drop:
                self._sessions.pop(thread_id, None)

    async def live_snapshot(self, thread_id: str) -> dict[str, str | None] | None:
        async with self._lock:
            session = self._sessions.get(thread_id)
            if not session:
                return None
            return {
                "thread_id": session.thread_id,
                "run_id": session.current_run_id,
                "status": session.status,
                "live_phase": session.live_phase,
                "updated_at": session.updated_at,
            }

    async def stream(self, thread_id: str, *, replay_history: bool = True) -> AsyncIterator[SseFrame]:
        session, subscriber_id, queue, history = await self.subscribe(
            thread_id, replay_history=replay_history
        )
        if session is None or subscriber_id is None or queue is None:
            return
        try:
            for frame in history:
                yield frame
            while True:
                frame = await queue.get()
                if frame is None:
                    break
                yield frame
        finally:
            await self.unsubscribe(thread_id, subscriber_id)


active_run_manager = ActiveRunManager()
