# The Trust Model

How the platform knows what's true, what's provisional, and why the AI cannot grade its own homework.

## Two tiers, no blur

| Tier | What it means | Who grants it |
|---|---|---|
| **Best-effort** | Autonomous output. Useful, labeled, never asserted as truth. A match *enriches*; a miss means *nothing*. | The machine, by default |
| **Certified** | Verified against the print by a person, then sealed. | A human, deliberately, never the AI |

Everything the AI produces is born best-effort. Certification is **earned** — page-by-page human verification against the source document — and it is the only path to the truth tier.

## The seal

When a table or page is Certified:

- It **seals read-only**. The platform refuses every mutation — API, UI, or the AI's own write tools (HTTP 409). See [`extraction_data.py`](agent_server/src/extraction_data.py).
- A **checksummed snapshot** lands in an append-only archive ([`certification.py`](agent_server/src/persistence/certification.py)). If sealed data ever drifts from its snapshot, an alarm trips — tamper-evidence, not just tidiness.
- **Unsealing is a human door.** There is no programmatic path for the AI to unseal anything.

## Document truth over engineering truth

The platform validates against **source-document fidelity**, not idealized correctness. If the manufacturer's print is wrong, the extracted data preserves the wrongness faithfully — misspellings, duplicates and all — because a "corrected" value is one you can no longer check against the source. Inferred corrections live in an explicitly separate, labeled layer, never blended into base data.

## The reconstruction rule

> No extracted schematic fact is trusted until it can be drawn back onto the original page render in the correct place.

Every schematic object preserves render-pixel geometry precisely so this check is always possible. The 3D machine graph is this rule made visible: if the data can rebuild the drawing, the extraction is honest.

## The anti-contamination boundary

Human-verified annotations are a **validation benchmark only**. Extraction must never use saved truth to decide where to look or what to believe during a run — if the extractor can find the pattern without seeing the answer key, it generalizes; if it peeks, the validation proves nothing. This discipline exists because an early autonomous run *self-validated as complete* and was found under 50% accurate by human review. Self-grading is structurally banned ever since.

## Audit rules are earned, not declared

The canvas audit engine runs deterministic checks per page. New rules are **born as warnings** and promoted to errors only after calibration against human-certified pages at **zero false positives**. Detector-fed rules (vision-model evidence) are capped at informational severity permanently — detection never gates.

## Evidence-ruled joins

Relationships between documents are measured against the live data before they become law: full-table match surveys (never samples), reported as honest fractions. The AI proposes with the evidence attached; a person rules. A wrong link never silently enters the twin. See [`data_map_tools.py`](agent_server/src/canvas_copilot/data_map_tools.py).

## Why this hard line exists

The trace this platform serves ends at a live electrical panel with a human's hands in it. An answer that *sounds* right is a liability there. Every rule above exists to make the system's confidence **checkable** — document, page, printed mark — instead of persuasive.
