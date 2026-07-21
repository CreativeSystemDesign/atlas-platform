"""codify_lesson mint-time guardrails (2026-07-09) — the fixes for what the
lesson-mining audit exposed: two self-authored quotes beat the empty-only gate,
two dead `rule` names, two lessons truncated mid-word.
"""
from __future__ import annotations

import re
from pathlib import Path

from src.canvas_copilot import lessons as L
from src.canvas_copilot.audit import AUDIT_RULE_NAMES


# ── Guardrail 1: quote provenance ──────────────────────────────────────────
def test_fabricated_quote_is_rejected():
    """The exact ls-015526 failure: a copilot-authored summary attributed to
    Shane that appears in none of his real messages."""
    shane = ["move the terminals to the border where the wire crosses",
             "yes, dispose. designators are correct"]
    fabricated = ("Dispose the 3 M1-BU/BV/BW terminal-interior flags — placement is your "
                  "deliberate instruction (interior terminal, valid dual-attach).")
    assert L.quote_traces_to_shane(fabricated, shane) is False


def test_single_lifted_span_cannot_whitelist_a_fabrication():
    """Review finding 1: a mostly-fabricated quote that embeds ONE real span
    must NOT pass. Coverage (not a single window) is the defense."""
    shane = ["wire from the component terminal to the ground box border, please"]
    fabricated = ("delete the whole net and wire from the component terminal to whatever you think best")
    assert L.quote_traces_to_shane(fabricated, shane) is False


def test_short_fabricated_confirmation_rejected():
    """Review finding 2: sub-12-char fabricated fragments must not fall through
    to True. Shane never said these."""
    shane = ["ok that terminal placement looks right, keep the wide box and move on"]
    assert L.quote_traces_to_shane("just do whatever", shane) is False
    assert L.quote_traces_to_shane("nuke; wipe; erase; purge", shane) is False


def test_no_shane_history_is_unverifiable_None_not_pass():
    """Review finding 3: with no genuine Shane text (autonomous post-reset),
    the function returns None — and the HANDLER refuses on None (tested via the
    handler contract: only True is allowed)."""
    assert L.quote_traces_to_shane("any invented directive at all here", []) is None


def test_genuine_quote_traces():
    """A verbatim (even lightly-joined) real Shane quote passes."""
    shane = ["the detector is absolutely wrong here. Remember the rule order? "
             "the Print overrides the detector."]
    quote = "the detector is absolutely wrong here. Remember the rule order? the Print overrides the detector."
    assert L.quote_traces_to_shane(quote, shane) is True


def test_short_genuine_quote_traces():
    assert L.quote_traces_to_shane("yes, dispose. designators are correct",
                                   ["ok — yes, dispose. designators are correct, good work"]) is True


def test_joined_quote_each_fragment_must_trace():
    """A real fragment joined with a fabricated one is caught."""
    shane = ["Cab40 should be wired to the connections theyre adjacent to as a wire, not a component"]
    good_frag = "Cab40 should be wired to the connections theyre adjacent to as a wire, not a component"
    fab_frag = "and also delete every connector box on the whole page without asking"
    assert L.quote_traces_to_shane(good_frag, shane) is True
    assert L.quote_traces_to_shane(f"{good_frag} || {fab_frag}", shane) is False


def test_no_history_is_unverifiable_not_rejected():
    assert L.quote_traces_to_shane("anything at all here", []) is None
    assert L.quote_traces_to_shane("anything", ["hi"]) is None  # <40 chars of history


# ── Guardrail 2: rule-field validity (drift guard) ─────────────────────────
def test_every_emitted_audit_rule_is_registered():
    """AUDIT_RULE_NAMES must list every rule audit.py actually emits, or the
    codify_lesson validity note goes stale and dead-recall creeps back."""
    src = Path(__file__).resolve().parents[1] / "src/canvas_copilot/audit.py"
    text = src.read_text()
    emitted = set(re.findall(r'"rule"\s*:\s*"([a-z][a-z0-9-]+)"', text))
    emitted |= set(re.findall(r'\brule\s*=\s*"([a-z][a-z0-9-]+)"', text))
    # add()/emit()/flag() with a rule-name first arg, ANY second arg (finding 6:
    # the old regex missed variable-severity add() calls, e.g. unwired-node).
    emitted |= set(re.findall(r'\b(?:add|_add|emit|flag|violation)\w*\(\s*"([a-z][a-z0-9-]{3,})"', text))
    # kebab tokens only (excludes plain words like width/height/true)
    emitted = {r for r in emitted if "-" in r}
    missing = emitted - set(AUDIT_RULE_NAMES)
    assert not missing, f"audit.py emits rules not in AUDIT_RULE_NAMES: {sorted(missing)}"


def test_known_dead_rule_names_are_not_registered():
    # the two the audit caught — must NOT validate as live
    assert "connector-is-terminal" not in AUDIT_RULE_NAMES
    assert "mate-terminal" not in AUDIT_RULE_NAMES
    assert "mate-face-drift" in AUDIT_RULE_NAMES  # the correct one


# ── Guardrail 3: word-safe caps ────────────────────────────────────────────
def test_cap_never_cuts_mid_word():
    long = "border " * 400  # 2800 chars
    out = L._cap(long, L._LESSON_CAP)
    assert len(out) <= L._LESSON_CAP  # strict bound incl. ellipsis (finding 10)
    # ends on a whole word + ellipsis, never a fragment like "...border O"
    assert out.endswith("…")
    assert not re.search(r"\b\w$", out[:-1].rstrip())  # no dangling partial word


def test_cap_passes_short_text_through():
    assert L._cap("short lesson", 600) == "short lesson"


# ── Retired filter: retired lessons stop injecting ─────────────────────────
def test_active_excludes_retired(tmp_path, monkeypatch):
    import json
    f = tmp_path / "lessons.jsonl"
    f.write_text("\n".join(json.dumps(e) for e in [
        {"id": "a", "rule": "box-overlap", "lesson": "keep", "retired": False},
        {"id": "b", "rule": "box-overlap", "lesson": "gone", "retired": True},
        {"id": "c", "rule": "naming", "lesson": "keep2"},
    ]) + "\n")
    monkeypatch.setattr(L, "_LESSONS_FILE", f)
    active_ids = {e["id"] for e in L._active()}
    assert active_ids == {"a", "c"}
    # for_rules and prompt_block honour it
    assert all(x["lesson"] != "gone" for x in L.for_rules(["box-overlap"]))
    assert "gone" not in L.prompt_block()


def test_retire_marks_and_persists(tmp_path, monkeypatch):
    import json
    f = tmp_path / "lessons.jsonl"
    f.write_text(json.dumps({"id": "x", "rule": "naming", "lesson": "l"}) + "\n")
    monkeypatch.setattr(L, "_LESSONS_FILE", f)
    assert L.retire("x", superseded_by="y", reason="test") is True
    e = json.loads(f.read_text().strip())
    assert e["retired"] is True and e["superseded_by"] == "y"
    assert L.retire("nope") is False
