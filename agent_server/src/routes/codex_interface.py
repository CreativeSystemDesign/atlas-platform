from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sse_starlette.sse import EventSourceResponse

from src.codex_interface.supervisor import (
    CodexInterfaceSupervisor,
    UnsafeInterfacePathError,
)
from src.codex_runtime.environment import (
    codex_dashboard_url,
    codex_environment_payload,
    codex_interface_drafts_root,
)
from src.config import settings

router = APIRouter(prefix="/code/codex/interface", tags=["Atlas Codex Interface"])


class InterfaceCheckpointBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=120)
    description: str = ""
    paths: list[str] | None = None


class InterfaceRollbackBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = ""


def get_interface_supervisor() -> CodexInterfaceSupervisor:
    repo_root = Path(settings.atlas_root).resolve()
    lane_payload = codex_environment_payload()
    return CodexInterfaceSupervisor(
        repo_root=repo_root,
        drafts_root=codex_interface_drafts_root(repo_root),
        frontend_restart_service=str(lane_payload["frontendRestartService"]),
        backend_restart_service=str(lane_payload["backendRestartService"]),
    )


@router.get("/revisions")
async def list_interface_revisions():
    supervisor = get_interface_supervisor()
    return {"revisions": [revision.__dict__ for revision in supervisor.list_revisions()]}


@router.post("/checkpoints")
async def create_interface_checkpoint(request: Request, body: InterfaceCheckpointBody):
    _require_interface_mutation_lane(request)
    supervisor = get_interface_supervisor()
    try:
        revision = supervisor.create_checkpoint(
            label=body.label,
            description=body.description,
            paths=body.paths,
        )
    except UnsafeInterfacePathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"revision": revision.__dict__}


@router.post("/revisions/{revision_id}/restore")
async def restore_interface_revision(
    request: Request,
    revision_id: str,
    body: InterfaceRollbackBody,
):
    _require_interface_mutation_lane(request)
    supervisor = get_interface_supervisor()
    try:
        revision = supervisor.restore_revision(
            revision_id,
            diagnostic={"reason": body.reason or "User requested rollback."},
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UnsafeInterfacePathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"revision": revision.__dict__, "rolled_back": True}


@router.post("/revisions/{revision_id}/default")
async def mark_interface_revision_default(request: Request, revision_id: str):
    _require_interface_mutation_lane(request)
    supervisor = get_interface_supervisor()
    try:
        revision = supervisor.mark_revision_default(revision_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"revision": revision.__dict__}


@router.post("/revisions/{revision_id}/validate")
async def validate_interface_revision(request: Request, revision_id: str):
    _require_interface_mutation_lane(request)
    supervisor = get_interface_supervisor()
    try:
        result = await supervisor.validate_or_restore(
            revision_id,
            health_probe=lambda: _probe_codex_route(revision_id),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UnsafeInterfacePathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "revision": result.revision.__dict__,
        "rolled_back": result.rolled_back,
        "diagnostic": result.diagnostic,
    }


@router.post("/revisions/{revision_id}/prepare/stream")
async def prepare_interface_revision(request: Request, revision_id: str):
    _require_interface_mutation_lane(request)
    supervisor = get_interface_supervisor()

    async def event_generator():
        try:
            async for step in supervisor.prepare_validation_steps(revision_id):
                yield {
                    "event": "interface_progress",
                    "data": json.dumps(step, ensure_ascii=False),
                }
        except FileNotFoundError as exc:
            yield {"event": "error", "data": str(exc)}
        except Exception as exc:
            yield {"event": "error", "data": str(exc)}

    return EventSourceResponse(event_generator())


async def _probe_codex_route(revision_id: str) -> tuple[bool, dict[str, Any]]:
    target_base = codex_dashboard_url()
    separator = "&" if "?" in target_base else "?"
    target = (
        f"{target_base}{separator}ui_rev={revision_id}"
        "&health_probe=interface-mutation"
        "&inspector_target=1"
        "&inspector_session=server-health-probe"
    )
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            response = await client.get(
                target,
                headers={
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                },
            )
    except Exception as exc:
        return False, {"target": target, "error": str(exc)}

    body = response.text[:20_000]
    has_next_error = (
        "__nextjs_original-stack-frames" in body
        or "next-error-h1" in body
        or "Application error:" in body
    )
    ok = response.status_code == 200 and not has_next_error
    return ok, {
        "target": target,
        "status_code": response.status_code,
        "reason_phrase": response.reason_phrase,
        "next_error_overlay": has_next_error,
        "body_preview": body[:1600] if not ok else "",
    }


def _require_interface_mutation_lane(request: Request) -> dict[str, Any]:
    payload = codex_environment_payload(request.headers)
    if not payload["hostMatchesLane"]:
        raise HTTPException(
            status_code=409,
            detail={
                "message": (
                    "Atlas Codex lane mismatch. This host reached a backend for a "
                    "different lane, so interface mutation was refused."
                ),
                "environment": payload,
            },
        )
    if not payload["interfaceMutationEnabled"]:
        raise HTTPException(
            status_code=409,
            detail={
                "message": (
                    "Atlas Codex interface mutation is disabled for this lane. "
                    "Use the preview lane and promote after validation."
                ),
                "environment": payload,
            },
        )
    return payload
