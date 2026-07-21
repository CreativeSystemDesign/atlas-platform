---
name: data-extraction-workflow
description: Standard operating workflow for extracting structured data from a single production document. Use when the user asks to extract data from a PDF, schematic, parts list, cable list, or table-heavy machine document.
---

# Data Extraction Workflow

Use this workflow when the user asks Architect to extract data from a single production document.

## Ownership Model
- Architect identifies extraction intent and owns the operator relationship.
- Architect identifies the target file and delegates the mission.
- `data-extraction-supervisor` owns the extraction mission.
- The supervisor inspects, chooses the appropriate specialist worker, delegates, reconciles, and returns the extracted artifact.
- The worker team performs extraction-heavy work.

## Required Path
1. Architect recognizes that the request is data extraction work.
2. Architect identifies the target file path. If the request is ambiguous, Architect may do one narrow document lookup only to resolve the file path.
3. Architect calls `prepare_data_extraction_workflow(...)` to build a standard mission brief.
4. Architect delegates that brief to `data-extraction-supervisor` via `task`.
5. The supervisor inspects first.
6. The supervisor chooses and delegates to the appropriate extraction worker(s).
7. The supervisor reconciles the extraction result and returns the extracted artifact.
8. Architect returns one final operator-facing extraction answer with the artifact location.
9. If validation is requested later, Architect initiates that as a separate follow-up phase only after the extraction artifact exists.

## Worker Selection Guide
- `table-structure-extractor`
  Use for parts lists, cable lists, parameter sheets, and complex tables.
- `ocr-extractor`
  Use when the text layer is missing, noisy, or clearly incomplete.
- `vision-extractor`
  Use when visual layout, labels, mixed language regions, or rendered page evidence matter.
- `schema-mapper`
  Use when raw extracted output needs normalization into canonical rows or CSV-ready structure.
- `spatial-analysis-agent`
  Use when tracing terminals, wires, page continuations, or diagram connectivity.

Named production extraction contracts override generic document-family behavior:
- Electrical parts list extraction is a table contract. The supervisor should route to `table-structure-extractor`, and the worker should prefer `parse_electrical_parts_list` with `output_contract='row_preserving'` unless the operator explicitly asks for expanded per-symbol output.
- Cable list extraction is a wire-link contract. The supervisor should route to `table-structure-extractor`, and the worker should prefer `parse_cable_list` with `output_contract='wire_labels'` unless the operator explicitly asks for a fuller row-preserving table export.
- Schematic Spine Slice 0 extraction is a vector-geometry component detection contract, not a generic schematic table/connection extraction. The supervisor should route to `spatial-analysis-agent`, and the worker must call `detect_schematic_spine_slice0` for the ELB 3 Phase `vector_sequence_fingerprint_v1` detection.

## Guardrails
- Architect must not perform direct extraction-heavy PDF work itself.
- Architect should not emit conversational preambles such as "I'll read the workflow" or "I'll extract the data".
- After the operator prompt, Architect-visible text should be limited to delegation/status updates and the final artifact result.
- Architect should describe extraction work as delegation: "delegating extraction to data-extraction-supervisor" or "extraction complete", not "I will extract the data".
- Architect must not choose extraction specialists; that is the supervisor's job.
- Architect should not read this workflow skill at runtime before delegation when the task is already clearly an extraction request.
- If the operator provides an exact source PDF path for a named production extraction, Architect should use that path directly and should not list the document library first.
- Unless the operator explicitly supplied a destination under the Atlas extraction output root, Architect should omit `output_path` when calling `prepare_data_extraction_workflow`.
- The `Write output to:` path returned by `prepare_data_extraction_workflow` is canonical. Architect must delegate that brief without replacing the path, and workers must not copy or mirror the artifact into the source PDF folder.
- For Schematic Spine Slice 0, Architect must preserve the named extraction exactly. Do not broaden it into wire extraction, terminal extraction, connection matrices, all schematic data, or CSV output.
- For Schematic Spine Slice 0, call `prepare_data_extraction_workflow(...)` with no `output_path`. The `detect_schematic_spine_slice0` tool owns its output directory and returns `artifact_json`, `canonical_render`, `reconstruction_overlay`, `component_marks_overlay`, `component_boxes_overlay`, `reference_candidates_overlay`, `terminal_nodes_overlay`, `terminal_wire_overlay`, `reference_wire_overlay`, `graphic_atoms_overlay`, `wire_segments_overlay`, `wire_trace_overlay`, `wire_paths_overlay`, `wire_endpoints_overlay`, `clean_validation_overlay`, `wire_object_associations_overlay`, `wire_interactions_overlay`, `text_associations_overlay`, `validation_overlay`, `evidence_overlay`, and `component_box_review_summary`.
- The schematic reference, terminal-node, terminal-to-wire, reference-to-wire, wire, wire-path, wire-object association, interaction, and text-association outputs are page-local evidence candidates for visual validation. They are not final connectivity, terminal maps, netlists, or component truth until a later validation gate promotes them.
- The supervisor should not personally do extraction-heavy work when a worker is appropriate.
- Worker assignments should be visible in transcript and timeline.
- The final answer should come from Architect, not a worker.
- validation-analyst should return structured findings to data-extraction-supervisor, not an operator-facing final report.
- validation-analyst should return the deterministic validation tool payload with minimal wrapping; if the tool fails or returns empty output, it should fail clearly instead of improvising a narrative.
- data-extraction-supervisor should return one reconciled mission package to Architect, not a second operator-facing final report.
- During validation missions, Architect should not preview extracted CSV contents and data-extraction-supervisor should not perform validation work itself.
- If validation-analyst fails or returns empty output, data-extraction-supervisor should surface that failure upward and stop rather than self-rescuing into manual validation.
- If validation is requested, the validation file is a reference only, never the extraction source.
- In production, validation should be performed against the source PDF visually/structurally; reference CSVs are development aids only.
- During the extraction phase, the validation CSV must not be opened, previewed, or used to derive schema, columns, or row structure.
- Architect should withhold the validation CSV path from the supervisor and worker team until extraction output exists.

## Standard Outputs
When applicable, the final answer should include:
- output path
- extracted row count
- downloadable artifact link
- any confidence or review warnings

For Schematic Spine Slice 0, the final answer should include:
- artifact JSON path
- canonical render path
- reconstruction overlay path
- component marks overlay path
- component boxes overlay path
- reference candidates overlay path
- terminal nodes overlay path
- terminal-to-wire overlay path
- reference-to-wire overlay path
- graphic atoms overlay path
- wire segments overlay path
- wire trace overlay path
- wire path overlay path
- wire endpoints overlay path
- wire endpoint-to-object association overlay path
- wire interactions overlay path
- text associations overlay path
- validation overlay path
- combined evidence overlay path
- text anchor count
- component mark count
- component box count
- component box visual review flag count
- reference candidate count
- terminal node count
- terminal-to-wire association count
- reference-to-wire association count
- graphic atom count
- wire segment count
- wire trace count
- wire path count
- wire endpoint count
- wire endpoint-to-object association count
- wire interaction count
- text association count
- detection count
- `bbox_px`
- `bbox_pdf`
- score
- source seqnos
- whether annotation candidate boxes were used
