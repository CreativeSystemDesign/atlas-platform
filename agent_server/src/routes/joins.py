"""Join-walk API — read-only queries over the drawn join contracts.

GET /projects/{pid}/joins/component?document_id=&mark=   → the mark's whole
joined record (schematic occurrences, terminals/nets, parts-list rows,
cables with printed endpoints).
GET /projects/{pid}/joins/wire?document_id=&label=       → every endpoint
and place the documents give the wire.

Serves the smart canvas hover card; always 200 with whatever the interim
data holds (empty sections are honest, not errors) — evidence, never a
gate.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Query

from src import join_walk

router = APIRouter(prefix="/projects/{project_id}/joins", tags=["Join walk"])


@router.get("/component")
async def component(project_id: uuid.UUID,
                    document_id: str = Query(min_length=1, max_length=200),
                    mark: str = Query(min_length=1, max_length=80)) -> dict[str, Any]:
    return await join_walk.component_joins(str(project_id), document_id, mark.strip())


@router.get("/wire")
async def wire(project_id: uuid.UUID,
               document_id: str = Query(min_length=1, max_length=200),
               label: str = Query(min_length=1, max_length=80)) -> dict[str, Any]:
    return await join_walk.wire_joins(str(project_id), document_id, label.strip())
