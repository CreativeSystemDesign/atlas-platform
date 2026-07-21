"""Atlas-Platform intake worker (Platform Graduation R14).

A separate process — NEVER the copilot server (the 1012-socket stability
constraint decided this). Polls `document_derivative_jobs` in Neon, claims
one job at a time, executes the derivative stage, and reports progress
per page. Job state lives in Neon so it survives restarts; every stage is
idempotent (skip work whose output already exists), so boot recovery is
simply running→queued.

Stages per document (R3 layout under ATLAS_DATA_ROOT/{project}/…):
- classify       → Arc's intake proposal (src/intake_classify.py): document
                   classification + normalized_name on `documents`, per-page
                   routing map on schematic_sheet_index (lane_source
                   'arc-proposed'). Queued FIRST so triage never waits on
                   renders. UNGRADUATED domain (R0): writes carry mechanical
                   WHERE guards — a shane-confirmed value is never overwritten.
- vector-dump    → schematic_page_text_blocks rows (page-px space, 300dpi —
                   the platform's canonical coordinate space)
- master-png     → masters/{doc}/page-NNNN.png @600dpi, chmod 444 (regenerable
                   cache tier per R3 — recorded params make it deterministic)
- workspace-png  → workspace/{doc}/page-NNNN.png @300dpi

When a document's three jobs all complete, documents.status flips
processing→available (R4: not "available" until vector dump + workspace
renders exist). A failed stage marks the job failed and the document
needs_attention with the stage named — visible, never swallowed.

Run: systemd unit atlas-intake-worker.service, or directly:
    cd agent_server && .venv/bin/python -m src.intake_worker
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import signal
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

from src.config import settings
from src.intake_classify import classify_document
from src.intake_skim import sanitize_filename, skim_document
from src.persistence.database import get_pool

logger = logging.getLogger("intake_worker")

POLL_S = 3.0
MASTER_DPI = 600
WORKSPACE_DPI = 300
# MuPDF refuses pixmaps past its internal allocation cap ("code=5: Overly
# large image" — hit 2026-07-13 by A0-format arrangement drawings at 600dpi).
# Pages that would exceed this pixel budget render at the largest dpi that
# fits instead, floored at 150; the reduced dpi is RECORDED in job params
# (R3: recorded params keep the cache tier deterministic).
MAX_RENDER_PIXELS = 178_000_000
MIN_FALLBACK_DPI = 150


def data_root() -> Path:
    return Path(settings.atlas_data_root or str(Path.home() / "atlas-data"))


def _fit_dpi(page: "fitz.Page", dpi: int) -> int:
    """Largest dpi ≤ requested that keeps the page under MAX_RENDER_PIXELS."""
    px = (page.rect.width / 72 * dpi) * (page.rect.height / 72 * dpi)
    if px <= MAX_RENDER_PIXELS:
        return dpi
    import math

    return max(MIN_FALLBACK_DPI, int(dpi * math.sqrt(MAX_RENDER_PIXELS / px)))


def _render_pages(pdf_path: str, out_dir: Path, dpi: int, done_cb) -> tuple[int, dict[int, int]]:
    """Render every page to PNG at `dpi` (capped per page by _fit_dpi).
    Idempotent: existing files skip. Returns (page_count, {page: reduced_dpi})
    for any page that could not render at the requested dpi. Masters are
    chmod 444 after write."""
    out_dir.mkdir(parents=True, exist_ok=True)
    reduced: dict[int, int] = {}
    doc = fitz.open(pdf_path)
    try:
        for i, page in enumerate(doc, start=1):
            used = _fit_dpi(page, dpi)
            if used != dpi:
                reduced[i] = used
            out = out_dir / f"page-{i:04d}.png"
            if not out.exists():
                # Atomic write: save to a temp name, chmod, then rename —
                # exists() means COMPLETE only because rename is atomic. A
                # SIGKILL mid-save (systemd stop timeout during a long
                # render — it happened twice on 2026-07-13) must never leave
                # a truncated page that future runs skip as done.
                # The temp name must END in .png — PyMuPDF infers the image
                # format from the extension (a bare .tmp suffix failed every
                # render on Shane's live upload, 2026-07-13). The leading dot
                # keeps it out of the pages endpoint's page-*.png glob.
                tmp = out_dir / f".{out.stem}.tmp.png"
                pix = page.get_pixmap(dpi=used)
                pix.save(str(tmp))
                if dpi == MASTER_DPI:
                    tmp.chmod(0o444)
                tmp.replace(out)
            done_cb(i)
        return doc.page_count, reduced
    finally:
        doc.close()


def _dump_text_blocks(pdf_path: str, rows_out: list[tuple], project_id: str,
                      document_id: str, done_cb) -> int:
    """Extract text blocks per page into page-px (300dpi) space — the
    platform's canonical coordinate system."""
    scale = WORKSPACE_DPI / 72.0
    doc = fitz.open(pdf_path)
    try:
        for pno, page in enumerate(doc, start=1):
            # get_pixmap (the workspace + master PNGs) HONORS the page /Rotate,
            # so the render is in ROTATED space. get_text returns block coords
            # in the UNROTATED MediaBox — 90/270° apart on rotated pages. bbox_px
            # is the platform's canonical px space and MUST match the render, so
            # transform each block by the page rotation matrix before scaling
            # (identity on rotation=0 pages, so unrotated docs are untouched).
            # Bug found 2026-07-18 by dogfooding: the mismatch broke every
            # schema_page_view crop on rotated bench docs. bbox_pdf stays raw
            # (true PDF/MediaBox space) — only bbox_px is render-space.
            rot = page.rotation_matrix
            for bi, b in enumerate(page.get_text("blocks")):
                # OEM PDFs with broken CID fonts emit NUL bytes in the text
                # layer; Postgres TEXT refuses them (job d2de9a0d, 2026-07-13).
                x0, y0, x1, y1 = b[0], b[1], b[2], b[3]
                text = str(b[4]).replace("\x00", "").strip()
                if not text:
                    continue
                bbox_pdf = {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}
                rr = (fitz.Rect(x0, y0, x1, y1) * rot).normalize()
                bbox_px = {"x": rr.x0 * scale, "y": rr.y0 * scale,
                           "width": rr.width * scale, "height": rr.height * scale}
                rows_out.append((
                    project_id, document_id, pno, bi, text,
                    " ".join(text.lower().split()),
                    json.dumps(bbox_pdf), json.dumps(bbox_px),
                    "intake-worker",
                    hashlib.sha256(f"{document_id}:{pno}:{bi}:{text}".encode()).hexdigest(),
                ))
            done_cb(pno)
        return doc.page_count
    finally:
        doc.close()


async def _stamp_working_copy(project_id: Any, document_id: str) -> int:
    """The working copy: the original's bytes, renamed to the normalized
    name, with the Neon metadata stamped into the PDF — a file that
    self-describes outside the platform (Shane's original intake design).
    Neon is the truth; this file is a PROJECTION, re-stamped on any change.
    Runs in the SERIAL loop so filename-collision checks are race-free.
    Returns page count (job progress denominator)."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT d.original_path, d.normalized_name, d.description, "
            "d.content_sha256, d.skim_state, d.working_path, p.slug "
            "FROM documents d JOIN projects p ON p.project_id = d.project_id "
            "WHERE d.document_id = %s", (document_id,))
        row = await cur.fetchone()
    if row is None or not row[0]:
        raise RuntimeError("document has no original to project from")
    original_path, name, description, sha, skim_state, old_working, slug = row

    working_dir = data_root() / slug / "working"
    working_dir.mkdir(parents=True, exist_ok=True)
    base = sanitize_filename(name or "", fallback=document_id)
    target = working_dir / f"{base}.pdf"
    # Serial loop ⇒ this existence check cannot race another stamp. A name
    # collision with a DIFFERENT document keeps both readable by suffixing
    # the slug (identity), never silently overwriting.
    if target.exists() and (old_working or "") != str(target):
        target = working_dir / f"{base} [{document_id}].pdf"

    def _stamp() -> int:
        doc = fitz.open(original_path)
        try:
            doc.set_metadata({
                "title": name or document_id,
                "subject": description or "",
                "keywords": (
                    f"atlas-platform; machine {slug}; document {document_id}; "
                    f"sha256 {sha or 'unrecorded'}; "
                    f"metadata {skim_state or 'unstamped'}"
                ),
                "creator": "Atlas-Platform intake",
                "producer": "Atlas-Platform (projection of the Neon record)",
            })
            doc.save(str(target))
            return doc.page_count
        finally:
            doc.close()

    pages = await asyncio.get_event_loop().run_in_executor(None, _stamp)

    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE documents SET working_path = %s, updated_at = now() "
            "WHERE document_id = %s", (str(target), document_id))
        await conn.commit()
    # A rename (fresh normalized name) leaves the old projection behind —
    # remove it; the file is regenerable and Neon holds the truth.
    if old_working and old_working != str(target):
        Path(old_working).unlink(missing_ok=True)
    return pages


async def _set_progress(job_id: Any, pages_done: int) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE document_derivative_jobs SET pages_done = %s WHERE job_id = %s",
            (pages_done, job_id))
        await conn.commit()


async def _run_job(job: tuple) -> None:
    job_id, project_id, document_id, kind = job
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT d.original_path, p.slug FROM documents d "
            "JOIN projects p ON p.project_id = d.project_id WHERE d.document_id = %s",
            (document_id,))
        row = await cur.fetchone()
    if row is None or not row[0]:
        raise RuntimeError("document has no original_path (pre-retrofit row?)")
    pdf_path, project_slug = row
    base = data_root() / project_slug

    loop = asyncio.get_event_loop()
    progress = {"n": 0}

    def done_cb(n: int) -> None:
        progress["n"] = n

    async def pump_progress() -> None:
        last = 0
        while True:
            await asyncio.sleep(2)
            if progress["n"] != last:
                last = progress["n"]
                await _set_progress(job_id, last)

    pump = asyncio.create_task(pump_progress())
    try:
        reduced: dict[int, int] = {}
        if kind == "master-png":
            total, reduced = await loop.run_in_executor(
                None, _render_pages, pdf_path, base / "masters" / document_id,
                MASTER_DPI, done_cb)
        elif kind == "workspace-png":
            total, reduced = await loop.run_in_executor(
                None, _render_pages, pdf_path, base / "workspace" / document_id,
                WORKSPACE_DPI, done_cb)
        elif kind == "classify":
            pool = await get_pool()
            async with pool.connection() as conn:
                cur = await conn.execute(
                    "SELECT pr.display_name FROM documents d "
                    "JOIN projects pr ON pr.project_id = d.project_id "
                    "WHERE d.document_id = %s", (document_id,))
                prow = await cur.fetchone()
            proposal = await classify_document(pdf_path, prow[0] if prow else "")
            total = int(proposal["page_count"])
            done_cb(total)
            pool = await get_pool()
            async with pool.connection() as conn:
                # R0 guard: proposals never overwrite a shane-confirmed word.
                await conn.execute(
                    # Same cross-guard as the skim branch: the shared
                    # normalized_name respects EITHER lane's confirmed state.
                    "UPDATE documents SET "
                    "normalized_name = COALESCE(%s, normalized_name), "
                    "classification = COALESCE(%s, classification), "
                    "classification_state = %s, classification_detail = %s, "
                    "updated_at = now() WHERE document_id = %s "
                    "AND classification_state IS DISTINCT FROM 'shane-confirmed' "
                    "AND skim_state IS DISTINCT FROM 'shane-confirmed'",
                    (proposal["normalized_name"], proposal["classification"],
                     proposal["state"],
                     json.dumps({
                         "confidence": proposal["confidence"],
                         "notes": proposal["notes"],
                         "problems": proposal["problems"],
                         "model": proposal["model"],
                     }),
                     document_id))
                for page, lane in sorted(proposal["pages"].items()):
                    await conn.execute(
                        "INSERT INTO schematic_sheet_index (project_id, document_id, "
                        "page_num, lane, lane_source, title_source) "
                        "VALUES (%s, %s, %s, %s, 'arc-proposed', 'arc-classify') "
                        "ON CONFLICT (project_id, document_id, page_num) DO UPDATE "
                        "SET lane = EXCLUDED.lane, lane_source = 'arc-proposed', "
                        "updated_at = now() "
                        "WHERE schematic_sheet_index.lane_source IS DISTINCT FROM 'shane-confirmed'",
                        (project_id, document_id, page, lane))
                await conn.commit()
            logger.info(
                "classify %s: %s · confidence %.2f · %s page(s) routed · state %s",
                document_id, proposal["classification"], proposal["confidence"],
                len(proposal["pages"]), proposal["state"])
        elif kind == "skim":
            # Capability #1: name + description only. Concurrent-pool safe —
            # everything here is per-document, and the guards are in the SQL.
            proposal = await skim_document(pdf_path)
            total = 1
            done_cb(1)
            pool = await get_pool()
            async with pool.connection() as conn:
                await conn.execute(
                    # normalized_name is SHARED across proposal lanes — a
                    # shane-confirmed word from EITHER lane (confirm-skim or
                    # confirm-routing) blocks this write (review finding
                    # 2026-07-13: single-state guards let one lane overwrite
                    # the other's confirmed name).
                    "UPDATE documents SET "
                    "normalized_name = COALESCE(%s, normalized_name), "
                    "description = COALESCE(%s, description), "
                    "skim_state = %s, skim_detail = %s, updated_at = now() "
                    "WHERE document_id = %s "
                    "AND skim_state IS DISTINCT FROM 'shane-confirmed' "
                    "AND classification_state IS DISTINCT FROM 'shane-confirmed'",
                    (proposal["normalized_name"], proposal["description"],
                     proposal["state"],
                     json.dumps({
                         "confidence": proposal["confidence"],
                         "model": proposal["model"],
                         "mode": proposal["mode"],
                         "escalated": proposal["escalated"],
                         "problems": proposal["problems"],
                     }),
                     document_id))
                # The working copy projects this metadata into a file. Dedup
                # against QUEUED only: a running stamp read Neon at claim
                # time, so metadata changed since then still needs a fresh
                # stamp — suppressing against 'running' silently loses the
                # newest truth (review finding 2026-07-13). A duplicate stamp
                # is idempotent.
                await conn.execute(
                    "INSERT INTO document_derivative_jobs (project_id, document_id, kind) "
                    "SELECT %s, %s, 'working-copy' WHERE NOT EXISTS ("
                    "  SELECT 1 FROM document_derivative_jobs "
                    "  WHERE document_id = %s AND kind = 'working-copy' "
                    "  AND status = 'queued')",
                    (project_id, document_id, document_id))
                await conn.commit()
            logger.info(
                "skim %s: %r · confidence %.2f · %s · %s%s",
                document_id, proposal["normalized_name"], proposal["confidence"],
                proposal["mode"], proposal["model"],
                " · escalated" if proposal["escalated"] else "")
        elif kind == "working-copy":
            total = await _stamp_working_copy(project_id, document_id)
            done_cb(total)
        elif kind == "vector-dump":
            rows: list[tuple] = []
            total = await loop.run_in_executor(
                None, _dump_text_blocks, pdf_path, rows, str(project_id),
                document_id, done_cb)
            pool = await get_pool()
            async with pool.connection() as conn:
                # Idempotent: this worker owns its source tag; re-runs replace.
                await conn.execute(
                    "DELETE FROM schematic_page_text_blocks "
                    "WHERE project_id = %s AND document_id = %s AND source = 'intake-worker'",
                    (project_id, document_id))
                for r in rows:
                    await conn.execute(
                        "INSERT INTO schematic_page_text_blocks (project_id, document_id, "
                        "page_num, block_index, text, normalized_text, bbox_pdf, bbox_px, "
                        "source, source_hash) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", r)
                await conn.commit()
        else:
            raise RuntimeError(f"unknown job kind {kind!r}")
    finally:
        pump.cancel()

    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE document_derivative_jobs SET status='completed', pages_total=%s, "
            "pages_done=%s, completed_at=now(), params = params || %s::jsonb "
            "WHERE job_id=%s",
            (total, total,
             json.dumps({"reduced_dpi_pages": reduced} if reduced else {}),
             job_id))
        await conn.commit()
        if reduced:
            logger.info("job %s: %d page(s) rendered below target dpi (pixel cap): %s",
                        job_id, len(reduced), reduced)
    # R4: available only when ALL of the document's jobs are complete. The
    # count runs in a SEPARATE transaction AFTER the completion committed:
    # with the concurrent skim pool, counting inside the same transaction
    # let two same-document completions each see the other as still-running
    # and NEITHER flip the doc — stuck 'processing' forever. Commit-first
    # means whoever commits last sees everything and flips.
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT COUNT(*) FROM document_derivative_jobs "
            "WHERE document_id = %s AND status != 'completed'", (document_id,))
        remaining = (await cur.fetchone())[0]
        if remaining == 0:
            await conn.execute(
                "UPDATE documents SET status='available', updated_at=now() "
                "WHERE document_id = %s AND status = 'processing'", (document_id,))
        await conn.commit()
    logger.info("job %s %s/%s completed (%s pages)", job_id, document_id, kind, total)


async def _claim_one(skim: bool) -> tuple | None:
    """Two claim lanes: the concurrent skim pool takes only 'skim' jobs; the
    serial loop takes everything else, human-visible-first (classify, then
    working-copy stamps, then text dumps, then the heavy renders)."""
    kind_filter = "kind = 'skim'" if skim else "kind <> 'skim'"
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "UPDATE document_derivative_jobs SET status='running', started_at=now() "
            "WHERE job_id = (SELECT job_id FROM document_derivative_jobs "
            f"  WHERE status='queued' AND {kind_filter} "
            "  ORDER BY CASE kind WHEN 'classify' THEN 0 WHEN 'working-copy' THEN 1 "
            "           WHEN 'vector-dump' THEN 2 ELSE 3 END, created_at "
            "  LIMIT 1 FOR UPDATE SKIP LOCKED) "
            "RETURNING job_id, project_id, document_id, kind")
        row = await cur.fetchone()
        await conn.commit()
    return row


async def _boot_recovery() -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "UPDATE document_derivative_jobs SET status='queued' WHERE status='running'")
        await conn.commit()
        if cur.rowcount:
            logger.info("boot recovery: %s running job(s) re-queued (stages are idempotent)", cur.rowcount)


async def _fail_job(job: tuple, exc: Exception) -> None:
    job_id, _, document_id, _kind = job
    logger.exception("job %s failed", job_id)
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE document_derivative_jobs SET status='failed', error_detail=%s, "
            "completed_at=now() WHERE job_id=%s", (str(exc)[:500], job_id))
        await conn.execute(
            "UPDATE documents SET status='needs_attention', updated_at=now() "
            "WHERE document_id=%s", (document_id,))
        await conn.commit()


async def _render_loop(stop: asyncio.Event) -> None:
    """The serial lane: renders, dumps, stamps — one at a time (R14)."""
    while not stop.is_set():
        job = await _claim_one(skim=False)
        if job is None:
            try:
                await asyncio.wait_for(stop.wait(), timeout=POLL_S)
            except asyncio.TimeoutError:
                pass
            continue
        try:
            await _run_job(job)
        except Exception as exc:  # noqa: BLE001 — a failed job is provenance, not a crash
            await _fail_job(job, exc)


SKIM_CONCURRENCY = 3


async def _skim_loop(stop: asyncio.Event) -> None:
    """The swarm lane (Shane's design): skims are light model calls, fully
    independent per document — a small concurrent pool, separate from the
    serial render lane, firing as soon as originals are secured."""
    sem = asyncio.Semaphore(SKIM_CONCURRENCY)
    tasks: set[asyncio.Task] = set()

    async def run_one(job: tuple) -> None:
        try:
            await _run_job(job)
        except Exception as exc:  # noqa: BLE001
            await _fail_job(job, exc)
        finally:
            sem.release()

    while not stop.is_set():
        await sem.acquire()
        if stop.is_set():
            sem.release()
            break
        try:
            job = await _claim_one(skim=True)
        except Exception:  # noqa: BLE001 — transient DB error must not leak the slot
            logger.exception("skim claim failed; retrying")
            sem.release()
            try:
                await asyncio.wait_for(stop.wait(), timeout=POLL_S)
            except asyncio.TimeoutError:
                pass
            continue
        if job is None:
            sem.release()
            try:
                await asyncio.wait_for(stop.wait(), timeout=POLL_S)
            except asyncio.TimeoutError:
                pass
            continue
        task = asyncio.create_task(run_one(job))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    logger.info("intake worker up · data root %s · poll %.0fs · skim pool %d",
                data_root(), POLL_S, SKIM_CONCURRENCY)
    await _boot_recovery()
    stop = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        asyncio.get_event_loop().add_signal_handler(sig, stop.set)
    await asyncio.gather(_render_loop(stop), _skim_loop(stop))
    logger.info("intake worker stopping")


if __name__ == "__main__":
    asyncio.run(main())
