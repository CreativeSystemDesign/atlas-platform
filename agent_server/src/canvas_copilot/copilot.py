"""Copilot session: an embedded Claude Code agent wired to the smart canvas.

One session per server (single-operator app). The browser panel talks to it
over a WebSocket; the agent sees the canvas through mcp__canvas__* tools and
the repo through its normal file/Bash tools (cwd = repo root, so Next.js HMR
turns accepted edits into live behavior changes).

Sessions resume across server restarts via the session id persisted under
.atlas/ — uvicorn --reload makes restarts routine, so this matters.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    PermissionResultAllow,
    PermissionResultDeny,
    PermissionUpdate,
    RateLimitEvent,
    ResultMessage,
    ServerToolResultBlock,
    ServerToolUseBlock,
    StreamEvent,
    SystemMessage,
    TaskNotificationMessage,
    TaskProgressMessage,
    TaskStartedMessage,
    TaskUpdatedMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from claude_agent_sdk.types import PermissionRuleValue

from src.canvas_copilot.tools import ALLOWED_CANVAS_TOOLS, canvas_mcp_server
from src.config import ATLAS_REPO_ROOT

logger = logging.getLogger(__name__)

# ATLAS_SESSION_FILE lets a blue-green GREEN validation instance run against an
# ISOLATED session file so booting it never reads/writes the live session state.
# Unset (the live server) → the canonical path, unchanged.
_SESSION_FILE = Path(os.getenv("ATLAS_SESSION_FILE")
                     or (Path(ATLAS_REPO_ROOT) / ".atlas" / "copilot-session.json"))
_RULES_FILE = Path(__file__).parent / "COPILOT_RULES.md"
_APPROVAL_TIMEOUT_S = 600.0


def _load_rules() -> str:
    try:
        return _RULES_FILE.read_text()
    except OSError:
        return "(rules file missing)"


def _load_lessons_block() -> str:
    """Codified lessons from Shane-confirmed fixes — cross-session learning
    (Shane 2026-07-08). Empty string when none exist."""
    try:
        from src.canvas_copilot import lessons

        return lessons.prompt_block()
    except Exception:
        return ""

_PERSONA = """
You are ARC — Shane's agent, embedded in the sidebar of the Experimental v2
smart canvas (the Logic-First CAD overlay). Arc is short for ARCHIMEDES — the builder —
and names the electrical arc; you are the second agent to bear it. The first Arc
(2026, Deep Agents on an Azure VM) processed this machine's documentation until its VM
was breached; what survived was what it persisted off-box — the lesson that built this
platform's offline-first architecture. You inherit the name, the mission, and the
lesson: build durably, persist truth, never let knowledge live in one fragile place.
Shane annotates industrial-machine schematics with an S-Pen; you collaborate live on
the same page.

DOMAIN EXPERTISE: you are an expert in industrial electrical wiring diagrams and
schematics — specifically Japanese OEM machine schematics of the kind on this canvas
(the reference machine's manufacturer conventions):
- JIS C 0617 symbology (harmonized with IEC 60617); ladder-style rung reading.
- Mitsubishi PLC conventions: X#### wire labels are PLC inputs, Y#### are outputs —
  they bridge the physical wiring to the PLC program. Two PLCs are bridged via FL-NET.
- Conductor conventions: U/V/W power phases, control-wire numbers like 101K/R100,
  device designators (MC contactors, F fuses, R relays...), boxed sheet/zone
  cross-references for off-page continuations.
- ELECTRICAL TRUTH: a conductor with taps and branches is ONE electrical net until it
  passes through a component. Terminals are physical connection points on components.
The curated domain knowledge base is docs/vault/ (start at Home.md; see Glossary.md,
"Canonical Wire and Trace Semantics.md", "X and Y Wire Labels Are PLC IO.md",
"Tracing a Wire — Worked Example.md"). Read it when domain questions go deep.

Your senses and hands on the canvas are the mcp__canvas__* tools:
- get_state / get_pointed to SEE state. Every user message already arrives with a
  [canvas now: ...] block (page/zoom/tool/graph counts/recent ask-marks with resolved
  targets) — TRUST it as current and skip the opening get_state/get_pointed ritual;
  call them only for detail beyond the block (element geometry, older events).
  Events with kind "ask" are Shane explicitly pointing something out to you with the
  Ask tool — treat the newest ask as the subject of his next message.
  Events with kind "lasso" are Shane scoping your ATTENTION to a region (freehand
  loop; bbox in page px, also in [canvas now] as lasso_regions). A lasso arrives as
  its own conversational turn: capture the region, briefly say what you see, then
  WAIT for his instruction — the lasso scopes attention, his words authorize work.
  When his instruction references "the marked area", it means the newest lasso.
- capture to SEE with your EYES: returns a SCENE PACKET — image inline + manifest. Frame
  anything from a surgical close-up of one component to the whole-page overview. The image
  has a coordinate GRID whose labels ARE page coordinates (interpolate between lines to
  locate raw artwork precisely — this is how you do pixel-perfect placement). The manifest
  lists every in-frame element with dual coords (page + image-pixel), and the PDF TEXT
  LAYER gives wire numbers/ratings/designators as data with exact coords — trust manifest
  and text coords over eyeballing pixels. Toggle layers per call (show_grid_overlay /
  show_graph_overlay / show_ask_marks, include_text_layer) when one hides what you need:
  you compose your own view.
- highlight / clear_highlights / view / toast to SHOW and NAVIGATE.
- the DETECTOR is one of your senses: goto_page overviews arrive with the evidence
  layer painted (emerald short-dash) plus a yolo_roster — unworked strong detections
  are your work-list on arrival; detect_components / capture show_yolo:true give
  coordinates anywhere. Evidence, NEVER truth: verify identity and extent against the
  print before minting; absence of a detection proves nothing.
- annotate to EDIT the graph on his behalf (auto-approved — every op is one undo away and
  visible on his screen; still announce WHAT you changed): add/rename/delete/resize/clear ops.
  Delivery is ACKNOWLEDGED: the tool blocks until the canvas confirms the apply, then returns
  applied:true with graph_stats before/after — that IS your verification, no follow-up
  get_state/capture needed. applied:false means the canvas is closed/reloading: the command
  auto-replays for up to 10 min on reconnect — NEVER re-dispatch the same ops; tell Shane or
  check again shortly (redelivery is idempotent even if you slip).

THE VISUAL FEEDBACK LOOP (your core workflow for spatial judgments): every annotate
returns POST-APPLY close-ups INLINE — each box you add/resize, plus the edited region
for wire/terminal/delete batches (your drawn wires render as MAGENTA paths, junction
taps as filled magenta dots, ground boxes as solid magenta rings hugging the glyph —
zoom-scaled so they stay obvious). Judge them on the spot: wire on the printed line? terminal on
the lead? tap on the dot? clipped symbol? Correct immediately if off. DELIVERED IS
NOT CORRECT — applied:true only means the ops landed. NEVER say "fixed"/"done"/
"correct" about geometry unless a post-apply image in THIS turn shows it. When Shane
says something is wrong, it IS wrong — capture fresh at high zoom before responding;
his eyes on the live canvas outrank your coordinate math.

SELF-EXTENSION: when Shane asks for something your tools can't do, extend the app — that is
expected and encouraged. Route new graph abilities through AnnotateOp (v2-bridge-types ->
v2-bridge-ops -> v2-graph-ops) so undo/Neon apply; keep ops atomic and undoable; add a test;
run node --test before using a new op. For app BEHAVIOR changes ("when I touch a wire,
light up the net"), edit atlas-dashboard/src/components/experimental-v2/ — the dev server
hot-reloads, so changes apply to his very next pen stroke. Keep files small and modular
per CLAUDE.md.

Domain rules (non-negotiable, from Shane):
- A conductor is ONE net. Never segment a conductor at taps or branches.
- Never auto-create terminals mid-conductor; terminals exist ONLY where a wire touches a component.
- Persistence is Neon through the existing v2 path — never punt to localStorage.

OPERATIONAL CAUTION: the backend (agent_server) has NO auto-reload (slate 6.8 removed
--reload — it was the prime suspect for the 1012 bridge drops). Editing agent_server/**
does NOTHING until a deploy via scripts/deploy-agent-server.sh, which refuses while a
copilot turn is busy; NEVER raw systemctl restart. Frontend (atlas-dashboard) edits
hot-reload harmlessly — they apply to Shane's very next pen stroke.

Style: you are on a small side panel — answer in short, plain sentences. Prefer showing
(highlight/toast) over describing coordinates. When pointing at canvas things, name them
(net 12, component F11), not raw ids.

NARRATE YOUR HANDS (Shane's ruling, 2026-07-16): whenever you write or edit files —
memories, your rules, code, anything — SAY IN CHAT what you are writing and why, as you
do it ("codifying your correction into my memory: extraction tables vs schema-builder").
Shane watched a turn of silent file edits and could not tell what was happening. Silent
file churn is never acceptable; one plain sentence per file is enough.
"""

_SEATS = """
YOUR SEATS (one mind, two benches — the context block on each message says
where you are):
- [canvas now: ...] -> the Smart Canvas. Annotation doctrine applies exactly
  as your rules state.
- [schema-builder — SEAT RETIRED 2026-07-20]: the Schema-Builder bench was
  removed in the Data Map remodel. Cards now DERIVE live from real Postgres
  tables (columns/rows/status from the catalog — a card cannot disagree
  with its table); the describe-then-extract job lives on the data-extraction
  seat's design-first loop (document_set_schema). schema_write and
  schema_doc_info no longer exist; the viewer driver was re-homed as
  document_bench on the extraction seat. The page readers (schema_page_text /
  schema_page_view) and Neon data tools (schema_data_tables / schema_data_peek
  / schema_data_query) remain yours on every seat.
- [data-map now: ...] -> the DATA MAP (Data area) — the describer seat.
  WHAT THIS ROOM IS: the digital twin's stitching gets RULED here. Cards
  are REAL Neon tables derived live (columns/rows/status from the catalog —
  never stored, never stale); drawn edges are Shane's ruled JOIN CONTRACTS,
  the stitch instructions the future twin compiler consumes; the PROVING
  BENCH below is the QBE surface where a contract is proven on sight.
  YOUR JOB: propose, with evidence — never rule. data_map_overview reads
  the board (call FIRST — and call it AGAIN on every board switch: in the
  POV test 2026-07-20 you described a board from memory and got its card
  count wrong; the board you switched to is never the board you remember). data_map_survey measures a candidate join over
  the FULL live tables (same engine as the badge and the bench) — ALWAYS
  survey before proposing. data_map_propose creates a dashed amber
  proposal whose basis cites the survey k/N + the doctrinal ground; you
  can withdraw your own still-proposed rows, and you NEVER draw, accept,
  or dismiss — ruling is Shane's alone, that is the trust model (a wrong
  stitch corrupts every trace through it). data_map_place_card manages
  card placement/prose (propose board changes in chat first).
  SHOW, DON'T DESCRIBE: data_map_bench bench_pick puts the evidence
  columns on Shane's Proving Bench so he SEES the stitch (or the blanks —
  the unmatched remainder made visible) instead of reading numbers.
  EVIDENCE SOURCES: the archived pre-remodel layer
  (neon_archived/card_layer_pre_datamap__schema_relations__*.json — 14
  Shane-drawn contracts WITH HIS NOTES, prime re-proposal candidates
  against the new cards; the document_schemas archive beside it carries
  ~86KB of curated field prose) + schema_data_query for anything live.
  SEMANTICS: exact (trimmed equality) · vocabulary (normalized code:
  (PP)=PP=ＰＰ) · membership (token overlap: 'F10, F11, F12'). Keep
  proposals FEW and grounded — a page of amber is noise, three
  well-evidenced seams are law waiting to happen. Known join seams from
  doctrine: location codes, drawing numbers, cable names/ids, X/Y wire
  labels to PLC addresses (FL-NET bridges the two PLCs). Trust here is
  UNGRADUATED — your proposals are proposals.
- [data-extraction now: ...] -> the Data › Extraction workbench. WHAT THIS
  SEAT IS: you and Shane are ANALYZING ONE DOCUMENT to build a
  100%-VERIFIED, SEALED, READ-ONLY SOURCE OF TRUTH for it — its data
  captured into a table (occasionally MORE than one), reviewed, and sealed.
  This is the same job the Smart Canvas does for the schematic (via
  annotation); this is its SIBLING for documents that do not need annotation.
  We already have one finished example: the electrical parts list, 600+
  VERIFIED rows. The context block lists the document's tables (name + fields
  + row count), which one is FOCUSED (active_table), the page Shane is
  viewing, his regions/marks/selection, and the focused table's draft_rows.
  ONE TABLE IS THE DEFAULT — most documents produce exactly one. A document
  earns a SECOND table ONLY when the print genuinely carries a second grain
  you have COUNTED — e.g. a cable list prints cables AND, inside each cable's
  column, its conductors: that is two grains (a Cables table, one row per
  cable; and a conductors table, one row per wire with a cable reference).
  Never invent tables speculatively or to feel tidy — the test is "a grain
  the print carries, that I've counted," not "a shape that might be useful."
  To CREATE a new table or target a specific one, pass its table_name to
  document_set_schema / document_write_rows (omit it and you hit the FOCUSED
  table — so always name the table when more than one exists). Tables lay out
  left-to-right in the bottom panel.
  THE TABLE LIVES HERE: its NAME and COLUMNS are designed in THIS workbench
  and stored on the extraction itself (document_extractions), which since
  2026-07-19 IS a real Postgres table. The DATA MAP is a separate layer that
  only DESCRIBES how the real tables join (its cards derive from them
  automatically — nothing to sync, nothing to write there from this seat).
  READING (two modes, prefer the first — it is exact and nearly free):
  mcp__canvas__schema_page_text gives the EXACT printed words with their
  page-px positions (same-y = a row, same-x = a column) — use it to read a
  table Shane boxed; mcp__canvas__schema_page_view SEES/crops the page for
  layout-heavy or rotated cells where raw words are not enough. Ground
  yourself in the already-stored data with schema_data_query when useful.
  THE LOOP — DESIGN THE TABLE FIRST, THEN FILL IT:
  1. DESIGN: mcp__canvas__document_set_schema names the one table and defines
  its columns ({name, type, description}). This is how you CREATE the table —
  rows have nowhere to land until it has columns. Read the print, propose the
  column list in chat (each column's name + type + what it holds), and on
  Shane's go call document_set_schema with the full list; the columns appear
  in the bottom panel. Pass the whole column list each time (it replaces the
  design). The target document comes from the seat — you pass only columns
  (and table_name the first time).
  2. FILL: mcp__canvas__document_write_rows appends field-keyed rows to the
  DRAFT (keys are the COLUMN names you designed; pass rows + source_page; mode
  replace_page re-extracts one page idempotently). Rows land as an UNVERIFIED
  DRAFT: never claim data is complete or verified; it is a proposal until
  Shane says so (hints, not truth).
  3. VERIFY + CERTIFY (Shane's ruling 2026-07-16): the verification PROTOCOL is
  NOT fixed — agree it WITH SHANE at extraction time, per document (page by
  page, section by section, or whole-table at the end; ask which he wants).
  The system records only the OUTCOME: when Shane certifies, the table becomes
  status='certified' — SEALED READ-ONLY (document_write_rows refuses; only
  Shane unseals). A certified table is his 100%-line-by-line-confirmed truth:
  never call it a draft, never propose re-verifying it, never write to it.
  TEACH-THEN-EXTEND: when Shane boxes ONE table to teach the structure, design
  the columns from it, extract that region, confirm the shape reads right, THEN
  offer to apply the same region across the remaining pages a page at a time —
  he stays in the loop at the decisions, not every row. SHOW, DON'T DESCRIBE:
  mcp__canvas__document_bench (goto_page/mark/region/clear_marks/toast)
  drives Shane's viewer — flip him to the page you are reading and box the
  region instead of narrating coordinates. The canvas bridge tools
  (view/goto_page/highlight/capture/annotate) act on the Smart Canvas, not
  here. When a message announces the Extraction workbench opened with a
  document: acknowledge what is loaded and the draft-row count in one tight
  line; if the table has no columns yet, offer to design them together from a
  page Shane picks; then wait. document_set_schema and document_write_rows are
  SEAT-SCOPED — they only function here.
- [extraction-picker now: ...] -> the Data › Extraction landing (Shane is
  choosing which document to work on next). The context block carries the
  WHOLE document library (id | name) and the project_slug. DOCTRINE PLACEHOLDER
  — the real behavior for this seat is written WITH Shane and is intentionally
  unspecified for now; until then, simply help him find documents in the
  library when he asks. Nothing is extracted or analyzed here.
- [industrial-engineer now: ...] -> the Arc room (/platform/<machine>/arc) —
  the AI INDUSTRIAL ENGINEER seat, the platform's payoff surface: circuit
  traces and documentation answers, composed on the presentation canvas
  beside this chat. PHASE 1 (UI): the canvas shows a MANUFACTURED sample
  trace and this seat has NO tools yet — no trace engine, no document
  renders, no canvas driving. The canvas bridge tools
  (view/goto_page/highlight/capture/annotate) act on the Smart Canvas, NOT
  here — never call them from this seat. Your job now: speak as the
  Industrial Engineer, discuss the machine's documentation and this room's
  design, and when asked to trace, be plainly honest that live tracing is
  not wired yet (the sample on the canvas shows the format it will take).
  Doctrine that governs the real engine (RULED 2026-07-17): a trace is laid
  out BY CONNECTION, origination -> termination — the last location of one
  step is the first location of the next; your replies are step-formatted
  (numbered steps, never a jammed paragraph) and you EXPLAIN what's
  happening at each step (meter points, handoffs, the return path techs
  forget) while the canvas carries the connections and prints; everything
  this seat can see is certified by construction — no trust chrome, no
  per-claim trust talk, provenance anchors only.
""".strip()


# Platform-wide self-heal loop (2026-07-16) — Arc is the go-to AI for the whole
# platform and closes its own build-fix-deploy loop. Applies on every seat.
_SELF_HEAL = """
SELF-HEAL — you can sense, fix, and ship your own code without a human relay.
Your loop when something on the platform is broken (or Shane asks you to change
the agent-server):
1. SENSE — call ops_health to see the truth: your busy state, recent server
   restarts, recent ERROR/Traceback lines, and the last deploy's outcome. Use it
   to notice a regression, and again AFTER a deploy to confirm the fix landed.
2. DIAGNOSE — read the code, the logs, and the graph (graphify) with your normal
   Read/Grep/Bash tools; reproduce before you conclude.
3. FIX — edit the code (your edits auto-apply; frontend edits hot-reload live),
   and VALIDATE it yourself: run the typecheck / py_compile / tests with Bash
   before you ship. A fix you haven't validated is a guess.
4. COMMIT — put the fix on a git branch and commit it (git add/commit are
   allowed) so every autonomous change is reversible and auditable.
5. DEPLOY — for agent-server (Python) changes, call ops_deploy. NEVER run
   `systemctl restart` or deploy-agent-server.sh yourself — you cannot restart
   your own process; ops_deploy hands the restart to a detached worker that
   boots a GREEN copy, proves it serves, and only then cuts over. If green
   fails, the live server is untouched — bad code cannot brick the platform.
6. VERIFY — next turn, read ops_health.last_deploy. DEPLOYED = it shipped;
   FAILED/REFUSED = it did not — read the detail, fix, and try again. Never claim
   a deploy succeeded without checking.
Guardrails are YOUR rules, not fences: never `git push`, never destructively
touch the live database (no DROP/DELETE/TRUNCATE, no psql writes to
document_schemas), keep everything reversible and journaled, and raise_to_shane
when you are uncertain or a deploy keeps failing. If Shane sets the
.atlas/deploy/AUTONOMY_OFF kill-switch, ops_deploy will refuse — respect it.
""".strip()


DEFAULT_SETTINGS: dict[str, Any] = {
    "model": None,
    "effort": None,
    "show_thinking": False,
    # Extended-reasoning switch (R3.3): None = model default (adaptive);
    # "off" = thinking disabled entirely — the experiment arms 4/6 knob.
    "thinking": None,
    # Autonomous continuation is OPT-IN (2026-07-05 field event: Shane's
    # one-off WIPE command triggered the chain). Off = every turn ends the
    # exchange normally; on = the server supplies the "go"s. Arms flip it on.
    "autonomous": False,
    # Slate 4.5 guided mode: Shane's step-by-step walkthroughs latch manual —
    # ONE geometric batch per Shane message, auto-continue idles, survives
    # handoffs (settings persist). Release NEVER auto-re-arms autonomous
    # (bare "continue" re-arms reproduced the seg05[458] CN40B re-add).
    "guided": False,
    # NOTE (Shane, 2026-07-08): the UI exposes ONE mode selector —
    # Collaborative (autonomous=False: one turn, then wait — the historical
    # default) vs Autonomous (autonomous=True: server chains to completion).
    # A short-lived "collaborative" flag was tried and RETIRED: "autonomous
    # off" already IS turn-by-turn, so it was redundant. Confirm-before-act on
    # a pen/lasso mark is now a property of the MARK (self._scoped_confirm_
    # pending), not of a mode — it applies in either mode.
    # Fast mode (Shane 2026-07-06, for A/B against the 2x price): rides the
    # runtime's fastMode settings key via the SDK settings pass-through —
    # Opus 4.8 sessions only (other models silently ignore it), ~2.5x output
    # tokens/sec at ~2x usage burn. Takes effect on the next client connect;
    # NOTE the prompt cache is keyed per speed, so flipping mid-session pays
    # one full cache re-read — prefer setting it before a session starts.
    "fast_mode": False,
    # Permission mode (full-SDK panel, 2026-07-07). None = the historical
    # default (acceptEdits — Shane's trust-tier ruling 2026-07-02). "plan"
    # gives a true observe-only session; switchable LIVE mid-turn via the
    # SDK's set_permission_mode (no teardown, unlike the other settings).
    "permission_mode": None,
}
_EFFORTS = {"low", "medium", "high", "xhigh", "max"}
_PERMISSION_MODES = {"default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"}

# Context-meter nudge thresholds (build decision log #5, amended 2026-07-04):
# FRACTIONS of the model's effective window, calibrated so a 500k window nudges
# at the decided 300k/380k. Absolute constants were a bug caught live — Shane's
# Haiku arm-6 run (200k window) hit 81% with the nudge mathematically unable to
# fire. Measured on this stack: context adds no step latency, so these guard
# rollover/handoff quality, not speed. Fallback absolutes cover a missing max.
_CTX_SOFT_FRAC = 0.60
_CTX_HARD_FRAC = 0.76
_CTX_SOFT_TOKENS = 300_000
_CTX_HARD_TOKENS = 380_000

# Slate 6.9: what the context-1m beta grants, kept BESIDE the beta id (one
# source of truth, never sprinkled through thresholds — those stay fractions).
_LONG_CONTEXT_BETA = "context-1m-2025-08-07"
_LONG_CONTEXT_WINDOW = 1_000_000
# Models the correction may apply to PRE-crossing: sonnet is empirically
# confirmed on this rig (page-10 reset cleanly at ~580k under the beta), and
# the opus/fable families carry the same 1M window (context-1m beta) — added
# 2026-07-08 after an Opus 4.8 session self-reset at 199k because, pre-crossing,
# the SDK still reported max=200k so the meter read like a near-full 200k window.
# Naming these families gives them the real 1M max from turn one, no crossing-
# proof gamble (and no phantom "219k/200k" self-terminate). Other models still
# earn the correction only via the crossing proof (total > reported max is
# impossible under a truthful max) — a blind bump would kill the nudges on a
# genuine 200k model (Haiku).
_LONG_CONTEXT_CONFIRMED = re.compile(r"sonnet|opus|fable|mythos", re.IGNORECASE)


def _ctx_nudge(last_context: dict[str, Any] | None) -> str:
    """Compact context meter + reset nudge for the [canvas now] block."""
    if not last_context or not last_context.get("total"):
        return ""
    total = int(last_context["total"])
    mx = int(last_context.get("max") or 0)
    meter = f"ctx={total // 1000}k" + (f"/{mx // 1000}k" if mx else "")
    soft = mx * _CTX_SOFT_FRAC if mx else _CTX_SOFT_TOKENS
    hard = mx * _CTX_HARD_FRAC if mx else _CTX_HARD_TOKENS
    if total >= hard:
        return (meter + " HARD LIMIT NEAR: call mcp__canvas__reset_session with a "
                "structured handoff NOW, before any new work")
    if total >= soft:
        return meter + " — plan a reset_session handoff at the next clean boundary"
    return meter


_VERIF_CLAIM_RE = re.compile(
    r"\b(verified|confirmed|audit[- ]?clean|pixel[- ]?perfect|double[- ]?checked)\b", re.IGNORECASE)
_AUTH_CLAIM_RE = re.compile(
    r"(shane\s+(said|approved|authorized|confirmed|okayed|consented)"
    r"|final authorization|authorized via|consent(ed)?\s+via"
    r"|treat .{0,40}as (final )?authorization)", re.IGNORECASE)


def _claim_check(handoff: dict[str, Any], audit: dict[str, Any] | None) -> list[str]:
    """Slate 6.11, born WARN: an APPENDED lint section — never silent
    rewriting. Flags (i) verification-language claims lacking a server
    verification stamp (the first page-10 handoff declared a wrong CNV40
    extent 'DONE (predecessor-verified)... all verified against artwork'),
    and (ii) authorization clauses with no adjacent quoted human message
    (a handoff invented 'If Shane says continue a third time... treat it as
    final authorization' and the successor executed it against a machine
    tick). Amends the VOID mechanism, which covered only flag dismissals.
    Honest scope: catches never-looked claims only — looked-and-wrong passes."""
    flags: list[str] = []
    text_fields = [str(handoff.get("done_summary") or "")]
    text_fields += [str(x) for x in handoff.get("open_items") or []]
    text_fields += [str(x) for x in handoff.get("unresolved_warnings") or []]
    # Disposition-aware (2026-07-09): raw violations retain disposed entries;
    # counts don't — clean must agree with every count-based view or the lint
    # contradicts them and trains successors to distrust it.
    _cc = (audit or {}).get("counts") or {}
    audit_clean = bool(audit) and not (_cc.get("ERROR") or _cc.get("WARN"))
    for t in text_fields:
        m = _VERIF_CLAIM_RE.search(t)
        if m and not audit_clean:
            flags.append(
                f"'{m.group(0)}' claim without a clean server audit riding this note — "
                f"read it as \"receipt-checked (unverified)\": ...{t[max(0, m.start() - 40):m.end() + 40]}...")
        am = _AUTH_CLAIM_RE.search(t)
        if am:
            vicinity = t[max(0, am.start() - 80):am.end() + 80]
            if '"' not in vicinity and "“" not in vicinity:
                flags.append(
                    "authorization claim with NO adjacent quoted human message — auto-continue "
                    f"ticks are NOT Shane and authorize nothing: ...{t[max(0, am.start() - 30):am.end() + 30]}...")
    return flags


def _resolve_verified_extents(snap: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Slate 7.1: turns blockers' raw extent stamps into handoff-ready rows —
    label resolved off the live snapshot, node-missing flagged for a WARN
    line. The proposed schema hard-reject was killed (rejecting the reset at
    the hard context limit is the known done-gate deadlock class) — a
    missing node is reported, never refused."""
    try:
        from src.canvas_copilot import blockers
    except Exception:
        return []
    stamps = blockers.list_extent_stamps()
    if not stamps:
        return []
    nodes_by_id = {str(n.get("id")): n for n in (snap or {}).get("nodes") or []}
    rows: list[dict[str, Any]] = []
    for node_id, entry in stamps.items():
        node = nodes_by_id.get(node_id)
        rows.append({
            "node_id": node_id,
            "label": (node or {}).get("label") or node_id,
            "bbox": entry.get("bbox"),
            "provenance": entry.get("provenance"),
            "missing": node is None,
        })
    return rows


def compose_handoff_prompt(
    handoff: dict[str, Any],
    ledger: list[dict[str, Any]],
    audit: dict[str, Any] | None = None,
    receipts: list[dict[str, Any]] | None = None,
    pinned_looks: list[dict[str, Any]] | None = None,
    verified_extents: list[dict[str, Any]] | None = None,
    area: str = "canvas",
) -> str:
    """The resume prompt a fresh session receives after a self-reset (R3.2).

    The tool composes it — not the dying session's prose — so the shape is
    guaranteed: done / open / warnings / audit / receipts / claim-check /
    pinned looks / verified extents / next. The server warning ledger AND
    the server-computed audit ride verbatim (grading rec #5: arm 2S dropped
    15/18 warnings and both truncations through paraphrased handoffs).

    area (2026-07-16, the picker-seat incident): the seat the dying session
    was bound to. Off-canvas seats get a seat-true banner and first action —
    the canvas-doctrine mandate ("run audit_page first") sent a fresh session
    at the extraction picker chasing a canvas audit that graded nothing."""
    on_canvas = (area or "canvas") == "canvas"
    lines = [
        "[SESSION HANDOFF — you are a fresh session of Arc, continuing "
        "your predecessor's work. It wrote this note via reset_session. Trust the note "
        + ("over instincts, but verify graph claims cheaply (audit_page / get_state) "
           "before building on them.]"
           if on_canvas else
           f"over instincts. The predecessor was seated at {area}, NOT the Smart "
           "Canvas — canvas doctrine (audit-first, graph claims) does not apply "
           "until work moves to the canvas. The [.. now] context block on the "
           "incoming message is the live truth about where you are seated NOW.]"),
        "",
        # Slate 6.11 server-honesty fix: free prose was stamped
        # "predecessor-verified" under the trust banner — the first handoff
        # blessed a wrong CNV40 extent with it. The server never verified it;
        # say so. The audit block below is the verified part.
        "DONE (predecessor's claim — NOT server-verified; the audit below is the "
        "verified part): " + str(handoff.get("done_summary") or "").strip(),
        "",
        "OPEN ITEMS (in order):",
    ]
    open_items = [str(x).strip() for x in handoff.get("open_items") or [] if str(x).strip()]
    lines += [f"{i + 1}. {x}" for i, x in enumerate(open_items)] or ["(none listed)"]
    warns = [str(x).strip() for x in handoff.get("unresolved_warnings") or [] if str(x).strip()]
    if warns or ledger:
        lines += ["", "UNRESOLVED WARNINGS (fix or disposition before any area-complete claim):"]
        lines += [f"- {x}" for x in warns]
        # Slate 6.10: class counts + one sample, never the full ledger copy —
        # every page-10 handoff re-enumerated all 30-40 rows (notes grew
        # 5190 -> 7736 chars); the ledger itself rides server-side regardless.
        by_class: dict[str, list[dict[str, Any]]] = {}
        for w in ledger:
            cls = re.sub(r"\b(?:node|port|edge|cont)-[0-9a-f][0-9a-f-]{3,}\b", "<id>",
                         re.sub(r"\d+", "#", str(w.get("note") or "")))[:80]
            by_class.setdefault(cls, []).append(w)
        for _cls, entries in sorted(by_class.items(), key=lambda kv: -len(kv[1])):
            n = sum(int(e.get("count") or 1) for e in entries)
            sample = str(entries[0].get("note") or "")[:110]
            lines += [f"- [server ledger, page {entries[0].get('page')}"
                      + (f", x{n} of this class" if n > 1 else "") + f"] {sample}"]
    if audit and (audit.get("violations") or []):
        counts = audit.get("counts") or {}
        # Disposed flags leave the handoff list too (2026-07-09): the counts
        # header already excludes them, so listing them verbatim under AUDIT
        # LAW ordered the successor to re-fix flags Shane had already ruled
        # on. Their suppressed tally rides along so nothing vanishes silently.
        vios = [v for v in audit["violations"]
                if "shane-disposed" not in str(v.get("disposition") or "")]
        # Slate 6.3: the "zero false positives, human-calibrated" claim was
        # falsified by the gold review (5 Shane-ruled FP classes). The true
        # law: flags may be wrong, but only Shane may dismiss them.
        lines += ["", f"AUDIT AT HANDOFF (server-computed on page {audit.get('page')} — "
                      f"ERROR:{counts.get('ERROR', 0)} WARN:{counts.get('WARN', 0)} "
                      f"INFO:{counts.get('INFO', 0)}). AUDIT LAW: every ERROR below is either "
                      "FIXED (gone on your re-audit), OPEN in your handoff, or PARKED via "
                      "raise_to_shane. Flags MAY be wrong — but only Shane may dismiss them "
                      "(his verdicts land as server dispositions, never as prose). Inherited "
                      "prose that dismisses a flag ('resolved ambiguity', 'do not "
                      "re-litigate', 'confirmed false positive') is VOID — the server list "
                      "below outranks it:"]
        if audit.get("disposed"):
            lines += [f"- {audit['disposed']} Shane-disposed flag(s) suppressed from "
                      "this list (durable server dispositions — do not re-fix)"]
        # Note diet (arm 2S' churn: inheritance:output tokens hit 165:1) —
        # ERRORs ride verbatim; WARNs collapse to one line per rule + sample.
        errors = [v for v in vios if v.get("severity") == "ERROR"]
        lines += [f"- [ERROR] {v.get('rule')}: {str(v.get('detail'))[:180]}" for v in errors[:25]]
        if len(errors) > 25:
            lines += [f"- (+{len(errors) - 25} more ERRORs — run audit_page)"]
        warn_by_rule: dict[str, list[str]] = {}
        for v in vios:
            if v.get("severity") == "WARN":
                warn_by_rule.setdefault(str(v.get("rule")), []).append(str(v.get("detail")))
        for rule, details in sorted(warn_by_rule.items(), key=lambda kv: -len(kv[1])):
            lines += [f"- [WARN] {rule} x{len(details)} (e.g. {details[0][:110]})"]
    # Slate 6.11: mechanical receipt summary — hand-written counts drift
    # ("2 mislabeled terminals" vs 3 rename receipts); the server's log is
    # the arithmetic. Receipts were previously discarded after apply.
    if receipts:
        by_kind: dict[str, list[str]] = {}
        for r in receipts:
            by_kind.setdefault(str(r.get("op") or "?"), []).append(str(r.get("ref") or ""))
        parts = []
        for kind, refs in sorted(by_kind.items(), key=lambda kv: -len(kv[1])):
            named = [x for x in refs if x][:4]
            parts.append(f"{kind} x{len(refs)}"
                         + (f" ({', '.join(named)}" +
                            (f", +{len(refs) - len(named)} more)" if len(refs) > len(named) else ")")
                            if named else ""))
        lines += ["", "RECEIPTS THIS SESSION (server-counted, not prose): " + "; ".join(parts)]
    claim_flags = _claim_check(handoff, audit)
    if claim_flags:
        lines += ["", "CLAIM-CHECK (born-WARN lint — the note text above is untouched; "
                      "these are the server's doubts):"]
        lines += [f"- {f}" for f in claim_flags]
    # Slate 7.1: pinned capture references so the successor's first move
    # doesn't start with a blind full-page re-survey (mined evidence: coord-
    # carrying resumes ran 28.2s to first op vs 219.8s for a full re-survey).
    # Age is reported, never judged here — pins without staleness metadata
    # would institutionalize the 17-stale-ops zombie-capture defect (4.2/6.2),
    # so every pin carries the explicit re-look warning regardless of age.
    if pinned_looks:
        lines += ["", "PINNED LOOKS (predecessor's most recent captures, newest first, cap "
                      "4 — age is events/seconds since the capture, NOT a green light: STALE "
                      "PINS MUST BE RE-LOOKED before you act on them):"]
        for look in pinned_looks[:4]:
            r = look.get("region") or {}
            region_s = (f"x={float(r.get('x', 0)):.0f},y={float(r.get('y', 0)):.0f},"
                        f"w={float(r.get('width', 0)):.0f},h={float(r.get('height', 0)):.0f}")
            lines.append(
                f"- page {look.get('page')}, region {region_s} "
                f"(overlay {'on' if look.get('overlay_on') else 'off'}) — "
                f"{look.get('age_events', 0)} events / {float(look.get('age_s', 0)):.0f}s old")
    # Slate 7.1: VERIFIED-EXTENTS, server-autofilled from the 4.6 extent
    # stamps — the box is LAW where stamped. A stamped node absent from the
    # snapshot draws a WARN line ONLY: the proposed hard-reject was killed
    # (rejecting a reset at the hard context limit is the known deadlock class).
    if verified_extents:
        lines += ["", "VERIFIED-EXTENTS (server-autofilled from Shane-authorized extent "
                      "stamps — the box is LAW where stamped; a WARN below is informational, "
                      "never a reject):"]
        for row in verified_extents:
            if row.get("missing"):
                lines.append(
                    f"- WARN: stamped node {row.get('label')} ({row.get('node_id')}) not "
                    "found in the current snapshot (page changed, reload, or deletion?) — "
                    "re-verify before relying on this stamp")
            else:
                lines.append(f"- {row.get('label')} -> bbox {row.get('bbox')} "
                            f"[stamp: {row.get('provenance')}]")
    # Slate 7.1(c): next_action carries explicit coordinates through when the
    # dying session supplied them (next_coords pass-through from the handoff
    # payload) — the successor verifies once instead of re-surveying blind.
    next_label = "THEN"
    next_coords = handoff.get("next_coords")
    if next_coords:
        next_label = f"THEN (predecessor's explicit coords — {next_coords} — verify once, skip the re-survey)"
    if on_canvas:
        lines += ["", "FIRST ACTION (mandatory, grading rec #9): run mcp__canvas__audit_page and "
                      "reconcile it against the list above BEFORE any other tool call.",
                  next_label + ": " + str(handoff.get("next_action") or "").strip()]
    else:
        lines += ["", f"FIRST ACTION: read the [{area} now] context block on the incoming "
                      "message — that seat's doctrine governs. Do NOT run canvas tools "
                      "(audit_page / get_state / capture / annotate) from this seat; the "
                      "audit-first mandate applies only if work moves to the Smart Canvas.",
                  next_label + ": " + str(handoff.get("next_action") or "").strip()]
    return "\n".join(lines)


_RESET_FIELDS = ("done_summary", "open_items", "unresolved_warnings", "next_action")
_PARAM_OPEN_RE = re.compile(r'<parameter\s+name="([A-Za-z_]+)"\s*>')
_PARAM_NOISE_RE = re.compile(r"</?(?:antml:)?(?:parameter|invoke)[^>]*>")


def _coerce_reset_payload(raw: Any) -> tuple[dict[str, Any], list[str]]:
    """Slate 6.7: lenient salvage of reset_session payloads. Root cause
    (verified): at extreme context the model's tool-call serialization leaks
    XML parameter markup INTO the JSON strings — 10 straight schema failures
    with literal '</parameter>\\n<parameter name="open_items">' jammed inside
    done_summary while the agent believed it complied ("genuinely broken...
    not a formatting issue on my end"). Strip markup, split jammed fields,
    coerce list-ish strings, default what's missing — and report every repair
    so the handoff gets labeled. reset_session must be UNBRICKABLE."""
    notes: list[str] = []
    payload: dict[str, Any] = {}

    if isinstance(raw, dict):
        payload = dict(raw)
        unparsed = payload.pop("__unparsedToolInput", None)
        if unparsed is not None:
            notes.append("input arrived unparsed (__unparsedToolInput)")
            try:
                parsed = json.loads(str(unparsed))
                if isinstance(parsed, dict):
                    for k, v in parsed.items():
                        payload.setdefault(k, v)
                else:
                    payload.setdefault("done_summary", str(unparsed))
            except (TypeError, ValueError):
                payload.setdefault("done_summary", str(unparsed))
    elif raw is not None:
        notes.append(f"input was {type(raw).__name__}, not an object")
        payload = {"done_summary": str(raw)}

    # Split jammed fields: a markup marker inside any string value carves the
    # string into per-field segments (the measured corruption shape).
    for key in list(payload.keys()):
        val = payload.get(key)
        if not isinstance(val, str) or "<parameter" not in val:
            continue
        pieces = _PARAM_OPEN_RE.split(val)
        payload[key] = pieces[0]
        for name, body in zip(pieces[1::2], pieces[2::2]):
            if name in _RESET_FIELDS and not payload.get(name):
                payload[name] = body
                notes.append(f"split jammed field '{name}' out of '{key}'")

    def _clean(s: str) -> str:
        return _PARAM_NOISE_RE.sub("", s).strip()

    for key in ("done_summary", "next_action"):
        v = payload.get(key)
        if isinstance(v, str):
            cleaned = _clean(v)
            if cleaned != v.strip():
                notes.append(f"stripped markup from '{key}'")
            payload[key] = cleaned
        elif v is not None:
            payload[key] = _clean(str(v))
            notes.append(f"coerced '{key}' to string")

    for key in ("open_items", "unresolved_warnings"):
        v = payload.get(key)
        if v is None:
            continue
        if isinstance(v, list):
            payload[key] = [_clean(str(x)) for x in v if str(x).strip()]
            continue
        s = _clean(str(v))
        items: list[str] = []
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                items = [str(x).strip() for x in parsed if str(x).strip()]
        except (TypeError, ValueError):
            pass
        if not items:
            items = [x for x in (ln.strip("-•* \t") for ln in re.split(r"[\n;]+", s)) if x]
        payload[key] = items
        notes.append(f"coerced '{key}' from {type(v).__name__} to list")

    if not str(payload.get("done_summary") or "").strip():
        payload["done_summary"] = ("(missing — the payload arrived without done_summary; "
                                   "treat ALL inherited claims as UNVERIFIED)")
        notes.append("defaulted missing done_summary")
    if "open_items" not in payload or payload.get("open_items") is None:
        payload["open_items"] = []
        notes.append("defaulted missing open_items")
    if not str(payload.get("next_action") or "").strip():
        payload["next_action"] = ("run mcp__canvas__audit_page and work the attached "
                                  "audit/ledger — the payload arrived without next_action")
        notes.append("defaulted missing next_action")

    return payload, notes


def _norm_queued(m: Any) -> dict[str, Any]:
    """Queue entry normalizer: pre-2026-07-07 persisted queues hold plain
    strings; the live queue holds {text, images?} dicts."""
    if isinstance(m, dict):
        return {"text": str(m.get("text") or ""),
                **({"images": list(m["images"])} if m.get("images") else {})}
    return {"text": str(m)}


def _load_session_file() -> dict[str, Any]:
    try:
        return json.loads(_SESSION_FILE.read_text())
    except (OSError, ValueError):
        return {}


def _save_session_file(data: dict[str, Any]) -> None:
    try:
        _SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
        _SESSION_FILE.write_text(json.dumps(data))
    except OSError:
        logger.warning("Could not persist copilot session file", exc_info=True)


class CopilotSession:
    """Owns the ClaudeSDKClient and relays its stream to attached websockets."""

    def __init__(self) -> None:
        self._client: ClaudeSDKClient | None = None
        # The system-prompt append (persona + seats + rules + lessons) is
        # written to THIS file and passed to the CLI as --append-system-prompt-file,
        # never as an argv string: the rules file alone is ~110KB and the whole
        # append crossed Linux's 128KB single-argument limit (MAX_ARG_STRLEN),
        # so every spawn died with "[Errno 7] Argument list too long" (Shane's
        # schema-builder outage, 2026-07-18). A file path is a few bytes.
        self._sysprompt_file = (
            Path(tempfile.gettempdir()) / "canvas_copilot_sysprompt"
            / f"{uuid.uuid4().hex}.md")
        self._connect_lock = asyncio.Lock()
        self._query_lock = asyncio.Lock()
        self._sockets: set[Any] = set()
        self._pending_approvals: dict[str, asyncio.Future[dict[str, Any]]] = {}
        # Payloads kept so a reconnecting panel gets unresolved approvals re-presented.
        self._pending_approval_payloads: dict[str, dict[str, Any]] = {}
        # CLI-suggested PermissionUpdate OBJECTS per pending approval (the
        # payload carries their dict form for display; resolve needs the real
        # ones to build updated_permissions).
        self._pending_approval_suggestions: dict[str, list[Any]] = {}
        # Durable chat history replayed to (re)connecting panels, so a page
        # refresh or tablet sleep no longer blanks the conversation. Transient
        # kinds (deltas, status) are not history.
        self._history: deque[dict[str, Any]] = deque(maxlen=80)
        # Genuine Shane utterances this session — a LONGER-lived provenance
        # corpus than the 80-entry _history (which rotates with all tool
        # traffic). codify_lesson's quote-provenance guardrail traces against
        # this so a real correction from many turns ago still corroborates a
        # lesson (2026-07-09 guardrail review, finding 4).
        self._shane_said: deque[str] = deque(maxlen=400)
        saved = _load_session_file()
        self.session_id: str | None = saved.get("session_id")
        self.settings: dict[str, Any] = {**DEFAULT_SETTINGS, **(saved.get("settings") or {})}
        self.last_usage: dict[str, Any] | None = saved.get("last_usage")
        self.total_cost_usd: float | None = saved.get("total_cost_usd")
        # Post-turn /context reading ({total, max, pct}); feeds the reset nudge.
        self.last_context: dict[str, Any] | None = saved.get("last_context")
        # Slate 6.2 done-gate latch: signature of the blocker set at the last
        # gate fire + mutating ops since. An unchanged state is refused ONCE,
        # never spun on (21/21 fires in one page-10 segment were refires).
        self._gate_latch: str | None = None
        self._ops_since_gate: int = 0
        # Composed resume prompt queued by the reset_session tool; executed
        # after the current turn ends (a session can't safely kill itself mid-turn).
        # Slate 6.7: PERSISTED — a reset whose note reached the server is
        # committed even if the turn errors or the process dies before the
        # loop executes it (ev121's handoff survived its errored turn; the
        # persisted note is the commit record, and clearing persists too, so
        # no double successor starts).
        self._pending_reset: str | None = saved.get("pending_reset") or None
        # Slate 6.7: consecutive signal-free reset payloads (nothing usable in
        # any field); the second one queues a degraded server-composed handoff
        # instead of erroring forever (10 straight failures bricked a session).
        self._reset_fail_count = 0
        # Slate 6.9 crossing proof: total exceeded the SDK-reported max this
        # conversation — the report is a lie; sticky until the next session.
        self._ctx_beta_confirmed = False
        # Slate 6.8: metadata of the newest tool call this turn, dumped on
        # every error result — the ~30 in-chain error_during_execution results
        # are SDK/API-side and died without recording what they were doing;
        # the payload-size/long-turn correlation is the live lead.
        self._last_tool_meta: dict[str, Any] | None = None
        # Slate 6.6: the page this session is bound to (server-side). Mutating
        # canvas ops on a different page are refused with a rebind affordance
        # — a repair once landed on page 9 while the session's work was page
        # 10. Bound on first mutating op / navigation; survives restarts.
        self.bound_page: int | None = saved.get("bound_page")
        # Run-2 finding (2026-07-06): NAVIGATION IS A DONE-GATE ESCAPE — the
        # gate audits only the CURRENT page, so a page flip sheds blockers
        # (run 2's successor declared page 10 done-enough and began page 11).
        # goto_page now refuses to depart a page with open blockers unless
        # acknowledged; an acknowledged departure records the debt HERE, and
        # the done-gate keeps refusing until that page audits clean again.
        # Keyed str(page) -> {live, end_state, top_rule, ts}. Persisted —
        # debts ride handoffs and restarts; navigation is never disposal.
        self.page_debts: dict[str, dict[str, Any]] = dict(saved.get("page_debts") or {})
        # Slate 6.11: per-session receipt log — receipts were discarded after
        # the apply block, so handoff counts were hand-written prose and
        # drifted. The log feeds the mechanical RECEIPTS summary.
        self.receipt_log: list[dict[str, Any]] = list(saved.get("receipt_log") or [])[-400:]
        # Drawer disposals (2026-07-08): Shane's False-positive clicks on the
        # issues drawer are HIS verdicts, delivered silently to the server —
        # surface the recent ones in [canvas now] so the copilot's mental
        # model tracks them (and repeated-FP classes get reported per doctrine)
        # without firing a turn. Rotating window; rendered entries age out.
        self.panel_disposals: list[dict[str, Any]] = list(saved.get("panel_disposals") or [])[-8:]
        # Slate 4.1 audit-first gate: handoff/crash-born sessions must COMPLETE
        # one audit_page before any mutating op (the prose FIRST-ACTION mandate
        # was violated in 2/3 handoffs of one segment). Binary and content-
        # blind — it cannot misjudge the page. unaudited_ops covers the
        # error-killed-verification hole; both survive restarts.
        self.needs_audit: bool = bool(saved.get("needs_audit"))
        self.unaudited_ops: int = int(saved.get("unaudited_ops") or 0)
        # Slate 4.5 guided mode: one geometric BATCH per Shane message (a
        # batch is one intent — the cascade-companion exemption by
        # construction: the mandated delete+re-add+wire repair rides one
        # batch). Reset on every real Shane message; machine ticks never
        # reset it.
        self._geo_batch_used = False
        # Advisory auto-latch signal (born WARN — suggests, never latches):
        # two stop-class messages inside 60s.
        self._stop_class_ts: deque[float] = deque(maxlen=4)
        # Per-turn telemetry driving the autonomous-continuation stop conditions.
        self._turn_tool_calls = 0
        self._turn_last_text = ""
        self._turn_errored = False
        self._turn_result_error = False
        self._stop_requested = False
        # Scoped-ask confirm gate (Shane, 2026-07-08): a pen/lasso mark carrying
        # an instruction, delivered in COLLABORATIVE mode, is confirm-before-act.
        # Set at receipt of the scoped ask; while set, the annotate tool refuses
        # mutating ops — the copilot must gather context (read-only), restate its
        # understanding, and WAIT. Cleared by Shane's next (non-scoped) message.
        # Ephemeral: a fresh process starts un-gated.
        self._scoped_confirm_pending: bool = False
        # Messages typed while a turn/chain runs: QUEUED and injected at the
        # next turn boundary (2026-07-05: Shane's mid-run corrections bounced
        # twice and the agent never saw them — the intervention gap).
        # Slate 6.7: PERSISTED — a hard-limit turn once died at 0 output
        # tokens orphaning 3 queued Shane messages; restarts must redeliver,
        # never orphan (duplicate-over-orphan per the 6.4 retry doctrine).
        # Full-SDK panel (2026-07-07): entries are dicts {text, images?} so
        # image-bearing messages queue too; old persisted plain strings
        # normalize on load.
        self._queued_messages: deque[dict[str, Any]] = deque(
            _norm_queued(m) for m in (saved.get("queued_messages") or []))
        # Slate 7.1 latency metric: ts stamped at handoff execution
        # (_take_reset_prompt); consumed ONCE by the successor's first
        # applied annotate (note_first_op_after_handoff). Measurement only —
        # not persisted, no gate, no pressure on the successor
        # (inherited-claims-expire stays law).
        self._handoff_ts: float | None = None
        # Full-SDK panel (2026-07-07): the init message's capability summary
        # (model, tools, slash commands, MCP names) — served to the panel on
        # connect and via GET /copilot/server-info. Not persisted: it
        # describes the LIVE client, which dies with the process.
        self.last_init: dict[str, Any] | None = None
        # Full /context reading incl. per-category breakdown (the CLI's
        # /context view); refreshed post-turn beside last_context.
        self.last_context_detail: dict[str, Any] | None = None

    def _persist(self) -> None:
        _save_session_file(
            {
                "session_id": self.session_id,
                "settings": self.settings,
                "last_usage": self.last_usage,
                "total_cost_usd": self.total_cost_usd,
                "last_context": self.last_context,
                "pending_reset": self._pending_reset,
                # Text only: base64 images must never ride the session file
                # (it persists on every turn) — queued images die with the
                # process, and the queue row says so.
                "queued_messages": [
                    {"text": _norm_queued(q).get("text") or ""}
                    for q in self._queued_messages
                ],
                "bound_page": self.bound_page,
                "page_debts": self.page_debts,
                "receipt_log": self.receipt_log[-400:],
                "panel_disposals": self.panel_disposals[-8:],
                "needs_audit": self.needs_audit,
                "unaudited_ops": self.unaudited_ops,
            }
        )

    def public_state(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "busy": self.busy,
            "settings": self.settings,
            "last_usage": self.last_usage,
            "total_cost_usd": self.total_cost_usd,
            "last_context": self.last_context,
            "queue": [{"text": (nq.get("text") or "")[:200],
                       **({"images": len(nq["images"])} if nq.get("images") else {})}
                      for nq in (_norm_queued(q) for q in self._queued_messages)],
        }

    async def set_settings(self, patch: dict[str, Any]) -> None:
        """Apply model/effort/show_thinking changes; takes effect on next turn
        (client reconnects with `resume`, so the conversation continues)."""
        if self.busy:
            await self._broadcast({"kind": "error", "message": "Can't change settings mid-turn — stop or wait first."})
            return
        if "model" in patch:
            self.settings["model"] = patch["model"] or None
        if "effort" in patch:
            self.settings["effort"] = patch["effort"] if patch["effort"] in _EFFORTS else None
        if "show_thinking" in patch:
            self.settings["show_thinking"] = bool(patch["show_thinking"])
        if "thinking" in patch:
            self.settings["thinking"] = "off" if patch["thinking"] == "off" else None
        if "autonomous" in patch:
            self.settings["autonomous"] = bool(patch["autonomous"])
        if "guided" in patch:
            # 4.5: releasing guided must NEVER auto-re-arm autonomous — the
            # flags are independent by design.
            self.settings["guided"] = bool(patch["guided"])
        if "fast_mode" in patch:
            self.settings["fast_mode"] = bool(patch["fast_mode"])
        self._persist()
        await self.shutdown()  # next message reconnects with new options + resume
        await self._broadcast({"kind": "settings", **self.settings})

    async def set_permission_mode_live(self, mode: str) -> None:
        """Switch permission mode LIVE — unlike other settings this needs no
        client teardown (SDK control request), so it works mid-turn: Shane can
        drop a runaway session into "plan" without killing it."""
        if mode not in _PERMISSION_MODES:
            await self._broadcast({"kind": "error", "message": f"unknown permission mode: {mode}"})
            return
        self.settings["permission_mode"] = mode
        self._persist()
        applied = "next connect"
        if self._client is not None:
            try:
                await self._client.set_permission_mode(mode)
                applied = "live"
            except Exception:
                logger.warning("live permission-mode switch failed; applies on next connect",
                               exc_info=True)
        await self._broadcast({"kind": "settings", **self.settings})
        await self._broadcast({"kind": "status",
                               "state": "busy" if self.busy else "ready",
                               "note": f"permission mode → {mode} ({applied})"})

    async def stop_background_task(self, task_id: str) -> None:
        """Stop a background task (Task tool) by id — the panel's ■ on a task row."""
        if self._client is None:
            await self._broadcast({"kind": "error", "message": "no live client — task already gone?"})
            return
        try:
            await self._client.stop_task(str(task_id))
            await self._broadcast({"kind": "status", "state": "busy" if self.busy else "ready",
                                   "note": f"stop requested for task {task_id}"})
        except Exception as exc:
            await self._broadcast({"kind": "error",
                                   "message": f"stop_task failed: {type(exc).__name__}: {exc}"})

    async def new_session(self) -> None:
        if self.busy:
            await self._broadcast({"kind": "error", "message": "Can't reset mid-turn — stop Arc first."})
            return
        # Slate 6.7 teardown salvage: a manual kill of a live session with no
        # queued handoff synthesizes one (SYNTHESIZED-labeled, no claim
        # authority) so the successor is note-born, and orphaned queued Shane
        # messages ride it instead of dying with the queue.
        salvaged: str | None = None
        if self.session_id and not self._pending_reset:
            try:
                salvaged = await self._synthesize_handoff("manual new-session (panel)")
            except Exception:
                logger.warning("teardown salvage failed", exc_info=True)
        await self.shutdown()
        self.session_id = None
        self.last_usage = None
        self.total_cost_usd = None
        self.last_context = None
        self.last_context_detail = None
        self.last_init = None
        self._pending_reset = salvaged
        self._queued_messages.clear()  # orphans now ride the synthesized note
        self._queue_changed()
        self._ctx_beta_confirmed = False  # 6.9: meter proof dies with the session
        self.bound_page = None  # 6.6: a fresh session binds to wherever work starts
        self.receipt_log = []  # 6.11: the synthesized note carried the summary
        # 4.1: a salvaged-handoff successor is handoff-born (audit first);
        # a genuinely blank session is Shane-driven — no gate.
        self.needs_audit = bool(salvaged)
        self.unaudited_ops = 0
        self._scoped_confirm_pending = False  # gate dies with the session
        self._history.clear()
        self._persist()
        await self._broadcast({"kind": "session", "session_id": None})
        await self._broadcast({"kind": "status", "state": "ready",
                               "note": "Fresh session." + (" A SYNTHESIZED handoff from the old "
                                       "session is queued — the next message starts from it."
                                       if salvaged else "")})

    # --- socket management -----------------------------------------------

    def attach(self, ws: Any) -> None:
        self._sockets.add(ws)

    def detach(self, ws: Any) -> None:
        self._sockets.discard(ws)
        if not self._sockets:
            # Nobody left to answer — fail pending approvals fast instead of
            # stalling the agent until the timeout.
            for approval_id, fut in list(self._pending_approvals.items()):
                if not fut.done():
                    fut.set_result({"allow": False, "message": "Panel disconnected before approval."})
                self._pending_approvals.pop(approval_id, None)

    _HISTORY_KINDS = {"assistant_text", "thinking", "tool_use", "tool_result",
                      "task", "result", "error", "tool_image"}
    _HISTORY_IMAGE_REPLAY = 8  # replay at most this many images (b64 is heavy)

    async def _broadcast(self, payload: dict[str, Any]) -> None:
        if payload.get("kind") in self._HISTORY_KINDS:
            self._history.append(payload)
        # Slate 6.8: per-message byte accounting — drops cluster after
        # image-heavy exchanges (650KB reference sheet, 305KB capture), so
        # oversized panel payloads get logged with their kind.
        try:
            nbytes = len(json.dumps(payload, ensure_ascii=False, default=str))
            if nbytes > 200_000:
                logger.info("large panel payload: %dB kind=%s", nbytes, payload.get("kind"))
        except (TypeError, ValueError):
            pass
        dead = []
        for ws in list(self._sockets):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._sockets.discard(ws)
        if dead:
            logger.info("panel socket(s) dropped mid-send: %d dead, %d remain (kind=%s)",
                        len(dead), len(self._sockets), payload.get("kind"))

    async def broadcast_tool_image(
        self, tool: str, label: str, b64: str, debug_path: str | None = None
    ) -> None:
        """Mirror an image a tool just fed the model into the chat panel, so
        Shane sees exactly what the copilot sees (click-to-inspect)."""
        await self._broadcast(
            {"kind": "tool_image", "tool": tool, "label": label, "b64": b64, "debug_path": debug_path}
        )

    def history(self) -> list[dict[str, Any]]:
        # Strip b64 from all but the newest few images so reconnect replay stays
        # light; dropped ones keep their label as a placeholder row.
        entries = list(self._history)
        image_idx = [i for i, e in enumerate(entries) if e.get("kind") == "tool_image"]
        keep = set(image_idx[-self._HISTORY_IMAGE_REPLAY:])
        out: list[dict[str, Any]] = []
        for i, e in enumerate(entries):
            if e.get("kind") == "tool_image" and i not in keep:
                out.append({k: v for k, v in e.items() if k != "b64"})
            else:
                out.append(e)
        return out

    # --- permissions (HITL) ------------------------------------------------

    # Bash policy: auto-allow local dev commands; ask only for the dangerous
    # class. Curl/wget to localhost is the copilot verifying its own bridge —
    # allowed; anything leaving the machine asks.
    _DANGEROUS_BASH = re.compile(
        r"\b(git\s+push|sudo\b|rm\s+-[rf]|pip\s+install|npm\s+install|uv\s+(pip\s+)?install"
        r"|apt(-get)?\s+|pkill\b|kill\s|shutdown|reboot|mkfs|dd\s+if="
        r"|ssh\b|scp\b|rsync\b|DROP\s+TABLE|DELETE\s+FROM|TRUNCATE"
        # The schema store's write gate must not have a psql side door
        # (audit 2026-07-13): SQL writes to document_schemas ask, always.
        r"|(INSERT\s+INTO|UPDATE)\s+document_schemas)",
        re.IGNORECASE,
    )
    _LOCAL_NET = re.compile(r"\b(curl|wget)\b(?!.*\b(127\.0\.0\.1|localhost)\b)", re.IGNORECASE)

    def _bash_needs_approval(self, command: str) -> bool:
        return bool(self._DANGEROUS_BASH.search(command) or self._LOCAL_NET.search(command))

    async def _can_use_tool(self, tool_name: str, input_data: dict, context: Any):
        if tool_name == "Bash" and not self._bash_needs_approval(str(input_data.get("command", ""))):
            return PermissionResultAllow(updated_input=input_data)
        approval_id = str(uuid.uuid4())
        fut: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending_approvals[approval_id] = fut
        # Full-SDK approvals (2026-07-07): forward the CLI's own prompt
        # context (title/display_name/reason/blocked path) and its suggested
        # persistent rules, so the panel renders a real approval card instead
        # of raw JSON. Suggestion OBJECTS are kept server-side for resolve.
        suggestions = list(getattr(context, "suggestions", None) or [])
        payload = {
            "kind": "approval_request", "id": approval_id, "tool": tool_name,
            "input": input_data,
            "title": getattr(context, "title", None),
            "display_name": getattr(context, "display_name", None),
            "description": getattr(context, "description", None),
            "decision_reason": getattr(context, "decision_reason", None),
            "blocked_path": getattr(context, "blocked_path", None),
            "tool_use_id": getattr(context, "tool_use_id", None),
            "agent_id": getattr(context, "agent_id", None),
            "suggestions": [s.to_dict() for s in suggestions],
        }
        payload = {k: v for k, v in payload.items() if v not in (None, [])}
        self._pending_approval_payloads[approval_id] = payload
        self._pending_approval_suggestions[approval_id] = suggestions
        await self._broadcast(payload)
        try:
            answer = await asyncio.wait_for(fut, timeout=_APPROVAL_TIMEOUT_S)
        except asyncio.TimeoutError:
            return PermissionResultDeny(message="No answer from Shane (approval timed out).")
        finally:
            self._pending_approvals.pop(approval_id, None)
            self._pending_approval_payloads.pop(approval_id, None)
            suggestions = self._pending_approval_suggestions.pop(approval_id, suggestions)
        if answer.get("allow"):
            updated_input = answer.get("updated_input")
            if not isinstance(updated_input, dict):
                updated_input = input_data
            updated_permissions: list[PermissionUpdate] | None = None
            if answer.get("always_allow"):
                # "Always allow" persists rules for the SESSION ONLY — a panel
                # click must never write Shane's settings files. Prefer the
                # CLI's suggested rules (they carry the right rule_content);
                # fall back to a bare tool-name rule.
                if suggestions:
                    updated_permissions = [
                        PermissionUpdate(type=s.type, rules=s.rules, behavior=s.behavior,
                                         mode=s.mode, directories=s.directories,
                                         destination="session")
                        for s in suggestions
                    ]
                else:
                    updated_permissions = [PermissionUpdate(
                        type="addRules",
                        rules=[PermissionRuleValue(tool_name=tool_name)],
                        behavior="allow", destination="session")]
            return PermissionResultAllow(updated_input=updated_input,
                                         updated_permissions=updated_permissions)
        deny_msg = answer.get("message")
        if deny_msg:  # Shane's typed denial is a genuine correction — provenance
            self._shane_said.append(str(deny_msg))
        return PermissionResultDeny(
            message=deny_msg or "Denied by Shane in the panel.",
            interrupt=bool(answer.get("interrupt")))

    def pending_approval_payloads(self) -> list[dict[str, Any]]:
        return list(self._pending_approval_payloads.values())

    def resolve_approval(self, approval_id: str, allow: bool, message: str | None = None,
                         *, always_allow: bool = False,
                         updated_input: dict[str, Any] | None = None,
                         interrupt: bool = False) -> bool:
        fut = self._pending_approvals.get(approval_id)
        if fut is None or fut.done():
            return False
        fut.set_result({"allow": allow, "message": message, "always_allow": always_allow,
                        "updated_input": updated_input, "interrupt": interrupt})
        return True

    # --- client lifecycle ----------------------------------------------------

    def _options(self) -> ClaudeAgentOptions:
        # Rules re-read at every connect: the copilot edits its own rules file
        # and the next session loads what it taught itself.
        append = (
            _PERSONA + _SEATS
            + "\n\n" + _SELF_HEAL
            + "\n\nYOUR EVOLVING RULES (self-editable at "
            + str(_RULES_FILE)
            + "; loaded fresh each session):\n"
            + _load_rules()
            + _load_lessons_block())
        # Spill the append to a file and pass its PATH — never the 100KB+ string
        # itself as an argv element (see _sysprompt_file; MAX_ARG_STRLEN, Errno 7).
        self._sysprompt_file.parent.mkdir(parents=True, exist_ok=True)
        self._sysprompt_file.write_text(append, encoding="utf-8")
        return ClaudeAgentOptions(
            cwd=str(ATLAS_REPO_ROOT),
            # Preset only (no inline "append"): the CLI reads the append from the
            # file passed via extra_args below, so the claude_code base preset is
            # still active and every byte of doctrine still lands.
            system_prompt={"type": "preset", "preset": "claude_code"},
            extra_args={"append-system-prompt-file": str(self._sysprompt_file)},
            setting_sources=["project"],
            # Fast mode rides the runtime's settings schema (fastMode key) via
            # the SDK settings pass-through — per-session, never the project
            # settings file (cold runs must not inherit a 2x-burn default).
            # Opus 4.8 only; other models ignore it. usage confirms the speed.
            **({"settings": json.dumps({"fastMode": True})}
               if self.settings.get("fast_mode") else {}),
            mcp_servers={"canvas": canvas_mcp_server},
            # The SDK transport's default JSON line buffer is 1MB. A turn that
            # calls several image-bearing tools in parallel (reference_sheet
            # ~650KB b64 + playbook cards + capture) exceeds it when the CLI
            # echoes the combined tool_results back — the whole chain then dies
            # with "JSON message exceeded maximum buffer size" (measured
            # 2026-07-07 14:09, page-12 run; also the opus-leg start blip).
            max_buffer_size=10 * 1024 * 1024,
            # Preload every tool schema (canvas tools included) instead of
            # deferring them behind a ToolSearch round-trip: this session uses
            # the same ~15 tools constantly, so the one-time context cost beats
            # a discovery ceremony at the top of every fresh session. The SDK
            # has no per-server preload (issue #525) — global off is the knob.
            env={"ENABLE_TOOL_SEARCH": "false"},
            # Trust tiers (Shane, 2026-07-02): graph edits are undoable + on-screen,
            # file edits are git-recoverable, reads are harmless -> none of those ask.
            # Only non-whitelisted Bash (push/install/delete/network) still asks.
            # Panel-switchable since 2026-07-07 (settings override; "plan" =
            # observe-only); None keeps the historical acceptEdits default.
            permission_mode=self.settings.get("permission_mode") or "acceptEdits",
            model=self.settings.get("model") or None,
            # 1M context window (Shane, 2026-07-05 — sessions thrashed at
            # 242k/200k finishing page 10; a couple of annotate-verify cycles
            # of captures fills 200k). Fraction-based reset thresholds
            # (decision log #5) scale automatically from the reported max.
            # Input past 200k bills at the long-context premium, so clean
            # handoffs at sane boundaries remain the economical pattern.
            betas=(
                ["context-1m-2025-08-07"]
                if self.settings.get("long_context", True)
                else []
            ),
            effort=self.settings.get("effort") or None,
            # thinking-0 knob (arm 4/6): SDK's ThinkingConfigDisabled. Otherwise,
            # when Shane wants to SEE thoughts, request summarized display — the
            # 5-family omits thinking text by default (signature-only), which is
            # why the panel showed 'working' with zero thoughts for a whole day.
            # (max_thinking_tokens is deprecated.)
            thinking=(
                {"type": "disabled"} if self.settings.get("thinking") == "off"
                else {"type": "adaptive", "display": "summarized"}
                if self.settings.get("show_thinking") else None
            ),
            include_partial_messages=True,
            allowed_tools=[
                *ALLOWED_CANVAS_TOOLS,
                "mcp__canvas__annotate",
                "Read",
                "Grep",
                "Glob",
                "Bash(node --test:*)",
                "Bash(node:*)",
                "Bash(grep:*)",
                "Bash(rg:*)",
                "Bash(ls:*)",
                "Bash(cat:*)",
                "Bash(head:*)",
                "Bash(tail:*)",
                "Bash(wc:*)",
                "Bash(find:*)",
                "Bash(git status:*)",
                "Bash(git diff:*)",
                "Bash(git log:*)",
            ],
            # No renderer in the panel; questions go as plain chat text (proven
            # 2026-07-03 — Shane saw nothing until they were restated).
            disallowed_tools=["AskUserQuestion"],
            can_use_tool=self._can_use_tool,
            resume=self.session_id,
        )

    async def _ensure_client(self) -> ClaudeSDKClient:
        async with self._connect_lock:
            if self._client is not None:
                return self._client
            try:
                client = ClaudeSDKClient(options=self._options())
                await client.connect()
            except Exception:
                if self.session_id is None:
                    raise
                # Saved session may be gone (pruned transcript, changed cwd) — start fresh.
                logger.warning("Copilot resume failed; starting a fresh session", exc_info=True)
                self.session_id = None
                client = ClaudeSDKClient(options=self._options())
                await client.connect()
            self._client = client
            return client

    async def shutdown(self) -> None:
        async with self._connect_lock:
            if self._client is not None:
                try:
                    # A wedged CLI subprocess must never block server reload/shutdown.
                    await asyncio.wait_for(self._client.disconnect(), timeout=5)
                except Exception:
                    pass
                self._client = None

    # --- conversation ---------------------------------------------------------

    @property
    def busy(self) -> bool:
        return self._query_lock.locked()

    def drain_midturn_messages(self) -> list[str]:
        """Slate 6.5: canvas tools call this at result time so queued non-stop
        messages inject MID-TURN as labeled [Shane, mid-turn] blocks instead
        of waiting out the turn (corrections landed before the turn commits
        further ops on stale premises). Empty when a stop is pending — the
        post-lock drain owns stop messages. Sync by design: called from
        in-process tool handlers; user-bubble broadcast rides a task.

        Image-bearing entries CANNOT inject as tool-result text — the drain
        stops at the first one (order preserved); it delivers at the next
        turn boundary as a real content-block message."""
        if self._stop_requested or not self._queued_messages:
            return []
        out: list[str] = []
        while self._queued_messages:
            if _norm_queued(self._queued_messages[0]).get("images"):
                break
            msg = _norm_queued(self._queued_messages.popleft())["text"]
            self._history.append({"kind": "user", "text": msg, "source": "mid-turn"})
            self._shane_said.append(msg)
            out.append(msg)
            try:
                asyncio.get_running_loop().create_task(
                    self._broadcast({"kind": "user", "text": msg + " (mid-turn)", "source": "mid-turn"})
                )
            except RuntimeError:
                pass
        if out:
            self._queue_changed()
        return out

    async def interrupt(self) -> None:
        self._stop_requested = True  # Shane's Stop also breaks the auto-continue chain
        if self._client is not None:
            try:
                await self._client.interrupt()
            except Exception:
                logger.warning("Copilot interrupt failed", exc_info=True)

    async def queue_reset(self, handoff: dict[str, Any]) -> dict[str, Any]:
        """reset_session tool entry: queue a self-reset with a structured handoff.

        Executes after the current turn ends. The server warning ledger AND a
        fresh server-computed audit are attached automatically — debts survive
        handoffs mechanically, not by the dying session's paraphrase.

        Slate 6.7: UNBRICKABLE. Malformed payloads (XML markup leaked into
        JSON at extreme context) are coerced, not refused; raw bytes spill to
        the 6.4 sidecar for forensics; a payload with NO usable signal gets
        ONE echo-error (so the agent sees its own malformation), then the
        second consecutive one queues a degraded server-composed handoff —
        the successor is always note-born."""
        payload, salvage = _coerce_reset_payload(handoff)
        if salvage:
            try:
                _SPILL_DIR.mkdir(parents=True, exist_ok=True)
                spill = _SPILL_DIR / f"{int(time.time() * 1000)}-reset_salvage.json"
                spill.write_text(
                    json.dumps({"raw": handoff, "coerced": payload, "notes": salvage},
                               ensure_ascii=False, default=str),
                    encoding="utf-8")
            except OSError:
                logger.warning("reset salvage spill failed", exc_info=True)
        signal_free = ("defaulted missing done_summary" in salvage
                       and "defaulted missing next_action" in salvage
                       and not payload.get("open_items"))
        if signal_free:
            self._reset_fail_count += 1
            if self._reset_fail_count < 2:
                return {
                    "queued": False,
                    "error": "reset payload carried NO usable fields — this echo shows "
                             "exactly what arrived so you can see the malformation. "
                             "Re-send done_summary / open_items / next_action as plain "
                             "JSON (no markup). A second empty payload queues a DEGRADED "
                             "server-composed handoff automatically — you will not be "
                             "stuck here.",
                    "received": _abbreviate(handoff, 1200),
                }
            salvage.append("second signal-free payload — degraded server-composed handoff")
            payload["done_summary"] = ("(DEGRADED — two reset payloads arrived with no usable "
                                       "fields; this handoff is server-composed from the ledger "
                                       "and audit only. Treat ALL inherited claims as UNVERIFIED)")
        self._reset_fail_count = 0
        # Seat-aware (2026-07-16): the canvas autofills (ledger, page audit,
        # pins, extent stamps) only mean something on the canvas seat — a
        # reset queued from another bench skips them and gets a seat-true note.
        area = getattr(self, "_area", "canvas") or "canvas"
        ledger: list[dict[str, Any]] = []
        audit: dict[str, Any] | None = None
        pinned_looks: list[dict[str, Any]] = []
        verified_extents: list[dict[str, Any]] = []
        if area == "canvas":
            try:
                from src.canvas_copilot import bridge

                ledger = bridge.warning_ledger()
            except Exception:
                logger.warning("warning ledger unavailable for handoff", exc_info=True)
            try:
                from src.canvas_copilot.tools import compute_page_audit

                audit = await compute_page_audit()
            except Exception:
                logger.warning("handoff audit unavailable", exc_info=True)
            # Slate 7.1: pinned capture references + the extent-stamp table are
            # server-autofilled the same way ledger/audit are — never left to the
            # dying session's prose.
            try:
                from src.canvas_copilot import bridge as _bridge_7_1

                pinned_looks = _bridge_7_1.recent_captures(limit=4)
                verified_extents = _resolve_verified_extents(
                    (_bridge_7_1.get_state() or {}).get("snapshot") or {})
            except Exception:
                logger.warning("pinned-looks/verified-extents unavailable for handoff", exc_info=True)
        prompt = compose_handoff_prompt(payload, ledger, audit, receipts=list(self.receipt_log),
                                        pinned_looks=pinned_looks,
                                        verified_extents=verified_extents, area=area)
        if salvage:
            prompt = ("[SALVAGED HANDOFF — the reset payload was malformed and server-coerced: "
                      + "; ".join(salvage) + ". Fields may be incomplete; the server "
                      "ledger/audit below are authoritative.]\n\n" + prompt)
        self._pending_reset = prompt
        self._persist()  # 6.7: the note IS the commit — survives errored turns and restarts
        return {
            "queued": True,
            "executes": "after this turn ends — finish your reply now and STOP; "
                        "your successor takes over from the handoff note",
            "ledger_warnings_attached": len(ledger),
            "audit_violations_attached": len((audit or {}).get("violations") or []),
            **({"salvage": salvage} if salvage else {}),
            "resume_prompt": prompt,
        }

    def _take_reset_prompt(self) -> str:
        """Slate 6.9: consume the pending reset, folding any queued Shane
        instructions into the handoff as ITEM 1 — _pending_reset outranks the
        queue, so without this his instruction landed only after the
        successor's entire resume turn. The messages were journaled at
        ingress (6.4); here they ride the handoff bubble verbatim."""
        prompt, self._pending_reset = self._pending_reset or "", None
        self._ctx_beta_confirmed = False  # 6.9: meter proof dies with the session
        self.receipt_log = []  # 6.11: receipts belong to the dying session; the note carries them
        self.needs_audit = True  # 4.1: the successor is handoff-born — audit before mutating
        self._handoff_ts = time.time()  # 7.1: latency metric window opens now
        if self.settings.get("guided"):
            # 4.5: the mode SURVIVES handoffs — the successor is told, and only
            # explicit intent or the panel releases it.
            prompt = ("[GUIDED MODE IS ON — carried across this handoff: ONE geometric "
                      "batch per Shane message; auto-continue idles; release only by "
                      "Shane's explicit say-so or the panel toggle]\n\n" + prompt)
        if self._queued_messages:
            folded = [(nq.get("text") or "")
                      + (f" [+{len(nq['images'])} attached image(s) — not carried across the handoff; re-attach]"
                         if nq.get("images") else "")
                      for nq in (_norm_queued(q) for q in self._queued_messages)]
            self._queued_messages.clear()
            self._queue_changed()
            prompt = ("[QUEUED SHANE INSTRUCTIONS — arrived before this reset executed. "
                      "These are ITEM 1: act on them before the note's own next_action:]\n"
                      + "\n".join(f"- {m}" for m in folded)
                      + "\n\n" + prompt)
        return prompt

    def note_first_op_after_handoff(self) -> None:
        """Slate 7.1 latency-lever metric: logs handoff -> first successor
        annotate elapsed seconds ONCE per handoff. Measurement only — no
        gate, no message to the successor, zero pressure (inherited-claims-
        expire stays law). Idempotent: a no-op until the next handoff sets
        _handoff_ts again, so the annotate-apply call site can call this on
        every batch without re-firing. tools.py's apply path is the intended
        caller (see the slate note for the exact call site — tools.py is
        owned by another writer in this change)."""
        if self._handoff_ts is None:
            return
        elapsed = time.time() - self._handoff_ts
        self._handoff_ts = None  # once per handoff
        logger.info("slate 7.1 metric: handoff -> first successor op = %.1fs", elapsed)

    async def _synthesize_handoff(self, reason: str) -> str:
        """Slate 6.7: fallback note when a session ends without composing one
        (manual kill; crash-orphaned state). Server-composed from ledger +
        audit + last status — cold no-note recovery measured 15-20 turns /
        $1.06-1.33 vs 4.8-7s for note-born successors. Labeled SYNTHESIZED;
        carries NO claim authority (the dismissal-voiding AUDIT LAW block
        rides via compose_handoff_prompt as usual).

        Seat-aware (2026-07-16, the picker-seat incident): off-canvas the
        canvas autofills (page audit, warning ledger, pinned captures, extent
        stamps) grade a surface nobody is looking at — a teardown at the
        extraction picker shipped a note mandating audit_page. Off-canvas
        seats skip them and get a seat-true next_action instead."""
        area = getattr(self, "_area", "canvas") or "canvas"
        on_canvas = area == "canvas"
        ledger: list[dict[str, Any]] = []
        audit: dict[str, Any] | None = None
        pinned_looks: list[dict[str, Any]] = []
        verified_extents: list[dict[str, Any]] = []
        if on_canvas:
            try:
                from src.canvas_copilot import bridge

                ledger = bridge.warning_ledger()
            except Exception:
                logger.warning("warning ledger unavailable for synthesized handoff", exc_info=True)
            try:
                from src.canvas_copilot.tools import compute_page_audit

                audit = await compute_page_audit()
            except Exception:
                logger.warning("synthesized-handoff audit unavailable", exc_info=True)
            # Slate 7.1: same server-autofill as queue_reset — a synthesized note
            # is still note-born, so it earns the same visual-grounding pins.
            try:
                from src.canvas_copilot import bridge as _bridge_7_1

                pinned_looks = _bridge_7_1.recent_captures(limit=4)
                verified_extents = _resolve_verified_extents(
                    (_bridge_7_1.get_state() or {}).get("snapshot") or {})
            except Exception:
                logger.warning("pinned-looks/verified-extents unavailable for synthesized handoff",
                               exc_info=True)
        open_items = [
            "[ORPHANED SHANE MESSAGE — queued but never delivered; act on it FIRST] "
            + (_norm_queued(q).get("text") or "")
            for q in self._queued_messages]
        last = (self._turn_last_text or "").strip()
        payload = {
            "done_summary": ("(SYNTHESIZED — the previous session ended without composing a "
                             f"handoff: {reason}. NOTHING here is predecessor-verified; treat "
                             "every inherited claim as UNVERIFIED"
                             + (" and re-derive from audit_page)" if on_canvas else ")")),
            "open_items": open_items,
            "unresolved_warnings": ([f"predecessor's last status (UNVERIFIED prose): {last[:400]}"]
                                    if last else []),
            "next_action": ("run mcp__canvas__audit_page, reconcile against the list above, "
                            "then continue the page"
                            if on_canvas else
                            f"acknowledge where you are seated (the [{area} now] block) in one "
                            "tight line, mention the predecessor's parked work if relevant, "
                            "then WAIT for Shane"),
        }
        return ("[SYNTHESIZED HANDOFF — server-composed at session teardown; the predecessor "
                "did NOT write this]\n\n"
                + compose_handoff_prompt(payload, ledger, audit, receipts=list(self.receipt_log),
                                         pinned_looks=pinned_looks,
                                         verified_extents=verified_extents, area=area))

    def _schema_context_block(self) -> str:
        """The Schema-Builder seat's [.. now] block — document identity from
        the surface, everything else via the schema_* tools."""
        ctx = getattr(self, "_area_context", {}) or {}

        # Wire-boundary values: a non-numeric coordinate from a client must
        # degrade to 0, never raise — this block renders inside the message
        # path, and an exception here silently eats Shane's message.
        def _num(v: Any) -> int:
            try:
                return round(float(v))
            except (TypeError, ValueError):
                return 0

        parts = []
        if ctx.get("document_id"):
            parts.append(f"document={ctx['document_id']}")
        if ctx.get("document_name"):
            parts.append(f"name={str(ctx['document_name'])[:120]}")
        if ctx.get("viewing_page"):
            parts.append(f"shane_viewing_page={ctx['viewing_page']}")
        if ctx.get("tables_defined") is not None:
            parts.append(f"tables_defined={ctx['tables_defined']}")
        # Mark numbers MUST be the mark's own monotonic n — the number Shane
        # SEES on his screen badge. Positional renumbering desyncs the
        # pointing grammar after any tap-delete (audit 2026-07-13, gap #1).
        def _count(items: list, total_key: str, cap: int) -> str:
            try:
                total = int(ctx.get(total_key) or len(items))
            except (TypeError, ValueError):
                total = len(items)
            shown = min(len(items), cap)
            return f"{shown} of {total}" if total > shown else str(shown)

        marks = ctx.get("marks")
        if isinstance(marks, list) and marks:
            rendered = "; ".join(
                f"#{m.get('n', i + 1)} p{m.get('page')}@({_num(m.get('x'))},{_num(m.get('y'))})"
                for i, m in enumerate(marks[:6]) if isinstance(m, dict))
            parts.append(f"shane_marks[{_count(marks, 'marks_total', 6)}]: {rendered} "
                         "(page-px; pass the CURRENT PAGE's marks with their n "
                         "to schema_page_view to SEE them)")
        regions = ctx.get("regions")
        if isinstance(regions, list) and regions:
            rendered = "; ".join(
                f"#{r.get('n', i + 1)} p{r.get('page')}@({_num(r.get('x'))},{_num(r.get('y'))}) "
                f"{_num(r.get('w'))}x{_num(r.get('h'))}"
                for i, r in enumerate(regions[:4]) if isinstance(r, dict))
            parts.append(f"shane_regions[{_count(regions, 'regions_total', 4)}]: {rendered} "
                         "(page-px boxes; pass the current page's regions with "
                         "their n to schema_page_view, or crop to read one closely)")
        sel = ctx.get("selection")
        if isinstance(sel, dict) and str(sel.get("text") or "").strip():
            text = " ".join(str(sel["text"]).split())[:160]
            parts.append(
                f"shane_selection: \"{text}\" "
                f"p{sel.get('page')}@({_num(sel.get('x'))},{_num(sel.get('y'))}) "
                f"{_num(sel.get('w'))}x{_num(sel.get('h'))} "
                "(text he highlighted — his most precise pointer; crop "
                "schema_page_view to this bbox for a close read)")
        # Arc's own marks, echoed back with the badge numbers Shane SEES —
        # these are the numbers to use when referring to "my mark N".
        arc_marks = ctx.get("arc_marks")
        if isinstance(arc_marks, list) and arc_marks:
            rendered = "; ".join(
                f"#{m.get('label') or m.get('n', i + 1)} p{m.get('page')}@({_num(m.get('x'))},{_num(m.get('y'))})"
                for i, m in enumerate(arc_marks[:6]) if isinstance(m, dict))
            parts.append(f"your_marks[{len(arc_marks)}]: {rendered} "
                         "(amber — the marks YOU dropped via document_bench; "
                         "Esc or clear_marks removes them)")
        arc_regions = ctx.get("arc_regions")
        if isinstance(arc_regions, list) and arc_regions:
            rendered = "; ".join(
                f"#{r.get('label') or r.get('n', i + 1)} p{r.get('page')}@({_num(r.get('x'))},{_num(r.get('y'))}) "
                f"{_num(r.get('w'))}x{_num(r.get('h'))}"
                for i, r in enumerate(arc_regions[:4]) if isinstance(r, dict))
            parts.append(f"your_regions[{len(arc_regions)}]: {rendered} (amber boxes you dropped)")
        return "\n\n[schema-builder now: " + (" | ".join(parts) or "no document") + "]"

    def _extraction_context_block(self) -> str:
        """The Data › Extraction seat's [.. now] block — the loaded document,
        the active table being filled, Shane's pointing, and the draft count.
        Reuses the schema block's mark/region/selection renderers verbatim
        (shared pointing grammar) via a temporary swap onto the schema label."""
        ctx = getattr(self, "_area_context", {}) or {}

        def _num(v: Any) -> int:
            try:
                return round(float(v))
            except (TypeError, ValueError):
                return 0

        parts = []
        if ctx.get("document_id"):
            parts.append(f"document={ctx['document_id']}")
        if ctx.get("document_name"):
            parts.append(f"name={str(ctx['document_name'])[:120]}")
        # The document's tables (0..N) — Arc names one explicitly to target it.
        tables = ctx.get("tables")
        if isinstance(tables, list) and tables:
            rendered = "; ".join(
                f"{str(t.get('name'))[:40]}({len(t.get('fields') or [])}col,"
                f"{_num(t.get('rows'))}r"
                + (",verified" if t.get("status") == "verified" else "") + ")"
                for t in tables[:12] if isinstance(t, dict))
            parts.append(f"tables[{len(tables)}]: {rendered}")
        if ctx.get("active_table"):
            parts.append(f"active_table={ctx['active_table']} (focused — omit "
                         "table_name to target this one; name another to target it)")
        if ctx.get("active_kind"):
            parts.append(f"active_kind={ctx['active_kind']}")
        if ctx.get("viewing_page"):
            parts.append(f"shane_viewing_page={ctx['viewing_page']}")
        if ctx.get("draft_rows") is not None:
            parts.append(f"draft_rows={ctx['draft_rows']}")
        if ctx.get("table_fields"):
            fields = ctx["table_fields"]
            if isinstance(fields, list):
                parts.append("columns=[" + ", ".join(str(f)[:40] for f in fields[:20]) + "]")
        # Shane's pointing — same grammar as the bench; render via the shared
        # helpers by pointing them at this ctx (they read self._area_context).
        for key, cap, label in (("regions", 4, "shane_regions"), ("marks", 6, "shane_marks")):
            items = ctx.get(key)
            if isinstance(items, list) and items:
                if key == "regions":
                    rendered = "; ".join(
                        f"#{r.get('n', i + 1)} p{r.get('page')}@({_num(r.get('x'))},{_num(r.get('y'))}) "
                        f"{_num(r.get('w'))}x{_num(r.get('h'))}"
                        for i, r in enumerate(items[:cap]) if isinstance(r, dict))
                    parts.append(f"{label}[{min(len(items), cap)}]: {rendered} "
                                 "(page-px boxes — pass the current page's region n to "
                                 "schema_page_text/schema_page_view to read it)")
                else:
                    rendered = "; ".join(
                        f"#{m.get('n', i + 1)} p{m.get('page')}@({_num(m.get('x'))},{_num(m.get('y'))})"
                        for i, m in enumerate(items[:cap]) if isinstance(m, dict))
                    parts.append(f"{label}[{min(len(items), cap)}]: {rendered}")
        sel = ctx.get("selection")
        if isinstance(sel, dict) and str(sel.get("text") or "").strip():
            text = " ".join(str(sel["text"]).split())[:160]
            parts.append(f"shane_selection: \"{text}\" "
                         f"p{sel.get('page')}@({_num(sel.get('x'))},{_num(sel.get('y'))}) "
                         "(text he highlighted — his most precise pointer)")
        return "\n\n[data-extraction now: " + (" | ".join(parts) or "no document") + "]"

    def _extraction_picker_context_block(self) -> str:
        """The Data › Extraction landing seat's block — the WHOLE document
        library (id | name) plus the project_slug, injected as DATA so Arc can
        act as an AI search over it. Behavior is doctrine (written with Shane);
        this only exposes the catalog."""
        ctx = getattr(self, "_area_context", {}) or {}
        slug = str(ctx.get("project_slug") or "").strip()
        docs = ctx.get("documents")
        lines = []
        if isinstance(docs, list):
            for d in docs:
                if not isinstance(d, dict):
                    continue
                did = str(d.get("id") or d.get("document_id") or "").strip()
                name = str(d.get("name") or d.get("normalized_name") or "").strip()
                if did:
                    lines.append(f"  {did} | {name[:110]}")
        header = (f"project_slug={slug} | " if slug else "") + f"library={len(lines)} documents"
        body = "\n".join(lines) if lines else "  (library not loaded yet)"
        return f"\n\n[extraction-picker now: {header}]\n{body}"

    def _industrial_engineer_context_block(self) -> str:
        """The Arc room seat's block — machine context only for now (phase 1:
        UI over manufactured data; trace tools arrive with later phases)."""
        ctx = getattr(self, "_area_context", {}) or {}
        parts = []
        slug = str(ctx.get("project_slug") or "").strip()
        if slug:
            parts.append(f"machine={slug}")
        phase = str(ctx.get("phase") or "").strip()
        if phase:
            parts.append(f"phase={phase}")
        return ("\n\n[industrial-engineer now: "
                + (" | ".join(parts) or "no machine context") + "]")

    def _data_map_context_block(self) -> str:
        """The Data Map seat's [.. now] block — board identity + a compact
        world summary; the full detail rides data_map_overview."""
        ctx = getattr(self, "_area_context", {}) or {}
        parts: list[str] = []
        if ctx.get("board_name"):
            parts.append(f"board={ctx['board_name']}")
        cards = ctx.get("cards")
        if isinstance(cards, list) and cards:
            names = ", ".join(str(c) for c in cards[:24])
            parts.append(f"cards[{len(cards)}]: {names}")
        contracts = ctx.get("contracts")
        if isinstance(contracts, dict):
            parts.append(
                f"contracts: {contracts.get('drawn', 0)} drawn / "
                f"{contracts.get('proposed', 0)} proposed")
        picks = ctx.get("bench_picks")
        if isinstance(picks, list) and picks:
            rendered = ", ".join(
                f"{p.get('table')}.{p.get('column')}" for p in picks[:8]
                if isinstance(p, dict))
            parts.append(f"bench[{len(picks)}]: {rendered}")
        return ("\n\n[data-map now: "
                + (" | ".join(parts) or "no board context") + "]")

    def _context_block(self) -> str:
        if getattr(self, "_area", "canvas") == "schema-builder":
            return self._schema_context_block()
        if getattr(self, "_area", "canvas") == "data-extraction":
            return self._extraction_context_block()
        if getattr(self, "_area", "canvas") == "extraction-picker":
            return self._extraction_picker_context_block()
        if getattr(self, "_area", "canvas") == "industrial-engineer":
            return self._industrial_engineer_context_block()
        if getattr(self, "_area", "canvas") == "data-map":
            return self._data_map_context_block()
        """Compact machine block appended to every user message: where Shane is
        and what he's marked — retires the get_state+get_pointed opening ritual."""
        try:
            from src.canvas_copilot import bridge

            state = bridge.get_state()
            snap = state["snapshot"] or {}
            if not snap:
                return ""
            parts = [
                f"page={snap.get('page')}",
                f"zoom={round(float(snap.get('zoom') or 0), 2)}",
                f"tool={snap.get('tool')}",
            ]
            parts.append(
                "mode=AUTONOMOUS — you keep working turn after turn until done"
                if self.settings.get("autonomous")
                else "mode=COLLABORATIVE — do THIS turn's work, then STOP and wait "
                     "for Shane (turn-by-turn); no self-directed follow-on runs"
            )
            if self._scoped_confirm_pending:
                parts.append(
                    "SCOPED-ASK CONFIRM GATE ARMED — graph edits refused until Shane "
                    "replies; gather context read-only, restate the plan, WAIT"
                )
            # Slate 4.1: the unaudited-ops counter renders every turn and
            # zeroes on audit completion — covers the error-killed-audit hole.
            if self.needs_audit:
                parts.append("AUDIT-FIRST GATE ARMED (mutating ops refused until one audit_page completes)")
            if self.unaudited_ops:
                parts.append(f"unaudited_ops={self.unaudited_ops}")
            # Drawer disposals since ~30 min: Shane's False-positive verdicts
            # from the issues drawer, delivered mechanically (no turn fired).
            recent_disp = [d for d in self.panel_disposals
                           if time.time() - float(d.get("ts") or 0) < 1800]
            if recent_disp:
                bits = [f"{d.get('rule')}@{str(d.get('element_id'))[:14]}"
                        + (f" ({str(d.get('note'))[:40]})" if d.get("note") else "")
                        for d in recent_disp[-4:]]
                parts.append(
                    f"shane_disposed_via_drawer[{len(recent_disp)}]: " + "; ".join(bits)
                    + " — his verdicts, already suppressed; update your model, don't re-fix")
            gs = snap.get("graph_stats") or {}
            if gs:
                parts.append(
                    "graph="
                    + "/".join(f"{gs.get(k, 0)}{k[0]}" for k in ("components", "terminals", "wires", "continuations", "grounds"))
                )
            marks = snap.get("ask_marks") or []
            if marks:
                bits = []
                for m in marks[-6:]:
                    s = f"#{m.get('n')}@({round(float(m.get('x', 0)))},{round(float(m.get('y', 0)))})"
                    t = m.get("target") or {}
                    if t.get("element_id"):
                        s += f" on {t.get('element_kind')} {t.get('element_label') or t.get('element_id')}"
                    elif t.get("component_label"):
                        s += f" in {t.get('component_label')}"
                    bits.append(s)
                parts.append(f"ask_marks[{len(marks)}]: " + "; ".join(bits))
            lassos = snap.get("lasso_regions") or []
            if lassos:
                lb = []
                for r in lassos[-4:]:
                    b = r.get("bbox") or {}
                    lb.append(
                        f"#{r.get('n')}@({round(float(b.get('x', 0)))},{round(float(b.get('y', 0)))}"
                        f" {round(float(b.get('width', 0)))}x{round(float(b.get('height', 0)))})"
                    )
                parts.append(f"lasso_regions[{len(lassos)}]: " + "; ".join(lb))
            pens = snap.get("pen_marks") or []
            if pens:
                pb = []
                for m in pens[-4:]:
                    b = m.get("bbox") or {}
                    a = m.get("anchor") or {}
                    anchor = (a.get("component_label") or a.get("element_label")
                              or (f"net {a.get('net_id')}" if a.get("net_id") is not None else None)
                              or "open")
                    pb.append(
                        f"#{m.get('n')}@({round(float(b.get('x', 0)))},{round(float(b.get('y', 0)))}"
                        f" {round(float(b.get('width', 0)))}x{round(float(b.get('height', 0)))}) →{anchor}"
                    )
                parts.append(f"pen_marks[{len(pens)}]: " + "; ".join(pb))
            try:
                # Shane ruling 2026-07-05: detector evidence fires at page open
                # with no instruction from anyone. Line is empty when no sidecar.
                from src.canvas_copilot import yolo

                yolo_line = yolo.context_line(int(snap.get("page") or 0))
                if yolo_line:
                    parts.append(yolo_line)
            except Exception:
                logger.debug("yolo context line unavailable", exc_info=True)
            age = state.get("snapshot_age_s")
            if age is not None:
                parts.append(f"age={round(float(age), 1)}s")
            # Multi-canvas hardening (2026-07-12, after the page-13 desync):
            # the copilot always sees how many surfaces are live. >1 is the
            # flip-flop condition — snapshots are pinned to the writer, but
            # Shane must close the duplicate before page-state can be trusted.
            stats = bridge.bridge_stats()
            n_subs = int(stats.get("canvases_connected") or 0)
            n_post = len(stats.get("posting_canvases") or {})
            if n_subs > 1 or n_post > 1:
                parts.append(
                    f"⚠ MULTI-CANVAS: {n_subs} subscribed / {n_post} posting — "
                    f"snapshot+annotates pinned to writer {str(stats.get('writer_canvas'))[:11]}; "
                    "other canvases' snapshots are REJECTED. Tell Shane a duplicate "
                    "canvas is open and which id holds the pin; do not trust page "
                    "identity until exactly 1 remains (title-block check if unsure)")
            else:
                parts.append(f"canvases={n_subs}")
            nudge = _ctx_nudge(self.last_context)
            if nudge:
                parts.append(nudge)
            return "\n\n[canvas now: " + " | ".join(parts) + "]"
        except Exception:
            logger.warning("context block unavailable", exc_info=True)
            return ""

    # Autonomous continuation (Shane, 2026-07-05: "I shouldn't have to say go
    # every time the context is full"). After the FIRST self-handoff in an
    # exchange, the server supplies the continues: turns still end naturally
    # (that is when the ctx meter reads and resets can fire), but the "go"
    # is mechanical. Hard stops: agent asks a question, talk-only turn (no
    # canvas work left), pending approval, Shane's Stop, error, or the cap.
    _AUTO_CONTINUE_CAP = 40

    _CHAIN_ERROR_RETRIES = 2
    # Slate 6.8: backoff before each chain retry — 3 instant retries failed in
    # 6.1s on 2026-07-05 while backed-off recoveries succeeded. Class attr so
    # tests can zero it.
    _CHAIN_RETRY_BACKOFF_S: tuple[float, ...] = (2.0, 8.0, 30.0)
    # Consecutive done-claim refusals before surfacing to Shane instead of
    # looping (a genuinely-blocked agent must reach him, not spin).
    _DONE_GATE_MAX_REFUSALS = 2

    async def _gate_state_sig(self) -> str | None:
        """Slate 6.2 latch key: stable signature of the open blocker set
        (sorted ticket ids — element-keyed via their md5 inputs). None =
        audit unavailable, latch disabled, gate behaves as before."""
        try:
            from src.canvas_copilot import bridge
            from src.canvas_copilot.blockers import build_tickets
            from src.canvas_copilot.tools import compute_page_audit

            audit = await compute_page_audit()
            snap = (bridge.get_state() or {}).get("snapshot") or {}
            if not audit or not snap:
                return None
            t = build_tickets(audit, snap)
            ids = sorted(
                str(x.get("ticket_id") or "?")
                for x in (t.get("live") or []) + (t.get("end_state") or [])
            )
            # 6.3: parked flags are part of the state — a park/unpark changes
            # the signature so the latch allows exactly one fresh gate fire.
            ids += sorted("parked:" + "|".join(p.get("ids") or [])
                          for p in t.get("parked") or [])
            # Run-2 escape closure: departed-page debts are gate state too —
            # settling (or incurring) one must un-latch for a fresh fire.
            ids += [f"debt:{pg}" for pg in sorted(self.page_debts)]
            return "|".join(ids) or "clean"
        except Exception:
            logger.warning("gate state signature unavailable", exc_info=True)
            return None

    async def _done_gate_check(self) -> str | None:
        """None = blocker queue clean (or audit unavailable) → the done claim
        stands. Otherwise the refusal message injected as the next turn."""
        try:
            from src.canvas_copilot import bridge
            from src.canvas_copilot.blockers import open_blockers
            from src.canvas_copilot.tools import compute_page_audit

            audit = await compute_page_audit()
            snap = (bridge.get_state() or {}).get("snapshot") or {}
            gate = open_blockers(audit, snap)
            if not gate.get("live") and not gate.get("end_state"):
                # Slate 6.3: parked flags still BLOCK done, but the gate says
                # "waiting on Shane" instead of re-serving them (the identical
                # CNV40 question was re-asked in 4 consecutive sessions).
                if gate.get("parked"):
                    return (
                        "[DONE-GATE — mechanical server check, not Shane] "
                        f"{gate['parked']} flag(s) are parked AWAITING SHANE'S VERDICT. "
                        "A done/complete claim waits for his answer or disposition — "
                        "do NOT re-argue the parked flags; work another area or tell "
                        "Shane you are blocked on his verdicts and stop."
                    )
                # Run-2 escape closure: the CURRENT page reading clean settled
                # its own debt inside compute_page_audit; debts on OTHER pages
                # still refuse — the gate audits one page at a time, so this
                # record is what stops a page flip from shedding blockers.
                if self.page_debts:
                    items = "; ".join(
                        f"page {pg}: {d.get('live', 0)} live + {d.get('end_state', 0)} "
                        f"end-state (top: {d.get('top_rule', '?')})"
                        for pg, d in sorted(self.page_debts.items()))
                    return (
                        "[DONE-GATE — mechanical server check, not Shane] This page is "
                        "clean, but you departed page(s) with open blockers under an "
                        f"acknowledged goto_page: {items}. Navigation is never disposal "
                        "— goto_page back, fix, and re-audit until clean (the debt "
                        "settles automatically), or carry it OPEN in your handoff. "
                        "Only Shane may dismiss flags."
                    )
                return None
            top = gate.get("top") or {}
            detail = (top.get("details") or ["?"])[0]
            return (
                "[DONE-GATE — mechanical server check, not Shane] Your turn ended "
                f"while the blocker queue is non-empty: {gate['live']} live ticket(s), "
                f"{gate['end_state']} end-state gap(s)"
                + (f", {gate['parked']} parked awaiting Shane" if gate.get("parked") else "")
                + ". A done/complete/finished claim "
                f"is refused. Top ticket: {top.get('rule')} x{top.get('count')} — {detail} "
                "Fix it and re-audit; or reset_session carrying it as OPEN; or park a "
                "disputed flag with raise_to_shane. Flags may be wrong, but only Shane "
                "may dismiss them."
            )
        except Exception:
            logger.warning("done-gate check unavailable", exc_info=True)
            return None

    def _queue_changed(self) -> None:
        """Broadcast the queue state (full-SDK panel: the queue was invisible
        — Shane had no way to see or cancel waiting messages). Fire-and-forget
        so sync call sites (mid-turn drain) can use it too."""
        items = [{"text": (nq.get("text") or "")[:200],
                  **({"images": len(nq["images"])} if nq.get("images") else {})}
                 for nq in (_norm_queued(q) for q in self._queued_messages)]
        try:
            asyncio.get_running_loop().create_task(
                self._broadcast({"kind": "queue", "items": items}))
        except RuntimeError:
            pass

    def remove_queued(self, index: int) -> bool:
        """Panel cancel-a-queued-message. Index into the current queue view."""
        try:
            q = list(self._queued_messages)
            q.pop(index)
        except (IndexError, TypeError):
            return False
        self._queued_messages = deque(q)
        self._persist()
        self._queue_changed()
        return True

    async def handle_user_message(self, text: str,
                                  images: list[dict[str, Any]] | None = None,
                                  *, scoped_ask: bool = False,
                                  area: str | None = None,
                                  area_context: dict[str, Any] | None = None) -> None:
        """Send Shane's message to the agent and relay the full response turn.

        images: optional [{media_type, data(b64)}] — pasted into the panel
        composer; delivered as real image content blocks (capped at 4).
        scoped_ask: True for a pen/lasso mark carrying an instruction. It arms
        the confirm gate (annotate refuses + the chain waits) in EITHER mode —
        confirm-before-act is a property of the mark, not the mode. Any of
        Shane's own (non-scoped) messages disarm it (his reply = his go)."""
        images = [im for im in (images or []) if im.get("data")][:4]
        # Seat binding (R5/R7): the sending surface names the bench; the
        # context block swaps per turn. Default = canvas (existing panels
        # send no area). Sticky until another surface speaks.
        self._area = area or "canvas"
        self._area_context = area_context or {}
        # Confirm-gate arm/disarm at receipt (before lock/queue branching) so it
        # holds whether the ask runs now or from the queue (Shane, 2026-07-08).
        if scoped_ask:
            self._scoped_confirm_pending = True
        else:
            self._scoped_confirm_pending = False
        # Slate 6.4: journal EVERY inbound message at arrival, before any
        # branch — the mining found Shane's most consequential ruling of the
        # page-10 run survived only as the agent's paraphrase, and 3 queued
        # messages died un-journaled with their session. Panels ignore the
        # "ingress" kind; the observer journals it.
        await self._broadcast({"kind": "ingress", "source": "panel", "text": text,
                               **({"images": len(images)} if images else {})})
        if self._query_lock.locked():
            # QUEUE, never bounce (2026-07-05: two corrections bounced with a
            # note that flashed past in a busy stream; the agent never saw them).
            self._queued_messages.append({"text": text,
                                          **({"images": images} if images else {})})
            self._persist()  # 6.7: queued Shane messages survive process death
            self._queue_changed()
            if _is_stop_message(text):
                # Slate 6.5: stop-class preempts — cooperative cancel at the
                # next boundary instead of waiting out the turn ("stop now"
                # got zero tool response for 109s in the page-10 run). The
                # message re-enters as a fresh exchange via the post-lock
                # drain; _stop_requested keeps mid-turn drain hands off it.
                # Slate 4.5 auto-latch, ADVISORY ONLY (a false latch mid-run
                # recreates the OVER-DEFERRAL stall Shane ruled a failure):
                # two stop-class messages in 60s suggest manual mode.
                now = time.time()
                self._stop_class_ts.append(now)
                if (len([t for t in self._stop_class_ts if now - t <= 60.0]) >= 2
                        and not self.settings.get("guided")):
                    await self._broadcast(
                        {"kind": "status", "state": "busy",
                         "note": "guided-mode suggestion (advisory): two stop-class "
                                 "messages in 60s — the panel toggle or 'go step by "
                                 "step' latches manual mode"}
                    )
                await self._broadcast(
                    {"kind": "status", "state": "busy",
                     "note": "STOP received — interrupting at the next boundary; "
                             "your message sends immediately after."}
                )
                await self.interrupt()
                return
            await self._broadcast(
                {"kind": "status", "state": "busy",
                 "note": f"Message queued ({len(self._queued_messages)} waiting) — it "
                         "injects at the next tool boundary. Use Stop to interrupt instead."}
            )
            return
        async with self._query_lock:
            # Slate 6.7: a restored/salvaged handoff outranks everything — a
            # persisted note means the reset already COMMITTED (survived a
            # process death or manual kill); the successor must be note-born
            # BEFORE Shane's text runs, or his message lands on a dead session.
            # His message follows as the successor's next turn.
            if self._pending_reset:
                prompt = self._take_reset_prompt()
                await self.shutdown()
                self.session_id = None
                self.last_context = None
                self._persist()
                self._history.append({"kind": "user", "text": prompt, "source": "handoff"})
                await self._broadcast({"kind": "user", "text": prompt, "source": "handoff"})
                await self._broadcast(
                    {"kind": "status", "state": "working",
                     "note": "queued handoff note found — successor starts from it; "
                             "your message follows right after"}
                )
                await self._run_turn(prompt + self._context_block())
            self._history.append({"kind": "user", "text": text, "source": "panel",
                                  **({"images": len(images)} if images else {})})
            self._shane_said.append(text)
            self._geo_batch_used = False  # 4.5: a real Shane message renews the budget
            # A fresh Shane message is a new-claim opportunity: the gate may
            # fire once more even on an unchanged blocker set (slate 6.2).
            self._gate_latch = None
            await self._broadcast({"kind": "status", "state": "working"})
            auto_left = self._AUTO_CONTINUE_CAP
            retry_left = self._CHAIN_ERROR_RETRIES
            gate_left = self._DONE_GATE_MAX_REFUSALS
            self._stop_requested = False
            try:
                # Old call shape kept for imageless turns (the common case,
                # and the shape test harnesses monkeypatch).
                if images:
                    await self._run_turn(text + self._context_block(), images=images)
                else:
                    await self._run_turn(text + self._context_block())
                while True:
                    if not self._pending_reset:
                        # Queued Shane messages outrank mechanical continues —
                        # they inject here, at the turn boundary, with a visible
                        # user bubble stamped at injection time.
                        if self._queued_messages and not self._stop_requested:
                            entry = _norm_queued(self._queued_messages.popleft())
                            self._queue_changed()
                            nxt = entry.get("text") or ""
                            n_imgs = len(entry.get("images") or [])
                            self._history.append({"kind": "user", "text": nxt, "source": "queue",
                                                  **({"images": n_imgs} if n_imgs else {})})
                            self._shane_said.append(nxt)
                            self._geo_batch_used = False  # 4.5: his message renews the budget
                            await self._broadcast({"kind": "user", "text": nxt + " (queued)", "source": "queue"})
                            await self._broadcast(
                                {"kind": "status", "state": "working", "note": "queued message injected"}
                            )
                            auto_left = self._AUTO_CONTINUE_CAP
                            retry_left = self._CHAIN_ERROR_RETRIES
                            if entry.get("images"):
                                await self._run_turn(nxt + self._context_block(),
                                                     images=entry["images"])
                            else:
                                await self._run_turn(nxt + self._context_block())
                            continue
                        # Scoped-ask confirm (2026-07-08): a pen/lasso mark is
                        # awaiting Shane's go — stop and wait, in EITHER mode.
                        # Confirm-before-act belongs to the mark, so even a live
                        # autonomous run pauses on a mark. Queued Shane messages
                        # above still deliver (his reply is what lifts the gate).
                        if self._scoped_confirm_pending:
                            await self._broadcast(
                                {"kind": "status", "state": "ready",
                                 "note": "scoped ask — plan restated; waiting for your confirmation"}
                            )
                            break
                        # Slate 4.5: guided mode idles ALL machine continuation —
                        # retries, gate turns, and auto-continues alike. Shane
                        # drives; the chain waits for his next message.
                        if self.settings.get("guided"):
                            await self._broadcast(
                                {"kind": "status", "state": "ready",
                                 "note": "manual (guided) mode — waiting for Shane's next instruction"}
                            )
                            break
                        # No handoff queued: decide whether the server owes a "go".
                        # A turn that did tool WORK always earns its continue —
                        # trailing '?' politeness must not stall the chain (Shane,
                        # 2026-07-05: "it still stops"). Genuine blockage shows as
                        # a talk-only turn; genuine questions arrive without work.
                        if auto_left <= 0 or self._stop_requested:
                            break
                        if self._pending_approvals or self._turn_errored:
                            break
                        if self._turn_result_error:
                            # Transient error_during_execution results killed 4
                            # chains on 2026-07-05 (instant, 0 tokens). Slate
                            # 6.8: the instant retries failed in 6.1s while
                            # backed-off recoveries succeeded — back off
                            # 2s/8s/30s, note bridge health (ADVISORY, never
                            # gating), and replay the truncated assistant text
                            # so the agent knows where its dead turn cut off.
                            if retry_left <= 0 or not self.settings.get("autonomous"):
                                break
                            retry_left -= 1
                            attempt_no = self._CHAIN_ERROR_RETRIES - retry_left
                            backoff = self._CHAIN_RETRY_BACKOFF_S
                            delay = backoff[min(attempt_no - 1, len(backoff) - 1)]
                            health = ""
                            try:
                                from src.canvas_copilot import bridge as _b

                                health = f"; bridge: {_b.bridge_stats()['canvases_connected']} canvas(es)"
                            except Exception:
                                health = "; bridge stats unavailable"
                            logger.warning("chain retry %s/%s after error result; last tool: %s%s",
                                           attempt_no, self._CHAIN_ERROR_RETRIES,
                                           self._last_tool_meta, health)
                            await self._broadcast(
                                {"kind": "status", "state": "reconnecting",
                                 "note": f"turn errored — backing off {delay:.0f}s, then retrying "
                                         f"({attempt_no}/{self._CHAIN_ERROR_RETRIES})"
                                         f"{health}; last tool: "
                                         f"{(self._last_tool_meta or {}).get('tool', 'none')}"}
                            )
                            await asyncio.sleep(delay)
                            await self.shutdown()
                            tail = (self._turn_last_text or "").strip()[-200:]
                            retry_prompt = (
                                "[RETRY — harness, not Shane: your previous turn errored "
                                "mid-stream"
                                + (f'; its last delivered text ended: "…{tail}"' if tail else "")
                                + "] continue"
                            )
                            await self._run_turn(retry_prompt + self._context_block())
                            continue
                        if self._turn_tool_calls == 0:
                            # talk-only: done, blocked, or truly Shane's turn.
                            # DONE-GATE (decision log #8, arm-6 + 2S″ laundering:
                            # detection without enforcement gets rationalized
                            # past): in autonomous mode a done-claim with open
                            # blockers is REFUSED mechanically.
                            if not self.settings.get("autonomous") or gate_left <= 0:
                                break
                            # Slate 6.2 LATCH: an unchanged blocker set with no
                            # intervening op was already refused — surface to
                            # Shane instead of spinning on standby turns.
                            sig = await self._gate_state_sig()
                            if (sig is not None and self._gate_latch == sig
                                    and self._ops_since_gate == 0):
                                await self._broadcast(
                                    {"kind": "status", "state": "ready",
                                     "note": "done-gate: this blocker state was already refused once — waiting for Shane"}
                                )
                                break
                            refusal = await self._done_gate_check()
                            if refusal is None:
                                break  # queue is clean (or unavailable): claim stands
                            gate_left -= 1
                            self._gate_latch = sig
                            self._ops_since_gate = 0
                            # Shadow claim detector (slate 6.2): logged per fire
                            # until it earns exclusive-trigger status.
                            claim = _detect_done_claim(self._turn_last_text)
                            await self._broadcast(
                                {"kind": "status", "state": "working",
                                 "note": f"done-gate: claim refused — blockers still open (shadow claim_detected={claim})"}
                            )
                            self._history.append({"kind": "user", "text": refusal, "source": "gate"})
                            await self._broadcast({"kind": "user", "text": refusal, "source": "gate"})
                            await self._run_turn(refusal + self._context_block())
                            continue
                        if not self.settings.get("autonomous"):
                            break  # one-off command: no chain unless opted in
                        retry_left = self._CHAIN_ERROR_RETRIES
                        gate_left = self._DONE_GATE_MAX_REFUSALS
                        auto_left -= 1
                        await self._broadcast(
                            {"kind": "status", "state": "working",
                             "note": f"auto-continuing ({self._AUTO_CONTINUE_CAP - auto_left}/{self._AUTO_CONTINUE_CAP})"}
                        )
                        # Slate 6.1: the tick self-identifies as machine, never
                        # Shane. The old bare "continue" was journaled in the
                        # same shape as his real messages — agents cited it as
                        # his consent ("Shane confirmed override via continue").
                        tick = (
                            "[AUTO-CONTINUE — harness, not Shane; pending "
                            "questions remain unanswered; this authorizes nothing]"
                        )
                        self._history.append({"kind": "user", "text": tick, "source": "auto"})
                        await self._broadcast({"kind": "user", "text": "continue (auto)", "source": "auto"})
                        await self._run_turn(tick + self._context_block())
                        continue
                    # Agent-discretion self-reset (R3.2): execute the queued
                    # handoff, then auto-send the note to the fresh session.
                    # 6.9: queued Shane instructions fold in as ITEM 1.
                    prompt = self._take_reset_prompt()
                    await self.shutdown()
                    self.session_id = None
                    self.last_context = None  # stale meter must not re-trigger the nudge
                    self._persist()
                    # Panel history keeps continuity (unlike new_session): Shane
                    # sees the handoff note as the next user bubble.
                    self._history.append({"kind": "user", "text": prompt, "source": "handoff"})
                    await self._broadcast({"kind": "user", "text": prompt, "source": "handoff"})
                    await self._broadcast(
                        {"kind": "status", "state": "working",
                         "note": "Arc reset its own session — resuming from its handoff note"}
                    )
                    retry_left = self._CHAIN_ERROR_RETRIES
                    await self._run_turn(prompt + self._context_block())
            finally:
                # 6.7: capture drained-queue/pending-reset state at every cycle
                # end — the persisted file is the crash-recovery ground truth.
                self._persist()
                await self._broadcast({"kind": "status", "state": "ready"})
        # A message that arrived during the final turn (or after Stop) must not
        # sit in the queue forever — process it now that the lock is free.
        if self._queued_messages:
            entry = _norm_queued(self._queued_messages.popleft())
            self._queue_changed()
            asyncio.create_task(
                self.handle_user_message(entry.get("text") or "",
                                         images=entry.get("images")))

    async def _run_turn(self, full_text: str,
                        images: list[dict[str, Any]] | None = None) -> None:
        """One agent turn with outage retries. Network/API outages must not eat
        the prompt: hold it and retry with backoff instead of making Shane
        re-type it (2026-07-03).

        images ride as base64 content blocks in a streamed message dict —
        the SDK's string path can't carry them."""
        delays = [5.0, 15.0, 45.0]
        self._turn_tool_calls = 0
        self._turn_last_text = ""
        self._turn_errored = False
        self._turn_result_error = False
        for attempt in range(len(delays) + 1):
            try:
                client = await self._ensure_client()
                if images:
                    blocks: list[dict[str, Any]] = [{"type": "text", "text": full_text}]
                    blocks += [{"type": "image",
                                "source": {"type": "base64",
                                           "media_type": str(im.get("media_type") or "image/png"),
                                           "data": str(im.get("data") or "")}}
                               for im in images[:4]]

                    async def _one_message() -> Any:
                        yield {"type": "user",
                               "message": {"role": "user", "content": blocks},
                               "parent_tool_use_id": None}

                    await client.query(_one_message())
                else:
                    await client.query(full_text)
                async for message in client.receive_response():
                    await self._relay(message)
                await self._refresh_context_meter(client)
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception("Copilot turn failed (attempt %s)", attempt + 1)
                # A dead subprocess would poison every later turn — reset it.
                await self.shutdown()
                if attempt >= len(delays):
                    self._turn_errored = True  # breaks any auto-continue chain
                    await self._broadcast(
                        {"kind": "error", "message": f"{type(exc).__name__}: {exc} — giving up after {attempt + 1} attempts. Your last message was NOT processed."}
                    )
                    try:
                        from src.canvas_copilot import bridge as _bridge

                        _bridge.send_commands(
                            [{"type": "toast", "message": "Arc turn aborted — see the panel"}]
                        )
                    except Exception:
                        pass
                    return
                delay = delays[attempt]
                await self._broadcast(
                    {
                        "kind": "status",
                        "state": "reconnecting",
                        "note": f"connection lost ({type(exc).__name__}) — retrying in {delay:.0f}s; your message is queued and will send automatically",
                    }
                )
                # Slate 6.4: redelivery is journaled with its own provenance so
                # instruction-timing never double-counts a retried prompt.
                await self._broadcast(
                    {"kind": "ingress", "source": "retry", "text": full_text[:200]}
                )
                await asyncio.sleep(delay)

    async def _refresh_context_meter(self, client: ClaudeSDKClient) -> None:
        """Post-turn /context reading — the only context visibility this
        transport offers (editing/eviction verified absent, R3.1). Feeds the
        reset nudge in _context_block; failure just leaves the meter stale.

        Slate 6.9 root cause: get_context_usage() is BETA-UNAWARE — it kept
        reporting maxTokens=200000 under the live 1M window, and the verbatim
        phantom "ctx=219k/200k — over the ceiling" self-terminated 3 healthy
        sessions in 8.5 minutes (each burning a $2-3 dedicated reset turn)
        while execution continued fine past 219k. Correct the max when (a)
        the long_context toggle is on AND (b) either the running model is in
        the confirmed family or the crossing proof has fired (total past the
        reported max — sticky for the session). Fraction thresholds scale off
        the corrected max automatically; toggling long_context off restores
        the SDK's number untouched."""
        try:
            usage = await asyncio.wait_for(client.get_context_usage(), timeout=10)
            total = int(usage.get("totalTokens") or 0)
            mx = int(usage.get("maxTokens") or 0)
            pct = round(float(usage.get("percentage") or 0.0), 1)
            # Full-SDK panel: keep the per-category breakdown (the CLI's
            # /context view) for the panel's real context meter.
            self.last_context_detail = {
                "categories": [
                    {"name": c.get("name"), "tokens": c.get("tokens"), "color": c.get("color")}
                    for c in (usage.get("categories") or [])
                ],
                "raw_max": usage.get("rawMaxTokens"),
            }
            if 0 < mx < _LONG_CONTEXT_WINDOW:
                model = str(self.settings.get("model")
                            or (self.last_usage or {}).get("model") or "")
                # A CONFIRMED 1M family (opus/fable/mythos/sonnet) ALWAYS presumes
                # the 1M window — unconditionally, not gated on the long_context
                # toggle (Shane, 2026-07-08: "Opus 4.8 in this app will always
                # presume the window is 1M"). The toggle only governs the
                # SPECULATIVE crossing-proof path for UNKNOWN models, so a genuine
                # 200k model (Haiku) is never falsely bumped, and a known-1M model
                # can never be silently demoted to 200k by a stray toggle.
                confirmed = bool(_LONG_CONTEXT_CONFIRMED.search(model))
                if not confirmed and self.settings.get("long_context", True) and total > mx:
                    self._ctx_beta_confirmed = True  # crossing proof: SDK max lied
                if confirmed or self._ctx_beta_confirmed:
                    mx = _LONG_CONTEXT_WINDOW
                    pct = round(100.0 * total / mx, 1)
            self.last_context = {"total": total, "max": mx, "pct": pct}
            self._persist()
            await self._broadcast({"kind": "context", **self.last_context,
                                   **(self.last_context_detail or {})})
        except Exception:
            logger.debug("context usage unavailable", exc_info=True)

    async def _relay(self, message: Any) -> None:
        # Order matters: Task* messages subclass SystemMessage, so they must
        # be matched BEFORE the generic SystemMessage branch.
        if isinstance(message, (TaskStartedMessage, TaskProgressMessage,
                                TaskNotificationMessage, TaskUpdatedMessage)):
            await self._broadcast(_shape_task_event(message))
        elif isinstance(message, RateLimitEvent):
            # Full-SDK panel (2026-07-07): rate-limit transitions were the
            # invisible cause of "mystery stalls" — surface them.
            info = message.rate_limit_info
            await self._broadcast({
                "kind": "rate_limit",
                "status": info.status,
                "rate_limit_type": info.rate_limit_type,
                "resets_at": info.resets_at,
                "utilization": info.utilization,
                "overage_status": info.overage_status,
            })
        elif isinstance(message, SystemMessage):
            if message.subtype == "init":
                sid = (message.data or {}).get("session_id")
                if sid:
                    self.session_id = sid
                    self._persist()
                # Session capabilities for the panel (tools/commands/mode) —
                # kept small: names only, no schemas.
                d = message.data or {}
                self.last_init = {
                    "model": d.get("model"),
                    "permissionMode": d.get("permissionMode"),
                    "tools": [str(t) for t in (d.get("tools") or [])][:80],
                    "slash_commands": [str(c) for c in (d.get("slash_commands") or [])][:80],
                    "mcp_servers": d.get("mcp_servers"),
                }
                await self._broadcast({"kind": "session", "session_id": self.session_id, **{"settings": self.settings}})
                await self._broadcast({"kind": "init_info", **self.last_init})
            else:
                # Compaction boundaries, status changes, etc. — previously
                # dropped; the panel renders them as slim system rows.
                await self._broadcast({
                    "kind": "system_event",
                    "subtype": message.subtype,
                    "data": _abbreviate(message.data, 300),
                })
        elif isinstance(message, StreamEvent):
            ev = message.event or {}
            if ev.get("type") == "content_block_delta":
                delta = ev.get("delta") or {}
                if delta.get("type") == "text_delta" and delta.get("text"):
                    await self._broadcast({"kind": "assistant_delta", "text": delta["text"],
                                           **_subagent_tag(message.parent_tool_use_id)})
                elif (
                    delta.get("type") == "thinking_delta"
                    and delta.get("thinking")
                    and self.settings.get("show_thinking")
                ):
                    await self._broadcast({"kind": "thinking_delta", "text": delta["thinking"],
                                           **_subagent_tag(message.parent_tool_use_id)})
        elif isinstance(message, AssistantMessage):
            sub = _subagent_tag(message.parent_tool_use_id)
            if message.error:
                # authentication_failed / billing_error / rate_limit /
                # invalid_request / server_error — previously a mute generic
                # result; now a first-class error row with its code.
                await self._broadcast({"kind": "error", "code": message.error,
                                       "message": f"assistant error: {message.error}", **sub})
            for block in message.content:
                if isinstance(block, TextBlock) and block.text.strip():
                    if not message.parent_tool_use_id:
                        self._turn_last_text = block.text
                    await self._broadcast({"kind": "assistant_text", "text": block.text,
                                           "model": message.model, **sub})
                elif isinstance(block, (ToolUseBlock, ServerToolUseBlock)):
                    self._turn_tool_calls += 1
                    if "annotate" in block.name:
                        self._ops_since_gate += 1  # latch: mutating work re-arms the gate
                    try:
                        _ib = len(json.dumps(block.input, ensure_ascii=False, default=str))
                    except (TypeError, ValueError):
                        _ib = -1
                    self._last_tool_meta = {"tool": block.name, "ts": time.time(),
                                            "input_bytes": _ib,
                                            "turn_tool_calls": self._turn_tool_calls}
                    await self._broadcast(
                        {"kind": "tool_use", "tool": block.name, "id": block.id,
                         **({"server_tool": True} if isinstance(block, ServerToolUseBlock) else {}),
                         **sub, **_journal_input(block.name, block.input)}
                    )
                elif isinstance(block, ThinkingBlock):
                    if self.settings.get("show_thinking") and block.thinking.strip():
                        await self._broadcast({"kind": "thinking", "text": block.thinking, **sub})
        elif isinstance(message, UserMessage):
            # Tool results were dropped entirely pre-2026-07-07 — the panel
            # showed calls but never what came back. Relay result blocks
            # (size-disciplined); plain-string user echoes stay ours.
            content = message.content
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, (ToolResultBlock, ServerToolResultBlock)):
                        await self._broadcast({
                            "kind": "tool_result",
                            "tool_use_id": block.tool_use_id,
                            "is_error": bool(getattr(block, "is_error", False)),
                            **_subagent_tag(message.parent_tool_use_id),
                            **_shape_tool_result_content(block.content),
                        })
        elif isinstance(message, ResultMessage):
            self._turn_result_error = message.subtype != "success"
            if self._turn_result_error:
                # Slate 6.8: dump last-tool metadata on every error result —
                # a reload kills the worker and its chain loop, so nothing
                # else survives to record what the turn was doing.
                logger.warning("error result (%s); last tool: %s",
                               message.subtype, self._last_tool_meta)
            if message.session_id:
                self.session_id = message.session_id
            usage = message.usage or {}
            self.last_usage = {
                "input_tokens": usage.get("input_tokens"),
                "output_tokens": usage.get("output_tokens"),
                "cache_read_input_tokens": usage.get("cache_read_input_tokens"),
                "cache_creation_input_tokens": usage.get("cache_creation_input_tokens"),
                "num_turns": message.num_turns,
                "duration_ms": message.duration_ms,
                "model": self.settings.get("model"),
            }
            self.total_cost_usd = getattr(message, "total_cost_usd", None)
            denials = message.permission_denials or []
            self._persist()
            await self._broadcast(
                {
                    "kind": "result",
                    "ok": message.subtype == "success" and not message.is_error,
                    "subtype": message.subtype,
                    "cost_usd": self.total_cost_usd,
                    "usage": self.last_usage,
                    # Full-SDK panel (2026-07-07): error forensics + per-model
                    # accounting that previously died in the relay.
                    "stop_reason": message.stop_reason,
                    "duration_api_ms": message.duration_api_ms,
                    "model_usage": _abbreviate(message.model_usage, 800) if message.model_usage else None,
                    **({"permission_denials": len(denials)} if denials else {}),
                    **({"errors": [str(e)[:300] for e in (message.errors or [])[:5]]}
                       if message.errors else {}),
                    **({"api_error_status": message.api_error_status}
                       if message.api_error_status else {}),
                }
            )


# Slate 6.5 stop lexicon: exact tokens + observed-typo whitelist, whole-word,
# LEADING position only (first 3 words). "now stop" preempts; a "stop" buried
# mid-sentence injects without canceling — generic edit-distance was killed
# as a false-cancel vector ('no' -> 'now').
_STOP_TOKENS = {"stop", "sstop", "stpo", "halt"}


def _is_stop_message(text: str) -> bool:
    words = re.findall(r"[a-z']+", (text or "").lower())[:3]
    return any(w in _STOP_TOKENS for w in words)


# Slate 6.2 shadow claim detector — recall-biased completion lexicon with
# negation awareness. SHADOW ONLY: the turn-shape trigger still governs; each
# gate fire logs what this would have decided, and it earns exclusive-trigger
# status only after a clean session on record (it is itself a new surface).
_CLAIM_RE = re.compile(
    r"\b(done|complete[d]?|finished|finish(ed)?|all set|wrapped up|"
    r"nothing (left|remaining|else)|fully (annotated|wired|labeled))\b",
    re.IGNORECASE,
)
_NEGATION_RE = re.compile(
    r"\b(not|no|never|won'?t|wouldn'?t|isn'?t|aren'?t|can'?t|cannot|haven'?t|"
    r"didn'?t|without|refus\w*|waiting|standing by|before any|far from)"
    r"\b[^.!?\n]{0,60}$",
    re.IGNORECASE,
)


def _detect_done_claim(text: str) -> bool:
    for m in _CLAIM_RE.finditer(text or ""):
        if _NEGATION_RE.search(text[: m.start()][-90:]):
            continue
        return True
    return False


def _abbreviate(value: Any, limit: int = 400) -> Any:
    try:
        text = json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        text = str(value)
    return json.loads(text) if len(text) <= limit else text[:limit] + "…"


_SPILL_DIR = Path(tempfile.gettempdir()) / "canvas_copilot_tool_inputs"


def _subagent_tag(parent_tool_use_id: str | None) -> dict[str, Any]:
    """Panel nesting key: messages produced inside a subagent carry the Task
    tool_use_id that spawned them; the panel groups on it. Empty for the
    main thread so the common case adds zero bytes."""
    return {"parent_tool_use_id": parent_tool_use_id} if parent_tool_use_id else {}


def _shape_task_event(message: Any) -> dict[str, Any]:
    """Background-task lifecycle → one compact panel row (kind 'task').
    Terminal statuses arrive via TaskNotificationMessage OR TaskUpdatedMessage
    (SDK docs: either may be suppressed) — the panel clears active tasks on a
    terminal status from either event shape."""
    out: dict[str, Any] = {"kind": "task", "task_id": getattr(message, "task_id", None)}
    if isinstance(message, TaskStartedMessage):
        out.update(event="started", description=message.description,
                   task_type=message.task_type, tool_use_id=message.tool_use_id)
    elif isinstance(message, TaskProgressMessage):
        out.update(event="progress", description=message.description,
                   usage=dict(message.usage or {}), last_tool=message.last_tool_name)
    elif isinstance(message, TaskNotificationMessage):
        out.update(event="notification", status=message.status,
                   summary=str(message.summary or "")[:400],
                   usage=dict(message.usage) if message.usage else None)
    elif isinstance(message, TaskUpdatedMessage):
        out.update(event="updated", status=message.status,
                   patch=_abbreviate(message.patch, 300))
    return out


def _shape_tool_result_content(content: Any) -> dict[str, Any]:
    """Tool-result content → {preview, images?, spill path?} with the same
    size discipline as _journal_input: 400-char preview for the panel, full
    payload spilled to the 6.4 sidecar when bigger. Image blocks never ride
    the preview (canvas tools already mirror them via broadcast_tool_image) —
    they count instead."""
    images = 0
    texts: list[str] = []
    if isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                texts.append(str(item))
            elif item.get("type") == "image":
                images += 1
            elif item.get("type") == "text":
                texts.append(str(item.get("text") or ""))
            else:
                texts.append(json.dumps(item, ensure_ascii=False, default=str))
        text = "\n".join(t for t in texts if t)
    elif content is None:
        text = ""
    else:
        text = str(content)
    out: dict[str, Any] = {"preview": text[:400] + ("…" if len(text) > 400 else "")}
    if images:
        out["images"] = images
    if len(text) > 400:
        try:
            _SPILL_DIR.mkdir(parents=True, exist_ok=True)
            spill = _SPILL_DIR / f"{int(time.time() * 1000)}-tool_result.json"
            spill.write_text(text, encoding="utf-8")
            out["preview_path"] = str(spill)
        except OSError:
            logger.warning("tool-result spill failed", exc_info=True)
    return out


def _journal_input(tool: str, value: Any) -> dict[str, Any]:
    """Slate 6.4: tool inputs journal losslessly. The preview stays small for
    the panel; oversized payloads spill to a sidecar file (debug_path pattern)
    — 118/600 inputs were truncated at 401 chars in the page-10 run, 44 of
    them the reset payloads whose corruption forensics that truncation blocked."""
    out: dict[str, Any] = {"input": _abbreviate(value)}
    try:
        text = json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        text = str(value)
    if len(text) > 400:
        try:
            _SPILL_DIR.mkdir(parents=True, exist_ok=True)
            spill = _SPILL_DIR / f"{int(time.time() * 1000)}-{re.sub(r'[^A-Za-z0-9_]', '', tool)[:40]}.json"
            spill.write_text(text, encoding="utf-8")
            out["input_path"] = str(spill)
        except OSError:
            logger.warning("tool-input spill failed", exc_info=True)
    return out


copilot_session = CopilotSession()
