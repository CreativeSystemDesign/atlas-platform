"""Documents + intake slice 1 (Platform Graduation R1/R3/R14).

This is intake's first physical slice: upload → staging write → SHA-256 →
per-project dedup → immutable original → documents row. The derivative
fan-out (vector dump, masters, workspace PNGs) belongs to the intake worker
(next slice); a document uploaded here honestly reports status='processing'
with zero derivatives until the worker exists.

R3: files live OUTSIDE the repo under ATLAS_DATA_ROOT
    ({root}/{project_slug}/originals/...). Originals are chmod read-only.
G39: an uploaded original is provisional until its Neon record commits —
    the file writes to a staging name and is finalized only after INSERT;
    on any failure the staging file is removed.
R14 dedup: identical hash within a project is refused with a pointer to the
    existing record; cross-project duplicates are legitimate.
R1: the slug is minted here and IMMUTABLE afterward (normalized_name is
    display metadata, never identity).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from psycopg import errors
from pydantic import BaseModel, Field

from src.config import settings
from src.intake_classify import LANES, pages_to_ranges
from src.persistence.database import get_pool

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["Documents"])


def data_root() -> Path:
    root = settings.atlas_data_root or str(Path.home() / "atlas-data")
    return Path(root)


def _slugify_document(name: str) -> str:
    stem = Path(name).stem
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("_").lower()
    return slug or f"document_{uuid.uuid4().hex[:8]}"


@router.get("")
async def list_documents(project_id: uuid.UUID) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT document_id, normalized_name, original_name, content_sha256, "
            "classification, status, revision_label, created_at, "
            "classification_state, classification_detail, "
            "description, skim_state, skim_detail, source_path, source_label, "
            "working_path "
            "FROM documents WHERE project_id = %s ORDER BY created_at",
            (project_id,))
        docs = await cur.fetchall()
        cur = await conn.execute(
            "SELECT document_id, page_num, lane, lane_source FROM schematic_sheet_index "
            "WHERE project_id = %s AND lane IS NOT NULL ORDER BY document_id, page_num",
            (project_id,))
        page_rows = await cur.fetchall()
        cur = await conn.execute(
            "SELECT document_id, kind, status, pages_done, pages_total "
            "FROM document_derivative_jobs WHERE project_id = %s",
            (project_id,))
        job_rows = await cur.fetchall()
        # Extraction rollup (phase 3, 2026-07-20): the "what's left" metric —
        # per doc, how many tables exist and how many are certified.
        cur = await conn.execute(
            "SELECT metadata->>'document_id', count(*), "
            "count(*) FILTER (WHERE metadata->>'status' = 'certified') "
            "FROM document_extractions WHERE project_id = %s "
            "AND metadata->>'document_id' IS NOT NULL "
            "AND metadata->>'table_name' IS NOT NULL GROUP BY 1",
            (project_id,))
        extraction_rows = await cur.fetchall()
    per_doc: dict[str, list[tuple[int, str | None, str | None]]] = {}
    for doc, page, lane, source in page_rows:
        per_doc.setdefault(doc, []).append((int(page), lane, source))
    # Honest intake state (Shane's 2026-07-13 catch: the worker is SERIAL —
    # one document processes at a time, the rest WAIT; a blanket 'processing'
    # chip lies). Derived from the job ledger: a doc is processing only if a
    # job of its is actually running right now; otherwise it's queued.
    intake: dict[str, dict[str, Any]] = {}
    for doc, kind, status, pages_done, pages_total in job_rows:
        s = intake.setdefault(doc, {"stages_total": 0, "stages_completed": 0, "running": None})
        s["stages_total"] += 1
        if status == "completed":
            s["stages_completed"] += 1
        elif status == "running":
            s["running"] = {"kind": kind, "pages_done": pages_done, "pages_total": pages_total}
    lanes: dict[str, dict[str, int]] = {}
    for doc, rows in per_doc.items():
        for _, lane, _src in rows:
            if lane:
                lanes.setdefault(doc, {})[lane] = lanes.get(doc, {}).get(lane, 0) + 1
    extractions = {doc: {"tables": int(n), "certified": int(c)}
                   for doc, n, c in extraction_rows}
    return {
        "documents": [
            {
                "document_id": d[0], "normalized_name": d[1], "original_name": d[2],
                "content_sha256": d[3], "classification": d[4], "status": d[5],
                "revision_label": d[6], "created_at": d[7].isoformat() if d[7] else None,
                "classification_state": d[8], "classification_detail": d[9],
                "description": d[10], "skim_state": d[11], "skim_detail": d[12],
                "source_path": d[13], "source_label": d[14], "working_path": d[15],
                "intake": intake.get(d[0]),
                "lanes": lanes.get(d[0], {}),
                "extractions": extractions.get(d[0]),
                # R11: contiguous equal-(lane,source) runs computed on read.
                "routing": pages_to_ranges(per_doc.get(d[0], [])),
            }
            for d in docs
        ]
    }


async def _workspace_dir(project_id: uuid.UUID, document_id: str) -> Path:
    """Resolve a document's workspace-render directory, verifying ownership."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT p.slug FROM documents d JOIN projects p ON p.project_id = d.project_id "
            "WHERE d.document_id = %s AND d.project_id = %s",
            (document_id, project_id))
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="document not found")
    return data_root() / row[0] / "workspace" / document_id


@router.get("/{document_id}/pages")
async def document_pages(project_id: uuid.UUID, document_id: str) -> dict[str, Any]:
    """Page inventory for the viewer — counted from the workspace renders
    that actually exist on disk, never asserted from job metadata."""
    ws = await _workspace_dir(project_id, document_id)
    pages = sorted(p.name for p in ws.glob("page-*.png")) if ws.is_dir() else []
    return {"document_id": document_id, "pages": len(pages), "tier": "workspace-300dpi"}


@router.get("/{document_id}/pages/{page_num}/text")
async def document_page_text(
    project_id: uuid.UUID, document_id: str, page_num: int
) -> dict[str, Any]:
    """The page's vector text blocks (page-px positions) — feeds the
    viewer's selectable text layer (PDF.js pattern: invisible glyphs over
    the render so the mouse selects real text)."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT 1 FROM documents WHERE document_id = %s AND project_id = %s",
            (document_id, project_id))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="document not found")
        cur = await conn.execute(
            "SELECT text, bbox_px FROM schematic_page_text_blocks "
            "WHERE document_id = %s AND page_num = %s "
            "ORDER BY (bbox_px->>'y')::float, (bbox_px->>'x')::float",
            (document_id, page_num))
        rows = await cur.fetchall()
    return {"page": page_num, "blocks": [
        {"text": t, "x": float(b["x"]), "y": float(b["y"]),
         "w": float(b["width"]), "h": float(b["height"])}
        for t, b in rows
    ]}


@router.get("/{document_id}/pages/{page_num}/image")
async def document_page_image(
    project_id: uuid.UUID, document_id: str, page_num: int
) -> FileResponse:
    if page_num < 1 or page_num > 9999:
        raise HTTPException(status_code=422, detail="page out of range")
    ws = await _workspace_dir(project_id, document_id)
    path = ws / f"page-{page_num:04d}.png"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"no render for page {page_num}")
    return FileResponse(str(path), media_type="image/png",
                        headers={"Cache-Control": "private, max-age=3600"})


@router.get("/{document_id}/pages/{page_num}/crop")
async def document_page_crop(
    project_id: uuid.UUID, document_id: str, page_num: int,
    x: float = Query(..., ge=0), y: float = Query(..., ge=0),
    w: float = Query(..., gt=0), h: float = Query(..., gt=0),
    max_px: int = Query(default=1600, ge=64, le=4000),
) -> Response:
    """A crop of the pre-rendered page (the 300dpi PNG) at the given page-px
    bbox — the DocumentViewer's capture tool, so Shane can snip a region and
    hand Arc a clean image with its provenance. No re-render: crop the render
    file and downscale to max_px on the long side. (x,y,w,h) are in the PNG's
    own pixel space, which is exactly the viewer's imgDims space."""
    if page_num < 1 or page_num > 9999:
        raise HTTPException(status_code=422, detail="page out of range")
    ws = await _workspace_dir(project_id, document_id)
    path = ws / f"page-{page_num:04d}.png"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"no render for page {page_num}")
    from io import BytesIO

    from PIL import Image
    with Image.open(path) as im:
        W, H = im.size
        x0 = max(0, min(int(x), W - 1))
        y0 = max(0, min(int(y), H - 1))
        x1 = max(x0 + 1, min(int(x + w), W))
        y1 = max(y0 + 1, min(int(y + h), H))
        crop = im.crop((x0, y0, x1, y1)).convert("RGB")
        longest = max(crop.size)
        if longest > max_px:
            s = max_px / longest
            crop = crop.resize((max(1, round(crop.width * s)), max(1, round(crop.height * s))))
        buf = BytesIO()
        crop.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png",
                    headers={"Cache-Control": "no-store"})


@router.delete("/{document_id}")
async def delete_document(project_id: uuid.UUID, document_id: str) -> dict[str, Any]:
    """Remove a document from the library — row, jobs, text dumps, routing
    rows, and files. REFUSED for any document certification seals reference (append-
    only identity is untouchable). Real deletion, not soft: the point is
    cleaning mistakes, and a lingering row would keep dedup refusing the
    corrected re-upload."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT d.original_path, d.working_path, p.slug FROM documents d "
            "JOIN projects p ON p.project_id = d.project_id "
            "WHERE d.document_id = %s AND d.project_id = %s",
            (document_id, project_id))
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="document not found")
        cur = await conn.execute(
            "SELECT COUNT(*) FROM gold_sealed_annotations WHERE document_id = %s",
            (document_id,))
        seals = (await cur.fetchone())[0]
        if seals:
            raise HTTPException(
                status_code=409,
                detail=f"refused: {seals} certified seal(s) reference this document — "
                       "sealed identity is never deleted")
        original_path, working_path, project_slug = row
        await conn.execute(
            "DELETE FROM document_derivative_jobs WHERE document_id = %s", (document_id,))
        await conn.execute(
            "DELETE FROM schematic_page_text_blocks WHERE document_id = %s "
            "AND source = 'intake-worker'", (document_id,))
        await conn.execute(
            "DELETE FROM schematic_sheet_index WHERE document_id = %s", (document_id,))
        await conn.execute(
            "DELETE FROM documents WHERE document_id = %s", (document_id,))
        await conn.commit()

    import shutil

    root = data_root() / project_slug
    for f in (original_path, working_path):
        if f:
            Path(f).unlink(missing_ok=True)
    for tier in ("masters", "workspace"):
        shutil.rmtree(root / tier / document_id, ignore_errors=True)
    return {"document_id": document_id, "deleted": True}


@router.post("/{document_id}/generate-skim")
async def generate_skim(project_id: uuid.UUID, document_id: str) -> dict[str, Any]:
    """On-demand skim DRAFT (Shane's Generate button): runs the skim and
    returns the proposal WITHOUT persisting — the editor fills its fields
    and Shane's Save is what commits (as shane-confirmed). This keeps the
    mechanical never-overwrite-confirmed guards absolute while letting him
    invoke Arc on any document, the schematic included. In-process by the
    same named exception the Parser Lab's sample runs use (interactive,
    user-initiated, no heavy rendering, no production writes)."""
    from src.intake_skim import skim_document

    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT original_path FROM documents "
            "WHERE document_id = %s AND project_id = %s", (document_id, project_id))
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="document not found")
    if not row[0] or not Path(row[0]).is_file():
        raise HTTPException(status_code=409, detail="document has no readable original")
    proposal = await skim_document(row[0])
    return {
        "normalized_name": proposal["normalized_name"],
        "description": proposal["description"],
        "confidence": proposal["confidence"],
        "model": proposal["model"],
        "mode": proposal["mode"],
        "persisted": False,
    }


class ConfirmSkim(BaseModel):
    normalized_name: str | None = None
    description: str | None = None


@router.post("/{document_id}/confirm-skim")
async def confirm_skim(
    project_id: uuid.UUID, document_id: str, body: ConfirmSkim
) -> dict[str, Any]:
    """Shane's confirm for the skim proposal (optionally edited). The only
    minter of skim_state='shane-confirmed'; re-enqueues the working-copy
    stamp so the file projection follows the Neon truth."""
    # An EXPLICITLY SENT empty description is a deliberate clear and must
    # stick (review finding 2026-07-13: COALESCE silently revived Arc's
    # rejected text and the confirm locked it in with no edit path left).
    # An omitted field keeps the current value.
    desc_sent = "description" in body.model_fields_set
    desc_value = (body.description or "").strip()[:2000] or None if desc_sent else None
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "UPDATE documents SET "
            "normalized_name = COALESCE(%s, normalized_name), "
            "description = CASE WHEN %s THEN %s ELSE description END, "
            "skim_state = 'shane-confirmed', updated_at = now() "
            "WHERE document_id = %s AND project_id = %s "
            "RETURNING normalized_name, description",
            ((body.normalized_name or "").strip()[:200] or None,
             desc_sent, desc_value,
             document_id, project_id))
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="document not found")
        # Dedup against QUEUED only — a running stamp snapshotted Neon at
        # claim time and must not swallow this confirm's re-stamp (review
        # finding 2026-07-13); duplicate stamps are idempotent.
        await conn.execute(
            "INSERT INTO document_derivative_jobs (project_id, document_id, kind) "
            "SELECT %s, %s, 'working-copy' WHERE NOT EXISTS ("
            "  SELECT 1 FROM document_derivative_jobs "
            "  WHERE document_id = %s AND kind = 'working-copy' "
            "  AND status = 'queued')",
            (project_id, document_id, document_id))
        await conn.commit()
    return {"document_id": document_id, "normalized_name": row[0],
            "description": row[1], "skim_state": "shane-confirmed",
            "note": "working copy re-stamp queued"}


@router.post("/classify-by-title")
async def classify_by_title(project_id: uuid.UUID) -> dict[str, Any]:
    """Deterministic title-rule classification (Shane's ruling 2026-07-20):
    propose classification + extraction method from the curated titles.
    Lands as arc-proposed; NEVER touches a shane-confirmed row (the R0
    guard); a title no rule matches proposes nothing and is reported.
    Idempotent — safe to re-run after uploads or renames."""
    from src.intake_title_rules import classify_title

    pool = await get_pool()
    proposed: list[dict[str, Any]] = []
    unmatched: list[str] = []
    skipped_confirmed = 0
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT document_id, normalized_name, original_name, "
            "classification_state FROM documents WHERE project_id = %s "
            "AND status != 'soft_deleted' ORDER BY created_at", (project_id,))
        rows = await cur.fetchall()
        for document_id, norm_name, orig_name, state in rows:
            if state == "shane-confirmed":
                skipped_confirmed += 1
                continue
            hit = classify_title(norm_name, orig_name)
            if hit is None:
                unmatched.append(norm_name or document_id)
                continue
            await conn.execute(
                "UPDATE documents SET classification = %s, "
                "classification_state = 'arc-proposed', "
                "classification_detail = %s, updated_at = now() "
                "WHERE document_id = %s AND project_id = %s "
                "AND classification_state IS DISTINCT FROM 'shane-confirmed'",
                (hit["classification"],
                 json.dumps({"source": "title-rule", "rule": hit["rule"],
                             "method": hit["method"]}),
                 document_id, project_id))
            proposed.append({"document_id": document_id,
                             "name": norm_name or document_id, **hit})
        await conn.commit()
    return {"proposed": proposed, "proposed_count": len(proposed),
            "unmatched": unmatched, "skipped_confirmed": skipped_confirmed}


class RoutingOverride(BaseModel):
    page_num: int = Field(ge=1)
    lane: str


class ConfirmRouting(BaseModel):
    overrides: list[RoutingOverride] = []
    normalized_name: str | None = None
    classification: str | None = None


@router.post("/{document_id}/confirm-routing")
async def confirm_routing(
    project_id: uuid.UUID, document_id: str, body: ConfirmRouting
) -> dict[str, Any]:
    """Shane's triage confirm: apply any lane edits, then flip the whole
    document's routing map + classification to shane-confirmed (R0 — the only
    path that mints 'shane-confirmed'; Arc's writes can never produce it)."""
    for o in body.overrides:
        if o.lane not in LANES:
            raise HTTPException(status_code=422, detail=f"unknown lane {o.lane!r}")
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT 1 FROM documents WHERE document_id = %s AND project_id = %s",
            (document_id, project_id))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="document not found")
        for o in body.overrides:
            await conn.execute(
                "INSERT INTO schematic_sheet_index (project_id, document_id, "
                "page_num, lane, lane_source, title_source) "
                "VALUES (%s, %s, %s, %s, 'shane-confirmed', 'shane-triage') "
                "ON CONFLICT (project_id, document_id, page_num) DO UPDATE "
                "SET lane = EXCLUDED.lane, lane_source = 'shane-confirmed', "
                "updated_at = now()",
                (project_id, document_id, o.page_num, o.lane))
        await conn.execute(
            "UPDATE schematic_sheet_index SET lane_source = 'shane-confirmed', "
            "updated_at = now() WHERE project_id = %s AND document_id = %s "
            "AND lane IS NOT NULL AND lane_source IS DISTINCT FROM 'shane-confirmed'",
            (project_id, document_id))
        await conn.execute(
            "UPDATE documents SET "
            "normalized_name = COALESCE(%s, normalized_name), "
            "classification = COALESCE(%s, classification), "
            "classification_state = 'shane-confirmed', updated_at = now() "
            "WHERE document_id = %s",
            (body.normalized_name, body.classification, document_id))
        cur = await conn.execute(
            "SELECT page_num, lane, lane_source FROM schematic_sheet_index "
            "WHERE project_id = %s AND document_id = %s AND lane IS NOT NULL "
            "ORDER BY page_num", (project_id, document_id))
        rows = await cur.fetchall()
        await conn.commit()
    return {
        "document_id": document_id,
        "routing": pages_to_ranges([(int(p), ln, src) for p, ln, src in rows]),
    }


async def _project_slug(project_id: uuid.UUID) -> str:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT slug FROM projects WHERE project_id = %s", (project_id,))
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="project not found")
    return row[0]


async def _ingest_payload(
    project_id: uuid.UUID,
    project_slug: str,
    payload: bytes,
    original_name: str,
    source_path: str | None,
    source_label: str | None,
) -> dict[str, Any]:
    """The one intake door: sha → dedup → slug → staged write → Neon row →
    immutable original → job fan-out. Browser uploads and server-path imports
    both come through here — only their source_path provenance differs."""
    if not payload:
        raise HTTPException(status_code=422, detail={"reason": "empty", "message": "empty upload"})
    sha256 = hashlib.sha256(payload).hexdigest()

    # R14 dedup — per project, refused with a pointer, never a silent no-op.
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT document_id, normalized_name, created_at FROM documents "
            "WHERE project_id = %s AND content_sha256 = %s", (project_id, sha256))
        dup = await cur.fetchone()
    if dup is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "reason": "duplicate_content",
                "message": f"already in this project as '{dup[1] or dup[0]}', "
                           f"uploaded {dup[2].isoformat() if dup[2] else 'earlier'}",
                "document_id": dup[0],
            })

    doc_slug = _slugify_document(original_name)
    # Slug collisions within the project get a short hash suffix — the slug is
    # identity and immutable, so mint it unique at birth. The SELECT is only a
    # fast path; the TRUTH is the PK insert below (review finding 2026-07-13:
    # two concurrent same-named uploads both pass a SELECT check).
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT 1 FROM documents WHERE document_id = %s", (doc_slug,))
        if await cur.fetchone() is not None:
            doc_slug = f"{doc_slug}-{sha256[:8]}"

    originals_dir = data_root() / project_slug / "originals"
    originals_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(original_name).suffix.lower()
    # Staging is PER-REQUEST unique: a shared slug-derived staging name let
    # two concurrent same-named uploads overwrite each other's bytes before
    # the rename — an immutable original whose content didn't match its
    # recorded sha (review finding 2026-07-13).
    staging_path = originals_dir / f".staging-{uuid.uuid4().hex}{suffix}"

    async def _insert(slug: str, final: Path) -> None:
        pool = await get_pool()
        async with pool.connection() as conn:
            await conn.execute(
                "INSERT INTO documents (document_id, project_id, normalized_name, "
                "original_name, content_sha256, status, original_path, "
                "source_path, source_label) "
                "VALUES (%s, %s, %s, %s, %s, 'processing', %s, %s, %s)",
                (slug, project_id, Path(original_name).stem, original_name,
                 sha256, str(final),
                 (source_path or "").strip()[:1000] or None,
                 (source_label or "").strip()[:300] or None))
            await conn.commit()

    # G39: provisional until the Neon record commits.
    staging_path.write_bytes(payload)
    final_path = originals_dir / f"{doc_slug}{suffix}"
    try:
        try:
            await _insert(doc_slug, final_path)
        except errors.UniqueViolation:
            # Lost the slug race to a concurrent upload — the PK is the
            # arbiter; re-mint with the content-hash suffix and retry once.
            doc_slug = f"{doc_slug}-{sha256[:8]}"
            final_path = originals_dir / f"{doc_slug}{suffix}"
            await _insert(doc_slug, final_path)
    except Exception:
        staging_path.unlink(missing_ok=True)
        raise
    os.replace(staging_path, final_path)
    os.chmod(final_path, 0o444)  # immutable original

    # R14: enqueue the intake fan-out (separate worker process; job state in
    # Neon; the server never renders). Mechanical derivatives only —
    # SHANE'S RULING 2026-07-13: anything that INTERPRETS document contents
    # (the classify pass included) is ON HOLD until the UI is built; each
    # content-touching capability is then designed together, one at a time.
    # The classify machinery stays in the worker, unfed, until that session.
    # The skim (capability #1, Shane green-lit 2026-07-13) fires immediately
    # in its own concurrent pool; its completion enqueues the working-copy
    # stamp. Renders run in the serial lane alongside.
    is_pdf = final_path.suffix.lower() == ".pdf"
    if is_pdf:
        pool = await get_pool()
        async with pool.connection() as conn:
            for kind in ("skim", "vector-dump", "workspace-png", "master-png"):
                await conn.execute(
                    "INSERT INTO document_derivative_jobs (project_id, document_id, kind) "
                    "VALUES (%s, %s, %s)", (project_id, doc_slug, kind))
            await conn.commit()

    return {
        "document_id": doc_slug,
        "content_sha256": sha256,
        "original_path": str(final_path),
        "status": "processing",
        "note": ("original secured; skim + 3 derivative jobs queued for the "
                 "intake worker"
                 if is_pdf else
                 "original secured; non-PDF — no intake fan-out (route it manually "
                 "from the Library)"),
    }


@router.post("/upload")
async def upload_document(
    project_id: uuid.UUID,
    file: UploadFile,
    # Browser provenance ceiling: the file picker exposes ONLY the name; the
    # folder picker exposes the path RELATIVE to the chosen folder. True
    # absolute paths are sandbox-hidden by every browser — use /import-path
    # (server-side read) when the real location matters.
    relative_path: str | None = Form(default=None),
    source_label: str | None = Form(default=None),
) -> dict[str, Any]:
    project_slug = await _project_slug(project_id)
    payload = await file.read()
    return await _ingest_payload(
        project_id, project_slug, payload, file.filename or "upload.bin",
        relative_path, source_label)


class ImportPath(BaseModel):
    path: str
    recursive: bool = True


@router.post("/import-path")
async def import_from_path(project_id: uuid.UUID, body: ImportPath) -> dict[str, Any]:
    """Server-side import: the platform reads files straight off this
    machine's disk, so source_path records the TRUE ABSOLUTE location — the
    provenance a browser upload can never see (Shane's ask, 2026-07-13).
    Same intake door as /upload; only the provenance depth differs."""
    project_slug = await _project_slug(project_id)
    root = Path(body.path).expanduser()
    if not root.exists():
        raise HTTPException(status_code=404, detail=f"path not found: {root}")
    if root.is_file():
        files = [root]
    else:
        walk = root.rglob("*") if body.recursive else root.iterdir()
        files = sorted(p for p in walk if p.is_file() and p.suffix.lower() == ".pdf")
    if len(files) > 500:
        raise HTTPException(status_code=422, detail=f"{len(files)} PDFs found — cap is 500 per import")

    results: list[dict[str, Any]] = []
    for f in files:
        absolute = str(f.resolve())
        try:
            r = await _ingest_payload(
                project_id, project_slug, f.read_bytes(), f.name,
                absolute, None)
            results.append({"file": absolute, "status": "secured",
                            "document_id": r["document_id"]})
        except HTTPException as exc:
            results.append({
                "file": absolute,
                "status": "duplicate" if exc.status_code == 409 else "failed",
                "detail": exc.detail if isinstance(exc.detail, str)
                          else (exc.detail or {}).get("message", str(exc.detail)),
            })
        except Exception as exc:  # noqa: BLE001 — one bad file must not kill the batch
            results.append({"file": absolute, "status": "failed", "detail": str(exc)[:200]})
    counts = {
        "secured": sum(1 for r in results if r["status"] == "secured"),
        "duplicates": sum(1 for r in results if r["status"] == "duplicate"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
    }
    return {"results": results, "summary": counts}
