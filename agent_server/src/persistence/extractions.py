"""Persistence for extracted document datasets backed by Neon PostgreSQL."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import psycopg

from src.config import settings
from src.persistence.projects import DEFAULT_PROJECT_ID


def persist_extracted_dataset(
    *,
    extraction_kind: str,
    source_pdf_path: str,
    output_contract: str,
    rows: list[dict[str, Any]],
    fieldnames: list[str],
    metadata: dict[str, Any] | None = None,
    project_id: uuid.UUID | str | None = None,
) -> dict[str, Any]:
    """Persist one extracted dataset plus its rows to Neon.

    This helper is intentionally synchronous so it can be called directly from
    synchronous tool implementations in ``custom_tools.py``.
    """
    if not settings.database_uri:
        raise ValueError("DATABASE_URI is not configured in agent_server/.env")

    normalized_pdf_path = str(Path(source_pdf_path).expanduser().resolve())
    normalized_metadata = metadata or {}
    normalized_project_id = uuid.UUID(str(project_id or DEFAULT_PROJECT_ID))

    with psycopg.connect(settings.database_uri) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO document_extractions (
                    project_id,
                    extraction_kind,
                    source_pdf_path,
                    output_contract,
                    row_count,
                    fieldnames,
                    metadata
                )
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
                RETURNING extraction_id
                """,
                (
                    normalized_project_id,
                    extraction_kind,
                    normalized_pdf_path,
                    output_contract,
                    len(rows),
                    json.dumps(fieldnames),
                    json.dumps(normalized_metadata),
                ),
            )
            extraction_id = cur.fetchone()[0]

            if rows:
                cur.executemany(
                    """
                    INSERT INTO document_extraction_rows (
                        extraction_id,
                        row_index,
                        source_page,
                        row_number,
                        location,
                        symbol_text,
                        description,
                        part_number,
                        quantity,
                        row_data
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    """,
                    [
                        (
                            extraction_id,
                            index,
                            _safe_int(row.get("Source Page") or row.get("source_page")),
                            _safe_text(row.get("Number")),
                            _safe_text(row.get("Location")),
                            _safe_text(row.get("Symbol Text")),
                            _safe_text(row.get("Description")),
                            _safe_text(row.get("Part Number")),
                            _safe_text(row.get("Quantity")),
                            json.dumps(row),
                        )
                        for index, row in enumerate(rows, start=1)
                    ],
                )
        conn.commit()

    return {
        "extraction_id": str(extraction_id),
        "row_count": len(rows),
    }


def _safe_text(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _safe_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None
