"""Neon PostgreSQL connection pool and schema initialization."""

from __future__ import annotations

import asyncio
import sys

from psycopg_pool import AsyncConnectionPool

from src.config import settings

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

_pool: AsyncConnectionPool | None = None
_schema_ready = False
_schema_lock: asyncio.Lock | None = None

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS projects (
    project_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assistants (
    assistant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    graph_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Untitled',
    description TEXT,
    config JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS threads (
    thread_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(project_id),
    metadata JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'idle',
    operational_state TEXT NOT NULL DEFAULT 'inactive',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(project_id),
    thread_id UUID NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
    assistant_id UUID REFERENCES assistants(assistant_id),
    status TEXT NOT NULL DEFAULT 'pending',
    metadata JSONB NOT NULL DEFAULT '{}',
    kwargs JSONB NOT NULL DEFAULT '{}',
    multitask_strategy TEXT NOT NULL DEFAULT 'enqueue',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_events (
    event_id BIGSERIAL PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
    event_name TEXT NOT NULL,
    actor_id TEXT,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crons (
    cron_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID REFERENCES threads(thread_id) ON DELETE CASCADE,
    assistant_id UUID REFERENCES assistants(assistant_id),
    schedule TEXT NOT NULL,
    input JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS langchain_docs (
    id BIGSERIAL PRIMARY KEY,
    corpus_name TEXT NOT NULL DEFAULT 'langchain_docs',
    source_url TEXT,
    file_path TEXT NOT NULL,
    doc_section TEXT NOT NULL,
    content TEXT NOT NULL,
    content_sha256 TEXT NOT NULL UNIQUE,
    embedding_model TEXT NOT NULL,
    embedding_dims INTEGER NOT NULL,
    embedding DOUBLE PRECISION[] NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_extractions (
    extraction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(project_id),
    extraction_kind TEXT NOT NULL,
    source_pdf_path TEXT NOT NULL,
    output_contract TEXT NOT NULL DEFAULT 'expanded',
    row_count INTEGER NOT NULL DEFAULT 0,
    fieldnames JSONB NOT NULL DEFAULT '[]',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_extraction_rows (
    extraction_row_id BIGSERIAL PRIMARY KEY,
    extraction_id UUID NOT NULL REFERENCES document_extractions(extraction_id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,
    source_page INTEGER,
    row_number TEXT,
    location TEXT,
    symbol_text TEXT,
    description TEXT,
    part_number TEXT,
    quantity TEXT,
    row_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schematic_page_metadata (
    metadata_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    page_num INTEGER NOT NULL,
    scale DOUBLE PRECISION NOT NULL,
    pdf_width DOUBLE PRECISION,
    pdf_height DOUBLE PRECISION,
    display_size JSONB,
    shapes JSONB NOT NULL DEFAULT '[]',
    text_blocks JSONB NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, document_id, page_num)
);

-- Canonical per-page record (2026-07-08, Shane's directive): the ONE table all
-- app logic reads a page's identity from. Aggregates the TOC-derived titles
-- (parsed from schematic pages 4-6, the drawing's own table of contents) with
-- the geometry/provenance that used to live only in schematic_page_metadata.
-- Row-per-block text stays in schematic_page_text_blocks (correct normalization)
-- but is served THROUGH this record's endpoint so callers have one door.
-- title_source records where the title came from: 'toc' | 'title_block' | 'both'.
CREATE TABLE IF NOT EXISTS schematic_sheet_index (
    sheet_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    page_num INTEGER NOT NULL,
    -- Titles (bilingual; the drawing is English + Japanese).
    title_en TEXT,
    title_ja TEXT,
    section TEXT,                       -- coarse grouping if derivable (e.g. "MAIN", "PLC")
    sheet_ref TEXT,                     -- printed sheet ref, e.g. "7/207"
    drawing_number TEXT,                -- title-block DWG NO., e.g. "<drawing-no>"
    -- Geometry passthrough (so this record answers page-size questions too).
    scale DOUBLE PRECISION,
    pdf_width DOUBLE PRECISION,
    pdf_height DOUBLE PRECISION,
    display_size JSONB,
    -- Provenance + extensibility.
    title_source TEXT NOT NULL DEFAULT 'toc',
    source_hash TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, document_id, page_num)
);

CREATE TABLE IF NOT EXISTS schematic_page_text_blocks (
    text_block_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    page_num INTEGER NOT NULL,
    block_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    normalized_text TEXT NOT NULL DEFAULT '',
    bbox_pdf JSONB NOT NULL,
    bbox_px JSONB NOT NULL,
    source TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, document_id, page_num, block_index)
);

CREATE TABLE IF NOT EXISTS schematic_annotations (
    annotation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    page_num INTEGER NOT NULL,
    client_annotation_id TEXT NOT NULL,
    annotation_type TEXT NOT NULL DEFAULT 'component',
    label TEXT NOT NULL,
    family TEXT,
    bbox JSONB NOT NULL,
    label_bbox JSONB,
    label_source TEXT,
    label_candidate_index INTEGER NOT NULL DEFAULT -1,
    label_candidates JSONB NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'human',
    snapped BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, document_id, page_num, client_annotation_id)
);

CREATE TABLE IF NOT EXISTS schematic_training_annotations (
    annotation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    page_num INTEGER NOT NULL,
    client_annotation_id TEXT NOT NULL,
    annotation_type TEXT NOT NULL DEFAULT 'component',
    label TEXT NOT NULL,
    family TEXT,
    bbox JSONB NOT NULL,
    label_bbox JSONB,
    label_source TEXT,
    label_candidate_index INTEGER NOT NULL DEFAULT -1,
    label_candidates JSONB NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'human',
    snapped BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, document_id, page_num, client_annotation_id)
);

CREATE TABLE IF NOT EXISTS schematic_yolo_annotations (
    annotation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    page_num INTEGER NOT NULL,
    client_annotation_id TEXT NOT NULL,
    annotation_type TEXT NOT NULL DEFAULT 'component',
    label TEXT NOT NULL,
    family TEXT,
    bbox JSONB NOT NULL,
    label_bbox JSONB,
    label_source TEXT,
    label_candidate_index INTEGER NOT NULL DEFAULT -1,
    label_candidates JSONB NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'human',
    snapped BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, document_id, page_num, client_annotation_id)
);

CREATE TABLE IF NOT EXISTS yolocolab (
    annotation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    page_num INTEGER NOT NULL,
    client_annotation_id TEXT NOT NULL,
    annotation_type TEXT NOT NULL DEFAULT 'component',
    label TEXT NOT NULL,
    family TEXT,
    bbox JSONB NOT NULL,
    label_bbox JSONB,
    label_source TEXT,
    label_candidate_index INTEGER NOT NULL DEFAULT -1,
    label_candidates JSONB NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'human',
    snapped BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, document_id, page_num, client_annotation_id)
);

INSERT INTO yolocolab (
    annotation_id,
    project_id,
    document_id,
    page_num,
    client_annotation_id,
    annotation_type,
    label,
    family,
    bbox,
    label_bbox,
    label_source,
    label_candidate_index,
    label_candidates,
    source,
    snapped,
    metadata,
    created_at,
    updated_at
)
SELECT
    annotation_id,
    project_id,
    document_id,
    page_num,
    client_annotation_id,
    annotation_type,
    label,
    family,
    bbox,
    label_bbox,
    label_source,
    label_candidate_index,
    label_candidates,
    source,
    snapped,
    metadata,
    created_at,
    updated_at
FROM schematic_yolo_annotations
WHERE source = 'ai-proposal'
ON CONFLICT (project_id, document_id, page_num, client_annotation_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS schematic_annotation_snapshots (
    snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    page_num INTEGER NOT NULL,
    name TEXT NOT NULL,
    notes TEXT,
    annotations JSONB NOT NULL DEFAULT '[]',
    annotation_count INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'operator',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, document_id, page_num, name)
);

CREATE TABLE IF NOT EXISTS schematic_v2_graph (
    graph_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    page_num INTEGER NOT NULL,
    nodes JSONB NOT NULL DEFAULT '[]',
    ports JSONB NOT NULL DEFAULT '[]',
    edges JSONB NOT NULL DEFAULT '[]',
    continuations JSONB NOT NULL DEFAULT '[]',
    grounds JSONB NOT NULL DEFAULT '[]',
    node_count INTEGER NOT NULL DEFAULT 0,
    port_count INTEGER NOT NULL DEFAULT 0,
    edge_count INTEGER NOT NULL DEFAULT 0,
    continuation_count INTEGER NOT NULL DEFAULT 0,
    ground_count INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'human',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, document_id, page_num)
);

-- certification-sealed annotation snapshots (Shane, 2026-07-08): APPEND-ONLY archive of
-- every page graph at the moment Shane seals it as a gold master. No code path
-- updates or deletes rows here — re-seals mint a new version. checksum is the
-- SHA-256 of the canonical graph JSON (tamper-evidence + drift tripwire).
CREATE TABLE IF NOT EXISTS gold_sealed_annotations (
    seal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    page_num INTEGER NOT NULL,
    version INTEGER NOT NULL,
    provenance TEXT NOT NULL DEFAULT '',
    graph JSONB NOT NULL,
    counts JSONB NOT NULL DEFAULT '{}',
    checksum TEXT NOT NULL,
    sealed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, document_id, page_num, version)
);

CREATE TABLE IF NOT EXISTS vision_training_runs (
    training_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    trainer TEXT NOT NULL DEFAULT 'qwen3vl',
    model_id TEXT,
    dataset_kind TEXT NOT NULL DEFAULT 'schematic_component_grounding',
    annotation_mode TEXT NOT NULL DEFAULT 'training_dataset',
    class_filter TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'created',
    phase TEXT NOT NULL DEFAULT 'created',
    display_name TEXT NOT NULL,
    region TEXT NOT NULL,
    runtime_template TEXT NOT NULL,
    gcs_bucket TEXT NOT NULL,
    gcs_prefix TEXT NOT NULL,
    dataset_uri TEXT,
    notebook_uri TEXT,
    output_uri TEXT,
    execution_name TEXT,
    execution_id TEXT,
    user_email TEXT,
    service_account TEXT,
    stdout TEXT,
    stderr TEXT,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    execution_payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS architect_memory_backups (
    namespace TEXT[] NOT NULL,
    key TEXT NOT NULL,
    value JSONB NOT NULL DEFAULT '{}',
    redis_updated_at TIMESTAMPTZ,
    snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source TEXT NOT NULL,
    checksum TEXT NOT NULL,
    PRIMARY KEY (namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_runs_thread_id ON runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_run_events_thread_id ON run_events(thread_id, event_id);
CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id, event_id);
CREATE INDEX IF NOT EXISTS idx_crons_thread_id ON crons(thread_id);
CREATE INDEX IF NOT EXISTS idx_langchain_docs_file_path ON langchain_docs(file_path);
CREATE INDEX IF NOT EXISTS idx_langchain_docs_corpus_name ON langchain_docs(corpus_name);
CREATE INDEX IF NOT EXISTS idx_document_extractions_kind
    ON document_extractions(extraction_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_extractions_source_pdf_path
    ON document_extractions(source_pdf_path);
CREATE INDEX IF NOT EXISTS idx_document_extraction_rows_extraction_id
    ON document_extraction_rows(extraction_id, row_index);
CREATE INDEX IF NOT EXISTS idx_document_extraction_rows_lookup
    ON document_extraction_rows(location, symbol_text, part_number);
CREATE INDEX IF NOT EXISTS idx_schematic_page_metadata_page
    ON schematic_page_metadata(project_id, document_id, page_num);
CREATE INDEX IF NOT EXISTS idx_schematic_page_text_blocks_page
    ON schematic_page_text_blocks(project_id, document_id, page_num, block_index);
CREATE INDEX IF NOT EXISTS idx_schematic_page_text_blocks_normalized
    ON schematic_page_text_blocks(project_id, document_id, normalized_text);
CREATE INDEX IF NOT EXISTS idx_schematic_annotations_page
    ON schematic_annotations(project_id, document_id, page_num, annotation_type);
CREATE INDEX IF NOT EXISTS idx_schematic_annotations_label
    ON schematic_annotations(project_id, document_id, label);
CREATE INDEX IF NOT EXISTS idx_schematic_training_annotations_page
    ON schematic_training_annotations(project_id, document_id, page_num, annotation_type);
CREATE INDEX IF NOT EXISTS idx_schematic_training_annotations_label
    ON schematic_training_annotations(project_id, document_id, label);
CREATE INDEX IF NOT EXISTS idx_schematic_yolo_annotations_page
    ON schematic_yolo_annotations(project_id, document_id, page_num, annotation_type);
CREATE INDEX IF NOT EXISTS idx_schematic_yolo_annotations_label
    ON schematic_yolo_annotations(project_id, document_id, label);
CREATE INDEX IF NOT EXISTS idx_yolocolab_page
    ON yolocolab(project_id, document_id, page_num, annotation_type);
CREATE INDEX IF NOT EXISTS idx_yolocolab_label
    ON yolocolab(project_id, document_id, label);
CREATE INDEX IF NOT EXISTS idx_schematic_annotation_snapshots_page
    ON schematic_annotation_snapshots(project_id, document_id, page_num, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schematic_v2_graph_page
    ON schematic_v2_graph(project_id, document_id, page_num);
CREATE INDEX IF NOT EXISTS idx_vision_training_runs_project
    ON vision_training_runs(project_id, document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vision_training_runs_status
    ON vision_training_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vision_training_runs_trainer
    ON vision_training_runs(trainer, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_architect_memory_backups_snapshot
    ON architect_memory_backups(snapshotted_at DESC);

-- === Platform Graduation phase 2 (2026-07-13) ================================

-- R2: machine families — the schema home for fleet-truth. The manufacturer-
-- legend tier and per-domain audit rule packs scope to FAMILY, not project;
-- two identical machines share a family, each keeps its own machine-truth.
CREATE TABLE IF NOT EXISTS machine_families (
    family_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer TEXT NOT NULL,
    model TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (manufacturer, model)
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES machine_families(family_id);

-- R1: the documents authority table. The PK IS the existing human-readable
-- slug (e.g. 'schematic_<drawing-no>') — the nine dependent TEXT
-- document_id columns keep working unmigrated, and append-only certification-seal
-- identity is untouched. THE SLUG IS IMMUTABLE AFTER INTAKE (normalized_name
-- is display metadata, never identity — the seal-rename invariant, by
-- construction). Note: the routing map deliberately does NOT live here —
-- R11 rules lane/lane_source columns on schematic_sheet_index as the single
-- per-page store (ranges computed on read, never stored).
CREATE TABLE IF NOT EXISTS documents (
    document_id TEXT PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    normalized_name TEXT,
    original_name TEXT,
    content_sha256 TEXT,
    classification TEXT,
    status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('gated','processing','needs_attention','rejected','available','soft_deleted')),
    original_path TEXT,
    working_path TEXT,
    revision_label TEXT,
    supersedes_document_id TEXT REFERENCES documents(document_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id, created_at DESC);

-- Classification pass (task #21 item 1): Arc proposes, Shane confirms.
-- classification_state tracks whose word the current classification is;
-- 'needs-shane' = Arc's confidence was too low to even propose quietly.
-- classification_detail carries the proposal provenance (confidence, notes,
-- model, problems) — display + audit, never identity.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS classification_state TEXT
    CHECK (classification_state IN ('arc-proposed','needs-shane','shane-confirmed'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS classification_detail JSONB;

-- Capability #1, the intake SKIM (Shane green-lit 2026-07-13): normalized
-- name + a short description, proposed by Arc from the first pages —
-- provenance-tracked like everything else. source_path/source_label answer
-- "where did this file come from" (docs gathered from all over; the browser
-- yields folder-relative paths, the batch label carries the real-world
-- origin). Neon is the metadata truth; the working copy is a stamped
-- projection of it (working_path).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_path TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_label TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS skim_state TEXT
    CHECK (skim_state IN ('arc-proposed','needs-shane','shane-confirmed'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS skim_detail JSONB;

-- R11: routing map — lane + provenance per page, ON the canonical per-page
-- record (Shane's 2026-07-08 one-table ruling). Contiguous equal-lane runs
-- ARE the ranges, computed on read.
ALTER TABLE schematic_sheet_index ADD COLUMN IF NOT EXISTS lane TEXT
    CHECK (lane IN ('schematic-canvas','table-extract','legend-mine','toc-parse','reference-only','spare'));
ALTER TABLE schematic_sheet_index ADD COLUMN IF NOT EXISTS lane_source TEXT
    CHECK (lane_source IN ('arc-proposed','shane-confirmed'));

-- R14: the intake worker's job ledger. Job state lives in Neon (source of
-- truth) so it survives worker restarts; the worker polls, claims, and
-- reports here — the copilot server process NEVER renders (the 1012-drop
-- stability constraint). Boot recovery mirrors the proven runs/threads
-- busy-reset pattern: a 'running' job found at worker start flips back to
-- 'queued' for resume (stages are idempotent, keyed on content).
CREATE TABLE IF NOT EXISTS document_derivative_jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('vector-dump','master-png','workspace-png')),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','completed','failed')),
    pages_total INTEGER,
    pages_done INTEGER NOT NULL DEFAULT 0,
    params JSONB NOT NULL DEFAULT '{}',
    error_detail TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_derivative_jobs_poll
    ON document_derivative_jobs(status, created_at);

-- Schema-Builder (Shane's EER vision, 2026-07-13): the collaborative data
-- contract per TABLE-within-document — what the data IS, defined before any
-- parser exists. These become the cards on the Relations canvas; drawn
-- field-to-field relations become the join contracts reconciliation tests.
CREATE TABLE IF NOT EXISTS document_schemas (
    schema_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    page_from INTEGER,
    page_to INTEGER,
    fields JSONB NOT NULL DEFAULT '[]',   -- [{name, type, description, example}]
    sample_rows JSONB NOT NULL DEFAULT '[]',  -- a few hand-typed rows: schema
                                              -- stress-test + future parser fixtures
    notes TEXT,
    canvas_pos JSONB,                      -- Relations-canvas placement {x, y}
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, document_id, table_name)
);
CREATE INDEX IF NOT EXISTS idx_document_schemas_project
    ON document_schemas(project_id, document_id);
ALTER TABLE document_schemas ADD COLUMN IF NOT EXISTS sample_rows JSONB NOT NULL DEFAULT '[]';

-- Relations board (Shane's EER vision, MVP 2026-07-14): one row = one join
-- contract between two schema fields. Arc's bench seam flags seed rows with
-- status 'proposed' (dashed edges); Shane drawing/accepting makes them
-- 'drawn'; match_num/den = the last DISTINCT-overlap survey (the live badge).
CREATE TABLE IF NOT EXISTS schema_relations (
    relation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    from_document_id TEXT NOT NULL,
    from_table TEXT NOT NULL,
    from_field TEXT NOT NULL,
    to_document_id TEXT NOT NULL,
    to_table TEXT NOT NULL,
    to_field TEXT NOT NULL,
    semantics TEXT NOT NULL DEFAULT 'exact'
        CHECK (semantics IN ('exact', 'membership', 'vocabulary')),
    status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'drawn', 'dismissed')),
    origin TEXT NOT NULL DEFAULT 'shane',      -- 'arc-flag' | 'shane'
    basis TEXT,                                -- the seam-flag prose behind a proposal
    notes TEXT,
    match_num INTEGER,
    match_den INTEGER,
    matched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, from_document_id, from_table, from_field,
            to_document_id, to_table, to_field)
);
CREATE INDEX IF NOT EXISTS idx_schema_relations_project
    ON schema_relations(project_id);

-- Named relation boards (Shane's ask, 2026-07-14): a board is a saved VIEW
-- over the global schema family — it owns its CARD PLACEMENTS and its JOIN
-- CONTRACTS, never the tables. The default board ("Main") lazily adopts
-- everything that predates boards (see relations_data.ensure_default_board);
-- Arc's proposals materialize only where seed_arc. Deleting a board deletes
-- the view (placements + relations cascade), never a schema.
CREATE TABLE IF NOT EXISTS relation_boards (
    board_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    seed_arc BOOLEAN NOT NULL DEFAULT false,
    settings JSONB NOT NULL DEFAULT '{}',      -- {hide_unplaced: bool}
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_relation_boards_default
    ON relation_boards(project_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS board_placements (
    board_id UUID NOT NULL REFERENCES relation_boards(board_id) ON DELETE CASCADE,
    schema_id UUID NOT NULL REFERENCES document_schemas(schema_id) ON DELETE CASCADE,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    collapsed BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (board_id, schema_id)
);

ALTER TABLE schema_relations ADD COLUMN IF NOT EXISTS board_id UUID
    REFERENCES relation_boards(board_id) ON DELETE CASCADE;
-- Contracts are unique PER BOARD now; the pre-boards project-wide UNIQUE
-- (auto-named at creation) is retired by lookup, then replaced with a
-- board-scoped unique index (the seeder's ON CONFLICT target).
DO $$
DECLARE c TEXT;
BEGIN
    SELECT conname INTO c FROM pg_constraint
    WHERE conrelid = 'schema_relations'::regclass AND contype = 'u'
      AND NOT (conkey @> ARRAY[(
          SELECT attnum FROM pg_attribute
          WHERE attrelid = 'schema_relations'::regclass
            AND attname = 'board_id')]);
    IF c IS NOT NULL THEN
        EXECUTE format('ALTER TABLE schema_relations DROP CONSTRAINT %I', c);
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_schema_relations_board_tuple
    ON schema_relations(board_id, from_document_id, from_table, from_field,
                        to_document_id, to_table, to_field);
CREATE INDEX IF NOT EXISTS idx_schema_relations_board
    ON schema_relations(board_id);

-- Data Map (remodel 2026-07-20, Shane's ruling): a card is a PLACEMENT of a
-- real Postgres table/view on a board plus curated prose. Cards store NO
-- schema — columns, row counts, and status derive live from the catalog at
-- read time, so a card can never disagree with its table (the drift class of
-- bug made impossible rather than fixed). Supersedes document_schemas +
-- board_placements (archived: neon_archived/card_layer_pre_datamap__*).
CREATE TABLE IF NOT EXISTS data_map_cards (
    board_id UUID NOT NULL REFERENCES relation_boards(board_id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    table_name TEXT NOT NULL,
    x DOUBLE PRECISION NOT NULL DEFAULT 0,
    y DOUBLE PRECISION NOT NULL DEFAULT 0,
    collapsed BOOLEAN NOT NULL DEFAULT false,
    description TEXT,                          -- curated card prose
    field_notes JSONB NOT NULL DEFAULT '{}',   -- {column_name: note}
    provenance TEXT,                           -- e.g. deep-agent scout-evidence flag
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (board_id, table_name)
);
CREATE INDEX IF NOT EXISTS idx_data_map_cards_project
    ON data_map_cards(project_id);

-- atlas_norm / atlas_tokens_norm: THE matching normalization, mirrored from
-- relations_data._norm/_tokens (full-width -> ASCII, upper, strip parens and
-- whitespace; membership token split). One engine, three consumers: match
-- surveys, the Proving Bench stitch, the future twin compiler. The Python
-- and SQL forms must stay behavior-identical — parity test in tests/.
-- atlas_trim mirrors Python str.strip(): [[:space:]] covers NBSP/U+3000/
-- tab/newline where btrim would strip ASCII space only (parity review
-- 2026-07-20). The 0x1c-0x1f range = the C0 separators Python whitespace
-- regexes also eat (embedded below as literal control characters).
CREATE OR REPLACE FUNCTION atlas_trim(v TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
    SELECT regexp_replace(coalesce(v, ''),
        '^[[:space:]-]+|[[:space:]-]+$', '', 'g')
$fn$;
-- (the strip classes below carry the 0x1c-0x1f C0 separators as literal
-- characters, because Python str.strip()/whitespace regexes eat them and
-- Postgres [:space:] does not)
CREATE OR REPLACE FUNCTION atlas_norm(v TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
    SELECT regexp_replace(
        upper(translate(coalesce(v, ''),
            'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ０１２３４５６７８９－',
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-')),
        '[()（）[:space:]\x1c-\x1f]+', '', 'g')
$fn$;
CREATE OR REPLACE FUNCTION atlas_tokens_norm(v TEXT) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
    SELECT coalesce(array_agg(atlas_norm(t)), '{}')
    FROM regexp_split_to_table(atlas_trim(v), '[,、;/[:space:]\x1c-\x1f]+') t
    WHERE atlas_norm(t) <> ''
$fn$;

-- Schematic SQL views: the annotation graph projected as queryable columns,
-- so the schematic side of the Data Map is table-backed like everything else
-- (cards, peek, surveys, and the Proving Bench all light up generically).
-- project_id scoping is load-bearing (multi-tenant future); "Certified"
-- badges rows by certification-seal presence — the graph mixes sealed pages (7-15)
-- with drawn-but-unsealed ones (page 16), and honesty requires the flag.
CREATE OR REPLACE VIEW v_schematic_components AS
SELECT g.project_id, g.document_id,
       g.page_num                          AS "PageNum",
       n->>'label'                         AS "Mark",
       n->'identity'->>'location'          AS "Location",
       n->'identity'->>'partNumber'        AS "PartNumber",
       n->'identity'->>'family'            AS "Family",
       n->'identity'->>'description'       AS "Description",
       n->>'id'                            AS "NodeId",
       EXISTS (SELECT 1 FROM gold_sealed_annotations s
               WHERE s.project_id = g.project_id
                 AND s.document_id = g.document_id
                 AND s.page_num = g.page_num) AS "Certified"
FROM schematic_v2_graph g, jsonb_array_elements(g.nodes) n
WHERE n->>'type' = 'component';

CREATE OR REPLACE VIEW v_schematic_wires AS
SELECT g.project_id, g.document_id,
       g.page_num                          AS "PageNum",
       e->>'label'                         AS "WireLabel",
       e->>'sourcePortId'                  AS "SourcePortId",
       e->>'targetPortId'                  AS "TargetPortId",
       e->>'id'                            AS "EdgeId",
       EXISTS (SELECT 1 FROM gold_sealed_annotations s
               WHERE s.project_id = g.project_id
                 AND s.document_id = g.document_id
                 AND s.page_num = g.page_num) AS "Certified"
FROM schematic_v2_graph g, jsonb_array_elements(g.edges) e;

-- The cable registry is created HERE (not in the post-SCHEMA_SQL executes
-- where it historically lived) because the view below references it — on a
-- fresh database the whole SCHEMA_SQL transaction would abort otherwise
-- (adversarial review 2026-07-20, verified on throwaway postgres).
CREATE TABLE IF NOT EXISTS schematic_v2_cable_registry (
    registry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    cables JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, document_id)
);

CREATE OR REPLACE VIEW v_schematic_cables AS
SELECT r.project_id, r.document_id,
       c.key                               AS "CableLabel",
       c.value->>'partNumber'              AS "PartNumber",
       (SELECT string_agg(DISTINCT cond->>'net', ', ')
        FROM jsonb_array_elements(c.value->'conductors') cond)   AS "ConductorNets",
       (SELECT string_agg(p, ', ')
        FROM jsonb_array_elements_text(c.value->'pages') p)      AS "Pages"
FROM schematic_v2_cable_registry r, jsonb_each(r.cables) c;

-- 'classify' joined the job vocabulary after the table shipped; CREATE TABLE
-- IF NOT EXISTS never updates a live CHECK, so the constraint is re-minted
-- idempotently on every boot.
ALTER TABLE document_derivative_jobs DROP CONSTRAINT IF EXISTS document_derivative_jobs_kind_check;
ALTER TABLE document_derivative_jobs ADD CONSTRAINT document_derivative_jobs_kind_check
    CHECK (kind IN ('vector-dump','master-png','workspace-png','classify',
                    'skim','working-copy'));
"""


def _schema_init_lock() -> asyncio.Lock:
    global _schema_lock
    if _schema_lock is None:
        _schema_lock = asyncio.Lock()
    return _schema_lock


async def _pin_search_path(conn) -> None:
    """Neon's POOLED endpoint (pgbouncer) can hand out server sessions whose
    session-level SET state leaked from another client — observed 2026-07-14,
    when a stray `SET search_path` from an unrelated session made healthy
    tables vanish for every fresh connection ("relation does not exist",
    "no schema has been selected to create in") while the data sat untouched.

    Honest contract (adversarial review, 2026-07-14): wired as BOTH
    `configure` (new physical connection) and `reset` (every checkin), this
    re-pins at connection birth and between every borrow — NOT per
    transaction. Under transaction pooling a backend-session swap mid-
    checkout stays theoretically exposed; full immunity needs the unpooled
    endpoint or per-transaction SET LOCAL (as init_schema does for boot).
    This is defense-in-depth against a now-forbidden failure class, not a
    guarantee."""
    await conn.execute('SET search_path TO "$user", public')
    await conn.commit()


async def get_pool(*, ensure_schema: bool = True) -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(
            conninfo=settings.database_uri,
            min_size=0,
            max_size=20,
            open=False,
            check=AsyncConnectionPool.check_connection,
            configure=_pin_search_path,
            reset=_pin_search_path,
        )
        await _pool.open()
    if ensure_schema:
        await ensure_schema_initialized()
    return _pool


async def ensure_schema_initialized() -> None:
    global _schema_ready
    if _schema_ready:
        return
    async with _schema_init_lock():
        if _schema_ready:
            return
        await init_schema()
        _schema_ready = True


async def init_schema() -> None:
    pool = await get_pool(ensure_schema=False)
    async with pool.connection() as conn:
        # Cross-PROCESS serialization: the server, the intake worker, and ops
        # scripts all run SCHEMA_SQL at boot. The asyncio lock only guards
        # within one process; two processes booting together deadlock on the
        # ALTER TABLE locks (observed 2026-07-13). Transaction-scoped so it
        # auto-releases at this block's commit — a session-scoped lock would
        # ride the pooled connection back into reuse.
        await conn.execute("SELECT pg_advisory_xact_lock(806650)")
        # SET LOCAL rides the SAME transaction (and therefore the same
        # pgbouncer server session) as SCHEMA_SQL — schema init is immune
        # to leaked search_path state no matter what the pool inherited.
        await conn.execute("SET LOCAL search_path TO public")
        await conn.execute(SCHEMA_SQL)
        await conn.execute(
            """
            INSERT INTO projects (project_id, machine_id, display_name, slug, metadata)
            VALUES (
                '00000000-0000-4000-8000-000000001650',
                'the reference machine-1',
                'the reference machine',
                'the reference machine-1',
                jsonb_build_object(
                    'source',
                    'bootstrap',
                    'description',
                    'Default project for existing machine the reference machine development data'
                )
            )
            ON CONFLICT (project_id) DO UPDATE SET
                machine_id = EXCLUDED.machine_id,
                display_name = EXCLUDED.display_name,
                slug = EXCLUDED.slug,
                updated_at = now()
            """
        )
        await conn.execute(
            """
            ALTER TABLE threads
            ADD COLUMN IF NOT EXISTS operational_state TEXT NOT NULL DEFAULT 'inactive'
            """
        )
        # Cables (Shane's design, 2026-07-10): per-page drawn cable elements
        # ride the page graph; the document-level conductor roster lives in
        # its own registry table (same name on any page = the same cable).
        await conn.execute(
            """
            ALTER TABLE schematic_v2_graph
            ADD COLUMN IF NOT EXISTS cables JSONB NOT NULL DEFAULT '[]'
            """
        )
        await conn.execute(
            """
            ALTER TABLE schematic_v2_graph
            ADD COLUMN IF NOT EXISTS cable_count INTEGER NOT NULL DEFAULT 0
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schematic_v2_cable_registry (
                registry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                document_id TEXT NOT NULL,
                cables JSONB NOT NULL DEFAULT '{}',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (project_id, document_id)
            )
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schematic_v2_continuation_registry (
                registry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                document_id TEXT NOT NULL,
                pages JSONB NOT NULL DEFAULT '{}',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (project_id, document_id)
            )
            """
        )
        await conn.execute(
            """
            ALTER TABLE threads
            ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(project_id)
            """
        )
        await conn.execute(
            """
            ALTER TABLE runs
            ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(project_id)
            """
        )
        await conn.execute(
            """
            ALTER TABLE document_extractions
            ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(project_id)
            """
        )
        await conn.execute(
            """
            UPDATE threads
            SET project_id = '00000000-0000-4000-8000-000000001650'
            WHERE project_id IS NULL
            """
        )
        await conn.execute(
            """
            UPDATE runs
            SET project_id = '00000000-0000-4000-8000-000000001650'
            WHERE project_id IS NULL
            """
        )
        await conn.execute(
            """
            UPDATE document_extractions
            SET project_id = '00000000-0000-4000-8000-000000001650'
            WHERE project_id IS NULL
            """
        )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_threads_project_id ON threads(project_id)"
        )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_runs_project_id ON runs(project_id)"
        )
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_document_extractions_project_id
            ON document_extractions(project_id, extraction_kind, created_at DESC)
            """
        )
        # Reset stale busy/interrupted threads from prior crashes
        await conn.execute(
            """
            UPDATE threads
            SET status = 'idle', updated_at = now()
            WHERE status IN ('busy', 'interrupted')
            """
        )
        await conn.execute(
            """
            UPDATE runs
            SET status = 'error', updated_at = now()
            WHERE status IN ('pending', 'running')
            """
        )
        await conn.commit()


async def close_pool() -> None:
    global _pool, _schema_ready
    if _pool is not None:
        await _pool.close()
        _pool = None
    _schema_ready = False
