from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response

from src.persistence.langgraph_store import sync_store_context

router = APIRouter(tags=["Artifacts"])

_ARCHITECT_MEMORY_PREFIX = "/memories/"
_ARCHITECT_MEMORY_NAMESPACE = ("atlas-architect", "memories")


def _zip_directory(directory: Path) -> Path:
    temp_dir = Path(tempfile.mkdtemp(prefix="atlas-artifact-zip-"))
    archive_base = temp_dir / directory.name
    archive_path = shutil.make_archive(str(archive_base), "zip", root_dir=directory)
    return Path(archive_path)


def _download_architect_memory(path: str) -> Response:
    suffix = path[len(_ARCHITECT_MEMORY_PREFIX) :]
    if not suffix:
        raise HTTPException(status_code=400, detail="/memories/ artifact path must include a file")
    key = f"/{suffix}"
    with sync_store_context() as store:
        item = store.get(_ARCHITECT_MEMORY_NAMESPACE, key)
    if item is None:
        raise HTTPException(status_code=404, detail="memory artifact not found")
    content = item.value.get("content", "")
    if not isinstance(content, str):
        raise HTTPException(status_code=400, detail="memory artifact content is not text")
    filename = Path(key).name or "memory.md"
    media_type = "text/markdown; charset=utf-8" if filename.endswith(".md") else "text/plain; charset=utf-8"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get('/artifacts/download')
def download_artifact(path: str = Query(..., description='Absolute filesystem path to a downloadable artifact or directory')):
    if path.startswith(_ARCHITECT_MEMORY_PREFIX):
        return _download_architect_memory(path)

    candidate = Path(path).expanduser()
    if not candidate.is_absolute():
        raise HTTPException(status_code=400, detail='path must be absolute')
    try:
        resolved = candidate.resolve()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f'could not resolve path: {exc}') from exc
    if not resolved.exists():
        raise HTTPException(status_code=404, detail='artifact not found')
    if resolved.is_dir():
        archive = _zip_directory(resolved)
        return FileResponse(archive, filename=f"{resolved.name}.zip", media_type='application/zip')
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail='path must point to a file or directory')
    return FileResponse(resolved, filename=resolved.name, media_type='application/octet-stream')
