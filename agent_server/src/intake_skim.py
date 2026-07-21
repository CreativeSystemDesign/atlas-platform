"""The intake skim — capability #1 (Shane green-lit 2026-07-13).

The narrowest content-touching pass: read a document's first pages and
propose a NORMALIZED NAME and a short DESCRIPTION. Nothing else — routing
and classification remain held (R18); this module makes no judgment about
what lane a page belongs to.

Design ratified in the joint session:
- Haiku 4.5 is the default engine (naming/describing is light comprehension;
  per-document cost is a production margin line).
- Escalation ladder: Haiku confidence < 0.7 → one Sonnet retry; still < 0.7
  → 'needs-shane'. Raising beats guessing (the classify pass proved the
  conscience pattern live: 26/62 raised themselves).
- Scans (no text layer) fall back to VISION: pages 1-2 rendered at low dpi
  to temp files the model Reads. One extra branch, no OCR dependency.
- Proposals land with shane-confirmed WHERE guards (worker side): Arc can
  never overwrite a name/description Shane has confirmed.

Pure parts (evidence, prompt, parse) are separated from the model call and
carry tests.
"""

from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path
from typing import Any

SKIM_MODEL = "claude-haiku-4-5-20251001"
ESCALATION_MODEL = "claude-sonnet-5"
CONFIDENCE_FLOOR = 0.7

_HEAD_PAGES = 6
_HEAD_CHARS = 1200
_MIN_TEXT_CHARS = 40   # below this the doc is treated as a scan → vision
_VISION_DPI = 150

_SYSTEM_PROMPT = """You are Arc, the Atlas-Platform intake skimmer. You \
receive the first pages of a freshly uploaded machine document (industrial-machine work \
plant context: schematics, manuals, parts lists, PLC printouts, OEM \
catalogs — often bilingual Japanese/English). Your ONLY job: propose a clean \
display name and a short description. You do NOT classify, route, or judge \
page contents beyond describing the document.

Respond with ONLY a JSON object — no prose, no code fences:
{
  "normalized_name": "<clean human-readable display name, e.g. 'Cast Trend Ver.3 Instruction Manual (CTCom / CTView Software)'>",
  "description": "<2-3 sentences: what this document IS, what it covers, anything a maintenance engineer would want to know before opening it>",
  "confidence": <0.0-1.0, honest>
}

Rules:
- Prefer the document's own title-block/cover wording; include drawing
  numbers where printed (e.g. '<drawing-no>').
- English name; keep meaningful Japanese terms in parentheses when they ARE
  the identity.
- If the evidence is thin (scan, sparse text), say what you can and LOWER
  confidence — never invent certainty."""


# ---------------------------------------------------------------- evidence

def gather_skim_evidence(pdf_path: str) -> dict[str, Any]:
    """First-pages text pack + the signals that decide text-vs-vision mode."""
    import fitz

    doc = fitz.open(pdf_path)
    try:
        pages: list[dict[str, Any]] = []
        total_chars = 0
        for i, page in enumerate(doc, start=1):
            if i > _HEAD_PAGES:
                break
            text = " ".join(page.get_text("text").replace("\x00", "").split())
            total_chars += len(text)
            pages.append({"page": i, "sample": text[:_HEAD_CHARS], "chars": len(text)})
        return {
            "file_name": Path(pdf_path).name,
            "page_count": doc.page_count,
            "pdf_title": (doc.metadata or {}).get("title") or "",
            "pages": pages,
            "total_chars": total_chars,
            "mode": "text" if total_chars >= _MIN_TEXT_CHARS else "vision",
        }
    finally:
        doc.close()


def render_vision_pages(pdf_path: str, out_dir: str, max_pages: int = 2) -> list[str]:
    """Low-dpi renders of the first pages for the scan fallback."""
    import fitz

    doc = fitz.open(pdf_path)
    try:
        paths: list[str] = []
        for i, page in enumerate(doc, start=1):
            if i > max_pages:
                break
            out = Path(out_dir) / f"skim-page-{i}.png"
            page.get_pixmap(dpi=_VISION_DPI).save(str(out))
            paths.append(str(out))
        return paths
    finally:
        doc.close()


def build_skim_prompt(evidence: dict[str, Any], image_paths: list[str] | None = None) -> str:
    lines = [
        f"File name as uploaded: {evidence['file_name']}",
        f"PDF metadata title: {evidence['pdf_title'] or '(none)'}",
        f"Total pages: {evidence['page_count']}",
    ]
    if image_paths:
        lines.append(
            "This document has no text layer (scan). Read these page images "
            "and skim from what you see:")
        lines += [f"  {p}" for p in image_paths]
    else:
        lines.append(f"Text from the first {len(evidence['pages'])} page(s):")
        for p in evidence["pages"]:
            lines.append(f"p{p['page']}: {p['sample'] or '(empty page)'}")
    return "\n".join(lines)


# ---------------------------------------------------------------- parsing

def parse_skim_response(text: str) -> dict[str, Any]:
    """Never raises on content: anything dubious lowers to needs-shane."""
    problems: list[str] = []
    raw: dict[str, Any] = {}
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if match:
        try:
            raw = json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            problems.append(f"JSON did not parse: {exc}")
    else:
        problems.append("no JSON object in response")
    if not isinstance(raw, dict):
        problems.append("response was not a JSON object")
        raw = {}

    try:
        confidence = max(0.0, min(1.0, float(raw.get("confidence", 0.0))))
    except (TypeError, ValueError):
        confidence = 0.0
        problems.append("confidence was not a number")

    name = raw.get("normalized_name")
    name = str(name).strip()[:200] if isinstance(name, str) and name.strip() else None
    if name is None:
        problems.append("no normalized_name given")
    description = raw.get("description")
    description = (
        str(description).strip()[:2000]
        if isinstance(description, str) and description.strip() else None
    )
    if description is None:
        problems.append("no description given")

    return {
        "normalized_name": name,
        "description": description,
        "confidence": confidence,
        "problems": problems,
    }


def sanitize_filename(name: str, fallback: str) -> str:
    """Normalized name → a filesystem-safe working-copy filename (keeps
    spaces and parentheses — the point is human readability)."""
    clean = re.sub(r'[\\/:*?"<>|\x00]+', "", name).strip().strip(".")
    clean = re.sub(r"\s+", " ", clean)[:150].strip()
    return clean or fallback


# ---------------------------------------------------------------- model call

async def _call_model(prompt: str, model: str, allow_read: bool) -> str:
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeAgentOptions,
        ResultMessage,
        TextBlock,
        query,
    )

    options = ClaudeAgentOptions(
        system_prompt=_SYSTEM_PROMPT,
        model=model,
        # max_turns=1 ends with an error result instead of the reply
        # (learned live on the classify pass); vision needs Read round-trips.
        max_turns=6 if allow_read else 4,
        allowed_tools=["Read"] if allow_read else [],
        # Text-heavy documents (manuals, alarm lists) produce single JSON
        # messages past the SDK's 1 MiB default and kill the reader mid-skim
        # ("JSON message exceeded maximum buffer size", observed 2026-07-14
        # during the full-the reference machine ingest). 32 MiB of headroom.
        max_buffer_size=32 * 1024 * 1024,
    )
    chunks: list[str] = []
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            chunks.extend(b.text for b in message.content if isinstance(b, TextBlock))
        elif isinstance(message, ResultMessage) and getattr(message, "result", None):
            return str(message.result)
    return "".join(chunks)


async def skim_document(pdf_path: str) -> dict[str, Any]:
    """Full skim: evidence → Haiku → (escalate to Sonnet if unsure) →
    validated proposal. No DB writes here; the worker owns persistence and
    the shane-confirmed guards.

    Returns {normalized_name, description, confidence, state, mode, model,
             escalated, problems}.
    """
    import asyncio

    loop = asyncio.get_event_loop()
    evidence = await loop.run_in_executor(None, gather_skim_evidence, pdf_path)

    image_paths: list[str] | None = None
    tmp: tempfile.TemporaryDirectory | None = None
    if evidence["mode"] == "vision":
        tmp = tempfile.TemporaryDirectory(prefix="skim-vision-")
        image_paths = await loop.run_in_executor(
            None, render_vision_pages, pdf_path, tmp.name)
    try:
        prompt = build_skim_prompt(evidence, image_paths)
        allow_read = image_paths is not None

        response = await asyncio.wait_for(
            _call_model(prompt, SKIM_MODEL, allow_read), timeout=600)
        parsed = parse_skim_response(response)
        model_used, escalated = SKIM_MODEL, False

        if parsed["confidence"] < CONFIDENCE_FLOOR or parsed["problems"]:
            escalated = True
            # Guarded: a failed escalation degrades to Haiku's proposal, it
            # never destroys it (review finding 2026-07-13).
            try:
                response = await asyncio.wait_for(
                    _call_model(prompt, ESCALATION_MODEL, allow_read), timeout=600)
                second = parse_skim_response(response)
                # Keep the stronger read: problem-free beats problem-laden
                # FIRST, confidence breaks the tie — a clean Sonnet answer
                # must never lose to a confident-but-broken Haiku parse
                # (review finding 2026-07-13).
                if (not second["problems"], second["confidence"]) >= (
                        not parsed["problems"], parsed["confidence"]):
                    parsed, model_used = second, ESCALATION_MODEL
            except Exception:  # noqa: BLE001 — keep the first proposal
                parsed["problems"] = [*parsed["problems"], "escalation call failed"]

        state = (
            "arc-proposed"
            if parsed["confidence"] >= CONFIDENCE_FLOOR and not parsed["problems"]
            else "needs-shane"
        )
        return {
            **parsed,
            "state": state,
            "mode": evidence["mode"],
            "model": model_used,
            "escalated": escalated,
        }
    finally:
        if tmp is not None:
            tmp.cleanup()
