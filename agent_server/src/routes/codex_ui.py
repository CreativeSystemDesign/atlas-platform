"""Generated UI contracts for the Atlas Codex center lane."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from src.config import settings
from src.graphs.codex_ui import (
    CodexCenterLayoutSpec,
    CodexTurnComponentSpec,
    CodexUiComposeContext,
    build_codex_component_graph,
    build_codex_layout_graph,
)
from src.graphs.model_resolution import (
    PREFERRED_CODEX_COMPONENT_MODEL_KEY,
    PREFERRED_CODEX_LAYOUT_MODEL_KEY,
)
from src.persistence.settings import get_setting

router = APIRouter(prefix="/code/codex/ui", tags=["Atlas Codex UI"])

_LAYOUT_CACHE: dict[str, CodexCenterLayoutSpec] = {}
_COMPONENT_CACHE: dict[str, CodexTurnComponentSpec] = {}


class CodexUiComposeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_id: str | None = None
    route: Literal["/codex"] = "/codex"
    viewport: Literal["mobile", "tablet", "desktop"] = "desktop"
    product: Literal["Atlas Codex"] = "Atlas Codex"
    audience: Literal["developer operator"] = "developer operator"
    surface: Literal["minimal conversational coding workspace"] = (
        "minimal conversational coding workspace"
    )
    cadence: list[
        Literal["user directive", "native reasoning summary", "assistant response"]
    ] = Field(
        default_factory=lambda: [
            "user directive",
            "native reasoning summary",
            "assistant response",
        ]
    )
    responsibilities: list[
        Literal[
            "choose center lane density",
            "choose safe labels",
            "choose compact empty state copy",
        ]
    ] = Field(
        default_factory=lambda: [
            "choose center lane density",
            "choose safe labels",
            "choose compact empty state copy",
        ]
    )
    force_refresh: bool = False

    def context_payload(self) -> dict[str, Any]:
        return CodexUiComposeContext(
            route=self.route,
            viewport=self.viewport,
            product=self.product,
            audience=self.audience,
            surface=self.surface,
            cadence=self.cadence,
            responsibilities=self.responsibilities,
        ).model_dump()


def codex_ui_cache_key(
    *,
    lane: Literal["layout", "components"],
    model_id: str,
    context: dict[str, Any],
) -> str:
    payload = json.dumps(
        {"lane": lane, "model_id": model_id, "context": context},
        default=str,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@router.post("/layout/compose")
async def compose_codex_layout(body: CodexUiComposeBody):
    model_id = await _resolve_preferred_model(
        explicit=body.model_id,
        key=PREFERRED_CODEX_LAYOUT_MODEL_KEY,
        default_model=settings.codex_layout_model,
    )
    context = body.context_payload()
    cache_key = codex_ui_cache_key(lane="layout", model_id=model_id, context=context)
    if not body.force_refresh and cache_key in _LAYOUT_CACHE:
        return {
            "model_id": model_id,
            "cached": True,
            "spec": _LAYOUT_CACHE[cache_key].model_dump(),
        }

    try:
        graph = build_codex_layout_graph(model_id=model_id)
        result = await graph.ainvoke({"context": context})
        spec = CodexCenterLayoutSpec.model_validate(result.get("spec"))
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Atlas Codex layout generator failed: {exc}",
        ) from exc

    _LAYOUT_CACHE[cache_key] = spec
    return {"model_id": model_id, "cached": False, "spec": spec.model_dump()}


@router.post("/components/compose")
async def compose_codex_components(body: CodexUiComposeBody):
    model_id = await _resolve_preferred_model(
        explicit=body.model_id,
        key=PREFERRED_CODEX_COMPONENT_MODEL_KEY,
        default_model=settings.codex_component_model,
    )
    context = body.context_payload()
    cache_key = codex_ui_cache_key(
        lane="components",
        model_id=model_id,
        context=context,
    )
    if not body.force_refresh and cache_key in _COMPONENT_CACHE:
        return {
            "model_id": model_id,
            "cached": True,
            "spec": _COMPONENT_CACHE[cache_key].model_dump(),
        }

    try:
        graph = build_codex_component_graph(model_id=model_id)
        result = await graph.ainvoke({"context": context})
        spec = CodexTurnComponentSpec.model_validate(result.get("spec"))
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Atlas Codex component generator failed: {exc}",
        ) from exc

    _COMPONENT_CACHE[cache_key] = spec
    return {"model_id": model_id, "cached": False, "spec": spec.model_dump()}


async def _resolve_preferred_model(
    *,
    explicit: str | None,
    key: str,
    default_model: str,
) -> str:
    if explicit and explicit.strip():
        return explicit.strip()
    preferred = (await get_setting(key, "")).strip()
    return preferred or default_model
