# Architecture

How a pile of machine PDFs becomes a queryable digital twin — the surfaces, the seat system, and the live bridge that lets an AI work a drawing next to a human.

## The shape of the problem

A machine's documentation is a **star**: one core artifact (the schematic) surrounded by documents that join back to it on keys they already print — wire labels, component marks, part numbers, terminal points, alarm codes. So the platform is organized around three kinds of work:

1. **Producing data** — extracting each document at its own printed grain (annotation for drawings, tables for tabular documents).
2. **Describing relationships** — measuring and recording how extracted tables join, with live evidence.
3. **Consuming data** — composing already-extracted facts into cited answers (the trace).

## Components

```
atlas-dashboard/  (Next.js)
  Smart Canvas          schematic annotation as a logic-graph overlay on the print
  3D Machine Graph      every annotated sheet in one scene — the reconstruction rule, visible
  Data Map + Proving Bench   tables as cards; joins drawn with live match evidence;
                        a query-by-example bench that proves a join against real rows
  Document Extraction   the classified document browser + extraction surfaces

agent_server/  (FastAPI + PostgreSQL)
  extraction pipeline   per-family parsers + model-driven readers, provenance on every row
  certification         append-only, checksummed seal snapshots; drift alarms; unseal is human-only
  audit engine          deterministic page checks; rules born WARN, promoted to ERROR by calibration
  live bridge           canvas state up / commands down (details below)
  Arc                   the resident AI engineer, one agent with per-surface "seats"
```

## The seat system

Arc is one agent with **seat-scoped tool grants**: the canvas seat can annotate but cannot touch extraction tables; the extraction seat designs and fills tables but cannot annotate; the data-map seat can *propose* joins but is mechanically unable to draw, accept, or dismiss them. Cross-seat writes don't exist. This is least-privilege applied to an AI colleague — each seat's powers match its room.

## The live bridge (human + AI on one canvas)

The canvas streams state **up** (page, viewport, tool, selection, pen events, graph stats) and receives commands **down** (highlight, navigate, annotate) over a typed bridge:

- **The pen is first-class input.** What the human is touching right now is queryable agent state — "annotate *it*" resolves to real element IDs, not a screenshot guess.
- **At-least-once, verified delivery.** Every mutating command carries an idempotency key and blocks on an **apply-receipt** with before/after graph stats. An AI edit either verifiably landed or verifiably didn't — "delivered" is never confused with "correct."
- **Honest eyes.** After edits, Arc re-captures the region and judges from fresh pixels; every image a tool feeds the model is mirrored into the chat panel so the human can inspect exactly what the AI saw.

## Extraction: contracts over improvisation

Recognized document families run **named, deterministic parsers** — the model routes and inspects; code emits the rows. Unrecognized families get model-driven extraction under the doctrine rules, always at the document's printed grain, always with provenance (`document → page → row/region`) on every fact. Ground truth is quarantined: saved human-verified annotations are a **validation benchmark only** — extraction never reads the answer key, so passing it means the method generalizes.

## The matching engine

Join evidence is computed by one engine with two implementations locked in parity by test — SQL functions for full-table surveys, a Python reference for row-level checks. Three semantics: exact (trimmed equality), vocabulary (normalized equality), membership (token-set overlap). Surveys run over *all* rows, never samples, and blank-normalizing values never count as matches.

## Deployment

Single-box friendly: FastAPI + Next.js as long-running services, PostgreSQL as the database of record, static marketing page served separately. Local caches exist for offline work; the database is always the source of truth. Nothing lives in one fragile place.
