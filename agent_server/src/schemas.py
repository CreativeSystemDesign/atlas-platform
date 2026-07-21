"""Pydantic schemas matching the official LangGraph Agent Server OpenAPI spec."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class ThreadStatus(str, Enum):
    idle = "idle"
    busy = "busy"
    interrupted = "interrupted"
    error = "error"


class ThreadOperationalState(str, Enum):
    inactive = "inactive"
    active = "active"


class ThreadLiveRunPhase(str, Enum):
    starting = "starting"
    active = "active"
    recovery = "recovery"
    ended = "ended"


class RunStatus(str, Enum):
    pending = "pending"
    running = "running"
    error = "error"
    success = "success"
    timeout = "timeout"
    interrupted = "interrupted"
    cancelled = "cancelled"


class MultitaskStrategy(str, Enum):
    reject = "reject"
    rollback = "rollback"
    interrupt = "interrupt"
    enqueue = "enqueue"


class ThreadCreate(BaseModel):
    thread_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    if_exists: str = "raise"


class ThreadSearch(BaseModel):
    metadata: dict[str, Any] = Field(default_factory=dict)
    limit: int = 50
    offset: int = 0


class Thread(BaseModel):
    thread_id: uuid.UUID
    project_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)
    status: ThreadStatus = ThreadStatus.idle
    operational_state: ThreadOperationalState = ThreadOperationalState.inactive
    live_run_phase: ThreadLiveRunPhase = ThreadLiveRunPhase.ended
    live_run_id: str | None = None
    values: dict[str, Any] = Field(default_factory=dict)


class ThreadCheckpointRef(BaseModel):
    thread_id: uuid.UUID
    checkpoint_id: str | None = None
    checkpoint_ns: str = ""
    parent_checkpoint_id: str | None = None


class ThreadTimelineSummary(BaseModel):
    event_family: str = "checkpoint"
    message_count: int = 0
    last_message_type: str | None = None
    last_message_preview: str | None = None
    file_count: int | None = None
    todo_count: int | None = None


class ThreadTimelineItem(BaseModel):
    order: int
    created_at: datetime | None = None
    next: list[str] = Field(default_factory=list)
    checkpoint: ThreadCheckpointRef
    summary: ThreadTimelineSummary = Field(default_factory=ThreadTimelineSummary)
    can_replay: bool = True
    can_fork: bool = True
    values: dict[str, Any] = Field(default_factory=dict)


class RunCreate(BaseModel):
    assistant_id: str = "atlas-architect"
    input: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    stream_mode: str | list[str] = Field(default_factory=lambda: ["messages"])
    multitask_strategy: MultitaskStrategy = MultitaskStrategy.enqueue


class HITLResumeBody(BaseModel):
    """Resume payload for LangGraph HITL (`HumanInTheLoopMiddleware`)."""

    decisions: list[dict[str, Any]] = Field(default_factory=list)


class Run(BaseModel):
    run_id: uuid.UUID
    thread_id: uuid.UUID
    assistant_id: str
    created_at: datetime
    updated_at: datetime
    status: RunStatus
    metadata: dict[str, Any] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    detail: str
