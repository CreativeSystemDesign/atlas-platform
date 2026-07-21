from __future__ import annotations

import asyncio
import json
import uuid

# Patch target must be the module that owns the names: the package
# star-imports from _core, so setattr on the package reaches neither the
# underscore-private helpers nor the get_pool binding _core actually calls.
from src.routes.extraction_workbench import _core as extraction_workbench


def test_create_page_annotation_snapshot_preserves_current_annotations(monkeypatch):
    project_id = uuid.UUID("00000000-0000-4000-8000-000000001650")
    annotations = [
        {"id": "component-f13", "label": "F13", "pageNum": 7},
        {"id": "wire-s101", "label": "S101", "pageNum": 7},
    ]
    created_at = "2026-05-10T02:40:00+00:00"
    fake_row = (
        uuid.UUID("11111111-1111-4111-8111-111111111111"),
        project_id,
        "schematic_<drawing-no>",
        7,
        "page-7-validated-trace-paths",
        "Operator visually validated page 7 via Trace mode highlights.",
        annotations,
        len(annotations),
        "operator",
        {"branch": "codex/wire-canonicalization-hardening"},
        created_at,
    )
    fake_pool = FakePool(fake_row)

    async def fake_get_page_annotations(project, document_id, page_num):
        assert project["project_id"] == str(project_id)
        assert document_id == "schematic_<drawing-no>"
        assert page_num == 7
        return {"annotations": annotations}

    async def fake_get_pool():
        return fake_pool

    monkeypatch.setattr(
        extraction_workbench, "_get_page_annotations", fake_get_page_annotations
    )
    monkeypatch.setattr(extraction_workbench, "get_pool", fake_get_pool)

    result = asyncio.run(
        extraction_workbench._create_page_annotation_snapshot(
            {"project_id": str(project_id)},
            "schematic_<drawing-no>",
            7,
            extraction_workbench.WorkbenchAnnotationSnapshotCreate(
                name="page-7-validated-trace-paths",
                notes="Operator visually validated page 7 via Trace mode highlights.",
                metadata={"branch": "codex/wire-canonicalization-hardening"},
            ),
        )
    )

    assert result == {
        "snapshot_id": "11111111-1111-4111-8111-111111111111",
        "project_id": str(project_id),
        "document_id": "schematic_<drawing-no>",
        "page_num": 7,
        "name": "page-7-validated-trace-paths",
        "notes": "Operator visually validated page 7 via Trace mode highlights.",
        "annotations": annotations,
        "annotation_count": 2,
        "source": "operator",
        "metadata": {"branch": "codex/wire-canonicalization-hardening"},
        "created_at": created_at,
    }
    assert fake_pool.connection_obj.committed is True
    assert json.loads(fake_pool.connection_obj.executions[0]["params"][4]) == annotations
    assert fake_pool.connection_obj.executions[0]["params"][5] == 2


class FakePool:
    def __init__(self, row):
        self.connection_obj = FakeConnection(row)

    def connection(self):
        return self.connection_obj


class FakeConnection:
    def __init__(self, row):
        self.row = row
        self.executions = []
        self.committed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return None

    async def execute(self, sql, params=()):
        self.executions.append({"sql": sql, "params": params})
        return FakeCursor(self.row)

    async def commit(self):
        self.committed = True


class FakeCursor:
    def __init__(self, row):
        self.row = row

    async def fetchone(self):
        return self.row
