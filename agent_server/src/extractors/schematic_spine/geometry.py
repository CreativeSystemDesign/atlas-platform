"""Geometry utilities."""

from __future__ import annotations

from .models import VectorDrawing

def _page_range(total_pages: int, page_from: int, page_to: int, max_pages: int) -> range:
    start = max(1, page_from)
    end = total_pages if page_to <= 0 else min(total_pages, page_to)
    if end < start:
        raise ValueError(f"Invalid page range: {page_from} to {page_to}")
    if max_pages > 0:
        end = min(end, start + max_pages - 1)
    return range(start, end + 1)


def _bbox_pdf(drawings: list[VectorDrawing]) -> tuple[float, float, float, float]:
    if not drawings:
        raise ValueError("Cannot compute a bbox for an empty drawing set")
    return (
        min(drawing.x0 for drawing in drawings),
        min(drawing.y0 for drawing in drawings),
        max(drawing.x1 for drawing in drawings),
        max(drawing.y1 for drawing in drawings),
    )


def _bbox_width(bbox: tuple[float, float, float, float]) -> float:
    return bbox[2] - bbox[0]


def _bbox_height(bbox: tuple[float, float, float, float]) -> float:
    return bbox[3] - bbox[1]


def _bbox_area_px(bbox: tuple[int, int, int, int]) -> int:
    return max(0, bbox[2] - bbox[0]) * max(0, bbox[3] - bbox[1])


def _points_bbox_pdf(points: tuple[tuple[float, float], ...]) -> tuple[float, float, float, float]:
    if not points:
        raise ValueError("Cannot compute a bbox for an empty point set")
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return (min(xs), min(ys), max(xs), max(ys))


def _line_length(points: tuple[tuple[float, float], ...]) -> float:
    if len(points) != 2:
        return 0.0
    (x0, y0), (x1, y1) = points
    return ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5


def _line_orientation(points: tuple[tuple[float, float], ...]) -> str:
    if len(points) != 2:
        return "unknown"
    (x0, y0), (x1, y1) = points
    width = abs(x1 - x0)
    height = abs(y1 - y0)
    if height <= 0.75 and width > 0.75:
        return "horizontal"
    if width <= 0.75 and height > 0.75:
        return "vertical"
    return "diagonal_or_symbol"

