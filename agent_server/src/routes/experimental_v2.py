"""Experimental v2 smart-canvas persistence — Neon-backed logic-graph workspace.

Replaces the localStorage-only draft store. The v2 graph now lives in Neon
(``schematic_v2_graph``), a sibling to the other annotation workspaces, kept
separate. The browser keeps a localStorage copy only as an offline cache.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.persistence.v2_cables import load_cable_registry, save_cable_registry
from src.persistence.v2_continuations import (
    load_continuation_registry,
    save_page_sightings,
    sheet_ref_for_page,
)
from src.persistence.v2_graph import empty_graph, load_v2_graph, save_v2_graph
from src.persistence.v2_graph_import import build_v2_graph_from_legacy

router = APIRouter(prefix="/experimental-v2", tags=["Experimental v2"])

_DEFAULT_PROJECT_ID = "00000000-0000-4000-8000-000000001650"
_DEFAULT_DOCUMENT_ID = "schematic_<drawing-no>"


def _project_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="invalid project_id") from exc


@router.get("/yolo")
async def get_yolo_detections(page: int = Query(...)) -> dict[str, Any]:
    """Per-page detector evidence for the canvas YOLO layer (v4 layer pills).
    Serves the precomputed page-scan sidecar the copilot already reads — never
    fresh inference, offline-safe (absent sidecar degrades to an empty list)."""
    try:
        from src.canvas_copilot import yolo

        return {"page": page, "detections": yolo.page_detections(page)}
    except Exception:
        return {"page": page, "detections": []}


class V2GraphBody(BaseModel):
    projectId: str = _DEFAULT_PROJECT_ID
    documentId: str = _DEFAULT_DOCUMENT_ID
    pageNum: int = Field(ge=1)
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    ports: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    continuations: list[dict[str, Any]] = Field(default_factory=list)
    grounds: list[dict[str, Any]] = Field(default_factory=list)
    cables: list[dict[str, Any]] = Field(default_factory=list)
    source: str = "human"


def _envelope(
    graph: dict[str, Any],
    *,
    project_id: str,
    document_id: str,
    page_num: int,
    seeded: bool,
    sheet_ref: str | None = None,
) -> dict[str, Any]:
    return {
        "available": True,
        "seededFromLegacy": seeded,
        "graph": graph,
        "projectId": project_id,
        "documentId": document_id,
        "pageNum": page_num,
        # The page's printed sheet fraction ("5/207") — sheet != page, and
        # continuation refs name SHEETS; the canvas needs its own sheet to
        # compute cross-page resolution (Shane's green-chip design).
        "sheetRef": sheet_ref,
    }


@router.get("/graph")
async def get_v2_graph(
    page_num: int = Query(ge=1),
    project_id: str = _DEFAULT_PROJECT_ID,
    document_id: str = _DEFAULT_DOCUMENT_ID,
    seed_from_legacy: bool = True,
) -> dict[str, Any]:
    """Load the saved v2 graph for a page.

    If nothing is saved yet and ``seed_from_legacy`` is set, return a graph built
    from the legacy digital-twin annotations (NOT yet persisted — it becomes
    persisted on the operator's first edit via the autosave PUT).
    """
    pid = _project_uuid(project_id)
    try:
        sheet_ref = await sheet_ref_for_page(pid, document_id, page_num)
    except Exception:
        sheet_ref = None
    saved = await load_v2_graph(pid, document_id, page_num)
    if saved is not None:
        return _envelope(saved, project_id=project_id, document_id=document_id, page_num=page_num, seeded=False, sheet_ref=sheet_ref)
    if seed_from_legacy:
        seeded = await build_v2_graph_from_legacy(pid, document_id, page_num)
        if any(seeded[key] for key in ("nodes", "ports", "edges", "continuations")):
            return _envelope(seeded, project_id=project_id, document_id=document_id, page_num=page_num, seeded=True, sheet_ref=sheet_ref)
    return _envelope(empty_graph(), project_id=project_id, document_id=document_id, page_num=page_num, seeded=False, sheet_ref=sheet_ref)


@router.put("/graph")
@router.post("/graph")
async def put_v2_graph(body: V2GraphBody) -> dict[str, Any]:
    """Upsert the whole per-page v2 graph to Neon (called by autosave)."""
    pid = _project_uuid(body.projectId)
    result = await save_v2_graph(
        pid,
        body.documentId,
        body.pageNum,
        {
            "nodes": body.nodes,
            "ports": body.ports,
            "edges": body.edges,
            "continuations": body.continuations,
            "grounds": body.grounds,
            "cables": body.cables,
        },
        source=body.source,
    )
    return {"ok": True, "pageNum": body.pageNum, **result}


class CableRegistryBody(BaseModel):
    projectId: str = _DEFAULT_PROJECT_ID
    documentId: str = _DEFAULT_DOCUMENT_ID
    cables: dict[str, Any] = Field(default_factory=dict)


class ContinuationSightingsBody(BaseModel):
    projectId: str = _DEFAULT_PROJECT_ID
    documentId: str = _DEFAULT_DOCUMENT_ID
    pageNum: int
    # {"sheet": "5", "sightings": [{contId, net, refSheet, refZone, rawRef}]}
    entry: dict[str, Any] = Field(default_factory=dict)


@router.get("/cables")
async def get_cable_registry(
    project_id: str = _DEFAULT_PROJECT_ID,
    document_id: str = _DEFAULT_DOCUMENT_ID,
) -> dict[str, Any]:
    """The document-level cable registry: cable name -> conductor roster.
    Same name on any page = the same physical cable (Shane's design)."""
    pid = _project_uuid(project_id)
    result = await load_cable_registry(pid, document_id)
    return {"ok": True, "projectId": project_id, "documentId": document_id, **result}


@router.put("/cables")
@router.post("/cables")
async def put_cable_registry(body: CableRegistryBody) -> dict[str, Any]:
    """Upsert the whole cable registry (called by the canvas autosave)."""
    pid = _project_uuid(body.projectId)
    result = await save_cable_registry(pid, body.documentId, body.cables)
    return {"ok": True, **result}


@router.get("/continuations")
async def get_continuation_registry(
    project_id: str = _DEFAULT_PROJECT_ID,
    document_id: str = _DEFAULT_DOCUMENT_ID,
) -> dict[str, Any]:
    """The document-level continuation registry: page -> {sheet, sightings}.
    Reciprocal sightings pair into RESOLVED cross-page links (derived, never
    stored — Shane's green-chip design, 2026-07-11)."""
    pid = _project_uuid(project_id)
    result = await load_continuation_registry(pid, document_id)
    return {"ok": True, "projectId": project_id, "documentId": document_id, **result}


@router.put("/continuations/page")
@router.post("/continuations/page")
async def put_continuation_sightings(body: ContinuationSightingsBody) -> dict[str, Any]:
    """Merge ONE page's continuation sightings (canvas autosave; a page only
    ever writes its own key, so concurrent canvases can't clobber)."""
    pid = _project_uuid(body.projectId)
    result = await save_page_sightings(pid, body.documentId, body.pageNum, body.entry)
    return {"ok": True, **result}


@router.post("/import-legacy")
async def import_legacy(
    page_num: int = Query(ge=1),
    project_id: str = _DEFAULT_PROJECT_ID,
    document_id: str = _DEFAULT_DOCUMENT_ID,
    save: bool = False,
) -> dict[str, Any]:
    """Build a v2 graph from the legacy digital-twin annotations for a page.

    ``save=true`` persists it (upsert); otherwise it is returned for preview.
    """
    pid = _project_uuid(project_id)
    seeded = await build_v2_graph_from_legacy(pid, document_id, page_num)
    saved_result = None
    if save:
        saved_result = await save_v2_graph(pid, document_id, page_num, seeded, source="legacy-import")
    return {"ok": True, "pageNum": page_num, "graph": seeded, "saved": saved_result}
