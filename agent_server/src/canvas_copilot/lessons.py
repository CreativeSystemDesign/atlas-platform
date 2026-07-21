"""Lessons — fixed TRUE issues codified as retrievable instruction (Shane, 2026-07-08).

The playbook captures excellence (bless → exemplar cards). Dispositions capture
false positives (per-element suppression, geometry-bound). This module captures
the third channel: a REAL issue the copilot fixed and Shane confirmed becomes a
LESSON — imperative instruction keyed to the audit rule that caught it — so the
next session doesn't rediscover the fix from scratch.

Governance mirrors dispositions: minting requires Shane's VERBATIM quote (his
confirmation of the fix or his correction that drove it). Nothing self-lessons
from the copilot's own opinion of its work.

Retrieval (two surfaces):
- audit_page attaches lessons matching the rules present in the current audit —
  right-time recall at the moment the same class of issue fires again.
- The system prompt carries a compact block of the most recent lessons — the
  cross-session memory (like COPILOT_RULES, loaded fresh each session).

Storage: git-tracked JSONL (docs/playbook/lessons.jsonl) + a human gallery
(LESSONS.md), following the playbook's corpus-is-the-asset pattern.
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Any

from src.config import ATLAS_REPO_ROOT

logger = logging.getLogger(__name__)

_ROOT = Path(ATLAS_REPO_ROOT) / "docs" / "playbook"
_LESSONS_FILE = _ROOT / "lessons.jsonl"
_GALLERY_FILE = _ROOT / "LESSONS.md"

# Injection caps — lessons must inform, never flood.
_MAX_PER_RULE = 2
_MAX_PROMPT_LESSONS = 8
# Content caps (2026-07-09): the old lesson[:600] cut two blessed lessons OFF
# MID-WORD. Cap generously and truncate on a word boundary so a stored lesson
# is never a fragment. The gallery/prompt still truncate for display.
_LESSON_CAP = 1500
_QUOTE_CAP = 800


def _cap(s: str, n: int) -> str:
    """Truncate to <=n chars total (incl. the ellipsis) on a word boundary."""
    s = str(s)
    if len(s) <= n:
        return s
    cut = s[:n - 1]  # leave room for the ellipsis so the result is <= n
    sp = cut.rfind(" ")
    return (cut[:sp] if sp > n * 0.6 else cut).rstrip() + "…"


def _norm(s: str) -> str:
    """Lowercase, collapse non-word (unicode-aware, so CJK survives) to spaces."""
    return re.sub(r"[^\w]+", " ", str(s).lower(), flags=re.UNICODE).strip()


def _coverage(frag_norm: str, shane: str) -> float:
    """Fraction of the fragment's words that sit inside a >=2-word run Shane
    actually said. A lone lifted span cannot whitelist a fabricated remainder —
    coverage measures how much of the WHOLE fragment is genuinely his."""
    qw = frag_norm.split()
    if not qw:
        return 0.0
    sw = shane.split()
    grams = set()
    for k in (2, 3):
        for i in range(len(sw) - k + 1):
            grams.add(" ".join(sw[i:i + k]))
    covered = [False] * len(qw)
    for k in (3, 2):
        for i in range(len(qw) - k + 1):
            if " ".join(qw[i:i + k]) in grams:
                for x in range(i, i + k):
                    covered[x] = True
    return sum(covered) / len(qw)


def _load_all() -> list[dict[str, Any]]:
    try:
        return [json.loads(line) for line in _LESSONS_FILE.read_text().splitlines() if line.strip()]
    except (OSError, ValueError):
        return []


def _active() -> list[dict[str, Any]]:
    """Lessons still in force — retired/superseded ones stay in the file for the
    record but never inject (a retired bad lesson must stop reaching the copilot)."""
    return [e for e in _load_all() if not e.get("retired")]


# A fragment traces only if this fraction of its words are genuinely Shane's —
# high enough that a fabricated directive cannot ride in on a lifted span.
_COVERAGE_MIN = 0.8


def quote_traces_to_shane(quote: str, shane_texts: list[str]) -> bool | None:
    """Provenance check for codify_lesson: does `quote` actually trace to words
    Shane really sent? `shane_texts` = his genuine messages this session.
    Returns True (traces — allow), False (fabricated — refuse), or None (no
    genuine Shane text to verify against, e.g. an autonomous post-reset span —
    the CALLER refuses on None too, because codify requires his verbatim words
    and there are none). A self-authored quote (the copilot summarizing its own
    work) fails this — that is the whole point."""
    shane = " ".join(_norm(t) for t in shane_texts if t)
    if len(shane) < 40:
        return None  # no genuine Shane words this session to trace against
    # The copilot may join several Shane messages with || / ; newlines — EACH
    # fragment must independently reach coverage, or the join smuggled in a
    # fabrication. Coverage (not a single window) is what defeats lifting one
    # real span to whitelist an invented directive.
    verified_any = False
    for frag in re.split(r"\s*(?:\|\||;|\n)\s*", str(quote)):
        fn = _norm(frag)
        words = fn.split()
        if not words:
            continue
        if len(words) < 2:
            # a lone word is too weak to prove provenance — it must at least
            # appear, but never on its own counts as "verified".
            if fn not in shane:
                return False
            continue
        if _coverage(fn, shane) < _COVERAGE_MIN:
            return False
        verified_any = True
    return True if verified_any else None


def retire(lesson_id: str, *, superseded_by: str | None = None, reason: str = "") -> bool:
    """Mark a lesson retired (kept in the file for history; stops injecting)."""
    entries = _load_all()
    hit = False
    for e in entries:
        if e.get("id") == lesson_id:
            e["retired"] = True
            if superseded_by:
                e["superseded_by"] = superseded_by
            if reason:
                e["retired_reason"] = reason
            hit = True
    if hit:
        _LESSONS_FILE.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in entries))
        _mark_gallery_retired(lesson_id)
    return hit


def _mark_gallery_retired(lesson_id: str) -> None:
    """Prefix the human gallery's bullet for a retired lesson (cosmetic —
    nothing reads LESSONS.md into a prompt, but keep the gallery honest)."""
    try:
        if not _GALLERY_FILE.exists():
            return
        out = []
        for line in _GALLERY_FILE.read_text().splitlines():
            if lesson_id in line and "[RETIRED]" not in line and line.lstrip().startswith("-"):
                line = line.replace("- ", "- ~~[RETIRED]~~ ", 1)
            out.append(line)
        _GALLERY_FILE.write_text("\n".join(out) + "\n")
    except OSError:
        logger.debug("gallery retire-mark failed", exc_info=True)


def mint(rule: str, lesson: str, shane_quote: str, *,
         page: int | None = None, element_ids: list[str] | None = None,
         rule_is_live_audit: bool | None = None) -> dict[str, Any]:
    """Append a lesson. Caller enforces the quote requirement; this persists."""
    entry = {
        "id": f"ls-{time.strftime('%Y%m%d-%H%M%S')}",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "rule": str(rule)[:80],
        "lesson": _cap(lesson, _LESSON_CAP),
        "shane_quote": _cap(shane_quote, _QUOTE_CAP),
        "page": page,
        "element_ids": [str(i) for i in (element_ids or [])][:8],
    }
    if rule_is_live_audit is not None:
        entry["rule_is_live_audit"] = rule_is_live_audit
    _ROOT.mkdir(parents=True, exist_ok=True)
    with _LESSONS_FILE.open("a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    _update_gallery(entry)
    logger.info("lesson minted: %s (%s)", entry["id"], entry["rule"])
    return entry


def _update_gallery(entry: dict[str, Any]) -> None:
    try:
        if not _GALLERY_FILE.exists():
            _GALLERY_FILE.write_text(
                "# Lessons — fixed true issues, codified\n\n"
                "Minted by the canvas copilot after Shane-confirmed fixes "
                "(`codify_lesson`). Newest last.\n\n")
        with _GALLERY_FILE.open("a") as f:
            f.write(f"- **{entry['id']}** [{entry['rule']}] {entry['lesson'][:200]}"
                    f" — Shane: \"{entry['shane_quote'][:120]}\"\n")
    except OSError:
        logger.debug("lesson gallery update failed", exc_info=True)


def for_rules(rules: list[str]) -> list[dict[str, Any]]:
    """Newest lessons whose rule is in `rules`, capped per rule — attached to
    audit_page so the copilot recalls the fix at the moment the class refires."""
    wanted = {str(r) for r in rules}
    out: list[dict[str, Any]] = []
    per_rule: dict[str, int] = {}
    for entry in reversed(_active()):
        r = str(entry.get("rule"))
        if r not in wanted or per_rule.get(r, 0) >= _MAX_PER_RULE:
            continue
        per_rule[r] = per_rule.get(r, 0) + 1
        out.append({"rule": r, "lesson": entry.get("lesson"), "when": entry.get("ts")})
    return out


def prompt_block() -> str:
    """Compact recent-lessons block for the system prompt ('' when none)."""
    entries = _active()[-_MAX_PROMPT_LESSONS:]
    if not entries:
        return ""
    lines = [f"- [{e.get('rule')}] {str(e.get('lesson'))[:220]}" for e in entries]
    return ("\n\nLESSONS (codified from Shane-confirmed fixes; follow them):\n"
            + "\n".join(lines))
