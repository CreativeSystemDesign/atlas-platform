"""Arc classification pass (Platform Graduation R14, task #21 item 1).

On upload every PDF gets a 'classify' job queued AHEAD of its renders: a
non-interactive Arc identity reads an evidence pack (per-page text samples +
signals, no images in v1) and proposes
  - normalized_name        (display metadata — NEVER identity, R1)
  - classification         (document-level: schematic / manual / parts-list …)
  - per-page routing map   (lane per page, written lane_source='arc-proposed')
  - confidence + notes     (the conscience: low confidence RAISES TO SHANE)

Trust boundaries (R0): classification is an UNGRADUATED domain — everything
Arc writes here is a proposal. Shane's confirm (Library triage) flips
lane_source/classification_state to 'shane-confirmed'; nothing in this module
or the worker may overwrite a shane-confirmed value, mechanically (WHERE
guards in the worker's writes, not prose).

Pure parts (evidence assembly, prompt, response parsing, range math) are
separated from the model call and carry tests — untested inline logic WILL
regress (ribbon-routing lesson).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

LANES = (
    "schematic-canvas",
    "table-extract",
    "legend-mine",
    "toc-parse",
    "reference-only",
    "spare",
)

CLASSIFY_MODEL = "claude-sonnet-5"
# Below this the proposal still lands, but flagged needs-shane (raised, not
# silently trusted). Same threshold applies when the response had problems.
CONFIDENCE_FLOOR = 0.7

# Evidence budget: early pages carry the identity signal (covers, TOCs,
# legends) so they get room; the long tail gets a sliver each — enough for
# the lane call ("MC1038 COIL…" vs "CABLE LIST" vs blank), cheap at 200+ pages.
_HEAD_PAGES = 4
_HEAD_CHARS = 1500
_TAIL_CHARS = 260
_TOTAL_CHAR_CAP = 60_000

_SYSTEM_PROMPT = """You are Arc, the Atlas-Platform intake classifier — the \
first reader of every document that enters the platform. You receive an \
evidence pack (per-page text samples extracted from a freshly uploaded PDF) \
and must classify the document and propose a per-page routing map. Your \
proposal routes real extraction work, and a human confirms it — be honest, \
never invent certainty.

Routing lanes (use ONLY these, exactly as written):
- schematic-canvas : wiring / electrical schematic diagram pages
- table-extract    : structured tables (cable lists, parts lists, I/O lists, settings tables)
- legend-mine      : symbol legends, device-designation references
- toc-parse        : table-of-contents / index pages
- reference-only   : covers, revision blocks, prose notes, drawings with no extractable circuit
- spare            : blank or explicit "SPARE" placeholder pages

Respond with ONLY a JSON object — no prose before or after, no code fences:
{
  "normalized_name": "<clean human-readable display name for the document>",
  "classification": "<schematic | manual | parts-list | plc-reference | cable-list | other>",
  "confidence": <0.0-1.0, your honest overall confidence>,
  "routing": [{"start": 1, "end": 6, "lane": "toc-parse"}, ...],
  "notes": "<1-2 sentences: what drove the call, and anything a human should double-check>"
}

Rules:
- routing must cover every page exactly once, in ascending order.
- If a page's lane is genuinely unclear, use reference-only, lower your
  confidence, and say why in notes.
- Pages with little or no text may be scanned images — say so in notes and
  lower confidence; never guess a lane confidently from absence of evidence.
- Japanese/bilingual text is normal for this fleet; classify from meaning."""


# ---------------------------------------------------------------- evidence

def gather_evidence(pdf_path: str) -> dict[str, Any]:
    """Extract the classification evidence pack from a PDF.

    Every page always gets its signals (char count, has_text); sample text is
    included head-first until the total budget runs out, so a 500-page manual
    still yields a complete per-page signal map.
    """
    import fitz  # local import: keeps the pure helpers importable without PyMuPDF

    doc = fitz.open(pdf_path)
    try:
        pages: list[dict[str, Any]] = []
        budget = _TOTAL_CHAR_CAP
        for i, page in enumerate(doc, start=1):
            text = page.get_text("text").strip()
            limit = _HEAD_CHARS if i <= _HEAD_PAGES else _TAIL_CHARS
            sample = ""
            if budget > 0 and text:
                sample = " ".join(text.split())[: min(limit, budget)]
                budget -= len(sample)
            pages.append({
                "page": i,
                "chars": len(text),
                "has_text": bool(text),
                "sample": sample,
            })
        return {
            "file_name": Path(pdf_path).name,
            "page_count": doc.page_count,
            "pdf_title": (doc.metadata or {}).get("title") or "",
            "pages": pages,
        }
    finally:
        doc.close()


def build_classify_prompt(evidence: dict[str, Any], project_name: str = "") -> str:
    lines = [
        f"Document: {evidence['file_name']}"
        + (f" (project: {project_name})" if project_name else ""),
        f"PDF metadata title: {evidence['pdf_title'] or '(none)'}",
        f"Pages: {evidence['page_count']}",
        "",
        "Per-page evidence (chars = text-layer size; empty sample + chars>0 means budget ran out, not an empty page):",
    ]
    for p in evidence["pages"]:
        flag = "" if p["has_text"] else " [NO TEXT LAYER]"
        lines.append(f"p{p['page']} ({p['chars']} ch){flag}: {p['sample']}")
    return "\n".join(lines)


# ---------------------------------------------------------------- parsing

def parse_classify_response(text: str, page_count: int) -> dict[str, Any]:
    """Validate the model's JSON into a proposal dict.

    Never raises on content problems — everything recoverable is normalized
    and everything dubious lands in `problems`, which (like low confidence)
    routes the proposal to needs-shane instead of silent trust.

    Returns: {normalized_name, classification, confidence, pages: {page: lane},
              notes, problems: [str], state: 'arc-proposed'|'needs-shane'}
    """
    problems: list[str] = []
    raw: dict[str, Any] = {}
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if match:
        try:
            raw = json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            problems.append(f"response JSON did not parse: {exc}")
    else:
        problems.append("no JSON object found in response")
    if not isinstance(raw, dict):
        problems.append("response was not a JSON object")
        raw = {}

    try:
        confidence = max(0.0, min(1.0, float(raw.get("confidence", 0.0))))
    except (TypeError, ValueError):
        confidence = 0.0
        problems.append("confidence was not a number")

    pages: dict[int, str] = {}
    routing = raw.get("routing")
    if not isinstance(routing, list):
        routing = []
        problems.append("routing missing or not a list")
    for item in routing:
        if not isinstance(item, dict):
            problems.append(f"routing item not an object: {item!r}")
            continue
        lane = item.get("lane")
        if lane not in LANES:
            problems.append(f"unknown lane {lane!r} dropped")
            continue
        try:
            start = max(1, int(item.get("start")))
            end = min(page_count, int(item.get("end")))
        except (TypeError, ValueError):
            problems.append(f"non-integer range in {item!r}")
            continue
        for page in range(start, end + 1):
            if page in pages:
                problems.append(f"page {page} routed twice; kept first ({pages[page]})")
            else:
                pages[page] = lane

    uncovered = page_count - len(pages)
    if uncovered > 0:
        problems.append(f"{uncovered} page(s) left unrouted")

    name = raw.get("normalized_name")
    name = str(name).strip()[:200] if isinstance(name, str) and name.strip() else None
    classification = raw.get("classification")
    classification = (
        str(classification).strip()[:80]
        if isinstance(classification, str) and classification.strip() else None
    )
    if classification is None:
        problems.append("no classification given")
    notes = raw.get("notes")
    notes = str(notes).strip()[:1000] if isinstance(notes, str) else ""

    state = "arc-proposed" if confidence >= CONFIDENCE_FLOOR and not problems else "needs-shane"
    return {
        "normalized_name": name,
        "classification": classification,
        "confidence": confidence,
        "pages": pages,
        "notes": notes,
        "problems": problems,
        "state": state,
    }


def pages_to_ranges(rows: list[tuple[int, str | None, str | None]]) -> list[dict[str, Any]]:
    """Contiguous equal-(lane, source) runs ARE the ranges (R11: computed on
    read, never stored). rows: (page_num, lane, lane_source); laneless pages
    break runs — an unrouted hole must stay visible, never bridged."""
    ranges: list[dict[str, Any]] = []
    for page, lane, source in sorted(rows):
        if lane is None:
            continue
        last = ranges[-1] if ranges else None
        if last and last["lane"] == lane and last["source"] == source and page == last["end"] + 1:
            last["end"] = page
        else:
            ranges.append({"start": page, "end": page, "lane": lane, "source": source})
    return ranges


# ---------------------------------------------------------------- model call

async def call_classifier(prompt: str) -> str:
    """One-shot, tool-less Arc call over the Agent SDK (same subscription auth
    lane as the canvas copilot — no API key exists on this box)."""
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeAgentOptions,
        ResultMessage,
        TextBlock,
        query,
    )

    options = ClaudeAgentOptions(
        system_prompt=_SYSTEM_PROMPT,
        model=CLASSIFY_MODEL,
        # max_turns=1 makes the CLI END WITH AN ERROR RESULT instead of the
        # first assistant message (observed 2026-07-13 on the first live
        # classify job: "Reached maximum number of turns (1)"). Tool-less
        # sessions end after one reply anyway; 4 is guard-rail, not budget.
        max_turns=4,
        allowed_tools=[],
    )
    chunks: list[str] = []
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            chunks.extend(b.text for b in message.content if isinstance(b, TextBlock))
        elif isinstance(message, ResultMessage) and getattr(message, "result", None):
            return str(message.result)
    return "".join(chunks)


async def classify_document(pdf_path: str, project_name: str = "") -> dict[str, Any]:
    """Full pass: evidence → Arc → validated proposal (no DB writes here; the
    worker owns persistence and its shane-confirmed guards)."""
    import asyncio

    loop = asyncio.get_event_loop()
    evidence = await loop.run_in_executor(None, gather_evidence, pdf_path)
    prompt = build_classify_prompt(evidence, project_name)
    response = await asyncio.wait_for(call_classifier(prompt), timeout=900)
    proposal = parse_classify_response(response, evidence["page_count"])
    proposal["page_count"] = evidence["page_count"]
    proposal["model"] = CLASSIFY_MODEL
    return proposal
