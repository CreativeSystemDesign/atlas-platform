"""Shared registry of non-extraction data sources + protected tables.

One home (adversarial review 2026-07-20, the ownership-guard finding) so
the Data Map's offered sources and the extraction layer's denylist can
never drift apart: everything here is a REAL table/view the platform owns
that an extraction must NEVER claim as its table_name — ensure/resync
would ALTER it and DELETE-refill it, destroying live data.
"""

from __future__ import annotations

# Curated allowlist of non-extraction sources the Data Map may offer as
# cards. kind drives the card's family color + chip.
EXTRA_SOURCES: dict[str, str] = {
    # the annotation graph projected as SQL views (schematic side of the map)
    "v_schematic_components": "schematic",
    "v_schematic_wires": "schematic",
    "v_schematic_cables": "schematic",
    "gold_cables": "view",
    # deep-agent era PLC spines — real tables, scout evidence until
    # re-extracted under current doctrine (card provenance says so)
    "plc_address_spine_entries": "plc",
    "plc_address_spine_references": "plc",
    "fl_net_interface_entries": "plc",
    # plant history (stock cage + downtime, landed 2026-07-17)
    "stock_machine_parts": "stock",
    "stock_die_parts": "stock",
    "downtime_records": "downtime",
    "downtime_machines": "downtime",
    "downtime_machine": "downtime",
    "downtime_die": "downtime",
    "downtime_indirect": "downtime",
}

# Platform internals an extraction may never claim. Not exhaustive of the
# whole schema (the ownership check covers any other existing table) — this
# is the explicit belt for the crown jewels, held even if an orphaned
# document_extractions row were ever to "own" one of these names.
PROTECTED_TABLES: frozenset[str] = frozenset({
    *EXTRA_SOURCES,
    "projects", "documents", "document_extractions", "document_extraction_rows",
    "document_derivative_jobs", "document_schemas", "schema_relations",
    "relation_boards", "board_placements", "data_map_cards",
    "schematic_v2_graph", "schematic_v2_cable_registry",
    "schematic_v2_continuation_registry", "gold_sealed_annotations",
    "schematic_annotations", "schematic_annotation_snapshots",
    "schematic_yolo_annotations", "schematic_training_annotations",
    "schematic_training_annotation_snapshots", "schematic_page_metadata",
    "schematic_page_text_blocks", "schematic_sheet_index",
    "threads", "runs", "run_events", "assistants", "crons", "settings",
    "langchain_docs",
})
