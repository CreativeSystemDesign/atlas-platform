"""Seed an Experimental v2 logic-graph from the legacy digital-twin annotations.

Reads the human wire / component / continuation annotations in
``schematic_annotations`` (the legacy extraction-workbench "digital twin"
workspace) for one page and converts them into the native v2 primitives
(nodes / ports / edges / continuations) so an operator can continue the trace
in the smart canvas rather than restarting. This only READS the legacy table.
"""

from __future__ import annotations

import math
import uuid
from typing import Any

from src.persistence.database import get_pool

_PORT_REUSE_PX = 10.0  # mirror the canvas ensurePort(): endpoints this close share a terminal
_LEGACY_TABLE = "schematic_annotations"  # the digital-twin workspace

_COMPONENT_TYPES = {"component"}
_WIRE_TYPES = {"wire_segment", "cable_segment"}
_CONTINUATION_TYPES = {"continuation"}


def _root_type(annotation_type: str | None, metadata: dict[str, Any]) -> str:
    return str((metadata or {}).get("rootType") or annotation_type or "component")


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _bbox_center(bbox: dict[str, Any] | None) -> tuple[float, float] | None:
    if not bbox:
        return None
    try:
        return (
            float(bbox["x"]) + float(bbox["width"]) / 2.0,
            float(bbox["y"]) + float(bbox["height"]) / 2.0,
        )
    except (KeyError, TypeError, ValueError):
        return None


class _PortRegistry:
    """Deduplicate terminals by proximity, mirroring the canvas ensurePort()."""

    def __init__(self, page_num: int) -> None:
        self._ports: list[dict[str, Any]] = []
        self._page = page_num
        self._count = 0

    def ensure(self, point: tuple[float, float]) -> str:
        for port in self._ports:
            existing = (port["point"]["x"], port["point"]["y"])
            if _dist(existing, point) <= _PORT_REUSE_PX:
                return port["id"]
        self._count += 1
        port = {
            "id": f"port-legacy-{self._page}-{self._count}",
            "parentId": "",
            "type": "terminal",
            "point": {"x": point[0], "y": point[1]},
            "label": f"T{self._count}",
        }
        self._ports.append(port)
        return port["id"]

    @property
    def ports(self) -> list[dict[str, Any]]:
        return self._ports


def _wire_endpoints(metadata: dict[str, Any]) -> list[tuple[float, float]]:
    geometry = (metadata or {}).get("wireGeometry") or {}
    segments = geometry.get("segments") or []
    points: list[tuple[float, float]] = []
    for seg in segments:
        try:
            points.append((float(seg["x1"]), float(seg["y1"])))
            points.append((float(seg["x2"]), float(seg["y2"])))
        except (KeyError, TypeError, ValueError):
            continue
    return points


def _ordered_path(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Order the endpoints along the wire's principal axis (its two extremes)."""
    unique: list[tuple[float, float]] = []
    for point in points:
        if not any(_dist(point, existing) <= 1.0 for existing in unique):
            unique.append(point)
    if len(unique) <= 2:
        return unique
    p0, p1 = unique[0], unique[1]
    best = -1.0
    for i in range(len(unique)):
        for j in range(i + 1, len(unique)):
            distance = _dist(unique[i], unique[j])
            if distance > best:
                best, p0, p1 = distance, unique[i], unique[j]
    axis = (p1[0] - p0[0], p1[1] - p0[1])
    axis_len = math.hypot(*axis) or 1.0

    def projection(point: tuple[float, float]) -> float:
        return ((point[0] - p0[0]) * axis[0] + (point[1] - p0[1]) * axis[1]) / axis_len

    return sorted(unique, key=projection)


async def build_v2_graph_from_legacy(
    project_id: str | uuid.UUID,
    document_id: str,
    page_num: int,
) -> dict[str, Any]:
    """Convert one page of legacy digital-twin annotations into a v2 graph."""
    pid = project_id if isinstance(project_id, uuid.UUID) else uuid.UUID(str(project_id))
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            f"""
            SELECT client_annotation_id, label, annotation_type, bbox, metadata
            FROM {_LEGACY_TABLE}
            WHERE project_id = %s AND document_id = %s AND page_num = %s
            ORDER BY created_at ASC, client_annotation_id ASC
            """,
            (pid, document_id, page_num),
        )
        results = await cur.fetchall()

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    continuations: list[dict[str, Any]] = []
    ports = _PortRegistry(page_num)
    skipped: dict[str, int] = {}

    def skip(kind: str) -> None:
        skipped[kind] = skipped.get(kind, 0) + 1

    for client_id, label, annotation_type, bbox, metadata in results:
        metadata = metadata or {}
        root = _root_type(annotation_type, metadata)

        if root in _COMPONENT_TYPES:
            if not bbox:
                skip(root)
                continue
            nodes.append(
                {
                    "id": f"node-{client_id}",
                    "type": "component",
                    "bbox": bbox,
                    "label": str(label or "COMP"),
                    "identity": None,
                }
            )
        elif root in _WIRE_TYPES:
            path = _ordered_path(_wire_endpoints(metadata))
            if len(path) < 2:
                skip(root)
                continue
            source_port = ports.ensure(path[0])
            target_port = ports.ensure(path[-1])
            if source_port == target_port:
                skip(root)
                continue
            edges.append(
                {
                    "id": f"edge-{client_id}",
                    "sourcePortId": source_port,
                    "targetPortId": target_port,
                    "path": [{"x": x, "y": y} for (x, y) in path],
                    "label": str(label) if label else None,
                }
            )
        elif root in _CONTINUATION_TYPES:
            center = _bbox_center(bbox)
            if center is None:
                skip(root)
                continue
            reference = metadata.get("continuationReference") if isinstance(metadata, dict) else None
            reference = reference or {}
            continuations.append(
                {
                    "id": f"cont-{client_id}",
                    "type": "continuation",
                    "point": {"x": center[0], "y": center[1]},
                    "sheet": reference.get("sheet"),
                    "zone": reference.get("zone"),
                    "rawRef": reference.get("rawRef") or (str(label) if label else None),
                    "target": None,
                }
            )
        else:
            skip(root)

    return {
        "nodes": nodes,
        "ports": ports.ports,
        "edges": edges,
        "continuations": continuations,
        "meta": {
            "seededFromLegacy": True,
            "legacyTable": _LEGACY_TABLE,
            "rowsRead": len(results),
            "skippedByType": skipped,
        },
    }
