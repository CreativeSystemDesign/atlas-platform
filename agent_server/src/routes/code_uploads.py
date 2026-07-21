"""Atlas Code VM upload inbox."""

from __future__ import annotations

import re
import uuid
import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request

from src.config import settings

router = APIRouter(prefix="/operator/code", tags=["Atlas Code Uploads"])


def _safe_segment(value: str, fallback: str) -> str:
    segment = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    segment = segment.strip("._")
    return segment[:120] or fallback


@router.post("/uploads")
async def upload_code_file(
    request: Request,
    filename: str = Query(..., min_length=1),
    thread_id: str | None = Query(default=None),
) -> dict[str, object]:
    """Save one arbitrary browser-provided file into Atlas Code's VM inbox."""
    body = await request.body()
    original_name = filename.strip()
    if not original_name:
        raise HTTPException(status_code=400, detail="filename is required")

    bucket = _safe_segment(thread_id or "inbox", "inbox")
    safe_name = _safe_segment(Path(original_name).name, "upload.bin")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    upload_id = uuid.uuid4().hex[:12]
    root = Path(settings.code_upload_dir).expanduser().resolve()
    dest_dir = root / bucket
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{stamp}-{upload_id}-{safe_name}"
    dest.write_bytes(body)

    content_type = request.headers.get("content-type") or "application/octet-stream"
    metadata_path = dest.with_suffix(dest.suffix + ".metadata.json")
    metadata_path.write_text(
        json.dumps(
            {
                "original_name": original_name,
                "content_type": content_type,
                "size": len(body),
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return {
        "path": str(dest),
        "metadata_path": str(metadata_path),
        "original_name": original_name,
        "content_type": content_type,
        "size": len(body),
    }
