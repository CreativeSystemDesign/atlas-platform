from __future__ import annotations

import base64
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from src.config import settings
from src.codex_runtime.environment import codex_environment_payload
from src.codex_runtime.manager import get_codex_runtime_manager, sse_frame
from src.codex_runtime.preview_promotion import (
    PULL_LIVE_CONFIRMATION_TOKEN,
    codex_preview_pull_live_safety,
    current_codex_preview_pull_live,
    current_codex_preview_promotion,
    is_preview_promotion_request,
    start_codex_preview_pull_live,
    start_codex_preview_promotion,
)
from src.graphs.model_resolution import (
    PREFERRED_CODEX_COMPONENT_MODEL_KEY,
    PREFERRED_CODEX_LAYOUT_MODEL_KEY,
    PREFERRED_CODEX_TRANSCRIPTION_MODEL_KEY,
)
from src.graphs.registry import invalidate_graph
from src.persistence.settings import get_setting, set_setting

router = APIRouter(prefix="/code/codex", tags=["Atlas Code Codex"])

ReasoningEffort = Literal["none", "minimal", "low", "medium", "high", "xhigh"]
CodexServiceTier = Literal["priority"]
CodexMemoryMode = Literal["enabled", "disabled", "inherit"]
CodexUserMemoryMode = Literal["enabled", "disabled"]
SortDirection = Literal["asc", "desc"]
ThreadSortKey = Literal["created_at", "updated_at"]
TurnItemsView = Literal["notLoaded", "summary", "full"]
ThreadGoalStatus = Literal["active", "paused", "budgetLimited", "complete"]
ReviewDelivery = Literal["inline", "detached"]


class CodexThreadStartBody(BaseModel):
    cwd: str | None = None
    model: str | None = None
    service_tier: CodexServiceTier | None = None
    effort: ReasoningEffort | None = None
    developer_instructions: str | None = None
    memory_mode: CodexMemoryMode | None = None


class CodexTurnStartBody(BaseModel):
    text: str = Field(min_length=1)
    cwd: str | None = None
    model: str | None = None
    service_tier: CodexServiceTier | None = None
    effort: ReasoningEffort | None = None
    summary: Literal["auto", "concise", "detailed", "none"] | None = "auto"
    developer_instructions: str | None = None
    visible_transcript: str | None = None
    interface_mutation_requested: bool = False
    memory_mode: CodexMemoryMode | None = None


class CodexSessionTurnBody(CodexTurnStartBody):
    thread_id: str | None = None


class CodexMemoryModeBody(BaseModel):
    mode: CodexUserMemoryMode


class CodexMemorySettingsBody(BaseModel):
    mode: CodexUserMemoryMode
    thread_id: str | None = None


class CodexThreadNameBody(BaseModel):
    name: str = Field(min_length=1, max_length=160)


class CodexThreadGoalBody(BaseModel):
    objective: str | None = None
    status: ThreadGoalStatus | None = None
    token_budget: int | None = Field(default=None, ge=0)


class CodexReviewStartBody(BaseModel):
    target: dict[str, Any] = Field(default_factory=lambda: {"type": "uncommittedChanges"})
    delivery: ReviewDelivery | None = "detached"


class CodexNativeMethodBody(BaseModel):
    method: str = Field(min_length=1, max_length=160)
    params: dict[str, Any] = Field(default_factory=dict)
    cwd: str | None = None
    timeout: float = Field(default=12, ge=1, le=60)


class CodexThreadForkBody(BaseModel):
    cwd: str | None = None
    model: str | None = None
    service_tier: CodexServiceTier | None = None
    effort: ReasoningEffort | None = None
    developer_instructions: str | None = None
    exclude_turns: bool | None = None


class CodexThreadRollbackBody(BaseModel):
    num_turns: int = Field(ge=1, le=100)


class CodexSteerBody(BaseModel):
    text: str = Field(min_length=1)


class CodexPreviewPromoteBody(BaseModel):
    timeout: float = Field(default=900, ge=30, le=1800)


class CodexPreviewPullLiveBody(BaseModel):
    timeout: float = Field(default=240, ge=10, le=600)
    confirm_reset_to_live: bool = False
    confirmation_token: str = ""


class CodexPreferredModelBody(BaseModel):
    model_id: str | None = None


TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024
TRANSCRIPTION_CONTENT_TYPES = {
    "audio/webm": "webm",
    "audio/wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp4": "mp4",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/ogg": "ogg",
    "audio/aac": "aac",
    "video/mp4": "mp4",
}


@router.get("/environment")
async def get_codex_environment(request: Request):
    return codex_environment_payload(request.headers)


@router.get("/settings/preferred-codex-layout-model")
async def get_codex_preferred_layout_model():
    return await _get_codex_preferred_model(
        PREFERRED_CODEX_LAYOUT_MODEL_KEY,
        settings.codex_layout_model,
    )


@router.put("/settings/preferred-codex-layout-model")
async def put_codex_preferred_layout_model(body: CodexPreferredModelBody):
    return await _put_codex_preferred_model(PREFERRED_CODEX_LAYOUT_MODEL_KEY, body)


@router.get("/settings/preferred-codex-component-model")
async def get_codex_preferred_component_model():
    return await _get_codex_preferred_model(
        PREFERRED_CODEX_COMPONENT_MODEL_KEY,
        settings.codex_component_model,
    )


@router.put("/settings/preferred-codex-component-model")
async def put_codex_preferred_component_model(body: CodexPreferredModelBody):
    return await _put_codex_preferred_model(PREFERRED_CODEX_COMPONENT_MODEL_KEY, body)


@router.get("/settings/preferred-codex-transcription-model")
async def get_codex_preferred_transcription_model():
    return await _get_codex_preferred_model(
        PREFERRED_CODEX_TRANSCRIPTION_MODEL_KEY,
        settings.codex_transcription_model,
    )


@router.put("/settings/preferred-codex-transcription-model")
async def put_codex_preferred_transcription_model(body: CodexPreferredModelBody):
    return await _put_codex_preferred_model(
        PREFERRED_CODEX_TRANSCRIPTION_MODEL_KEY,
        body,
    )


@router.post("/audio/transcriptions")
async def transcribe_codex_audio(
    request: Request,
    model: str | None = Query(default=None),
):
    api_key = settings.openrouter_api_key.strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENROUTER_API_KEY is not configured for Atlas Codex transcription.",
        )

    content_type = (request.headers.get("content-type") or "").split(";", 1)[0].lower()
    audio_format = TRANSCRIPTION_CONTENT_TYPES.get(content_type)
    if not audio_format:
        raise HTTPException(
            status_code=415,
            detail="Unsupported audio format. Recordings must be webm, wav, mp3, mp4, m4a, ogg, or aac.",
        )

    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=400, detail="Audio recording was empty.")
    if len(audio) > TRANSCRIPTION_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Audio recording exceeds the 25 MB limit.")

    requested_model = (model or "").strip()
    if model is not None and not requested_model:
        raise HTTPException(status_code=400, detail="Transcription model must be a non-empty string.")
    selected_model = requested_model or settings.codex_transcription_model.strip()
    if not selected_model:
        raise HTTPException(
            status_code=503,
            detail="ATLAS_CODEX_TRANSCRIPTION_MODEL is not configured.",
        )

    payload = {
        "model": selected_model,
        "input_audio": {
            "data": base64.b64encode(audio).decode("ascii"),
            "format": audio_format,
        },
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://atlas-platform.cloud/codex",
        "X-OpenRouter-Title": "Atlas Codex",
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://openrouter.ai/api/v1/audio/transcriptions",
                headers=headers,
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Transcription request failed: {exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=_openrouter_error_detail(response, selected_model),
        )

    try:
        response_payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Transcription response was not JSON.") from exc
    text = str(response_payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=502, detail="Transcription response did not include text.")

    return {"text": text, "model": selected_model}


@router.get("/models")
async def list_codex_models(include_hidden: bool = False):
    manager = get_codex_runtime_manager()
    try:
        return await manager.list_models(include_hidden=include_hidden)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/models/supported")
async def list_supported_codex_models(
    include_hidden: bool = False,
    cwd: str | None = None,
    force_refresh: bool = False,
):
    manager = get_codex_runtime_manager()
    try:
        return await manager.list_supported_models(
            include_hidden=include_hidden,
            cwd=cwd,
            force_refresh=force_refresh,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/memory")
async def get_codex_memory_settings():
    manager = get_codex_runtime_manager()
    try:
        return await manager.memory_settings()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.put("/memory")
async def put_codex_memory_settings(body: CodexMemorySettingsBody):
    manager = get_codex_runtime_manager()
    try:
        return await manager.set_memory_settings(
            mode=body.mode,
            thread_id=body.thread_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/memory/reset")
async def reset_codex_memory():
    manager = get_codex_runtime_manager()
    try:
        return await manager.reset_memory()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/developer/capabilities")
async def get_codex_developer_capabilities(
    cwd: str | None = None,
    thread_id: str | None = None,
):
    manager = get_codex_runtime_manager()
    try:
        return await manager.developer_capabilities(cwd=cwd, thread_id=thread_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/developer/native-request")
async def run_codex_native_method(body: CodexNativeMethodBody):
    manager = get_codex_runtime_manager()
    try:
        return await manager.native_request(
            method=body.method,
            params=body.params,
            cwd=body.cwd,
            timeout=body.timeout,
        )
    except Exception as exc:
        _raise_codex_runtime_http_exception(exc)


@router.post("/preview/promote")
async def promote_codex_preview(
    request: Request,
    body: CodexPreviewPromoteBody | None = None,
):
    if not is_preview_promotion_request(request.headers):
        raise HTTPException(
            status_code=403,
            detail="Preview promotion is only available from preview.atlas-platform.cloud.",
    )
    options = body or CodexPreviewPromoteBody()
    return await start_codex_preview_promotion(timeout=options.timeout)


@router.get("/preview/promote")
async def read_codex_preview_promotion(request: Request):
    if not is_preview_promotion_request(request.headers):
        raise HTTPException(
            status_code=403,
            detail="Preview promotion status is only available from preview.atlas-platform.cloud.",
        )
    return current_codex_preview_promotion()


@router.post("/preview/pull-live")
async def pull_codex_preview_from_live(
    request: Request,
    body: CodexPreviewPullLiveBody | None = None,
):
    if not is_preview_promotion_request(request.headers):
        raise HTTPException(
            status_code=403,
            detail="Preview live pull is only available from preview.atlas-platform.cloud.",
        )
    options = body or CodexPreviewPullLiveBody()
    safety = codex_preview_pull_live_safety()
    confirmed = (
        options.confirm_reset_to_live
        and options.confirmation_token == PULL_LIVE_CONFIRMATION_TOKEN
    )
    if safety.get("requiresConfirmation") and not confirmed:
        raise HTTPException(
            status_code=409,
            detail={
                "message": (
                    "Preview live pull would reset active preview work. Confirm the "
                    "reset explicitly after reviewing the safety report."
                ),
                "safety": safety,
                "requiredConfirmationToken": PULL_LIVE_CONFIRMATION_TOKEN,
            },
        )
    return await start_codex_preview_pull_live(timeout=options.timeout)


@router.get("/preview/pull-live")
async def read_codex_preview_pull_live(request: Request):
    if not is_preview_promotion_request(request.headers):
        raise HTTPException(
            status_code=403,
            detail="Preview live pull status is only available from preview.atlas-platform.cloud.",
        )
    return current_codex_preview_pull_live()


@router.get("/preview/pull-live/safety")
async def read_codex_preview_pull_live_safety(request: Request):
    if not is_preview_promotion_request(request.headers):
        raise HTTPException(
            status_code=403,
            detail="Preview live pull safety is only available from preview.atlas-platform.cloud.",
        )
    return codex_preview_pull_live_safety()


@router.post("/threads")
async def start_codex_thread(body: CodexThreadStartBody):
    manager = get_codex_runtime_manager()
    try:
        return await manager.start_thread(
            cwd=body.cwd,
            model=body.model,
            service_tier=body.service_tier,
            effort=body.effort,
            developer_instructions=body.developer_instructions,
            memory_mode=body.memory_mode,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/threads")
async def list_codex_threads(
    archived: bool | None = None,
    cursor: str | None = None,
    cwd: str | None = None,
    include_support_probes: bool = False,
    limit: int | None = Query(default=24, ge=1, le=100),
    search_term: str | None = None,
    sort_direction: SortDirection | None = "desc",
    sort_key: ThreadSortKey | None = "updated_at",
    use_state_db_only: bool | None = None,
):
    manager = get_codex_runtime_manager()
    try:
        return await manager.list_threads(
            archived=archived,
            cursor=cursor,
            cwd=cwd,
            include_support_probes=include_support_probes,
            limit=limit,
            search_term=search_term,
            sort_direction=sort_direction,
            sort_key=sort_key,
            use_state_db_only=use_state_db_only,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/threads/{thread_id}")
async def read_codex_thread(thread_id: str, include_turns: bool = False):
    manager = get_codex_runtime_manager()
    try:
        return await manager.read_thread(
            thread_id=thread_id,
            include_turns=include_turns,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/threads/{thread_id}/turns")
async def list_codex_thread_turns(
    thread_id: str,
    cursor: str | None = None,
    items_view: TurnItemsView | None = "summary",
    limit: int | None = Query(default=12, ge=1, le=100),
    sort_direction: SortDirection | None = "desc",
):
    manager = get_codex_runtime_manager()
    try:
        return await manager.list_thread_turns(
            thread_id=thread_id,
            cursor=cursor,
            items_view=items_view,
            limit=limit,
            sort_direction=sort_direction,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/threads/{thread_id}/turns/{turn_id}/items")
async def list_codex_thread_turn_items(
    thread_id: str,
    turn_id: str,
    cursor: str | None = None,
    limit: int | None = Query(default=100, ge=1, le=250),
    sort_direction: SortDirection | None = "asc",
):
    manager = get_codex_runtime_manager()
    try:
        return await manager.list_thread_turn_items(
            thread_id=thread_id,
            turn_id=turn_id,
            cursor=cursor,
            limit=limit,
            sort_direction=sort_direction,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.put("/threads/{thread_id}/name")
async def set_codex_thread_name(thread_id: str, body: CodexThreadNameBody):
    manager = get_codex_runtime_manager()
    try:
        return await manager.set_thread_name(thread_id=thread_id, name=body.name)
    except Exception as exc:
        _raise_codex_runtime_http_exception(exc)


@router.get("/threads/{thread_id}/goal")
async def get_codex_thread_goal(thread_id: str):
    manager = get_codex_runtime_manager()
    try:
        return await manager.get_thread_goal(thread_id=thread_id)
    except Exception as exc:
        _raise_codex_runtime_http_exception(exc)


@router.put("/threads/{thread_id}/goal")
async def set_codex_thread_goal(thread_id: str, body: CodexThreadGoalBody):
    manager = get_codex_runtime_manager()
    try:
        return await manager.set_thread_goal(
            thread_id=thread_id,
            objective=body.objective,
            status=body.status,
            token_budget=body.token_budget,
        )
    except Exception as exc:
        _raise_codex_runtime_http_exception(exc)


@router.delete("/threads/{thread_id}/goal")
async def clear_codex_thread_goal(thread_id: str):
    manager = get_codex_runtime_manager()
    try:
        return await manager.clear_thread_goal(thread_id=thread_id)
    except Exception as exc:
        _raise_codex_runtime_http_exception(exc)


@router.post("/threads/{thread_id}/review")
async def start_codex_review(thread_id: str, body: CodexReviewStartBody):
    manager = get_codex_runtime_manager()
    try:
        return await manager.start_review(
            thread_id=thread_id,
            target=body.target,
            delivery=body.delivery,
        )
    except Exception as exc:
        _raise_codex_runtime_http_exception(exc)


@router.post("/threads/{thread_id}/archive")
async def archive_codex_thread(thread_id: str):
    manager = get_codex_runtime_manager()
    try:
        return await manager.archive_thread(thread_id=thread_id)
    except Exception as exc:
        _raise_codex_runtime_http_exception(exc)


@router.post("/threads/{thread_id}/unarchive")
async def unarchive_codex_thread(thread_id: str):
    manager = get_codex_runtime_manager()
    try:
        return await manager.unarchive_thread(thread_id=thread_id)
    except Exception as exc:
        _raise_codex_runtime_http_exception(exc)


@router.post("/threads/{thread_id}/fork")
async def fork_codex_thread(thread_id: str, body: CodexThreadForkBody):
    manager = get_codex_runtime_manager()
    try:
        return await manager.fork_thread(
            thread_id=thread_id,
            cwd=body.cwd,
            model=body.model,
            service_tier=body.service_tier,
            effort=body.effort,
            developer_instructions=body.developer_instructions,
            exclude_turns=body.exclude_turns,
        )
    except Exception as exc:
        _raise_codex_runtime_http_exception(exc)


@router.post("/threads/{thread_id}/compact")
async def compact_codex_thread(thread_id: str):
    manager = get_codex_runtime_manager()
    try:
        return await manager.compact_thread(thread_id=thread_id)
    except Exception as exc:
        _raise_codex_runtime_http_exception(exc)


@router.post("/threads/{thread_id}/rollback")
async def rollback_codex_thread(thread_id: str, body: CodexThreadRollbackBody):
    manager = get_codex_runtime_manager()
    try:
        return await manager.rollback_thread(
            thread_id=thread_id,
            num_turns=body.num_turns,
        )
    except Exception as exc:
        _raise_codex_runtime_http_exception(exc)


@router.post("/threads/{thread_id}/memory-mode")
async def set_codex_thread_memory_mode(thread_id: str, body: CodexMemoryModeBody):
    manager = get_codex_runtime_manager()
    try:
        return await manager.set_thread_memory_mode(
            thread_id=thread_id,
            mode=body.mode,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/threads/{thread_id}/turns/stream")
async def stream_codex_turn(thread_id: str, body: CodexTurnStartBody):
    manager = get_codex_runtime_manager()

    async def event_generator():
        try:
            async for payload in manager.stream_turn(
                thread_id=thread_id,
                text=body.text,
                cwd=body.cwd,
                model=body.model,
                service_tier=body.service_tier,
                effort=body.effort,
                summary=body.summary,
                developer_instructions=body.developer_instructions,
                visible_transcript=body.visible_transcript,
                interface_mutation_requested=body.interface_mutation_requested,
                memory_mode=body.memory_mode,
            ):
                yield sse_frame(payload)
        except Exception as exc:
            yield {"event": "error", "data": str(exc)}

    return EventSourceResponse(event_generator())


@router.post("/turns/stream")
async def stream_new_codex_thread_turn(body: CodexTurnStartBody):
    manager = get_codex_runtime_manager()

    async def event_generator():
        try:
            async for payload in manager.stream_new_thread_turn(
                text=body.text,
                cwd=body.cwd,
                model=body.model,
                service_tier=body.service_tier,
                effort=body.effort,
                summary=body.summary,
                developer_instructions=body.developer_instructions,
                visible_transcript=body.visible_transcript,
                interface_mutation_requested=body.interface_mutation_requested,
                memory_mode=body.memory_mode,
            ):
                yield sse_frame(payload)
        except Exception as exc:
            yield {"event": "error", "data": str(exc)}

    return EventSourceResponse(event_generator())


@router.post("/session/turns/stream")
async def stream_codex_session_turn(body: CodexSessionTurnBody):
    """Stream one conversational Codex turn.

    This is the product-facing chat route for `/codex`: the browser sends a
    directive plus the last known native Codex thread id, and the backend either
    resumes that native thread or creates the first one. Codex remains the
    conversation source of truth; the backend is only the server-side transport
    and safety boundary.
    """

    manager = get_codex_runtime_manager()

    async def event_generator():
        try:
            if body.thread_id:
                async for payload in manager.stream_turn(
                    thread_id=body.thread_id,
                    text=body.text,
                    cwd=body.cwd,
                    model=body.model,
                    service_tier=body.service_tier,
                    effort=body.effort,
                    summary=body.summary,
                    developer_instructions=body.developer_instructions,
                    visible_transcript=body.visible_transcript,
                    interface_mutation_requested=body.interface_mutation_requested,
                    memory_mode=body.memory_mode,
                ):
                    yield sse_frame(payload)
                return

            async for payload in manager.stream_new_thread_turn(
                text=body.text,
                cwd=body.cwd,
                model=body.model,
                service_tier=body.service_tier,
                effort=body.effort,
                summary=body.summary,
                developer_instructions=body.developer_instructions,
                visible_transcript=body.visible_transcript,
                interface_mutation_requested=body.interface_mutation_requested,
                memory_mode=body.memory_mode,
            ):
                yield sse_frame(payload)
        except Exception as exc:
            yield {"event": "error", "data": str(exc)}

    return EventSourceResponse(event_generator())


@router.post("/threads/{thread_id}/turns/{turn_id}/steer")
async def steer_codex_turn(thread_id: str, turn_id: str, body: CodexSteerBody):
    manager = get_codex_runtime_manager()
    try:
        return await manager.steer(thread_id=thread_id, turn_id=turn_id, text=body.text)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/threads/{thread_id}/turns/{turn_id}/interrupt")
async def interrupt_codex_turn(thread_id: str, turn_id: str):
    manager = get_codex_runtime_manager()
    try:
        return await manager.interrupt(thread_id=thread_id, turn_id=turn_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def _raise_codex_runtime_http_exception(exc: Exception) -> None:
    message = str(exc) or exc.__class__.__name__
    raise HTTPException(status_code=424, detail=message) from exc


async def _get_codex_preferred_model(
    key: str,
    default_from_env: str,
) -> dict[str, str | None]:
    raw = await get_setting(key, "")
    value = raw.strip()
    return {
        "model_id": value if value else None,
        "default_from_env": default_from_env,
    }


async def _put_codex_preferred_model(
    key: str,
    body: CodexPreferredModelBody,
) -> dict[str, str | bool | None]:
    if body.model_id is None or not str(body.model_id).strip():
        await set_setting(key, "")
        saved = None
    else:
        saved = str(body.model_id).strip()
        await set_setting(key, saved)
    invalidate_graph("atlas-code")
    return {"ok": True, "model_id": saved}


def _openrouter_error_detail(response: httpx.Response, model: str) -> str:
    try:
        payload = response.json()
    except ValueError:
        message = response.text[:1000].strip()
        if response.status_code == 404:
            return (
                f"OpenRouter transcription model '{model}' was not found or is not "
                "available for speech-to-text."
            )
        return (
            f"OpenRouter transcription failed with HTTP {response.status_code}"
            f"{f': {message}' if message else '.'}"
        )
    message = ""
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            message_value = error.get("message")
            if message_value:
                message = str(message_value)
        if not message:
            message_value = payload.get("message") or payload.get("detail")
            if message_value:
                message = str(message_value)
    if response.status_code == 404:
        return (
            f"OpenRouter transcription model '{model}' was not found or is not "
            f"available for speech-to-text.{f' Provider message: {message}' if message else ''}"
        )
    if message:
        return f"OpenRouter transcription failed with HTTP {response.status_code}: {message}"
    return f"OpenRouter transcription failed with HTTP {response.status_code}."
