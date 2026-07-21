---
name: document-processing
description: Guide for processing industrial machine documentation into digital twin data. Use when asked to process documents, extract data from schematics, or build digital twins.
---

# Document Processing Guide

## Document Types
1. **Wiring Schematics** — electrical connection diagrams
2. **Ladder Diagrams** — PLC logic representations
3. **Cable Lists** — wire-to-terminal mapping tables
4. **PLC Programs** — controller logic exports
5. **Parts Lists** — component inventory with part numbers

## Processing Pipeline
1. **Inventory** — list all documents in the target directory
2. **Classify** — determine document type and page structure
3. **Extract** — pull structured data (OCR for images, parse for tables)
4. **Normalize** — standardize naming, resolve cross-references
5. **Verify** — check data consistency, flag gaps
6. **Store** — write verified data to PostgreSQL digital twin tables

## Quality Rules
- Every wire must have two endpoints
- Every terminal must belong to a component
- Cross-references between documents must resolve
- Duplicate entries must be flagged, not silently merged

## Machine the reference machine-1 — document set on disk
All files under this path belong to **one machine**, **the reference machine-1** (not a generic sample pack):

`/home/eshanegross/az_vm/atlas_platform/documents/the reference machine/the reference machine/`

Typical artifacts there include:
- Electrical parts list CSV
- Wire label CSV
- Vacuum cabinet CSV
- machine-cable cabinet CSV
- Schematics, manuals, PLC program PDFs

Future machines would get their own tree (e.g. `documents/<machine-id>/...`).


## Data Extraction Team
When the task is serious PDF extraction, route it through the `data-extraction-supervisor` worker rather than trying to perform every extraction step in the main Architect context. The supervisor owns planning, delegation, reconciliation, and validation; the worker team performs the extraction work.

Specialist workers available under that team:
- `vision-extractor` ? visual interpretation of rendered pages and ambiguous layouts
- `ocr-extractor` ? OCR recovery when the native text layer is missing or noisy
- `table-structure-extractor` ? nested headers, merged cells, continuation rows, and table reconstruction
- `schema-mapper` ? normalize extracted content into canonical structured rows
- `spatial-analysis-agent` ? circuit tracing, continuation symbols, terminals, and page-to-page spatial reasoning

Preferred operating pattern:
1. Inspect the PDF structure first.
2. Choose the extraction workers that match the document class.
3. Delegate the extraction itself to those workers.
4. Reconcile conflicts, preserve evidence, and only then return normalized output.
