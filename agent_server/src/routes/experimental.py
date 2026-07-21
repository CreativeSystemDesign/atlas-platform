from __future__ import annotations

import base64
from datetime import UTC, datetime
import json
from pathlib import Path
import subprocess
from typing import Any
from uuid import uuid4

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/experimental", tags=["Experimental"])
workbench_router = APIRouter(prefix="/workbench/experimental", tags=["Experimental"])

_REPO_ROOT = Path(__file__).resolve().parents[3]
_DASHBOARD_ROOT = _REPO_ROOT / "atlas-dashboard"
_SCREENSHOT_SCRIPT = _DASHBOARD_ROOT / "scripts/experimental-capture-viewport.mjs"
_SCREENSHOT_PUBLIC_DIR = _DASHBOARD_ROOT / "public/experimental-captures"
_ANNOTATION_SAVE_DIR = _REPO_ROOT / ".atlas/experimental/annotation-layer-saves"


class ViewerStatePayload(BaseModel):
    source: str = "experimental-adobe-viewer"
    documentName: str = ""
    documentUrl: str = ""
    status: str = ""
    currentPage: int | None = None
    pageCount: int | None = None
    zoom: float | None = None
    selectedText: str = ""
    gridSelection: dict[str, Any] | None = None
    pdfTitle: str = ""
    lastEvent: dict[str, Any] | None = None
    capturedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class ViewerPointerPayload(BaseModel):
    source: str = "codex-skill"
    x: int = Field(ge=0, le=1000)
    y: int = Field(ge=0, le=1000)
    note: str = ""
    label: str = ""
    durationMs: int | None = Field(default=None, ge=500, le=300000)
    capturedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class ViewerAnnotationPayload(BaseModel):
    source: str = "codex-skill"
    label: str
    x1: int = Field(ge=0, le=1000)
    y1: int = Field(ge=0, le=1000)
    x2: int = Field(ge=0, le=1000)
    y2: int = Field(ge=0, le=1000)
    note: str = ""
    color: str = "emerald"
    id: str | None = None
    capturedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class ViewerAnnotationUpdatePayload(BaseModel):
    label: str | None = None
    x1: int | None = Field(default=None, ge=0, le=1000)
    y1: int | None = Field(default=None, ge=0, le=1000)
    x2: int | None = Field(default=None, ge=0, le=1000)
    y2: int | None = Field(default=None, ge=0, le=1000)
    note: str | None = None
    color: str | None = None


class ViewerCommandPayload(BaseModel):
    source: str = "codex-skill"
    type: str
    note: str = ""
    id: str | None = None
    capturedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class ViewerScreenshotPayload(BaseModel):
    source: str = "experimental-pdfjs-viewer"
    pageUrl: str
    viewportWidth: int = Field(default=1440, ge=640, le=3840)
    viewportHeight: int = Field(default=900, ge=480, le=2160)
    gridSelection: dict[str, Any] | None = None
    viewerPointer: dict[str, Any] | None = None
    annotations: list[dict[str, Any]] = Field(default_factory=list)
    cursor: dict[str, Any] | None = None
    mode: str = ""
    viewerState: dict[str, Any] | None = None
    capturedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class ViewerScreenshotUploadPayload(ViewerScreenshotPayload):
    imageDataUrl: str


_LATEST_VIEWER_STATE: dict[str, Any] = {
    "available": False,
    "message": "No experimental viewer state has been published yet.",
}

_LATEST_VIEWER_POINTER: dict[str, Any] = {
    "available": False,
    "message": "No experimental viewer pointer has been published yet.",
}

_VIEWER_ANNOTATIONS: list[dict[str, Any]] = []

_LATEST_VIEWER_COMMAND: dict[str, Any] = {
    "available": False,
    "message": "No experimental viewer command has been published yet.",
}

_LATEST_VIEWER_SCREENSHOT: dict[str, Any] = {
    "available": False,
    "message": "No experimental viewer screenshot has been captured yet.",
}

_LATEST_ANNOTATION_SAVE: dict[str, Any] = {
    "available": False,
    "message": "No experimental annotation save has been created yet.",
}


def _annotation_index(annotation_id: str) -> int | None:
    for index, annotation in enumerate(_VIEWER_ANNOTATIONS):
        if annotation.get("id") == annotation_id or annotation.get("displayId") == annotation_id:
            return index
    return None


def _normalize_annotation_geometry(annotation: dict[str, Any]) -> None:
    x1 = int(annotation["x1"])
    x2 = int(annotation["x2"])
    y1 = int(annotation["y1"])
    y2 = int(annotation["y2"])
    annotation["x1"] = min(x1, x2)
    annotation["x2"] = max(x1, x2)
    annotation["y1"] = min(y1, y2)
    annotation["y2"] = max(y1, y2)
    annotation["width"] = annotation["x2"] - annotation["x1"]
    annotation["height"] = annotation["y2"] - annotation["y1"]


@router.get("/viewer-state")
@workbench_router.get("/viewer-state")
async def get_experimental_viewer_state() -> dict[str, Any]:
    return _LATEST_VIEWER_STATE


@router.post("/viewer-state")
@workbench_router.post("/viewer-state")
async def put_experimental_viewer_state(payload: ViewerStatePayload) -> dict[str, Any]:
    global _LATEST_VIEWER_STATE
    data = payload.model_dump()
    data["available"] = True
    data["receivedAt"] = datetime.now(UTC).isoformat()
    _LATEST_VIEWER_STATE = data
    return {"ok": True, "receivedAt": data["receivedAt"]}


@router.get("/viewer-pointer")
@workbench_router.get("/viewer-pointer")
async def get_experimental_viewer_pointer() -> dict[str, Any]:
    return _LATEST_VIEWER_POINTER


@router.post("/viewer-pointer")
@workbench_router.post("/viewer-pointer")
async def put_experimental_viewer_pointer(payload: ViewerPointerPayload) -> dict[str, Any]:
    global _LATEST_VIEWER_POINTER
    data = payload.model_dump()
    data["available"] = True
    data["receivedAt"] = datetime.now(UTC).isoformat()
    data["label"] = data["label"] or f"x {data['x']}, y {data['y']}"
    _LATEST_VIEWER_POINTER = data
    return {"ok": True, "receivedAt": data["receivedAt"]}


@router.delete("/viewer-pointer")
@workbench_router.delete("/viewer-pointer")
async def clear_experimental_viewer_pointer() -> dict[str, Any]:
    global _LATEST_VIEWER_POINTER
    _LATEST_VIEWER_POINTER = {
        "available": False,
        "message": "No experimental viewer pointer has been published yet.",
        "clearedAt": datetime.now(UTC).isoformat(),
    }
    return {"ok": True, "clearedAt": _LATEST_VIEWER_POINTER["clearedAt"]}


@router.get("/viewer-annotations")
@workbench_router.get("/viewer-annotations")
async def get_experimental_viewer_annotations() -> dict[str, Any]:
    return {
        "available": True,
        "annotations": _VIEWER_ANNOTATIONS,
        "count": len(_VIEWER_ANNOTATIONS),
    }


@router.post("/viewer-annotations")
@workbench_router.post("/viewer-annotations")
async def add_experimental_viewer_annotation(
    payload: ViewerAnnotationPayload,
) -> dict[str, Any]:
    x1 = min(payload.x1, payload.x2)
    x2 = max(payload.x1, payload.x2)
    y1 = min(payload.y1, payload.y2)
    y2 = max(payload.y1, payload.y2)
    data = payload.model_dump()
    data.update(
        {
            "id": payload.id or str(uuid4()),
            "displayId": f"B{len(_VIEWER_ANNOTATIONS) + 1}",
            "x1": x1,
            "x2": x2,
            "y1": y1,
            "y2": y2,
            "width": x2 - x1,
            "height": y2 - y1,
            "available": True,
            "receivedAt": datetime.now(UTC).isoformat(),
        }
    )
    _VIEWER_ANNOTATIONS.append(data)
    return {"ok": True, "annotation": data, "count": len(_VIEWER_ANNOTATIONS)}


@router.delete("/viewer-annotations")
@workbench_router.delete("/viewer-annotations")
async def clear_experimental_viewer_annotations() -> dict[str, Any]:
    removed = len(_VIEWER_ANNOTATIONS)
    _VIEWER_ANNOTATIONS.clear()
    return {
        "ok": True,
        "removed": removed,
        "clearedAt": datetime.now(UTC).isoformat(),
    }


@router.patch("/viewer-annotations/{annotation_id}")
@workbench_router.patch("/viewer-annotations/{annotation_id}")
async def update_experimental_viewer_annotation(
    annotation_id: str,
    payload: ViewerAnnotationUpdatePayload,
) -> dict[str, Any]:
    index = _annotation_index(annotation_id)
    if index is None:
        return {"ok": False, "error": "annotation not found"}
    annotation = _VIEWER_ANNOTATIONS[index]
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if value is not None:
            annotation[key] = value
    _normalize_annotation_geometry(annotation)
    annotation["updatedAt"] = datetime.now(UTC).isoformat()
    return {"ok": True, "annotation": annotation}


@router.delete("/viewer-annotations/{annotation_id}")
@workbench_router.delete("/viewer-annotations/{annotation_id}")
async def delete_experimental_viewer_annotation(annotation_id: str) -> dict[str, Any]:
    index = _annotation_index(annotation_id)
    if index is None:
        return {"ok": False, "error": "annotation not found"}
    removed = _VIEWER_ANNOTATIONS.pop(index)
    return {
        "ok": True,
        "removed": removed,
        "count": len(_VIEWER_ANNOTATIONS),
        "deletedAt": datetime.now(UTC).isoformat(),
    }


@router.get("/viewer-command")
@workbench_router.get("/viewer-command")
async def get_experimental_viewer_command() -> dict[str, Any]:
    return _LATEST_VIEWER_COMMAND


@router.post("/viewer-command")
@workbench_router.post("/viewer-command")
async def put_experimental_viewer_command(payload: ViewerCommandPayload) -> dict[str, Any]:
    global _LATEST_VIEWER_COMMAND
    data = payload.model_dump()
    data["id"] = data["id"] or str(uuid4())
    data["available"] = True
    data["receivedAt"] = datetime.now(UTC).isoformat()
    _LATEST_VIEWER_COMMAND = data
    return {"ok": True, "command": data}


@router.get("/viewer-screenshot")
@workbench_router.get("/viewer-screenshot")
async def get_experimental_viewer_screenshot() -> dict[str, Any]:
    return _LATEST_VIEWER_SCREENSHOT


@router.post("/viewer-screenshot")
@workbench_router.post("/viewer-screenshot")
async def capture_experimental_viewer_screenshot(
    payload: ViewerScreenshotPayload,
) -> dict[str, Any]:
    global _LATEST_VIEWER_SCREENSHOT
    _SCREENSHOT_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    filename = f"experimental-viewer-{timestamp}.png"
    manifest_filename = f"experimental-viewer-{timestamp}.json"
    output_path = _SCREENSHOT_PUBLIC_DIR / filename
    manifest_path = _SCREENSHOT_PUBLIC_DIR / manifest_filename
    command = [
        "node",
        str(_SCREENSHOT_SCRIPT),
        "--url",
        payload.pageUrl,
        "--output",
        str(output_path),
        "--width",
        str(payload.viewportWidth),
        "--height",
        str(payload.viewportHeight),
    ]
    result = subprocess.run(
        command,
        cwd=str(_DASHBOARD_ROOT),
        capture_output=True,
        text=True,
        timeout=45,
        check=False,
    )
    if result.returncode != 0:
        return {
            "ok": False,
            "error": result.stderr.strip() or result.stdout.strip() or "screenshot failed",
        }

    captured_at = datetime.now(UTC).isoformat()
    manifest = {
        "available": True,
        "imagePath": str(output_path),
        "imageUrl": f"/experimental-captures/{filename}",
        "imageFilename": filename,
        "pageUrl": payload.pageUrl,
        "viewportWidth": payload.viewportWidth,
        "viewportHeight": payload.viewportHeight,
        "gridSelection": payload.gridSelection,
        "viewerPointer": payload.viewerPointer,
        "annotations": payload.annotations,
        "annotationCount": len(payload.annotations),
        "cursor": payload.cursor,
        "mode": payload.mode,
        "viewerState": payload.viewerState,
        "captureSource": payload.source,
        "capturedAt": captured_at,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    data = {
        "available": True,
        "path": str(output_path),
        "url": f"/experimental-captures/{filename}",
        "filename": filename,
        "manifestPath": str(manifest_path),
        "manifestUrl": f"/experimental-captures/{manifest_filename}",
        "manifestFilename": manifest_filename,
        "pageUrl": payload.pageUrl,
        "viewportWidth": payload.viewportWidth,
        "viewportHeight": payload.viewportHeight,
        "captureSource": payload.source,
        "capturedAt": captured_at,
    }
    _LATEST_VIEWER_SCREENSHOT = data
    return {"ok": True, "screenshot": data}


@router.post("/viewer-screenshot/upload")
@workbench_router.post("/viewer-screenshot/upload")
async def upload_experimental_viewer_screenshot(
    payload: ViewerScreenshotUploadPayload,
) -> dict[str, Any]:
    global _LATEST_VIEWER_SCREENSHOT
    _SCREENSHOT_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    filename = f"experimental-viewer-{timestamp}.png"
    manifest_filename = f"experimental-viewer-{timestamp}.json"
    output_path = _SCREENSHOT_PUBLIC_DIR / filename
    manifest_path = _SCREENSHOT_PUBLIC_DIR / manifest_filename

    prefix = "data:image/png;base64,"
    if not payload.imageDataUrl.startswith(prefix):
        return {"ok": False, "error": "Expected a PNG data URL."}
    try:
        image_bytes = base64.b64decode(payload.imageDataUrl[len(prefix) :], validate=True)
    except Exception as exc:
        return {"ok": False, "error": f"Invalid PNG data URL: {exc}"}
    output_path.write_bytes(image_bytes)

    captured_at = datetime.now(UTC).isoformat()
    manifest = {
        "available": True,
        "imagePath": str(output_path),
        "imageUrl": f"/experimental-captures/{filename}",
        "imageFilename": filename,
        "pageUrl": payload.pageUrl,
        "viewportWidth": payload.viewportWidth,
        "viewportHeight": payload.viewportHeight,
        "gridSelection": payload.gridSelection,
        "viewerPointer": payload.viewerPointer,
        "annotations": payload.annotations,
        "annotationCount": len(payload.annotations),
        "cursor": payload.cursor,
        "mode": payload.mode,
        "viewerState": payload.viewerState,
        "captureSource": payload.source,
        "capturedAt": captured_at,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    data = {
        "available": True,
        "path": str(output_path),
        "url": f"/experimental-captures/{filename}",
        "filename": filename,
        "manifestPath": str(manifest_path),
        "manifestUrl": f"/experimental-captures/{manifest_filename}",
        "manifestFilename": manifest_filename,
        "pageUrl": payload.pageUrl,
        "viewportWidth": payload.viewportWidth,
        "viewportHeight": payload.viewportHeight,
        "captureSource": payload.source,
        "capturedAt": captured_at,
    }
    _LATEST_VIEWER_SCREENSHOT = data
    return {"ok": True, "screenshot": data}


@router.get("/viewer-annotations/save")
@workbench_router.get("/viewer-annotations/save")
async def get_experimental_annotation_save() -> dict[str, Any]:
    return _LATEST_ANNOTATION_SAVE


@router.post("/viewer-annotations/save")
@workbench_router.post("/viewer-annotations/save")
async def save_experimental_viewer_annotations() -> dict[str, Any]:
    global _LATEST_ANNOTATION_SAVE
    _ANNOTATION_SAVE_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    output_path = _ANNOTATION_SAVE_DIR / f"experimental-annotations-{timestamp}.json"
    payload = {
        "savedAt": datetime.now(UTC).isoformat(),
        "count": len(_VIEWER_ANNOTATIONS),
        "annotations": _VIEWER_ANNOTATIONS,
    }
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    data = {
        "available": True,
        "path": str(output_path),
        "count": len(_VIEWER_ANNOTATIONS),
        "savedAt": payload["savedAt"],
    }
    _LATEST_ANNOTATION_SAVE = data
    return {"ok": True, "save": data}
