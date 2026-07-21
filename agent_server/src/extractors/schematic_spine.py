"""Schematic spine proof extractor.

Slice 0 is intentionally narrow: prove that Atlas can find one schematic symbol
from vector geometry, render the source page in a canonical pixel frame, and
write a validation overlay grounded to that frame.
"""

from __future__ import annotations

import json
import re
import sqlite3
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fitz
from PIL import Image, ImageDraw

DEFAULT_MACHINE_ID = "the reference machine"
DEFAULT_DOCUMENT_ID = "schematic_<drawing-no>"
DEFAULT_SCHEMATIC_RELATIVE_PATH = "the reference machine/the reference machine/01_SCHEMATIC DIAGRAM_<drawing-no>.pdf"
DEFAULT_VECTOR_DB_PATH = Path("/mnt/c/annotator/data/vectors.db")
VECTOR_FINGERPRINT_METHOD = "vector_sequence_fingerprint_v1"
TEXT_ANCHOR_METHOD = "pymupdf_text_words_v1"
GRAPHIC_ATOM_METHOD = "legacy_vectors_db_drawing_items_v1"
WIRE_SEGMENT_METHOD = "graphic_atom_wire_segment_candidate_v1"
WIRE_INTERACTION_METHOD = "orthogonal_wire_interaction_candidate_v1"
TEXT_GEOMETRY_ASSOCIATION_METHOD = "nearest_text_to_geometry_candidate_v1"
WIRE_TRACE_METHOD = "filtered_wire_trace_candidate_v1"
WIRE_PATH_METHOD = "wire_trace_connected_component_candidate_v1"
WIRE_ENDPOINT_METHOD = "wire_path_endpoint_candidate_v1"
WIRE_OBJECT_ASSOCIATION_METHOD = "wire_endpoint_object_association_candidate_v1"
COMPONENT_MARK_METHOD = "text_anchor_component_mark_candidate_v1"
COMPONENT_BOX_METHOD = "mark_guided_component_box_candidate_v1"
REFERENCE_CANDIDATE_METHOD = "stacked_numeric_reference_candidate_v1"
TERMINAL_NODE_METHOD = "text_enclosed_terminal_node_candidate_v1"
TERMINAL_WIRE_ASSOCIATION_METHOD = "terminal_wire_touch_candidate_v1"
REFERENCE_WIRE_ASSOCIATION_METHOD = "reference_wire_proximity_candidate_v1"
REFERENCE_GLYPH_PADDING_PX = 10
COMPONENT_MARK_PREFIXES = (
    "MCB",
    "ELB",
    "F",
    "PL",
    "WHM",
    "CT",
    "TB",
    "CR",
    "SOL",
    "INV",
    "CNV",
    "CN",
    "CON",
    "AMP",
    "THR",
    "RTC",
    "LNF",
    "OSH",
    "M",
    "SV",
)


@dataclass(frozen=True)
class VectorDrawing:
    drawing_id: int
    seqno: int
    x0: float
    y0: float
    x1: float
    y1: float
    stroke_width: float | None


@dataclass(frozen=True)
class VectorTemplate:
    template_id: str
    label: str
    source_page: int
    core_seq_start: int
    core_seq_end: int
    component_bbox_pdf: tuple[float, float, float, float]


@dataclass(frozen=True)
class VectorMatch:
    page: int
    score: float
    bbox_pdf: tuple[float, float, float, float]
    bbox_px: tuple[int, int, int, int]
    core_bbox_pdf: tuple[float, float, float, float]
    source_vector_ids: tuple[int, ...]
    source_seqnos: tuple[int, ...]


@dataclass(frozen=True)
class TextAnchor:
    anchor_id: str
    source_page: int
    raw_text: str
    normalized_text: str
    bbox_pdf: tuple[float, float, float, float]
    bbox_px: tuple[int, int, int, int]
    class_candidates: tuple[str, ...]
    extraction_method: str = TEXT_ANCHOR_METHOD


@dataclass(frozen=True)
class GraphicAtom:
    atom_id: str
    source_page: int
    item_id: int
    drawing_id: int
    seqno: int
    kind: str
    points_pdf: tuple[tuple[float, float], ...]
    bbox_pdf: tuple[float, float, float, float]
    bbox_px: tuple[int, int, int, int]
    class_candidates: tuple[str, ...]
    extraction_method: str = GRAPHIC_ATOM_METHOD


@dataclass(frozen=True)
class WireSegmentCandidate:
    segment_id: str
    source_page: int
    source_atom_id: str
    source_item_id: int
    source_drawing_id: int
    source_seqno: int
    orientation: str
    endpoints_pdf: tuple[tuple[float, float], tuple[float, float]]
    endpoints_px: tuple[tuple[int, int], tuple[int, int]]
    bbox_pdf: tuple[float, float, float, float]
    bbox_px: tuple[int, int, int, int]
    length_pdf: float
    class_candidates: tuple[str, ...]
    extraction_method: str = WIRE_SEGMENT_METHOD


@dataclass(frozen=True)
class WireInteractionCandidate:
    interaction_id: str
    source_page: int
    interaction_type: str
    point_pdf: tuple[float, float]
    point_px: tuple[int, int]
    segment_ids: tuple[str, str]
    source_atom_ids: tuple[str, str]
    class_candidates: tuple[str, ...]
    extraction_method: str = WIRE_INTERACTION_METHOD


@dataclass(frozen=True)
class WirePathCandidate:
    path_id: str
    source_page: int
    wire_segment_ids: tuple[str, ...]
    wire_interaction_ids: tuple[str, ...]
    terminal_candidate_ids: tuple[str, ...]
    terminal_texts: tuple[str, ...]
    reference_candidate_ids: tuple[str, ...]
    reference_texts: tuple[str, ...]
    text_anchor_ids: tuple[str, ...]
    text_labels: tuple[str, ...]
    bbox_px: tuple[int, int, int, int]
    bbox_pdf: tuple[float, float, float, float]
    class_candidates: tuple[str, ...]
    extraction_method: str = WIRE_PATH_METHOD


@dataclass(frozen=True)
class WireEndpointCandidate:
    endpoint_id: str
    source_page: int
    wire_path_id: str
    wire_segment_id: str
    endpoint_index: int
    point_pdf: tuple[float, float]
    point_px: tuple[int, int]
    touch_interaction_ids: tuple[str, ...]
    near_terminal_candidate_ids: tuple[str, ...]
    near_terminal_texts: tuple[str, ...]
    near_reference_candidate_ids: tuple[str, ...]
    near_reference_texts: tuple[str, ...]
    near_component_box_ids: tuple[str, ...]
    near_component_mark_texts: tuple[str, ...]
    path_text_labels: tuple[str, ...]
    class_candidates: tuple[str, ...]
    extraction_method: str = WIRE_ENDPOINT_METHOD


@dataclass(frozen=True)
class WireObjectAssociationCandidate:
    association_id: str
    source_page: int
    wire_path_id: str
    target_type: str
    target_id: str
    target_label: str
    relation_candidate: str
    endpoint_ids: tuple[str, ...]
    endpoint_points_px: tuple[tuple[int, int], ...]
    path_text_labels: tuple[str, ...]
    class_candidates: tuple[str, ...]
    extraction_method: str = WIRE_OBJECT_ASSOCIATION_METHOD


@dataclass(frozen=True)
class TextGeometryAssociationCandidate:
    association_id: str
    source_page: int
    source_anchor_id: str
    source_anchor_text: str
    source_anchor_classes: tuple[str, ...]
    target_type: str
    target_id: str
    relation_candidate: str
    distance_px: float
    anchor_center_px: tuple[int, int]
    target_point_px: tuple[int, int]
    class_candidates: tuple[str, ...]
    extraction_method: str = TEXT_GEOMETRY_ASSOCIATION_METHOD


@dataclass(frozen=True)
class ComponentMarkCandidate:
    component_candidate_id: str
    source_page: int
    mark_anchor_id: str
    mark_text: str
    mark_bbox_px: tuple[int, int, int, int]
    mark_bbox_pdf: tuple[float, float, float, float]
    nearby_anchor_ids: tuple[str, ...]
    nearby_location_tag_anchor_ids: tuple[str, ...]
    class_candidates: tuple[str, ...]
    extraction_method: str = COMPONENT_MARK_METHOD


@dataclass(frozen=True)
class ComponentBoxCandidate:
    component_box_id: str
    source_page: int
    mark_text: str
    mark_anchor_id: str
    mark_bbox_px: tuple[int, int, int, int]
    mark_bbox_pdf: tuple[float, float, float, float]
    bbox_px: tuple[int, int, int, int]
    bbox_pdf: tuple[float, float, float, float]
    source_detection_ids: tuple[str, ...]
    source_atom_ids: tuple[str, ...]
    source_kind: str
    class_candidates: tuple[str, ...]
    extraction_method: str = COMPONENT_BOX_METHOD


@dataclass(frozen=True)
class ReferenceCandidate:
    reference_candidate_id: str
    source_page: int
    reference_text: str
    top_anchor_id: str
    bottom_anchor_id: str
    reference_anchor_ids: tuple[str, ...]
    bbox_px: tuple[int, int, int, int]
    bbox_pdf: tuple[float, float, float, float]
    class_candidates: tuple[str, ...]
    extraction_method: str = REFERENCE_CANDIDATE_METHOD


@dataclass(frozen=True)
class TerminalNodeCandidate:
    terminal_candidate_id: str
    source_page: int
    terminal_text: str
    text_anchor_id: str
    text_bbox_px: tuple[int, int, int, int]
    text_bbox_pdf: tuple[float, float, float, float]
    enclosure_atom_ids: tuple[str, ...]
    enclosure_bbox_px: tuple[int, int, int, int]
    enclosure_bbox_pdf: tuple[float, float, float, float]
    class_candidates: tuple[str, ...]
    extraction_method: str = TERMINAL_NODE_METHOD


@dataclass(frozen=True)
class TerminalWireAssociationCandidate:
    association_id: str
    source_page: int
    terminal_candidate_id: str
    terminal_text: str
    wire_segment_id: str
    relation_candidate: str
    distance_px: float
    terminal_center_px: tuple[int, int]
    nearest_wire_point_px: tuple[int, int]
    class_candidates: tuple[str, ...]
    extraction_method: str = TERMINAL_WIRE_ASSOCIATION_METHOD


@dataclass(frozen=True)
class ReferenceWireAssociationCandidate:
    association_id: str
    source_page: int
    reference_candidate_id: str
    reference_text: str
    wire_segment_id: str
    relation_candidate: str
    distance_px: float
    reference_center_px: tuple[int, int]
    nearest_wire_point_px: tuple[int, int]
    class_candidates: tuple[str, ...]
    extraction_method: str = REFERENCE_WIRE_ASSOCIATION_METHOD


ELB_3_PHASE_TEMPLATE = VectorTemplate(
    template_id="elb_3_phase_page7_pair10",
    label="ELB 3 Phase",
    source_page=7,
    core_seq_start=306,
    core_seq_end=334,
    component_bbox_pdf=(178.28, 532.94, 218.38, 587.02),
)


def _normalize_anchor_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).replace("\u3000", " ")
    return re.sub(r"\s+", " ", normalized).strip()


def _strip_wrapping_punctuation(value: str) -> str:
    return value.strip().strip("()（）[]【】")


def _classify_anchor_text(
    *,
    raw_text: str,
    normalized_text: str,
    bbox_pdf: tuple[float, float, float, float],
    page_width: float,
    page_height: float,
) -> tuple[str, ...]:
    """Return loose source-text roles without promoting them into trusted facts."""
    del raw_text
    text = normalized_text.strip()
    if not text:
        return ("unclassified",)

    token = _strip_wrapping_punctuation(text)
    x0, y0, x1, y1 = bbox_pdf
    classes: list[str] = []
    near_page_grid = x0 <= 40 or x1 >= page_width - 40 or y0 <= 30 or y1 >= page_height - 30

    if near_page_grid and re.fullmatch(r"(?:[A-M]|[0-9]{1,2})", token):
        classes.append("grid_reference")

    if token in {"PP", "CP"}:
        classes.append("location_tag")

    if token in {"PE", "L1", "L2", "L3", "L+", "L-"} or re.fullmatch(r"P[0-9]+", token):
        classes.append("terminal_label")

    if re.fullmatch(r"(?:[RSTUVWXYZ][0-9]{1,4}|[0-9]{3,4}[A-Z]?)", token):
        classes.append("wire_label")

    if (
        re.fullmatch(r"[A-Z]{1,6}[0-9]{1,4}[A-Z0-9-]*", token)
        and any(token.startswith(prefix) for prefix in COMPONENT_MARK_PREFIXES)
    ):
        classes.append("component_mark")

    if (
        "DWG" in text
        or "DESCRIPTION" in text
        or re.fullmatch(r"[0-9]{3}-[A-Z][0-9]{4}[:-][0-9]{3}-[0-9](?: R[0-9]+)?", text)
        or (y0 >= page_height - 110 and len(text) >= 8)
    ):
        classes.append("page_metadata")

    return tuple(dict.fromkeys(classes)) or ("source_text",)


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


def _classify_graphic_atom(
    *,
    kind: str,
    points: tuple[tuple[float, float], ...],
    bbox_pdf: tuple[float, float, float, float],
) -> tuple[str, ...]:
    classes: list[str] = []
    x0, y0, x1, y1 = bbox_pdf
    width = abs(x1 - x0)
    height = abs(y1 - y0)

    if y0 <= 35 or x0 <= 45 or x1 >= 550 or y0 >= 745:
        classes.append("frame_or_title_block_candidate")

    if kind == "l" and len(points) == 2:
        length = _line_length(points)
        is_horizontal = height <= 0.75 and width > 0.75
        is_vertical = width <= 0.75 and height > 0.75
        if is_horizontal:
            classes.append("horizontal_segment")
        if is_vertical:
            classes.append("vertical_segment")
        if length >= 25:
            classes.append("long_line_candidate")
        elif length <= 4:
            classes.append("small_symbol_stroke")
        else:
            classes.append("symbol_stroke_candidate")
        if length >= 25 and (is_horizontal or is_vertical):
            classes.append("orthogonal_wire_or_border_candidate")
    elif kind == "c":
        classes.append("curve_symbol_stroke")
    elif kind == "re":
        classes.append("rectangle_symbol_stroke")
    else:
        classes.append("vector_graphic_atom")

    return tuple(dict.fromkeys(classes))


def _classify_wire_segment(
    *,
    orientation: str,
    bbox_pdf: tuple[float, float, float, float],
    length_pdf: float,
    page_width: float,
    page_height: float,
) -> tuple[str, ...]:
    x0, y0, x1, y1 = bbox_pdf
    classes = ["wire_segment_candidate", f"{orientation}_segment_candidate"]

    if length_pdf >= 25:
        classes.append("long_run_candidate")
    else:
        classes.append("short_run_candidate")

    if x0 <= 55 or x1 >= page_width - 55:
        classes.append("page_edge_continuation_candidate")

    if y0 <= 55 or y1 >= page_height - 145:
        classes.append("boundary_adjacent_candidate")

    return tuple(dict.fromkeys(classes))


def _is_wire_segment_candidate(
    atom: GraphicAtom,
    *,
    page_width: float,
    page_height: float,
) -> bool:
    if atom.kind != "l" or len(atom.points_pdf) != 2:
        return False

    orientation = _line_orientation(atom.points_pdf)
    if orientation not in {"horizontal", "vertical"}:
        return False

    x0, y0, x1, y1 = atom.bbox_pdf
    length_pdf = _line_length(atom.points_pdf)
    if length_pdf < 8:
        return False

    # Keep title-block and page-frame lines out of the wiring layer. This does
    # not prove the remaining lines are electrical nets; it only says they are
    # source-faithful wire/run candidates worth validating visually.
    if x0 < 15 or y0 < 35 or x1 > page_width - 15 or y1 > page_height - 15:
        return False
    if y0 >= page_height - 120:
        return False
    if orientation == "horizontal" and length_pdf > page_width * 0.88:
        return False
    if orientation == "horizontal" and x0 > page_width * 0.70 and length_pdf > 45:
        return False
    if orientation == "vertical" and length_pdf > page_height * 0.78:
        return False

    return True


def _wire_segments_from_graphic_atoms(
    *,
    graphic_atoms: list[GraphicAtom],
    page_record: dict[str, Any],
    dpi: int,
) -> list[WireSegmentCandidate]:
    page_width = float(page_record["pdf_mediabox"][2]) - float(page_record["pdf_mediabox"][0])
    page_height = float(page_record["pdf_mediabox"][3]) - float(page_record["pdf_mediabox"][1])
    render_width_px = int(page_record["render_width_px"])
    render_height_px = int(page_record["render_height_px"])

    segments: list[WireSegmentCandidate] = []
    for atom in graphic_atoms:
        if not _is_wire_segment_candidate(
            atom,
            page_width=page_width,
            page_height=page_height,
        ):
            continue

        orientation = _line_orientation(atom.points_pdf)
        endpoint_a = atom.points_pdf[0]
        endpoint_b = atom.points_pdf[1]
        endpoints_px = (
            _pdf_point_to_px(
                endpoint_a,
                dpi=dpi,
                render_width_px=render_width_px,
                render_height_px=render_height_px,
            ),
            _pdf_point_to_px(
                endpoint_b,
                dpi=dpi,
                render_width_px=render_width_px,
                render_height_px=render_height_px,
            ),
        )
        length_pdf = _line_length(atom.points_pdf)
        segments.append(
            WireSegmentCandidate(
                segment_id=f"wire-p{atom.source_page:03d}-{len(segments) + 1:04d}",
                source_page=atom.source_page,
                source_atom_id=atom.atom_id,
                source_item_id=atom.item_id,
                source_drawing_id=atom.drawing_id,
                source_seqno=atom.seqno,
                orientation=orientation,
                endpoints_pdf=(endpoint_a, endpoint_b),
                endpoints_px=endpoints_px,
                bbox_pdf=atom.bbox_pdf,
                bbox_px=atom.bbox_px,
                length_pdf=length_pdf,
                class_candidates=_classify_wire_segment(
                    orientation=orientation,
                    bbox_pdf=atom.bbox_pdf,
                    length_pdf=length_pdf,
                    page_width=page_width,
                    page_height=page_height,
                ),
            )
        )

    return segments


def _load_page_drawings(con: sqlite3.Connection, page: int) -> list[VectorDrawing]:
    row = con.execute("SELECT page_id FROM pages WHERE page_num=?", (page,)).fetchone()
    if row is None:
        raise ValueError(f"Vector database has no page {page}")

    rows = con.execute(
        """
        SELECT drawing_id, seqno, x0, y0, x1, y1, stroke_width
        FROM drawings
        WHERE page_id=?
        ORDER BY seqno, drawing_id
        """,
        (row[0],),
    ).fetchall()
    return [
        VectorDrawing(
            drawing_id=int(drawing_id),
            seqno=int(seqno),
            x0=float(x0),
            y0=float(y0),
            x1=float(x1),
            y1=float(y1),
            stroke_width=float(stroke_width) if stroke_width is not None else None,
        )
        for drawing_id, seqno, x0, y0, x1, y1, stroke_width in rows
    ]


def _load_page_graphic_atoms(
    con: sqlite3.Connection,
    *,
    page: int,
    dpi: int,
    render_sizes: dict[int, tuple[int, int]],
) -> list[GraphicAtom]:
    row = con.execute("SELECT page_id FROM pages WHERE page_num=?", (page,)).fetchone()
    if row is None:
        raise ValueError(f"Vector database has no page {page}")
    render_width_px, render_height_px = render_sizes[page]

    rows = con.execute(
        """
        SELECT
            i.item_id,
            d.drawing_id,
            d.seqno,
            i.kind,
            d.x0,
            d.y0,
            d.x1,
            d.y1,
            i.x1,
            i.y1,
            i.x2,
            i.y2,
            i.x3,
            i.y3,
            i.x4,
            i.y4
        FROM drawings d
        JOIN drawing_items i ON i.drawing_id=d.drawing_id
        WHERE d.page_id=?
        ORDER BY d.seqno, d.drawing_id, i.item_id
        """,
        (row[0],),
    ).fetchall()

    atoms: list[GraphicAtom] = []
    for (
        item_id,
        drawing_id,
        seqno,
        kind,
        drawing_x0,
        drawing_y0,
        drawing_x1,
        drawing_y1,
        item_x1,
        item_y1,
        item_x2,
        item_y2,
        item_x3,
        item_y3,
        item_x4,
        item_y4,
    ) in rows:
        raw_points = (
            (item_x1, item_y1),
            (item_x2, item_y2),
            (item_x3, item_y3),
            (item_x4, item_y4),
        )
        points = tuple(
            (float(x), float(y)) for x, y in raw_points if x is not None and y is not None
        )
        bbox_pdf = (
            _points_bbox_pdf(points)
            if points
            else (float(drawing_x0), float(drawing_y0), float(drawing_x1), float(drawing_y1))
        )
        bbox_px = _pdf_bbox_to_px(
            bbox_pdf,
            dpi=dpi,
            render_width_px=render_width_px,
            render_height_px=render_height_px,
        )
        atoms.append(
            GraphicAtom(
                atom_id=f"graphic-p{page:03d}-{int(item_id):05d}",
                source_page=page,
                item_id=int(item_id),
                drawing_id=int(drawing_id),
                seqno=int(seqno),
                kind=str(kind),
                points_pdf=points,
                bbox_pdf=bbox_pdf,
                bbox_px=bbox_px,
                class_candidates=_classify_graphic_atom(
                    kind=str(kind),
                    points=points,
                    bbox_pdf=bbox_pdf,
                ),
            )
        )
    return atoms


def _template_core_drawings(
    con: sqlite3.Connection,
    template: VectorTemplate,
) -> list[VectorDrawing]:
    drawings = [
        drawing
        for drawing in _load_page_drawings(con, template.source_page)
        if template.core_seq_start <= drawing.seqno <= template.core_seq_end
    ]
    if not drawings:
        raise ValueError(
            f"Template {template.template_id} has no vector drawings in seq "
            f"{template.core_seq_start}-{template.core_seq_end}"
        )
    return drawings


def _normalized_drawing_signature(drawings: list[VectorDrawing]) -> tuple[list[float], tuple]:
    bbox = _bbox_pdf(drawings)
    width = max(_bbox_width(bbox), 1e-6)
    height = max(_bbox_height(bbox), 1e-6)
    signature: list[float] = []
    for drawing in drawings:
        signature.extend(
            [
                (drawing.x0 - bbox[0]) / width,
                (drawing.y0 - bbox[1]) / height,
                (drawing.x1 - bbox[0]) / width,
                (drawing.y1 - bbox[1]) / height,
            ]
        )
    return signature, bbox


def _score_window(
    template_signature: list[float],
    template_core_bbox: tuple[float, float, float, float],
    candidate: list[VectorDrawing],
) -> tuple[float, tuple[float, float, float, float], float, float]:
    candidate_signature, candidate_bbox = _normalized_drawing_signature(candidate)
    if len(candidate_signature) != len(template_signature):
        raise ValueError("Candidate signature length does not match template signature length")

    mean_abs_error = sum(
        abs(template_value - candidate_value)
        for template_value, candidate_value in zip(template_signature, candidate_signature)
    ) / len(template_signature)
    width_error = abs(_bbox_width(candidate_bbox) - _bbox_width(template_core_bbox)) / max(
        _bbox_width(template_core_bbox),
        1e-6,
    )
    height_error = abs(_bbox_height(candidate_bbox) - _bbox_height(template_core_bbox)) / max(
        _bbox_height(template_core_bbox),
        1e-6,
    )
    dimension_error = width_error + height_error
    score = max(0.0, 1.0 - (mean_abs_error * 8.0 + dimension_error * 0.5))
    return score, candidate_bbox, mean_abs_error, dimension_error


def _component_bbox_from_core(
    candidate_core_bbox: tuple[float, float, float, float],
    template_core_bbox: tuple[float, float, float, float],
    template_component_bbox: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    template_width = max(_bbox_width(template_core_bbox), 1e-6)
    template_height = max(_bbox_height(template_core_bbox), 1e-6)
    scale_x = _bbox_width(candidate_core_bbox) / template_width
    scale_y = _bbox_height(candidate_core_bbox) / template_height

    left_offset = template_core_bbox[0] - template_component_bbox[0]
    top_offset = template_core_bbox[1] - template_component_bbox[1]
    right_offset = template_component_bbox[2] - template_core_bbox[2]
    bottom_offset = template_component_bbox[3] - template_core_bbox[3]

    return (
        candidate_core_bbox[0] - left_offset * scale_x,
        candidate_core_bbox[1] - top_offset * scale_y,
        candidate_core_bbox[2] + right_offset * scale_x,
        candidate_core_bbox[3] + bottom_offset * scale_y,
    )


def _pdf_bbox_to_px(
    bbox: tuple[float, float, float, float],
    *,
    dpi: int,
    render_width_px: int,
    render_height_px: int,
) -> tuple[int, int, int, int]:
    scale = dpi / 72.0
    x0 = int(round(bbox[0] * scale))
    y0 = int(round(bbox[1] * scale))
    x1 = int(round(bbox[2] * scale))
    y1 = int(round(bbox[3] * scale))
    return (
        max(0, min(render_width_px - 1, x0)),
        max(0, min(render_height_px - 1, y0)),
        max(0, min(render_width_px, x1)),
        max(0, min(render_height_px, y1)),
    )


def _pdf_point_to_px(
    point: tuple[float, float],
    *,
    dpi: int,
    render_width_px: int,
    render_height_px: int,
) -> tuple[int, int]:
    scale = dpi / 72.0
    x = int(round(point[0] * scale))
    y = int(round(point[1] * scale))
    return (
        max(0, min(render_width_px, x)),
        max(0, min(render_height_px, y)),
    )


def _bbox_iou(
    a: tuple[int, int, int, int],
    b: tuple[int, int, int, int],
) -> float:
    ix0 = max(a[0], b[0])
    iy0 = max(a[1], b[1])
    ix1 = min(a[2], b[2])
    iy1 = min(a[3], b[3])
    intersection = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    if intersection == 0:
        return 0.0
    area_a = max(0, a[2] - a[0]) * max(0, a[3] - a[1])
    area_b = max(0, b[2] - b[0]) * max(0, b[3] - b[1])
    return intersection / max(area_a + area_b - intersection, 1)


def _bbox_center_px(bbox: tuple[int, int, int, int]) -> tuple[int, int]:
    return (int(round((bbox[0] + bbox[2]) / 2)), int(round((bbox[1] + bbox[3]) / 2)))


def _bbox_union_px(
    a: tuple[int, int, int, int],
    b: tuple[int, int, int, int],
) -> tuple[int, int, int, int]:
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def _bbox_union_pdf(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def _expand_bbox_px(
    bbox: tuple[int, int, int, int],
    *,
    padding: int,
    render_width_px: int,
    render_height_px: int,
) -> tuple[int, int, int, int]:
    return (
        max(0, bbox[0] - padding),
        max(0, bbox[1] - padding),
        min(render_width_px, bbox[2] + padding),
        min(render_height_px, bbox[3] + padding),
    )


def _expand_bbox_pdf(
    bbox: tuple[float, float, float, float],
    *,
    padding: float,
) -> tuple[float, float, float, float]:
    return (
        bbox[0] - padding,
        bbox[1] - padding,
        bbox[2] + padding,
        bbox[3] + padding,
    )


def _bbox_intersects_px(
    a: tuple[int, int, int, int],
    b: tuple[int, int, int, int],
    *,
    padding: int = 0,
) -> bool:
    return not (
        a[2] < b[0] - padding
        or a[0] > b[2] + padding
        or a[3] < b[1] - padding
        or a[1] > b[3] + padding
    )


def _point_distance_px(
    a: tuple[int, int],
    b: tuple[int, int],
) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def _point_to_wire_segment_distance_px(
    point: tuple[int, int],
    segment: WireSegmentCandidate,
) -> tuple[float, tuple[int, int]]:
    (x1, y1), (x2, y2) = segment.endpoints_px
    px, py = point
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        nearest = (x1, y1)
        return _point_distance_px(point, nearest), nearest

    t = ((px - x1) * dx + (py - y1) * dy) / float(dx * dx + dy * dy)
    clamped_t = max(0.0, min(1.0, t))
    nearest = (int(round(x1 + clamped_t * dx)), int(round(y1 + clamped_t * dy)))
    return _point_distance_px(point, nearest), nearest


def _detection_id(match: VectorMatch, template: VectorTemplate) -> str:
    seq_start = match.source_seqnos[0] if match.source_seqnos else 0
    seq_end = match.source_seqnos[-1] if match.source_seqnos else 0
    return f"{template.template_id}-p{match.page:03d}-seq{seq_start}-{seq_end}"


def _wire_segment_axis_bounds(
    segment: WireSegmentCandidate,
) -> tuple[float, float, float]:
    (x1, y1), (x2, y2) = segment.endpoints_pdf
    if segment.orientation == "horizontal":
        return ((y1 + y2) / 2.0, min(x1, x2), max(x1, x2))
    if segment.orientation == "vertical":
        return ((x1 + x2) / 2.0, min(y1, y2), max(y1, y2))
    return (0.0, 0.0, 0.0)


def _interval_overlap_pdf(
    a_start: float,
    a_end: float,
    b_start: float,
    b_end: float,
) -> float:
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def _closed_rectangle_edge_segment_ids(
    wire_segments: list[WireSegmentCandidate],
    *,
    tolerance_pdf: float = 0.9,
) -> set[str]:
    """Find orthogonal closed rectangles so trace filtering can avoid enclosures."""
    horizontal = [segment for segment in wire_segments if segment.orientation == "horizontal"]
    vertical = [segment for segment in wire_segments if segment.orientation == "vertical"]
    closed_edges: set[str] = set()

    for left_index, left_segment in enumerate(vertical):
        left_x, left_top, left_bottom = _wire_segment_axis_bounds(left_segment)
        for right_segment in vertical[left_index + 1 :]:
            right_x, right_top, right_bottom = _wire_segment_axis_bounds(right_segment)
            if abs(left_top - right_top) > tolerance_pdf:
                continue
            if abs(left_bottom - right_bottom) > tolerance_pdf:
                continue

            rect_left = min(left_x, right_x)
            rect_right = max(left_x, right_x)
            rect_top = (left_top + right_top) / 2.0
            rect_bottom = (left_bottom + right_bottom) / 2.0
            if rect_right - rect_left < 8 or rect_bottom - rect_top < 8:
                continue

            top_edges: list[WireSegmentCandidate] = []
            bottom_edges: list[WireSegmentCandidate] = []
            for h_segment in horizontal:
                h_y, h_left, h_right = _wire_segment_axis_bounds(h_segment)
                if abs(h_left - rect_left) > tolerance_pdf:
                    continue
                if abs(h_right - rect_right) > tolerance_pdf:
                    continue
                if abs(h_y - rect_top) <= tolerance_pdf:
                    top_edges.append(h_segment)
                if abs(h_y - rect_bottom) <= tolerance_pdf:
                    bottom_edges.append(h_segment)

            if not top_edges or not bottom_edges:
                continue

            closed_edges.add(left_segment.segment_id)
            closed_edges.add(right_segment.segment_id)
            closed_edges.update(edge.segment_id for edge in top_edges)
            closed_edges.update(edge.segment_id for edge in bottom_edges)

    for top_index, top_segment in enumerate(horizontal):
        top_y, top_left, top_right = _wire_segment_axis_bounds(top_segment)
        for bottom_segment in horizontal[top_index + 1 :]:
            bottom_y, bottom_left, bottom_right = _wire_segment_axis_bounds(bottom_segment)
            if abs(top_left - bottom_left) > tolerance_pdf:
                continue
            if abs(top_right - bottom_right) > tolerance_pdf:
                continue

            rect_top = min(top_y, bottom_y)
            rect_bottom = max(top_y, bottom_y)
            if top_right - top_left < 8:
                continue
            if rect_bottom - rect_top < 8:
                continue

            left_edges: list[WireSegmentCandidate] = []
            right_edges: list[WireSegmentCandidate] = []
            for v_segment in vertical:
                v_x, v_top, v_bottom = _wire_segment_axis_bounds(v_segment)
                overlap = _interval_overlap_pdf(v_top, v_bottom, rect_top, rect_bottom)
                if overlap < min(6.0, max(2.0, (rect_bottom - rect_top) * 0.2)):
                    continue
                if abs(v_x - top_left) <= tolerance_pdf:
                    left_edges.append(v_segment)
                if abs(v_x - top_right) <= tolerance_pdf:
                    right_edges.append(v_segment)

            if not left_edges or not right_edges:
                continue

            closed_edges.add(top_segment.segment_id)
            closed_edges.add(bottom_segment.segment_id)
            closed_edges.update(edge.segment_id for edge in left_edges)
            closed_edges.update(edge.segment_id for edge in right_edges)

    return closed_edges


def _segment_overlaps_text_anchor(
    segment: WireSegmentCandidate,
    text_anchors: list[TextAnchor],
    *,
    padding_pdf: float = 1.0,
) -> bool:
    axis, start, end = _wire_segment_axis_bounds(segment)
    if segment.orientation == "horizontal":
        for anchor in text_anchors:
            ax0, ay0, ax1, ay1 = anchor.bbox_pdf
            if not (ay0 - padding_pdf <= axis <= ay1 + padding_pdf):
                continue
            if _interval_overlap_pdf(start, end, ax0 - padding_pdf, ax1 + padding_pdf) >= 2:
                return True
    elif segment.orientation == "vertical":
        for anchor in text_anchors:
            ax0, ay0, ax1, ay1 = anchor.bbox_pdf
            if not (ax0 - padding_pdf <= axis <= ax1 + padding_pdf):
                continue
            if _interval_overlap_pdf(start, end, ay0 - padding_pdf, ay1 + padding_pdf) >= 2:
                return True
    return False


def _segment_inside_component_box(
    segment: WireSegmentCandidate,
    component_boxes: list[ComponentBoxCandidate],
    *,
    padding: int = 8,
) -> bool:
    return any(
        all(_point_in_bbox_px(endpoint, component_box.bbox_px, padding=padding)
            for endpoint in segment.endpoints_px)
        for component_box in component_boxes
    )


def _wire_trace_segments_from_candidates(
    *,
    wire_segments: list[WireSegmentCandidate],
    text_anchors: list[TextAnchor],
    reference_candidates: list[ReferenceCandidate],
    component_boxes: list[ComponentBoxCandidate],
) -> list[WireSegmentCandidate]:
    closed_rectangle_edges = _closed_rectangle_edge_segment_ids(wire_segments)
    reference_bboxes = tuple(reference.bbox_px for reference in reference_candidates)
    trace_segments: list[WireSegmentCandidate] = []

    for segment in wire_segments:
        if segment.segment_id in closed_rectangle_edges:
            continue
        if _segment_overlaps_text_anchor(segment, text_anchors):
            continue
        if _segment_inside_component_box(segment, component_boxes):
            continue
        if any(
            _bbox_intersects_px(
                segment.bbox_px,
                reference_bbox,
                padding=REFERENCE_GLYPH_PADDING_PX,
            )
            for reference_bbox in reference_bboxes
        ):
            continue
        trace_segments.append(segment)

    return trace_segments


def _endpoint_distance(
    a: tuple[float, float],
    b: tuple[float, float],
) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def _point_near_segment_endpoint(
    point: tuple[float, float],
    segment: WireSegmentCandidate,
    *,
    tolerance_pdf: float,
) -> bool:
    return any(
        _endpoint_distance(point, endpoint) <= tolerance_pdf
        for endpoint in segment.endpoints_pdf
    )


def _detect_wire_interactions(
    *,
    wire_segments: list[WireSegmentCandidate],
    page_record: dict[str, Any],
    dpi: int,
    tolerance_pdf: float = 0.8,
) -> list[WireInteractionCandidate]:
    render_width_px = int(page_record["render_width_px"])
    render_height_px = int(page_record["render_height_px"])
    horizontal = [segment for segment in wire_segments if segment.orientation == "horizontal"]
    vertical = [segment for segment in wire_segments if segment.orientation == "vertical"]
    interactions: list[WireInteractionCandidate] = []
    seen: set[tuple[str, str, int, int]] = set()

    for h_segment in horizontal:
        _, hy0, _, hy1 = h_segment.bbox_pdf
        h_y = (hy0 + hy1) / 2.0
        h_left = min(h_segment.endpoints_pdf[0][0], h_segment.endpoints_pdf[1][0])
        h_right = max(h_segment.endpoints_pdf[0][0], h_segment.endpoints_pdf[1][0])

        for v_segment in vertical:
            vx0, vy0, vx1, vy1 = v_segment.bbox_pdf
            v_x = (vx0 + vx1) / 2.0
            v_top = min(v_segment.endpoints_pdf[0][1], v_segment.endpoints_pdf[1][1])
            v_bottom = max(v_segment.endpoints_pdf[0][1], v_segment.endpoints_pdf[1][1])

            if not (h_left - tolerance_pdf <= v_x <= h_right + tolerance_pdf):
                continue
            if not (v_top - tolerance_pdf <= h_y <= v_bottom + tolerance_pdf):
                continue

            point_pdf = (v_x, h_y)
            h_endpoint_hit = _point_near_segment_endpoint(
                point_pdf,
                h_segment,
                tolerance_pdf=tolerance_pdf,
            )
            v_endpoint_hit = _point_near_segment_endpoint(
                point_pdf,
                v_segment,
                tolerance_pdf=tolerance_pdf,
            )
            if h_endpoint_hit or v_endpoint_hit:
                interaction_type = "endpoint_touch_candidate"
                classes = ("wire_interaction_candidate", "connection_evidence_candidate")
            else:
                interaction_type = "crossing_without_junction_evidence_candidate"
                classes = ("wire_interaction_candidate", "crossing_candidate")

            point_px = _pdf_point_to_px(
                point_pdf,
                dpi=dpi,
                render_width_px=render_width_px,
                render_height_px=render_height_px,
            )
            seen_key = (
                h_segment.segment_id,
                v_segment.segment_id,
                round(point_px[0]),
                round(point_px[1]),
            )
            if seen_key in seen:
                continue
            seen.add(seen_key)
            interactions.append(
                WireInteractionCandidate(
                    interaction_id=(
                        f"wire-interaction-p{h_segment.source_page:03d}-"
                        f"{len(interactions) + 1:04d}"
                    ),
                    source_page=h_segment.source_page,
                    interaction_type=interaction_type,
                    point_pdf=point_pdf,
                    point_px=point_px,
                    segment_ids=(h_segment.segment_id, v_segment.segment_id),
                    source_atom_ids=(h_segment.source_atom_id, v_segment.source_atom_id),
                    class_candidates=classes,
                )
            )

    return interactions


def _associate_text_to_geometry(
    *,
    text_anchors: list[TextAnchor],
    wire_segments: list[WireSegmentCandidate],
    component_boxes: list[ComponentBoxCandidate],
    max_wire_label_distance_px: float = 55.0,
    max_component_mark_distance_px: float = 190.0,
) -> list[TextGeometryAssociationCandidate]:
    associations: list[TextGeometryAssociationCandidate] = []

    for anchor in text_anchors:
        anchor_classes = set(anchor.class_candidates)
        anchor_center = _bbox_center_px(anchor.bbox_px)
        if anchor_classes & {"wire_label", "terminal_label"} and wire_segments:
            nearest_segment: WireSegmentCandidate | None = None
            nearest_distance = float("inf")
            nearest_point = anchor_center
            for segment in wire_segments:
                distance, point = _point_to_wire_segment_distance_px(anchor_center, segment)
                if distance < nearest_distance:
                    nearest_segment = segment
                    nearest_distance = distance
                    nearest_point = point

            if nearest_segment is not None and nearest_distance <= max_wire_label_distance_px:
                relation = (
                    "wire_label_near_wire_segment"
                    if "wire_label" in anchor_classes
                    else "terminal_label_near_wire_segment"
                )
                associations.append(
                    TextGeometryAssociationCandidate(
                        association_id=(
                            f"assoc-p{anchor.source_page:03d}-{len(associations) + 1:04d}"
                        ),
                        source_page=anchor.source_page,
                        source_anchor_id=anchor.anchor_id,
                        source_anchor_text=anchor.normalized_text,
                        source_anchor_classes=anchor.class_candidates,
                        target_type="wire_segment",
                        target_id=nearest_segment.segment_id,
                        relation_candidate=relation,
                        distance_px=nearest_distance,
                        anchor_center_px=anchor_center,
                        target_point_px=nearest_point,
                        class_candidates=("text_geometry_association_candidate", relation),
                    )
                )

        if "component_mark" in anchor_classes and component_boxes:
            nearest_box: ComponentBoxCandidate | None = None
            nearest_box_distance = float("inf")
            nearest_box_center = anchor_center
            for component_box in component_boxes:
                if component_box.mark_anchor_id == anchor.anchor_id:
                    distance = 0.0
                else:
                    distance = _point_distance_px(
                        anchor_center,
                        _bbox_center_px(component_box.bbox_px),
                    )
                if distance < nearest_box_distance:
                    nearest_box = component_box
                    nearest_box_distance = distance
                    nearest_box_center = _bbox_center_px(component_box.bbox_px)

            if (
                nearest_box is not None
                and nearest_box_distance <= max_component_mark_distance_px
            ):
                relation = "component_mark_near_component_box"
                associations.append(
                    TextGeometryAssociationCandidate(
                        association_id=(
                            f"assoc-p{anchor.source_page:03d}-{len(associations) + 1:04d}"
                        ),
                        source_page=anchor.source_page,
                        source_anchor_id=anchor.anchor_id,
                        source_anchor_text=anchor.normalized_text,
                        source_anchor_classes=anchor.class_candidates,
                        target_type="component_box",
                        target_id=nearest_box.component_box_id,
                        relation_candidate=relation,
                        distance_px=nearest_box_distance,
                        anchor_center_px=anchor_center,
                        target_point_px=nearest_box_center,
                        class_candidates=("text_geometry_association_candidate", relation),
                    )
                )

    return associations


def _component_mark_candidates_from_text_anchors(
    text_anchors: list[TextAnchor],
    *,
    max_nearby_distance_px: float = 190.0,
) -> list[ComponentMarkCandidate]:
    marks = [
        anchor
        for anchor in text_anchors
        if "component_mark" in anchor.class_candidates
    ]
    candidates: list[ComponentMarkCandidate] = []

    for mark in marks:
        mark_center = _bbox_center_px(mark.bbox_px)
        nearby: list[tuple[float, TextAnchor]] = []
        location_tag_ids: list[str] = []
        for anchor in text_anchors:
            if anchor.anchor_id == mark.anchor_id:
                continue
            anchor_classes = set(anchor.class_candidates)
            if anchor_classes & {"grid_reference", "page_metadata"}:
                continue

            distance = _point_distance_px(mark_center, _bbox_center_px(anchor.bbox_px))
            if distance > max_nearby_distance_px:
                continue

            nearby.append((distance, anchor))
            if "location_tag" in anchor_classes:
                location_tag_ids.append(anchor.anchor_id)

        nearby.sort(key=lambda item: item[0])
        candidates.append(
            ComponentMarkCandidate(
                component_candidate_id=(
                    f"component-mark-p{mark.source_page:03d}-{len(candidates) + 1:04d}"
                ),
                source_page=mark.source_page,
                mark_anchor_id=mark.anchor_id,
                mark_text=mark.normalized_text,
                mark_bbox_px=mark.bbox_px,
                mark_bbox_pdf=mark.bbox_pdf,
                nearby_anchor_ids=tuple(anchor.anchor_id for _, anchor in nearby[:12]),
                nearby_location_tag_anchor_ids=tuple(dict.fromkeys(location_tag_ids)),
                class_candidates=(
                    "component_mark_candidate",
                    "text_anchor_component_mark_candidate",
                ),
            )
        )

    return candidates


def _component_family(mark_text: str) -> str:
    match = re.match(r"[A-Z]+", mark_text.strip().upper())
    return match.group(0) if match else "UNKNOWN"


def _component_search_window_px(
    mark_bbox_px: tuple[int, int, int, int],
    *,
    family: str,
) -> tuple[int, int, int, int]:
    center_x, center_y = _bbox_center_px(mark_bbox_px)
    if family == "MCB":
        return (center_x - 340, center_y - 70, center_x - 120, center_y + 125)
    if family == "CT":
        return (center_x + 35, center_y - 75, center_x + 310, center_y + 95)
    if family == "F":
        return (center_x - 35, center_y - 60, center_x + 90, center_y + 110)
    if family == "PL":
        return (center_x - 55, center_y + 5, center_x + 95, center_y + 125)
    if family == "WHM":
        return (center_x - 100, center_y + 10, center_x + 340, center_y + 875)
    if family == "TB":
        return (center_x - 300, center_y - 20, center_x + 300, center_y + 2200)
    return (center_x - 110, center_y - 110, center_x + 130, center_y + 130)


def _component_box_atom_candidate(atom: GraphicAtom, *, family: str) -> bool:
    classes = set(atom.class_candidates)
    if "frame_or_title_block_candidate" in classes:
        return False
    if family == "WHM":
        return atom.kind == "l"
    if family == "TB":
        return atom.kind in {"l", "re"}
    if family == "PL" and "long_line_candidate" in classes:
        return False
    if family == "PL" and atom.kind in {"c", "re"}:
        return True
    if family in {"F", "MCB"} and atom.kind == "re":
        return True
    if family not in {"CT", "F", "MCB"} and atom.kind == "re":
        return True
    if atom.kind != "l" or len(atom.points_pdf) != 2:
        return False
    return _line_length(atom.points_pdf) <= 70


def _component_box_candidates_from_marks(
    *,
    component_marks: list[ComponentMarkCandidate],
    graphic_atoms: list[GraphicAtom],
    detections: list[VectorMatch],
    template: VectorTemplate,
    page_record: dict[str, Any],
    max_detection_distance_px: float = 225.0,
) -> list[ComponentBoxCandidate]:
    render_width_px = int(page_record["render_width_px"])
    render_height_px = int(page_record["render_height_px"])
    used_detection_ids: set[str] = set()
    boxes: list[ComponentBoxCandidate] = []

    for mark in component_marks:
        family = _component_family(mark.mark_text)
        mark_center = _bbox_center_px(mark.mark_bbox_px)
        nearest_detection: tuple[float, str, VectorMatch] | None = None
        if family == "ELB":
            for detection in detections:
                detection_id = _detection_id(detection, template)
                if detection_id in used_detection_ids:
                    continue
                distance = _point_distance_px(mark_center, _bbox_center_px(detection.bbox_px))
                if distance > max_detection_distance_px:
                    continue
                if nearest_detection is None or distance < nearest_detection[0]:
                    nearest_detection = (distance, detection_id, detection)

        if nearest_detection is not None:
            _, detection_id, detection = nearest_detection
            used_detection_ids.add(detection_id)
            boxes.append(
                ComponentBoxCandidate(
                    component_box_id=f"component-box-p{mark.source_page:03d}-{len(boxes) + 1:04d}",
                    source_page=mark.source_page,
                    mark_text=mark.mark_text,
                    mark_anchor_id=mark.mark_anchor_id,
                    mark_bbox_px=mark.mark_bbox_px,
                    mark_bbox_pdf=mark.mark_bbox_pdf,
                    bbox_px=detection.bbox_px,
                    bbox_pdf=detection.bbox_pdf,
                    source_detection_ids=(detection_id,),
                    source_atom_ids=(),
                    source_kind="fingerprint_component_box",
                    class_candidates=(
                        "component_box_candidate",
                        "fingerprint_component_box_candidate",
                        f"{family.lower()}_component_box_candidate",
                    ),
                )
            )
            continue

        window = _component_search_window_px(mark.mark_bbox_px, family=family)
        candidate_atoms = [
            atom
            for atom in graphic_atoms
            if _component_box_atom_candidate(atom, family=family)
            and _point_in_bbox_px(_bbox_center_px(atom.bbox_px), window)
        ]
        if family in {"TB", "WHM"}:
            candidate_atoms = [
                atom
                for atom in candidate_atoms
                if atom.bbox_px[0] >= window[0]
                and atom.bbox_px[2] <= window[2]
                and atom.bbox_px[1] >= window[1]
                and atom.bbox_px[3] <= window[3]
            ]
        if family == "F":
            candidate_atoms = [
                atom
                for atom in candidate_atoms
                if _bbox_center_px(atom.bbox_px)[1] >= mark.mark_bbox_px[3] - 6
            ]

        if candidate_atoms:
            bbox_px = _union_atom_bbox_px(candidate_atoms)
            bbox_pdf = _union_atom_bbox_pdf(candidate_atoms)
            source_kind = "mark_guided_graphic_cluster"
            class_candidates = (
                "component_box_candidate",
                "mark_guided_graphic_cluster_component_box_candidate",
                f"{family.lower()}_component_box_candidate",
            )
        else:
            bbox_px = mark.mark_bbox_px
            bbox_pdf = mark.mark_bbox_pdf
            source_kind = "mark_only_component_box"
            class_candidates = (
                "component_box_candidate",
                "mark_only_component_box_candidate",
                f"{family.lower()}_component_box_candidate",
            )

        boxes.append(
            ComponentBoxCandidate(
                component_box_id=f"component-box-p{mark.source_page:03d}-{len(boxes) + 1:04d}",
                source_page=mark.source_page,
                mark_text=mark.mark_text,
                mark_anchor_id=mark.mark_anchor_id,
                mark_bbox_px=mark.mark_bbox_px,
                mark_bbox_pdf=mark.mark_bbox_pdf,
                bbox_px=_expand_bbox_px(
                    bbox_px,
                    padding=8,
                    render_width_px=render_width_px,
                    render_height_px=render_height_px,
                ),
                bbox_pdf=_expand_bbox_pdf(bbox_pdf, padding=2.0),
                source_detection_ids=(),
                source_atom_ids=tuple(atom.atom_id for atom in candidate_atoms),
                source_kind=source_kind,
                class_candidates=class_candidates,
            )
        )

    return boxes


def _numeric_reference_seed(anchor: TextAnchor, *, page_height: float) -> bool:
    if not re.fullmatch(r"\d{1,2}", anchor.normalized_text):
        return False
    if set(anchor.class_candidates) & {"grid_reference", "page_metadata"}:
        return False
    if _bbox_height(anchor.bbox_pdf) < 4.8:
        return False
    return anchor.bbox_pdf[1] <= page_height - 120


def _reference_candidates_from_text_anchors(
    text_anchors: list[TextAnchor],
    *,
    page_height: float,
    column_tolerance_px: int = 12,
    max_stack_step_px: int = 32,
) -> list[ReferenceCandidate]:
    """Group exact two-token numeric stacks as page-local reference candidates."""
    numeric_anchors = [
        anchor
        for anchor in text_anchors
        if _numeric_reference_seed(anchor, page_height=page_height)
    ]
    columns: list[list[tuple[TextAnchor, int, int]]] = []

    for anchor in sorted(numeric_anchors, key=lambda item: _bbox_center_px(item.bbox_px)[0]):
        center_x, center_y = _bbox_center_px(anchor.bbox_px)
        for column in columns:
            average_x = sum(item[1] for item in column) / len(column)
            if abs(center_x - average_x) <= column_tolerance_px:
                column.append((anchor, center_x, center_y))
                break
        else:
            columns.append([(anchor, center_x, center_y)])

    candidate_runs: list[list[tuple[TextAnchor, int, int]]] = []
    for column in columns:
        column.sort(key=lambda item: item[2])
        run: list[tuple[TextAnchor, int, int]] = []
        previous_center_y: int | None = None

        for item in column:
            _, _, center_y = item
            if previous_center_y is None or center_y - previous_center_y <= max_stack_step_px:
                run.append(item)
            else:
                if len(run) == 2:
                    candidate_runs.append(run)
                run = [item]
            previous_center_y = center_y

        if len(run) == 2:
            candidate_runs.append(run)

    candidate_runs.sort(
        key=lambda item: (
            _bbox_union_px(item[0][0].bbox_px, item[1][0].bbox_px)[1],
            _bbox_union_px(item[0][0].bbox_px, item[1][0].bbox_px)[0],
        )
    )
    return [
        _reference_candidate_from_run(run, index=index)
        for index, run in enumerate(candidate_runs, start=1)
    ]


def _reference_candidate_from_run(
    run: list[tuple[TextAnchor, int, int]],
    *,
    index: int,
) -> ReferenceCandidate:
    top_anchor = run[0][0]
    bottom_anchor = run[1][0]
    bbox_px = _bbox_union_px(top_anchor.bbox_px, bottom_anchor.bbox_px)
    bbox_pdf = _bbox_union_pdf(top_anchor.bbox_pdf, bottom_anchor.bbox_pdf)
    return ReferenceCandidate(
        reference_candidate_id=f"reference-p{top_anchor.source_page:03d}-{index:04d}",
        source_page=top_anchor.source_page,
        reference_text=f"{top_anchor.normalized_text}/{bottom_anchor.normalized_text}",
        top_anchor_id=top_anchor.anchor_id,
        bottom_anchor_id=bottom_anchor.anchor_id,
        reference_anchor_ids=(top_anchor.anchor_id, bottom_anchor.anchor_id),
        bbox_px=bbox_px,
        bbox_pdf=bbox_pdf,
        class_candidates=(
            "reference_candidate",
            "stacked_numeric_reference_candidate",
        ),
    )


def _terminal_text_seed(anchor: TextAnchor) -> bool:
    return not set(anchor.class_candidates) & {"grid_reference", "page_metadata"}


def _terminal_text_pattern(value: str) -> bool:
    token = _strip_wrapping_punctuation(value)
    return bool(
        re.fullmatch(r"\d{1,2}", token)
        or re.fullmatch(r"[A-Z]\d{1,2}[A-Z]?", token)
        or re.fullmatch(r"[A-Z][+-]", token)
        or re.fullmatch(r"[A-Z]", token)
        or token == "PE"
    )


def _union_atom_bbox_px(atoms: list[GraphicAtom]) -> tuple[int, int, int, int]:
    return (
        min(atom.bbox_px[0] for atom in atoms),
        min(atom.bbox_px[1] for atom in atoms),
        max(atom.bbox_px[2] for atom in atoms),
        max(atom.bbox_px[3] for atom in atoms),
    )


def _union_atom_bbox_pdf(atoms: list[GraphicAtom]) -> tuple[float, float, float, float]:
    return (
        min(atom.bbox_pdf[0] for atom in atoms),
        min(atom.bbox_pdf[1] for atom in atoms),
        max(atom.bbox_pdf[2] for atom in atoms),
        max(atom.bbox_pdf[3] for atom in atoms),
    )


def _terminal_node_candidates_from_text_and_graphics(
    *,
    text_anchors: list[TextAnchor],
    graphic_atoms: list[GraphicAtom],
    curve_distance_px: float = 26.0,
) -> list[TerminalNodeCandidate]:
    curve_atoms = [
        atom
        for atom in graphic_atoms
        if "curve_symbol_stroke" in atom.class_candidates
    ]
    candidates: list[TerminalNodeCandidate] = []

    for anchor in text_anchors:
        if not _terminal_text_seed(anchor):
            continue
        if not _terminal_text_pattern(anchor.normalized_text):
            continue

        anchor_center = _bbox_center_px(anchor.bbox_px)
        nearby_curve_atoms = [
            atom
            for atom in curve_atoms
            if _point_distance_px(anchor_center, _bbox_center_px(atom.bbox_px))
            <= curve_distance_px
        ]
        if len(nearby_curve_atoms) < 4:
            continue

        enclosure_bbox_px = _union_atom_bbox_px(nearby_curve_atoms)
        width = enclosure_bbox_px[2] - enclosure_bbox_px[0]
        height = enclosure_bbox_px[3] - enclosure_bbox_px[1]
        if not (18 <= width <= 80 and 18 <= height <= 80):
            continue
        if abs(width - height) > 25:
            continue
        if not (
            enclosure_bbox_px[0] - 4 <= anchor_center[0] <= enclosure_bbox_px[2] + 4
            and enclosure_bbox_px[1] - 4 <= anchor_center[1] <= enclosure_bbox_px[3] + 4
        ):
            continue

        candidates.append(
            TerminalNodeCandidate(
                terminal_candidate_id=(
                    f"terminal-node-p{anchor.source_page:03d}-{len(candidates) + 1:04d}"
                ),
                source_page=anchor.source_page,
                terminal_text=anchor.normalized_text,
                text_anchor_id=anchor.anchor_id,
                text_bbox_px=anchor.bbox_px,
                text_bbox_pdf=anchor.bbox_pdf,
                enclosure_atom_ids=tuple(atom.atom_id for atom in nearby_curve_atoms),
                enclosure_bbox_px=enclosure_bbox_px,
                enclosure_bbox_pdf=_union_atom_bbox_pdf(nearby_curve_atoms),
                class_candidates=(
                    "terminal_node_candidate",
                    "text_enclosed_by_curve_candidate",
                ),
            )
        )

    return sorted(
        candidates,
        key=lambda item: (item.enclosure_bbox_px[1], item.enclosure_bbox_px[0]),
    )


def _associate_terminal_nodes_to_wire_segments(
    *,
    terminal_nodes: list[TerminalNodeCandidate],
    wire_segments: list[WireSegmentCandidate],
    max_distance_px: float = 22.0,
) -> list[TerminalWireAssociationCandidate]:
    associations: list[TerminalWireAssociationCandidate] = []

    for terminal in terminal_nodes:
        terminal_center = _bbox_center_px(terminal.enclosure_bbox_px)
        for segment in wire_segments:
            distance, nearest_point = _point_to_wire_segment_distance_px(
                terminal_center,
                segment,
            )
            if distance > max_distance_px:
                continue

            associations.append(
                TerminalWireAssociationCandidate(
                    association_id=(
                        f"terminal-wire-p{terminal.source_page:03d}-"
                        f"{len(associations) + 1:04d}"
                    ),
                    source_page=terminal.source_page,
                    terminal_candidate_id=terminal.terminal_candidate_id,
                    terminal_text=terminal.terminal_text,
                    wire_segment_id=segment.segment_id,
                    relation_candidate="terminal_node_touching_wire_segment",
                    distance_px=distance,
                    terminal_center_px=terminal_center,
                    nearest_wire_point_px=nearest_point,
                    class_candidates=(
                        "terminal_wire_association_candidate",
                        "terminal_node_touching_wire_segment",
                    ),
                )
            )

    return associations


def _associate_references_to_wire_segments(
    *,
    reference_candidates: list[ReferenceCandidate],
    wire_segments: list[WireSegmentCandidate],
    max_distance_px: float = 70.0,
    max_short_segment_distance_px: float = 45.0,
    max_segments_per_reference: int = 3,
    min_short_segment_length_pdf: float = 7.5,
) -> list[ReferenceWireAssociationCandidate]:
    associations: list[ReferenceWireAssociationCandidate] = []
    reference_bboxes = tuple(reference.bbox_px for reference in reference_candidates)

    for reference in reference_candidates:
        reference_center = _bbox_center_px(reference.bbox_px)
        reference_matches: list[tuple[float, tuple[int, int], WireSegmentCandidate]] = []
        for segment in wire_segments:
            if any(
                _bbox_intersects_px(
                    segment.bbox_px,
                    reference_bbox,
                    padding=REFERENCE_GLYPH_PADDING_PX,
                )
                for reference_bbox in reference_bboxes
            ):
                continue
            is_long_run = "long_run_candidate" in segment.class_candidates
            if not is_long_run and segment.length_pdf < min_short_segment_length_pdf:
                continue
            distance, nearest_point = _point_to_wire_segment_distance_px(
                reference_center,
                segment,
            )
            if distance > max_distance_px:
                continue
            if (
                not is_long_run
                and (
                    segment.orientation != "horizontal"
                    or distance > max_short_segment_distance_px
                )
            ):
                continue
            reference_matches.append((distance, nearest_point, segment))

        reference_matches.sort(
            key=lambda item: (
                item[0],
                0 if "long_run_candidate" in item[2].class_candidates else 1,
                item[2].segment_id,
            )
        )
        for distance, nearest_point, segment in reference_matches[
            :max_segments_per_reference
        ]:
            associations.append(
                ReferenceWireAssociationCandidate(
                    association_id=(
                        f"reference-wire-p{reference.source_page:03d}-"
                        f"{len(associations) + 1:04d}"
                    ),
                    source_page=reference.source_page,
                    reference_candidate_id=reference.reference_candidate_id,
                    reference_text=reference.reference_text,
                    wire_segment_id=segment.segment_id,
                    relation_candidate="reference_marker_near_wire_segment",
                    distance_px=distance,
                    reference_center_px=reference_center,
                    nearest_wire_point_px=nearest_point,
                    class_candidates=(
                        "reference_wire_association_candidate",
                        "reference_marker_near_wire_segment",
                    ),
                )
            )

    return associations


def _ordered_unique(values: list[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(value for value in values if value))


def _wire_path_candidates_from_trace_segments(
    *,
    wire_trace_segments: list[WireSegmentCandidate],
    wire_interactions: list[WireInteractionCandidate],
    terminal_wire_associations: list[TerminalWireAssociationCandidate],
    reference_wire_associations: list[ReferenceWireAssociationCandidate],
    text_associations: list[TextGeometryAssociationCandidate],
) -> list[WirePathCandidate]:
    trace_by_id = {segment.segment_id: segment for segment in wire_trace_segments}
    parent = {segment_id: segment_id for segment_id in trace_by_id}

    def find(segment_id: str) -> str:
        while parent[segment_id] != segment_id:
            parent[segment_id] = parent[parent[segment_id]]
            segment_id = parent[segment_id]
        return segment_id

    def union(left: str, right: str) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    connection_interactions = [
        interaction
        for interaction in wire_interactions
        if interaction.interaction_type == "endpoint_touch_candidate"
        and all(segment_id in trace_by_id for segment_id in interaction.segment_ids)
    ]
    for interaction in connection_interactions:
        first, second = interaction.segment_ids
        union(first, second)

    groups: dict[str, list[str]] = {}
    for segment_id in trace_by_id:
        groups.setdefault(find(segment_id), []).append(segment_id)

    grouped_segment_ids = sorted(
        groups.values(),
        key=lambda segment_ids: (
            min(trace_by_id[segment_id].bbox_px[1] for segment_id in segment_ids),
            min(trace_by_id[segment_id].bbox_px[0] for segment_id in segment_ids),
        ),
    )
    paths: list[WirePathCandidate] = []
    for segment_ids in grouped_segment_ids:
        segment_ids = sorted(
            segment_ids,
            key=lambda segment_id: (
                trace_by_id[segment_id].bbox_px[1],
                trace_by_id[segment_id].bbox_px[0],
            ),
        )
        segment_id_set = set(segment_ids)
        segments = [trace_by_id[segment_id] for segment_id in segment_ids]
        bbox_px = segments[0].bbox_px
        bbox_pdf = segments[0].bbox_pdf
        for segment in segments[1:]:
            bbox_px = _bbox_union_px(bbox_px, segment.bbox_px)
            bbox_pdf = _bbox_union_pdf(bbox_pdf, segment.bbox_pdf)

        path_interactions = [
            interaction.interaction_id
            for interaction in connection_interactions
            if set(interaction.segment_ids).issubset(segment_id_set)
        ]
        terminal_matches = [
            association
            for association in terminal_wire_associations
            if association.wire_segment_id in segment_id_set
        ]
        reference_matches = [
            association
            for association in reference_wire_associations
            if association.wire_segment_id in segment_id_set
        ]
        text_matches = [
            association
            for association in text_associations
            if association.target_type == "wire_segment"
            and association.target_id in segment_id_set
        ]
        class_candidates = ["wire_path_candidate"]
        if len(segment_ids) == 1:
            class_candidates.append("single_segment_wire_path_candidate")
        else:
            class_candidates.append("connected_wire_path_candidate")

        paths.append(
            WirePathCandidate(
                path_id=f"wire-path-p{segments[0].source_page:03d}-{len(paths) + 1:04d}",
                source_page=segments[0].source_page,
                wire_segment_ids=tuple(segment_ids),
                wire_interaction_ids=_ordered_unique(path_interactions),
                terminal_candidate_ids=_ordered_unique(
                    [association.terminal_candidate_id for association in terminal_matches]
                ),
                terminal_texts=_ordered_unique(
                    [association.terminal_text for association in terminal_matches]
                ),
                reference_candidate_ids=_ordered_unique(
                    [
                        association.reference_candidate_id
                        for association in reference_matches
                    ]
                ),
                reference_texts=_ordered_unique(
                    [association.reference_text for association in reference_matches]
                ),
                text_anchor_ids=_ordered_unique(
                    [association.source_anchor_id for association in text_matches]
                ),
                text_labels=_ordered_unique(
                    [association.source_anchor_text for association in text_matches]
                ),
                bbox_px=bbox_px,
                bbox_pdf=bbox_pdf,
                class_candidates=tuple(class_candidates),
            )
        )

    return paths


def _point_in_bbox_px(
    point: tuple[int, int],
    bbox: tuple[int, int, int, int],
    *,
    padding: int = 0,
) -> bool:
    x, y = point
    return (
        bbox[0] - padding <= x <= bbox[2] + padding
        and bbox[1] - padding <= y <= bbox[3] + padding
    )


def _point_near_bbox_boundary_px(
    point: tuple[int, int],
    bbox: tuple[int, int, int, int],
    *,
    padding: int,
) -> bool:
    if not _point_in_bbox_px(point, bbox, padding=padding):
        return False
    x, y = point
    return min(abs(x - bbox[0]), abs(x - bbox[2]), abs(y - bbox[1]), abs(y - bbox[3])) <= padding


def _wire_endpoint_candidates_from_paths(
    *,
    wire_paths: list[WirePathCandidate],
    wire_trace_segments: list[WireSegmentCandidate],
    wire_interactions: list[WireInteractionCandidate],
    terminal_nodes: list[TerminalNodeCandidate],
    reference_candidates: list[ReferenceCandidate],
    component_boxes: list[ComponentBoxCandidate],
    endpoint_touch_tolerance_pdf: float = 0.8,
) -> list[WireEndpointCandidate]:
    segment_by_id = {segment.segment_id: segment for segment in wire_trace_segments}
    component_box_by_id = {
        component_box.component_box_id: component_box
        for component_box in component_boxes
    }
    touch_interactions = [
        interaction
        for interaction in wire_interactions
        if interaction.interaction_type == "endpoint_touch_candidate"
    ]
    endpoints: list[WireEndpointCandidate] = []
    seen: set[tuple[str, int, int]] = set()

    for path in wire_paths:
        for segment_id in path.wire_segment_ids:
            segment = segment_by_id.get(segment_id)
            if segment is None:
                continue
            for endpoint_index, (point_pdf, point_px) in enumerate(
                zip(segment.endpoints_pdf, segment.endpoints_px, strict=True)
            ):
                touch_ids = tuple(
                    interaction.interaction_id
                    for interaction in touch_interactions
                    if segment.segment_id in interaction.segment_ids
                    and _endpoint_distance(point_pdf, interaction.point_pdf)
                    <= endpoint_touch_tolerance_pdf
                )
                near_terminals = [
                    terminal
                    for terminal in terminal_nodes
                    if _point_in_bbox_px(point_px, terminal.enclosure_bbox_px, padding=14)
                    or _point_distance_px(
                        point_px,
                        _bbox_center_px(terminal.enclosure_bbox_px),
                    )
                    <= 24
                ]
                near_references = [
                    reference
                    for reference in reference_candidates
                    if _point_in_bbox_px(point_px, reference.bbox_px, padding=48)
                    or _point_distance_px(point_px, _bbox_center_px(reference.bbox_px)) <= 58
                ]
                near_component_box_ids = tuple(
                    component_box_id
                    for component_box_id, component_box in component_box_by_id.items()
                    if _point_near_bbox_boundary_px(
                        point_px,
                        component_box.bbox_px,
                        padding=18,
                    )
                )
                near_component_mark_texts = _ordered_unique(
                    [
                        component_box_by_id[component_box_id].mark_text
                        for component_box_id in near_component_box_ids
                    ]
                )

                if (
                    touch_ids
                    and not near_terminals
                    and not near_references
                    and not near_component_box_ids
                ):
                    continue

                seen_key = (path.path_id, point_px[0], point_px[1])
                if seen_key in seen:
                    continue
                seen.add(seen_key)

                classes = ["wire_endpoint_candidate", "wire_path_endpoint_candidate"]
                if touch_ids:
                    classes.append("endpoint_touch_evidence_candidate")
                else:
                    classes.append("open_wire_endpoint_candidate")
                if near_terminals:
                    classes.append("terminal_wire_endpoint_candidate")
                if near_references:
                    classes.append("continuation_reference_endpoint_candidate")
                if near_component_box_ids:
                    classes.append("component_boundary_endpoint_candidate")
                if (
                    not near_terminals
                    and not near_references
                    and not near_component_box_ids
                    and not touch_ids
                ):
                    classes.append("unresolved_wire_endpoint_candidate")

                endpoints.append(
                    WireEndpointCandidate(
                        endpoint_id=(
                            f"wire-endpoint-p{segment.source_page:03d}-"
                            f"{len(endpoints) + 1:04d}"
                        ),
                        source_page=segment.source_page,
                        wire_path_id=path.path_id,
                        wire_segment_id=segment.segment_id,
                        endpoint_index=endpoint_index,
                        point_pdf=point_pdf,
                        point_px=point_px,
                        touch_interaction_ids=touch_ids,
                        near_terminal_candidate_ids=_ordered_unique(
                            [terminal.terminal_candidate_id for terminal in near_terminals]
                        ),
                        near_terminal_texts=_ordered_unique(
                            [terminal.terminal_text for terminal in near_terminals]
                        ),
                        near_reference_candidate_ids=_ordered_unique(
                            [
                                reference.reference_candidate_id
                                for reference in near_references
                            ]
                        ),
                        near_reference_texts=_ordered_unique(
                            [reference.reference_text for reference in near_references]
                        ),
                        near_component_box_ids=near_component_box_ids,
                        near_component_mark_texts=near_component_mark_texts,
                        path_text_labels=path.text_labels,
                        class_candidates=tuple(dict.fromkeys(classes)),
                    )
                )

    return endpoints


def _wire_object_associations_from_endpoints(
    wire_endpoints: list[WireEndpointCandidate],
) -> list[WireObjectAssociationCandidate]:
    grouped: dict[tuple[str, str, str, str], list[WireEndpointCandidate]] = {}

    for endpoint in wire_endpoints:
        for target_id, target_label in zip(
            endpoint.near_terminal_candidate_ids,
            endpoint.near_terminal_texts,
            strict=True,
        ):
            grouped.setdefault(
                (
                    endpoint.wire_path_id,
                    "terminal_node",
                    target_id,
                    target_label,
                ),
                [],
            ).append(endpoint)
        for target_id, target_label in zip(
            endpoint.near_reference_candidate_ids,
            endpoint.near_reference_texts,
            strict=True,
        ):
            grouped.setdefault(
                (
                    endpoint.wire_path_id,
                    "continuation_reference",
                    target_id,
                    target_label,
                ),
                [],
            ).append(endpoint)
        for target_id, target_label in zip(
            endpoint.near_component_box_ids,
            endpoint.near_component_mark_texts,
            strict=True,
        ):
            grouped.setdefault(
                (
                    endpoint.wire_path_id,
                    "component_box",
                    target_id,
                    target_label,
                ),
                [],
            ).append(endpoint)

    associations: list[WireObjectAssociationCandidate] = []
    relation_by_target_type = {
        "terminal_node": "wire_endpoint_near_terminal_node",
        "continuation_reference": "wire_endpoint_near_continuation_reference",
        "component_box": "wire_endpoint_near_component_box",
    }
    for (wire_path_id, target_type, target_id, target_label), endpoints in sorted(
        grouped.items(),
        key=lambda item: (item[0][0], item[0][1], item[0][3]),
    ):
        relation = relation_by_target_type[target_type]
        associations.append(
            WireObjectAssociationCandidate(
                association_id=(
                    f"wire-object-p{endpoints[0].source_page:03d}-"
                    f"{len(associations) + 1:04d}"
                ),
                source_page=endpoints[0].source_page,
                wire_path_id=wire_path_id,
                target_type=target_type,
                target_id=target_id,
                target_label=target_label,
                relation_candidate=relation,
                endpoint_ids=_ordered_unique([endpoint.endpoint_id for endpoint in endpoints]),
                endpoint_points_px=tuple(endpoint.point_px for endpoint in endpoints),
                path_text_labels=_ordered_unique(
                    [
                        label
                        for endpoint in endpoints
                        for label in endpoint.path_text_labels
                    ]
                ),
                class_candidates=(
                    "wire_object_association_candidate",
                    relation,
                ),
            )
        )

    return associations


def _extract_text_anchors(
    pdf_path: Path,
    *,
    pages: range,
    dpi: int,
    render_sizes: dict[int, tuple[int, int]],
) -> dict[int, list[TextAnchor]]:
    anchors_by_page: dict[int, list[TextAnchor]] = {}
    with fitz.open(pdf_path) as doc:
        for page_number in pages:
            page = doc.load_page(page_number - 1)
            page_width = float(page.rect.width)
            page_height = float(page.rect.height)
            render_width_px, render_height_px = render_sizes[page_number]
            words = sorted(
                page.get_text("words"),
                key=lambda word: (
                    round(float(word[1]), 3),
                    round(float(word[0]), 3),
                    int(word[5]),
                    int(word[6]),
                    int(word[7]),
                ),
            )
            page_anchors: list[TextAnchor] = []
            for index, word in enumerate(words, start=1):
                x0, y0, x1, y1, raw_text = word[:5]
                normalized_text = _normalize_anchor_text(str(raw_text))
                if not normalized_text:
                    continue
                bbox_pdf = (float(x0), float(y0), float(x1), float(y1))
                bbox_px = _pdf_bbox_to_px(
                    bbox_pdf,
                    dpi=dpi,
                    render_width_px=render_width_px,
                    render_height_px=render_height_px,
                )
                page_anchors.append(
                    TextAnchor(
                        anchor_id=f"text-p{page_number:03d}-{index:04d}",
                        source_page=page_number,
                        raw_text=str(raw_text),
                        normalized_text=normalized_text,
                        bbox_pdf=bbox_pdf,
                        bbox_px=bbox_px,
                        class_candidates=_classify_anchor_text(
                            raw_text=str(raw_text),
                            normalized_text=normalized_text,
                            bbox_pdf=bbox_pdf,
                            page_width=page_width,
                            page_height=page_height,
                        ),
                    )
                )
            anchors_by_page[page_number] = page_anchors
    return anchors_by_page


def _search_template_matches(
    con: sqlite3.Connection,
    *,
    template: VectorTemplate,
    pages: range,
    dpi: int,
    render_sizes: dict[int, tuple[int, int]],
    min_score: float,
) -> list[VectorMatch]:
    template_drawings = _template_core_drawings(con, template)
    template_signature, template_core_bbox = _normalized_drawing_signature(template_drawings)
    template_length = len(template_drawings)
    matches: list[VectorMatch] = []

    for page in pages:
        drawings = _load_page_drawings(con, page)
        render_width_px, render_height_px = render_sizes[page]
        page_matches: list[VectorMatch] = []

        for index in range(0, len(drawings) - template_length + 1):
            candidate = drawings[index : index + template_length]
            candidate_core_bbox = _bbox_pdf(candidate)
            candidate_width = _bbox_width(candidate_core_bbox)
            candidate_height = _bbox_height(candidate_core_bbox)
            if candidate_width < 20 or candidate_height < 20:
                continue
            if candidate_width > 80 or candidate_height > 80:
                continue

            score, candidate_core_bbox, _, _ = _score_window(
                template_signature,
                template_core_bbox,
                candidate,
            )
            if score < min_score:
                continue

            component_bbox_pdf = _component_bbox_from_core(
                candidate_core_bbox,
                template_core_bbox,
                template.component_bbox_pdf,
            )
            bbox_px = _pdf_bbox_to_px(
                component_bbox_pdf,
                dpi=dpi,
                render_width_px=render_width_px,
                render_height_px=render_height_px,
            )
            page_matches.append(
                VectorMatch(
                    page=page,
                    score=score,
                    bbox_pdf=component_bbox_pdf,
                    bbox_px=bbox_px,
                    core_bbox_pdf=candidate_core_bbox,
                    source_vector_ids=tuple(drawing.drawing_id for drawing in candidate),
                    source_seqnos=tuple(drawing.seqno for drawing in candidate),
                )
            )

        kept: list[VectorMatch] = []
        for match in sorted(page_matches, key=lambda item: item.score, reverse=True):
            if all(_bbox_iou(match.bbox_px, existing.bbox_px) < 0.80 for existing in kept):
                kept.append(match)
        matches.extend(kept)

    return sorted(matches, key=lambda item: (item.page, -item.score))


def _render_canonical_pages(
    pdf_path: Path,
    *,
    pages: range,
    dpi: int,
    output_dir: Path,
) -> dict[int, dict[str, Any]]:
    if not pdf_path.exists():
        raise ValueError(f"Schematic PDF does not exist: {pdf_path}")

    output_dir.mkdir(parents=True, exist_ok=True)
    page_records: dict[int, dict[str, Any]] = {}
    matrix = fitz.Matrix(dpi / 72.0, dpi / 72.0)

    with fitz.open(pdf_path) as doc:
        for page_number in pages:
            if page_number < 1 or page_number > doc.page_count:
                raise ValueError(f"Page {page_number} is out of range for {pdf_path}")
            page = doc.load_page(page_number - 1)
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            render_path = output_dir / f"page_{page_number:03d}_canonical.png"
            pixmap.save(str(render_path))
            page_records[page_number] = {
                "source_page": page_number,
                "render_width_px": int(pixmap.width),
                "render_height_px": int(pixmap.height),
                "canonical_render": str(render_path),
                "pdf_mediabox": list(page.mediabox),
                "pdf_cropbox": list(page.cropbox),
                "page_rotation": int(page.rotation),
                "pdf_to_render_transform": [dpi / 72.0, 0, 0, dpi / 72.0, 0, 0],
            }

    return page_records


def _write_validation_overlay(
    *,
    page_record: dict[str, Any],
    component_boxes: list[ComponentBoxCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    image = Image.open(render_path).convert("RGB")
    draw = ImageDraw.Draw(image)
    for component_box in component_boxes:
        x0, y0, x1, y1 = component_box.bbox_px
        draw.rectangle((x0, y0, x1, y1), outline=(0, 180, 0), width=4)
        label = component_box.mark_text
        text_y = y0 - 18 if y0 >= 18 else y1 + 4
        draw.text((x0, text_y), label, fill=(0, 120, 0))

    overlay_path = output_dir / f"page_{page_record['source_page']:03d}_validation_overlay.png"
    image.save(overlay_path)
    return str(overlay_path)


def _anchor_color(anchor: TextAnchor) -> tuple[int, int, int, int]:
    classes = set(anchor.class_candidates)
    if "component_mark" in classes:
        return (0, 168, 255, 210)
    if "wire_label" in classes:
        return (255, 198, 41, 210)
    if "location_tag" in classes:
        return (185, 116, 255, 220)
    if "terminal_label" in classes:
        return (50, 220, 165, 210)
    if "page_metadata" in classes:
        return (255, 118, 82, 190)
    if "grid_reference" in classes:
        return (125, 150, 175, 150)
    return (180, 210, 230, 120)


def _should_label_anchor(anchor: TextAnchor) -> bool:
    classes = set(anchor.class_candidates)
    return bool(classes & {"component_mark", "wire_label", "location_tag", "terminal_label"})


def _write_reconstruction_overlay(
    *,
    page_record: dict[str, Any],
    text_anchors: list[TextAnchor],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for anchor in text_anchors:
        x0, y0, x1, y1 = anchor.bbox_px
        color = _anchor_color(anchor)
        draw.rectangle((x0, y0, x1, y1), outline=color, width=2)
        if _should_label_anchor(anchor):
            label = anchor.normalized_text[:28]
            label_y = y0 - 12 if y0 >= 12 else y1 + 2
            draw.text((x0, label_y), label, fill=color)

    reconstruction_path = (
        output_dir / f"page_{page_record['source_page']:03d}_reconstruction_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(reconstruction_path)
    return str(reconstruction_path)


def _write_component_marks_overlay(
    *,
    page_record: dict[str, Any],
    component_marks: list[ComponentMarkCandidate],
    text_anchors: list[TextAnchor],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    anchor_by_id = {anchor.anchor_id: anchor for anchor in text_anchors}
    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for mark in component_marks:
        x0, y0, x1, y1 = mark.mark_bbox_px
        draw.rectangle((x0 - 3, y0 - 3, x1 + 3, y1 + 3), outline=(0, 155, 255, 235), width=4)
        draw.text((x0, y0 - 16 if y0 >= 16 else y1 + 3), mark.mark_text, fill=(0, 95, 200, 245))

        mark_center = _bbox_center_px(mark.mark_bbox_px)
        for location_anchor_id in mark.nearby_location_tag_anchor_ids:
            location_anchor = anchor_by_id.get(location_anchor_id)
            if location_anchor is None:
                continue
            lx0, ly0, lx1, ly1 = location_anchor.bbox_px
            location_center = _bbox_center_px(location_anchor.bbox_px)
            draw.rectangle(
                (lx0 - 2, ly0 - 2, lx1 + 2, ly1 + 2),
                outline=(180, 95, 255, 220),
                width=3,
            )
            draw.line((mark_center, location_center), fill=(120, 95, 255, 145), width=2)

    component_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_component_marks_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(component_overlay_path)
    return str(component_overlay_path)


def _write_component_boxes_overlay(
    *,
    page_record: dict[str, Any],
    component_boxes: list[ComponentBoxCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for component_box in component_boxes:
        x0, y0, x1, y1 = component_box.bbox_px
        mx0, my0, mx1, my1 = component_box.mark_bbox_px
        color = (
            (0, 180, 80, 245)
            if component_box.source_detection_ids
            else (0, 125, 255, 235)
        )
        draw.rectangle((x0, y0, x1, y1), outline=color, width=5)
        draw.rectangle((mx0 - 2, my0 - 2, mx1 + 2, my1 + 2), outline=(255, 190, 40, 220), width=2)
        label_y = y0 - 18 if y0 >= 18 else y1 + 4
        draw.text((x0, label_y), component_box.mark_text, fill=color)

    component_boxes_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_component_boxes_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(component_boxes_overlay_path)
    return str(component_boxes_overlay_path)


def _write_component_box_review_overlay(
    *,
    page_record: dict[str, Any],
    component_box_records: list[dict[str, Any]],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for component_box in component_box_records:
        visual_review_flags = component_box["visual_review_flags"]
        if not visual_review_flags:
            continue
        x0, y0, x1, y1 = component_box["bbox_px"]
        color = (
            (255, 92, 52, 250)
            if len(visual_review_flags) > 1
            else (255, 165, 35, 245)
        )
        fill = (
            (255, 92, 52, 35)
            if len(visual_review_flags) > 1
            else (255, 165, 35, 30)
        )
        draw.rectangle((x0, y0, x1, y1), outline=color, fill=fill, width=7)
        label = f"{component_box['mark_text']} review"
        label_y = y0 - 22 if y0 >= 22 else y1 + 4
        draw.text((x0, label_y), label, fill=color)

    review_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_component_box_review_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(review_overlay_path)
    return str(review_overlay_path)


def _write_reference_candidates_overlay(
    *,
    page_record: dict[str, Any],
    reference_candidates: list[ReferenceCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for candidate in reference_candidates:
        x0, y0, x1, y1 = candidate.bbox_px
        draw.rounded_rectangle(
            (x0 - 4, y0 - 4, x1 + 4, y1 + 4),
            radius=5,
            outline=(255, 142, 35, 240),
            width=4,
        )
        draw.line((x0 - 7, y0 - 7, x1 + 7, y1 + 7), fill=(255, 210, 60, 115), width=2)
        draw.text((x1 + 7, max(0, y0 - 4)), candidate.reference_text, fill=(150, 65, 0, 245))

    reference_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_reference_candidates_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(reference_overlay_path)
    return str(reference_overlay_path)


def _write_terminal_nodes_overlay(
    *,
    page_record: dict[str, Any],
    terminal_nodes: list[TerminalNodeCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for candidate in terminal_nodes:
        ex0, ey0, ex1, ey1 = candidate.enclosure_bbox_px
        tx0, ty0, tx1, ty1 = candidate.text_bbox_px
        draw.ellipse((ex0 - 4, ey0 - 4, ex1 + 4, ey1 + 4), outline=(0, 180, 125, 240), width=4)
        draw.rectangle((tx0 - 2, ty0 - 2, tx1 + 2, ty1 + 2), outline=(0, 120, 255, 220), width=3)
        draw.text((ex1 + 7, max(0, ey0 - 4)), candidate.terminal_text, fill=(0, 95, 70, 245))

    terminal_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_terminal_nodes_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(terminal_overlay_path)
    return str(terminal_overlay_path)


def _write_terminal_wire_associations_overlay(
    *,
    page_record: dict[str, Any],
    terminal_nodes: list[TerminalNodeCandidate],
    terminal_wire_associations: list[TerminalWireAssociationCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    terminal_by_id = {terminal.terminal_candidate_id: terminal for terminal in terminal_nodes}
    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for association in terminal_wire_associations:
        terminal = terminal_by_id.get(association.terminal_candidate_id)
        if terminal is None:
            continue
        ex0, ey0, ex1, ey1 = terminal.enclosure_bbox_px
        tx, ty = association.terminal_center_px
        wx, wy = association.nearest_wire_point_px
        draw.line((tx, ty, wx, wy), fill=(255, 75, 80, 185), width=3)
        draw.ellipse((wx - 5, wy - 5, wx + 5, wy + 5), fill=(255, 75, 80, 205))
        draw.ellipse((ex0 - 4, ey0 - 4, ex1 + 4, ey1 + 4), outline=(0, 180, 125, 225), width=3)

    association_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_terminal_wire_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(association_overlay_path)
    return str(association_overlay_path)


def _write_reference_wire_associations_overlay(
    *,
    page_record: dict[str, Any],
    reference_candidates: list[ReferenceCandidate],
    reference_wire_associations: list[ReferenceWireAssociationCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    reference_by_id = {
        reference.reference_candidate_id: reference
        for reference in reference_candidates
    }
    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for association in reference_wire_associations:
        reference = reference_by_id.get(association.reference_candidate_id)
        if reference is None:
            continue
        x0, y0, x1, y1 = reference.bbox_px
        rx, ry = association.reference_center_px
        wx, wy = association.nearest_wire_point_px
        draw.line((rx, ry, wx, wy), fill=(245, 120, 25, 170), width=3)
        draw.ellipse((wx - 5, wy - 5, wx + 5, wy + 5), fill=(245, 120, 25, 205))
        draw.rounded_rectangle(
            (x0 - 4, y0 - 4, x1 + 4, y1 + 4),
            radius=5,
            outline=(255, 142, 35, 230),
            width=3,
        )

    reference_wire_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_reference_wire_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(reference_wire_overlay_path)
    return str(reference_wire_overlay_path)


def _atom_color(atom: GraphicAtom) -> tuple[int, int, int, int]:
    classes = set(atom.class_candidates)
    if "orthogonal_wire_or_border_candidate" in classes:
        return (20, 132, 255, 120)
    if "long_line_candidate" in classes:
        return (255, 175, 30, 130)
    if "curve_symbol_stroke" in classes:
        return (225, 90, 255, 160)
    if "rectangle_symbol_stroke" in classes:
        return (40, 215, 210, 150)
    if "small_symbol_stroke" in classes:
        return (255, 105, 70, 150)
    return (125, 180, 220, 95)


def _atom_points_px(
    atom: GraphicAtom,
    *,
    dpi: int,
    render_width_px: int,
    render_height_px: int,
) -> list[tuple[int, int]]:
    return [
        _pdf_point_to_px(
            point,
            dpi=dpi,
            render_width_px=render_width_px,
            render_height_px=render_height_px,
        )
        for point in atom.points_pdf
    ]


def _write_graphic_atoms_overlay(
    *,
    page_record: dict[str, Any],
    graphic_atoms: list[GraphicAtom],
    output_dir: Path,
    dpi: int,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    render_width_px = int(page_record["render_width_px"])
    render_height_px = int(page_record["render_height_px"])
    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for atom in graphic_atoms:
        color = _atom_color(atom)
        if atom.kind == "l" and len(atom.points_pdf) == 2:
            points_px = _atom_points_px(
                atom,
                dpi=dpi,
                render_width_px=render_width_px,
                render_height_px=render_height_px,
            )
            draw.line(points_px, fill=color, width=3)
        elif atom.kind == "c" and len(atom.points_pdf) >= 2:
            points_px = _atom_points_px(
                atom,
                dpi=dpi,
                render_width_px=render_width_px,
                render_height_px=render_height_px,
            )
            draw.line(points_px, fill=color, width=3, joint="curve")
        else:
            x0, y0, x1, y1 = atom.bbox_px
            draw.rectangle((x0, y0, x1, y1), outline=color, width=2)

    graphic_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_graphic_atoms_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(graphic_overlay_path)
    return str(graphic_overlay_path)


def _wire_color(segment: WireSegmentCandidate) -> tuple[int, int, int, int]:
    if segment.orientation == "horizontal":
        return (255, 176, 32, 185)
    if segment.orientation == "vertical":
        return (50, 205, 255, 185)
    return (210, 220, 235, 150)


def _write_wire_segments_overlay(
    *,
    page_record: dict[str, Any],
    wire_segments: list[WireSegmentCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for segment in wire_segments:
        draw.line(segment.endpoints_px, fill=_wire_color(segment), width=4)
        for endpoint in segment.endpoints_px:
            x, y = endpoint
            draw.ellipse((x - 3, y - 3, x + 3, y + 3), outline=(255, 255, 255, 180), width=1)

    wire_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_wire_segments_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(wire_overlay_path)
    return str(wire_overlay_path)


def _trace_color(segment: WireSegmentCandidate) -> tuple[int, int, int, int]:
    if segment.orientation == "horizontal":
        return (0, 190, 105, 215)
    if segment.orientation == "vertical":
        return (0, 135, 255, 215)
    return (120, 210, 235, 180)


def _write_wire_trace_overlay(
    *,
    page_record: dict[str, Any],
    wire_trace_segments: list[WireSegmentCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for segment in wire_trace_segments:
        draw.line(segment.endpoints_px, fill=_trace_color(segment), width=5)
        for endpoint in segment.endpoints_px:
            x, y = endpoint
            draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(255, 255, 255, 180))
            draw.ellipse((x - 6, y - 6, x + 6, y + 6), outline=_trace_color(segment), width=2)

    wire_trace_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_wire_trace_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(wire_trace_overlay_path)
    return str(wire_trace_overlay_path)


def _wire_path_color(index: int) -> tuple[int, int, int, int]:
    palette = (
        (0, 185, 255, 215),
        (255, 155, 35, 215),
        (75, 220, 125, 215),
        (190, 120, 255, 215),
        (255, 80, 120, 215),
        (35, 210, 190, 215),
        (245, 210, 55, 215),
        (110, 155, 255, 215),
    )
    return palette[index % len(palette)]


def _write_wire_paths_overlay(
    *,
    page_record: dict[str, Any],
    wire_trace_segments: list[WireSegmentCandidate],
    wire_paths: list[WirePathCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    segment_by_id = {segment.segment_id: segment for segment in wire_trace_segments}
    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for index, path in enumerate(wire_paths):
        color = _wire_path_color(index)
        for segment_id in path.wire_segment_ids:
            segment = segment_by_id.get(segment_id)
            if segment is None:
                continue
            draw.line(segment.endpoints_px, fill=color, width=6)
            for endpoint in segment.endpoints_px:
                x, y = endpoint
                draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=color)

    wire_paths_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_wire_paths_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(wire_paths_overlay_path)
    return str(wire_paths_overlay_path)


def _endpoint_color(endpoint: WireEndpointCandidate) -> tuple[int, int, int, int]:
    classes = set(endpoint.class_candidates)
    if "terminal_wire_endpoint_candidate" in classes:
        return (30, 220, 130, 225)
    if "continuation_reference_endpoint_candidate" in classes:
        return (255, 150, 35, 225)
    if "component_boundary_endpoint_candidate" in classes:
        return (190, 110, 255, 225)
    if "endpoint_touch_evidence_candidate" in classes:
        return (55, 210, 230, 210)
    return (70, 135, 255, 210)


def _write_wire_endpoints_overlay(
    *,
    page_record: dict[str, Any],
    wire_trace_segments: list[WireSegmentCandidate],
    wire_endpoints: list[WireEndpointCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    segment_by_id = {segment.segment_id: segment for segment in wire_trace_segments}
    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for segment in wire_trace_segments:
        draw.line(segment.endpoints_px, fill=(55, 115, 205, 70), width=3)

    for endpoint in wire_endpoints:
        segment = segment_by_id.get(endpoint.wire_segment_id)
        if segment is None:
            continue
        x, y = endpoint.point_px
        color = _endpoint_color(endpoint)
        draw.ellipse((x - 9, y - 9, x + 9, y + 9), fill=(255, 255, 255, 210))
        draw.ellipse((x - 10, y - 10, x + 10, y + 10), outline=color, width=3)
        draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=color)

    wire_endpoints_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_wire_endpoints_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(wire_endpoints_overlay_path)
    return str(wire_endpoints_overlay_path)


def _write_clean_validation_overlay(
    *,
    page_record: dict[str, Any],
    text_anchors: list[TextAnchor],
    component_boxes: list[ComponentBoxCandidate],
    terminal_nodes: list[TerminalNodeCandidate],
    reference_candidates: list[ReferenceCandidate],
    wire_trace_segments: list[WireSegmentCandidate],
    wire_endpoints: list[WireEndpointCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for segment in wire_trace_segments:
        draw.line(segment.endpoints_px, fill=(25, 115, 210, 135), width=4)

    for anchor in text_anchors:
        anchor_classes = set(anchor.class_candidates)
        if anchor_classes & {"grid_reference", "page_metadata"}:
            continue
        if anchor.bbox_px[1] >= int(page_record["render_height_px"]) - 360:
            continue
        if not anchor_classes & {"wire_label", "terminal_label", "location_tag"}:
            continue
        if "wire_label" in anchor_classes:
            color = (75, 95, 235, 215)
        elif "terminal_label" in anchor_classes:
            color = (0, 155, 145, 215)
        else:
            color = (90, 105, 120, 185)
        x0, y0, x1, y1 = anchor.bbox_px
        draw.rounded_rectangle(
            (x0 - 3, y0 - 3, x1 + 3, y1 + 3),
            radius=4,
            outline=color,
            width=2,
        )

    for terminal in terminal_nodes:
        x0, y0, x1, y1 = terminal.enclosure_bbox_px
        draw.ellipse((x0 - 3, y0 - 3, x1 + 3, y1 + 3), outline=(0, 185, 125, 230), width=3)

    for reference in reference_candidates:
        x0, y0, x1, y1 = reference.bbox_px
        draw.rounded_rectangle(
            (x0 - 4, y0 - 4, x1 + 4, y1 + 4),
            radius=5,
            outline=(255, 140, 30, 230),
            width=3,
        )

    for component_box in component_boxes:
        x0, y0, x1, y1 = component_box.bbox_px
        draw.rectangle((x0, y0, x1, y1), outline=(0, 170, 255, 245), width=5)
        label_y = y0 - 18 if y0 >= 18 else y1 + 4
        draw.text((x0, label_y), component_box.mark_text, fill=(0, 90, 190, 245))

    for endpoint in wire_endpoints:
        x, y = endpoint.point_px
        color = _endpoint_color(endpoint)
        draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=(255, 255, 255, 210))
        draw.ellipse((x - 8, y - 8, x + 8, y + 8), outline=color, width=3)
        draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=color)

    clean_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_clean_validation_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(clean_overlay_path)
    return str(clean_overlay_path)


def _write_wire_object_associations_overlay(
    *,
    page_record: dict[str, Any],
    component_boxes: list[ComponentBoxCandidate],
    terminal_nodes: list[TerminalNodeCandidate],
    reference_candidates: list[ReferenceCandidate],
    wire_object_associations: list[WireObjectAssociationCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    target_centers: dict[tuple[str, str], tuple[int, int]] = {}
    component_target_boxes: dict[str, tuple[int, int, int, int]] = {}
    for component_box in component_boxes:
        target_centers[("component_box", component_box.component_box_id)] = _bbox_center_px(
            component_box.bbox_px
        )
        component_target_boxes[component_box.component_box_id] = component_box.bbox_px
    for terminal in terminal_nodes:
        target_centers[("terminal_node", terminal.terminal_candidate_id)] = _bbox_center_px(
            terminal.enclosure_bbox_px
        )
    for reference in reference_candidates:
        target_centers[("continuation_reference", reference.reference_candidate_id)] = (
            _bbox_center_px(reference.bbox_px)
        )

    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    wire_path_ids = {
        association.wire_path_id for association in wire_object_associations
    }
    wire_segment_ids = {
        segment_id
        for page_wire_path in page_record.get("wire_path_candidates", [])
        if page_wire_path.get("path_id") in wire_path_ids
        for segment_id in page_wire_path.get("wire_segment_ids", [])
    }
    wire_segments_by_id = {
        segment["source_segment_id"]: segment
        for segment in page_record.get("wire_trace_candidates", [])
    }
    for segment_id in wire_segment_ids:
        segment = wire_segments_by_id.get(segment_id)
        if segment is None:
            continue
        endpoints = segment.get("endpoints_px", [])
        if len(endpoints) != 2:
            continue
        draw.line((tuple(endpoints[0]), tuple(endpoints[1])), fill=(35, 95, 145, 92), width=3)

    associated_component_box_ids = {
        association.target_id
        for association in wire_object_associations
        if association.target_type == "component_box"
    }
    for component_box in component_boxes:
        if component_box.component_box_id not in associated_component_box_ids:
            continue
        x0, y0, x1, y1 = component_box.bbox_px
        draw.rectangle((x0, y0, x1, y1), outline=(0, 170, 255, 165), width=3)

    for association in wire_object_associations:
        target_center = target_centers.get((association.target_type, association.target_id))
        if target_center is None:
            continue
        if association.target_type == "component_box":
            color = (0, 170, 255, 210)
        elif association.target_type == "terminal_node":
            color = (20, 210, 130, 210)
        else:
            color = (255, 140, 35, 210)
        for endpoint_point in association.endpoint_points_px:
            target_point = target_center
            if association.target_type == "component_box":
                bbox = component_target_boxes.get(association.target_id)
                if bbox is not None:
                    x, y = endpoint_point
                    target_point = (
                        max(bbox[0], min(bbox[2], x)),
                        max(bbox[1], min(bbox[3], y)),
                    )
            if endpoint_point != target_point:
                draw.line((endpoint_point, target_point), fill=color, width=2)
            x, y = endpoint_point
            draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=color)
        if association.target_type != "component_box":
            tx, ty = target_center
            draw.ellipse((tx - 6, ty - 6, tx + 6, ty + 6), outline=color, width=3)

    associations_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_wire_object_associations_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(associations_overlay_path)
    return str(associations_overlay_path)


def _write_wire_interactions_overlay(
    *,
    page_record: dict[str, Any],
    wire_segments: list[WireSegmentCandidate],
    wire_interactions: list[WireInteractionCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for segment in wire_segments:
        draw.line(segment.endpoints_px, fill=(60, 145, 255, 115), width=3)

    for interaction in wire_interactions:
        x, y = interaction.point_px
        if interaction.interaction_type == "endpoint_touch_candidate":
            fill = (25, 225, 120, 210)
            outline = (5, 95, 45, 245)
        else:
            fill = (255, 136, 25, 195)
            outline = (125, 60, 10, 245)
        draw.ellipse((x - 8, y - 8, x + 8, y + 8), fill=fill, outline=outline, width=2)

    interactions_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_wire_interactions_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(interactions_overlay_path)
    return str(interactions_overlay_path)


def _write_text_associations_overlay(
    *,
    page_record: dict[str, Any],
    associations: list[TextGeometryAssociationCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for association in associations:
        if association.target_type == "component_box":
            color = (0, 205, 85, 220)
        elif association.relation_candidate == "terminal_label_near_wire_segment":
            color = (55, 225, 190, 190)
        else:
            color = (255, 205, 35, 185)
        ax, ay = association.anchor_center_px
        tx, ty = association.target_point_px
        draw.line((ax, ay, tx, ty), fill=color, width=2)
        draw.ellipse((ax - 4, ay - 4, ax + 4, ay + 4), fill=color)
        draw.ellipse((tx - 4, ty - 4, tx + 4, ty + 4), outline=color, width=2)

    association_overlay_path = (
        output_dir / f"page_{page_record['source_page']:03d}_text_associations_overlay.png"
    )
    Image.alpha_composite(image, overlay).convert("RGB").save(association_overlay_path)
    return str(association_overlay_path)


def _write_evidence_overlay(
    *,
    page_record: dict[str, Any],
    text_anchors: list[TextAnchor],
    component_boxes: list[ComponentBoxCandidate],
    output_dir: Path,
) -> str:
    render_path = Path(str(page_record["canonical_render"]))
    if not render_path.exists():
        raise ValueError(f"Canonical render does not exist: {render_path}")

    image = Image.open(render_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for anchor in text_anchors:
        x0, y0, x1, y1 = anchor.bbox_px
        color = _anchor_color(anchor)
        draw.rectangle((x0, y0, x1, y1), outline=color, width=2)
        if _should_label_anchor(anchor):
            label_y = y0 - 12 if y0 >= 12 else y1 + 2
            draw.text((x0, label_y), anchor.normalized_text[:28], fill=color)

    for component_box in component_boxes:
        x0, y0, x1, y1 = component_box.bbox_px
        draw.rectangle((x0, y0, x1, y1), outline=(0, 190, 55, 255), width=6)
        text_y = y0 - 22 if y0 >= 22 else y1 + 4
        draw.text((x0, text_y), component_box.mark_text, fill=(0, 120, 35, 255))

    evidence_path = output_dir / f"page_{page_record['source_page']:03d}_evidence_overlay.png"
    Image.alpha_composite(image, overlay).convert("RGB").save(evidence_path)
    return str(evidence_path)


def _text_anchor_to_record(anchor: TextAnchor, *, source_file: str) -> dict[str, Any]:
    return {
        "anchor_id": anchor.anchor_id,
        "source_file": source_file,
        "source_page": anchor.source_page,
        "raw_text": anchor.raw_text,
        "normalized_text": anchor.normalized_text,
        "bbox_px": list(anchor.bbox_px),
        "bbox_pdf": [round(value, 6) for value in anchor.bbox_pdf],
        "class_candidates": list(anchor.class_candidates),
        "extraction_method": anchor.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": anchor.source_page,
            "bbox_px": list(anchor.bbox_px),
            "bbox_pdf": [round(value, 6) for value in anchor.bbox_pdf],
            "method": anchor.extraction_method,
        },
    }


def _graphic_atom_to_record(atom: GraphicAtom, *, source_file: str) -> dict[str, Any]:
    return {
        "atom_id": atom.atom_id,
        "source_file": source_file,
        "source_page": atom.source_page,
        "item_id": atom.item_id,
        "drawing_id": atom.drawing_id,
        "source_seqno": atom.seqno,
        "kind": atom.kind,
        "points_pdf": [[round(x, 6), round(y, 6)] for x, y in atom.points_pdf],
        "bbox_px": list(atom.bbox_px),
        "bbox_pdf": [round(value, 6) for value in atom.bbox_pdf],
        "class_candidates": list(atom.class_candidates),
        "extraction_method": atom.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": atom.source_page,
            "bbox_px": list(atom.bbox_px),
            "bbox_pdf": [round(value, 6) for value in atom.bbox_pdf],
            "method": atom.extraction_method,
            "drawing_id": atom.drawing_id,
            "item_id": atom.item_id,
            "source_seqno": atom.seqno,
        },
    }


def _component_mark_to_record(
    candidate: ComponentMarkCandidate,
    *,
    source_file: str,
) -> dict[str, Any]:
    return {
        "component_candidate_id": candidate.component_candidate_id,
        "source_file": source_file,
        "source_page": candidate.source_page,
        "mark_anchor_id": candidate.mark_anchor_id,
        "mark_text": candidate.mark_text,
        "mark_bbox_px": list(candidate.mark_bbox_px),
        "mark_bbox_pdf": [round(value, 6) for value in candidate.mark_bbox_pdf],
        "nearby_anchor_ids": list(candidate.nearby_anchor_ids),
        "nearby_location_tag_anchor_ids": list(candidate.nearby_location_tag_anchor_ids),
        "class_candidates": list(candidate.class_candidates),
        "extraction_method": candidate.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": candidate.source_page,
            "bbox_px": list(candidate.mark_bbox_px),
            "bbox_pdf": [round(value, 6) for value in candidate.mark_bbox_pdf],
            "method": candidate.extraction_method,
            "mark_anchor_id": candidate.mark_anchor_id,
        },
    }


def _component_box_to_record(
    candidate: ComponentBoxCandidate,
    *,
    source_file: str,
) -> dict[str, Any]:
    box_area_px = _bbox_area_px(candidate.bbox_px)
    mark_area_px = max(_bbox_area_px(candidate.mark_bbox_px), 1)
    mark_to_box_area_ratio = round(box_area_px / mark_area_px, 3)
    visual_review_flags: list[str] = []
    if candidate.source_kind == "mark_only_component_box":
        visual_review_flags.append("mark_only_component_box_requires_geometry_review")
    if mark_to_box_area_ratio >= 300:
        visual_review_flags.append("large_component_box_relative_to_mark_review")
    if len(candidate.source_atom_ids) >= 32:
        visual_review_flags.append("many_graphic_atoms_in_component_box_review")

    return {
        "component_box_id": candidate.component_box_id,
        "source_file": source_file,
        "source_page": candidate.source_page,
        "mark_text": candidate.mark_text,
        "mark_anchor_id": candidate.mark_anchor_id,
        "mark_bbox_px": list(candidate.mark_bbox_px),
        "mark_bbox_pdf": [round(value, 6) for value in candidate.mark_bbox_pdf],
        "bbox_px": list(candidate.bbox_px),
        "bbox_pdf": [round(value, 6) for value in candidate.bbox_pdf],
        "source_detection_ids": list(candidate.source_detection_ids),
        "source_atom_ids": list(candidate.source_atom_ids),
        "source_atom_count": len(candidate.source_atom_ids),
        "bbox_area_px": box_area_px,
        "mark_area_px": mark_area_px,
        "mark_to_box_area_ratio": mark_to_box_area_ratio,
        "visual_review_flags": visual_review_flags,
        "source_kind": candidate.source_kind,
        "class_candidates": list(candidate.class_candidates),
        "extraction_method": candidate.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": candidate.source_page,
            "bbox_px": list(candidate.bbox_px),
            "bbox_pdf": [round(value, 6) for value in candidate.bbox_pdf],
            "method": candidate.extraction_method,
            "mark_anchor_id": candidate.mark_anchor_id,
            "source_detection_ids": list(candidate.source_detection_ids),
            "source_atom_ids": list(candidate.source_atom_ids),
        },
    }


def _component_box_review_summary(
    component_box_records: list[dict[str, Any]],
    *,
    flagged_box_limit: int = 50,
) -> dict[str, Any]:
    flag_counts: dict[str, int] = {}
    flagged_component_boxes: list[dict[str, Any]] = []

    for component_box in component_box_records:
        visual_review_flags = [
            str(flag) for flag in component_box.get("visual_review_flags", [])
        ]
        if not visual_review_flags:
            continue

        for flag in visual_review_flags:
            flag_counts[flag] = flag_counts.get(flag, 0) + 1

        flagged_component_boxes.append(
            {
                "component_box_id": component_box["component_box_id"],
                "mark_text": component_box["mark_text"],
                "bbox_px": component_box["bbox_px"],
                "source_kind": component_box["source_kind"],
                "source_atom_count": component_box["source_atom_count"],
                "mark_to_box_area_ratio": component_box["mark_to_box_area_ratio"],
                "visual_review_flags": visual_review_flags,
            }
        )

    return {
        "flagged_component_box_count": len(flagged_component_boxes),
        "flag_counts": dict(sorted(flag_counts.items())),
        "flagged_component_boxes": flagged_component_boxes[:flagged_box_limit],
        "flagged_component_box_limit": flagged_box_limit,
    }


def _aggregate_component_box_review_summaries(
    page_records: list[dict[str, Any]],
) -> dict[str, Any]:
    flag_counts: dict[str, int] = {}
    pages: list[dict[str, Any]] = []
    flagged_component_box_count = 0

    for page_record in page_records:
        page_summary = page_record["component_box_review_summary"]
        page_flagged_count = int(page_summary["flagged_component_box_count"])
        flagged_component_box_count += page_flagged_count
        for flag, count in page_summary["flag_counts"].items():
            flag_counts[str(flag)] = flag_counts.get(str(flag), 0) + int(count)
        if page_flagged_count:
            pages.append(
                {
                    "source_page": page_record["source_page"],
                    "flagged_component_box_count": page_flagged_count,
                    "flag_counts": page_summary["flag_counts"],
                    "flagged_component_boxes": page_summary[
                        "flagged_component_boxes"
                    ],
                }
            )

    return {
        "flagged_component_box_count": flagged_component_box_count,
        "flag_counts": dict(sorted(flag_counts.items())),
        "pages": pages,
    }


def _reference_candidate_to_record(
    candidate: ReferenceCandidate,
    *,
    source_file: str,
) -> dict[str, Any]:
    return {
        "reference_candidate_id": candidate.reference_candidate_id,
        "source_file": source_file,
        "source_page": candidate.source_page,
        "reference_text": candidate.reference_text,
        "top_anchor_id": candidate.top_anchor_id,
        "bottom_anchor_id": candidate.bottom_anchor_id,
        "reference_anchor_ids": list(candidate.reference_anchor_ids),
        "bbox_px": list(candidate.bbox_px),
        "bbox_pdf": [round(value, 6) for value in candidate.bbox_pdf],
        "class_candidates": list(candidate.class_candidates),
        "extraction_method": candidate.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": candidate.source_page,
            "bbox_px": list(candidate.bbox_px),
            "bbox_pdf": [round(value, 6) for value in candidate.bbox_pdf],
            "method": candidate.extraction_method,
            "reference_anchor_ids": list(candidate.reference_anchor_ids),
        },
    }


def _terminal_node_to_record(
    candidate: TerminalNodeCandidate,
    *,
    source_file: str,
) -> dict[str, Any]:
    return {
        "terminal_candidate_id": candidate.terminal_candidate_id,
        "source_file": source_file,
        "source_page": candidate.source_page,
        "terminal_text": candidate.terminal_text,
        "text_anchor_id": candidate.text_anchor_id,
        "text_bbox_px": list(candidate.text_bbox_px),
        "text_bbox_pdf": [round(value, 6) for value in candidate.text_bbox_pdf],
        "enclosure_atom_ids": list(candidate.enclosure_atom_ids),
        "enclosure_bbox_px": list(candidate.enclosure_bbox_px),
        "enclosure_bbox_pdf": [round(value, 6) for value in candidate.enclosure_bbox_pdf],
        "class_candidates": list(candidate.class_candidates),
        "extraction_method": candidate.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": candidate.source_page,
            "bbox_px": list(candidate.enclosure_bbox_px),
            "bbox_pdf": [round(value, 6) for value in candidate.enclosure_bbox_pdf],
            "method": candidate.extraction_method,
            "text_anchor_id": candidate.text_anchor_id,
            "enclosure_atom_ids": list(candidate.enclosure_atom_ids),
        },
    }


def _terminal_wire_association_to_record(
    association: TerminalWireAssociationCandidate,
    *,
    source_file: str,
) -> dict[str, Any]:
    return {
        "association_id": association.association_id,
        "source_file": source_file,
        "source_page": association.source_page,
        "terminal_candidate_id": association.terminal_candidate_id,
        "terminal_text": association.terminal_text,
        "wire_segment_id": association.wire_segment_id,
        "relation_candidate": association.relation_candidate,
        "distance_px": round(association.distance_px, 3),
        "terminal_center_px": list(association.terminal_center_px),
        "nearest_wire_point_px": list(association.nearest_wire_point_px),
        "class_candidates": list(association.class_candidates),
        "extraction_method": association.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": association.source_page,
            "method": association.extraction_method,
            "terminal_candidate_id": association.terminal_candidate_id,
            "wire_segment_id": association.wire_segment_id,
        },
    }


def _reference_wire_association_to_record(
    association: ReferenceWireAssociationCandidate,
    *,
    source_file: str,
) -> dict[str, Any]:
    return {
        "association_id": association.association_id,
        "source_file": source_file,
        "source_page": association.source_page,
        "reference_candidate_id": association.reference_candidate_id,
        "reference_text": association.reference_text,
        "wire_segment_id": association.wire_segment_id,
        "relation_candidate": association.relation_candidate,
        "distance_px": round(association.distance_px, 3),
        "reference_center_px": list(association.reference_center_px),
        "nearest_wire_point_px": list(association.nearest_wire_point_px),
        "class_candidates": list(association.class_candidates),
        "extraction_method": association.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": association.source_page,
            "method": association.extraction_method,
            "reference_candidate_id": association.reference_candidate_id,
            "wire_segment_id": association.wire_segment_id,
        },
    }


def _wire_segment_to_record(
    segment: WireSegmentCandidate,
    *,
    source_file: str,
) -> dict[str, Any]:
    return {
        "segment_id": segment.segment_id,
        "source_file": source_file,
        "source_page": segment.source_page,
        "source_atom_id": segment.source_atom_id,
        "source_item_id": segment.source_item_id,
        "source_drawing_id": segment.source_drawing_id,
        "source_seqno": segment.source_seqno,
        "orientation": segment.orientation,
        "endpoints_pdf": [
            [round(x, 6), round(y, 6)] for x, y in segment.endpoints_pdf
        ],
        "endpoints_px": [list(endpoint) for endpoint in segment.endpoints_px],
        "bbox_px": list(segment.bbox_px),
        "bbox_pdf": [round(value, 6) for value in segment.bbox_pdf],
        "length_pdf": round(segment.length_pdf, 6),
        "class_candidates": list(segment.class_candidates),
        "extraction_method": segment.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": segment.source_page,
            "bbox_px": list(segment.bbox_px),
            "bbox_pdf": [round(value, 6) for value in segment.bbox_pdf],
            "method": segment.extraction_method,
            "source_atom_id": segment.source_atom_id,
            "source_item_id": segment.source_item_id,
            "source_drawing_id": segment.source_drawing_id,
            "source_seqno": segment.source_seqno,
        },
    }


def _wire_trace_segment_to_record(
    segment: WireSegmentCandidate,
    *,
    source_file: str,
) -> dict[str, Any]:
    return {
        "trace_id": f"trace-{segment.segment_id}",
        "source_file": source_file,
        "source_page": segment.source_page,
        "source_segment_id": segment.segment_id,
        "source_atom_id": segment.source_atom_id,
        "source_item_id": segment.source_item_id,
        "source_drawing_id": segment.source_drawing_id,
        "source_seqno": segment.source_seqno,
        "orientation": segment.orientation,
        "endpoints_pdf": [
            [round(x, 6), round(y, 6)] for x, y in segment.endpoints_pdf
        ],
        "endpoints_px": [list(endpoint) for endpoint in segment.endpoints_px],
        "bbox_px": list(segment.bbox_px),
        "bbox_pdf": [round(value, 6) for value in segment.bbox_pdf],
        "length_pdf": round(segment.length_pdf, 6),
        "class_candidates": [
            "wire_trace_candidate",
            f"{segment.orientation}_trace_candidate",
            *list(segment.class_candidates),
        ],
        "extraction_method": WIRE_TRACE_METHOD,
        "source_anchor": {
            "source_file": source_file,
            "source_page": segment.source_page,
            "bbox_px": list(segment.bbox_px),
            "bbox_pdf": [round(value, 6) for value in segment.bbox_pdf],
            "method": WIRE_TRACE_METHOD,
            "source_segment_id": segment.segment_id,
            "source_atom_id": segment.source_atom_id,
            "source_item_id": segment.source_item_id,
            "source_drawing_id": segment.source_drawing_id,
            "source_seqno": segment.source_seqno,
        },
    }


def _wire_path_to_record(
    path: WirePathCandidate,
    *,
    source_file: str,
) -> dict[str, Any]:
    return {
        "path_id": path.path_id,
        "source_file": source_file,
        "source_page": path.source_page,
        "wire_segment_ids": list(path.wire_segment_ids),
        "wire_interaction_ids": list(path.wire_interaction_ids),
        "terminal_candidate_ids": list(path.terminal_candidate_ids),
        "terminal_texts": list(path.terminal_texts),
        "reference_candidate_ids": list(path.reference_candidate_ids),
        "reference_texts": list(path.reference_texts),
        "text_anchor_ids": list(path.text_anchor_ids),
        "text_labels": list(path.text_labels),
        "bbox_px": list(path.bbox_px),
        "bbox_pdf": [round(value, 6) for value in path.bbox_pdf],
        "class_candidates": list(path.class_candidates),
        "extraction_method": path.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": path.source_page,
            "bbox_px": list(path.bbox_px),
            "bbox_pdf": [round(value, 6) for value in path.bbox_pdf],
            "method": path.extraction_method,
            "wire_segment_ids": list(path.wire_segment_ids),
            "wire_interaction_ids": list(path.wire_interaction_ids),
        },
    }


def _wire_endpoint_to_record(
    endpoint: WireEndpointCandidate,
    *,
    source_file: str,
) -> dict[str, Any]:
    return {
        "endpoint_id": endpoint.endpoint_id,
        "source_file": source_file,
        "source_page": endpoint.source_page,
        "wire_path_id": endpoint.wire_path_id,
        "wire_segment_id": endpoint.wire_segment_id,
        "endpoint_index": endpoint.endpoint_index,
        "point_pdf": [round(endpoint.point_pdf[0], 6), round(endpoint.point_pdf[1], 6)],
        "point_px": list(endpoint.point_px),
        "touch_interaction_ids": list(endpoint.touch_interaction_ids),
        "near_terminal_candidate_ids": list(endpoint.near_terminal_candidate_ids),
        "near_terminal_texts": list(endpoint.near_terminal_texts),
        "near_reference_candidate_ids": list(endpoint.near_reference_candidate_ids),
        "near_reference_texts": list(endpoint.near_reference_texts),
        "near_component_box_ids": list(endpoint.near_component_box_ids),
        "near_component_mark_texts": list(endpoint.near_component_mark_texts),
        "path_text_labels": list(endpoint.path_text_labels),
        "class_candidates": list(endpoint.class_candidates),
        "extraction_method": endpoint.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": endpoint.source_page,
            "point_px": list(endpoint.point_px),
            "point_pdf": [
                round(endpoint.point_pdf[0], 6),
                round(endpoint.point_pdf[1], 6),
            ],
            "method": endpoint.extraction_method,
            "wire_path_id": endpoint.wire_path_id,
            "wire_segment_id": endpoint.wire_segment_id,
            "endpoint_index": endpoint.endpoint_index,
        },
    }


def _wire_object_association_to_record(
    association: WireObjectAssociationCandidate,
    *,
    source_file: str,
) -> dict[str, Any]:
    return {
        "association_id": association.association_id,
        "source_file": source_file,
        "source_page": association.source_page,
        "wire_path_id": association.wire_path_id,
        "target_type": association.target_type,
        "target_id": association.target_id,
        "target_label": association.target_label,
        "relation_candidate": association.relation_candidate,
        "endpoint_ids": list(association.endpoint_ids),
        "endpoint_points_px": [list(point) for point in association.endpoint_points_px],
        "path_text_labels": list(association.path_text_labels),
        "class_candidates": list(association.class_candidates),
        "extraction_method": association.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": association.source_page,
            "method": association.extraction_method,
            "wire_path_id": association.wire_path_id,
            "target_type": association.target_type,
            "target_id": association.target_id,
            "target_label": association.target_label,
            "endpoint_ids": list(association.endpoint_ids),
            "endpoint_points_px": [
                list(point) for point in association.endpoint_points_px
            ],
        },
    }


def _wire_interaction_to_record(
    interaction: WireInteractionCandidate,
    *,
    source_file: str,
) -> dict[str, Any]:
    return {
        "interaction_id": interaction.interaction_id,
        "source_file": source_file,
        "source_page": interaction.source_page,
        "interaction_type": interaction.interaction_type,
        "point_pdf": [round(interaction.point_pdf[0], 6), round(interaction.point_pdf[1], 6)],
        "point_px": list(interaction.point_px),
        "segment_ids": list(interaction.segment_ids),
        "source_atom_ids": list(interaction.source_atom_ids),
        "class_candidates": list(interaction.class_candidates),
        "extraction_method": interaction.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": interaction.source_page,
            "point_px": list(interaction.point_px),
            "point_pdf": [
                round(interaction.point_pdf[0], 6),
                round(interaction.point_pdf[1], 6),
            ],
            "method": interaction.extraction_method,
            "segment_ids": list(interaction.segment_ids),
            "source_atom_ids": list(interaction.source_atom_ids),
        },
    }


def _text_association_to_record(
    association: TextGeometryAssociationCandidate,
    *,
    source_file: str,
) -> dict[str, Any]:
    return {
        "association_id": association.association_id,
        "source_file": source_file,
        "source_page": association.source_page,
        "source_anchor_id": association.source_anchor_id,
        "source_anchor_text": association.source_anchor_text,
        "source_anchor_classes": list(association.source_anchor_classes),
        "target_type": association.target_type,
        "target_id": association.target_id,
        "relation_candidate": association.relation_candidate,
        "distance_px": round(association.distance_px, 3),
        "anchor_center_px": list(association.anchor_center_px),
        "target_point_px": list(association.target_point_px),
        "class_candidates": list(association.class_candidates),
        "extraction_method": association.extraction_method,
        "source_anchor": {
            "source_file": source_file,
            "source_page": association.source_page,
            "method": association.extraction_method,
            "source_anchor_id": association.source_anchor_id,
            "target_type": association.target_type,
            "target_id": association.target_id,
        },
    }


def _match_to_record(
    match: VectorMatch,
    *,
    template: VectorTemplate,
    source_file: str,
) -> dict[str, Any]:
    return {
        "detection_id": _detection_id(match, template),
        "template_id": template.template_id,
        "label": template.label,
        "source_file": source_file,
        "source_page": match.page,
        "bbox_px": list(match.bbox_px),
        "bbox_pdf": [round(value, 6) for value in match.bbox_pdf],
        "score": round(match.score, 6),
        "extraction_method": VECTOR_FINGERPRINT_METHOD,
        "source_vector_ids": list(match.source_vector_ids),
        "source_seqnos": list(match.source_seqnos),
        "source_anchor": {
            "source_file": source_file,
            "source_page": match.page,
            "bbox_px": list(match.bbox_px),
            "bbox_pdf": [round(value, 6) for value in match.bbox_pdf],
            "method": VECTOR_FINGERPRINT_METHOD,
            "source_vector_ids": list(match.source_vector_ids),
            "source_seqnos": list(match.source_seqnos),
        },
    }


def build_schematic_spine_slice0(
    *,
    pdf_path: Path,
    vector_db_path: Path = DEFAULT_VECTOR_DB_PATH,
    output_dir: Path,
    page_from: int = 7,
    page_to: int = 7,
    max_pages: int = 1,
    dpi: int = 300,
    min_score: float = 0.99,
    machine_id: str = DEFAULT_MACHINE_ID,
    document_id: str = DEFAULT_DOCUMENT_ID,
    template: VectorTemplate = ELB_3_PHASE_TEMPLATE,
    require_detection: bool = True,
    artifact_filename: str = "schematic_spine_slice0.json",
    include_flattened_records: bool = True,
) -> dict[str, Any]:
    """Build the Slice 0 proof artifact and validation overlays."""
    if dpi <= 0:
        raise ValueError("dpi must be positive")
    if not vector_db_path.exists():
        raise ValueError(f"Vector database does not exist: {vector_db_path}")
    if not pdf_path.exists():
        raise ValueError(f"Schematic PDF does not exist: {pdf_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    with fitz.open(pdf_path) as doc:
        pages = _page_range(doc.page_count, page_from, page_to, max_pages)

    page_records = _render_canonical_pages(pdf_path, pages=pages, dpi=dpi, output_dir=output_dir)
    render_sizes = {
        page: (record["render_width_px"], record["render_height_px"])
        for page, record in page_records.items()
    }
    text_anchors_by_page = _extract_text_anchors(
        pdf_path,
        pages=pages,
        dpi=dpi,
        render_sizes=render_sizes,
    )

    with sqlite3.connect(vector_db_path) as con:
        graphic_atoms_by_page = {
            page: _load_page_graphic_atoms(
                con,
                page=page,
                dpi=dpi,
                render_sizes=render_sizes,
            )
            for page in pages
        }
        detections = _search_template_matches(
            con,
            template=template,
            pages=pages,
            dpi=dpi,
            render_sizes=render_sizes,
            min_score=min_score,
        )

    if require_detection and not detections:
        raise ValueError(
            f"No {template.label} detections met min_score={min_score} on pages "
            f"{pages.start}-{pages.stop - 1}"
        )

    source_file = pdf_path.name
    detections_by_page: dict[int, list[VectorMatch]] = {}
    for detection in detections:
        detections_by_page.setdefault(detection.page, []).append(detection)

    flattened_detection_records: list[dict[str, Any]] = []
    flattened_text_anchor_records: list[dict[str, Any]] = []
    flattened_component_mark_records: list[dict[str, Any]] = []
    flattened_component_box_records: list[dict[str, Any]] = []
    flattened_reference_candidate_records: list[dict[str, Any]] = []
    flattened_terminal_node_records: list[dict[str, Any]] = []
    flattened_terminal_wire_records: list[dict[str, Any]] = []
    flattened_reference_wire_records: list[dict[str, Any]] = []
    flattened_graphic_atom_records: list[dict[str, Any]] = []
    flattened_wire_segment_records: list[dict[str, Any]] = []
    flattened_wire_trace_records: list[dict[str, Any]] = []
    flattened_wire_path_records: list[dict[str, Any]] = []
    flattened_wire_endpoint_records: list[dict[str, Any]] = []
    flattened_wire_object_association_records: list[dict[str, Any]] = []
    flattened_wire_interaction_records: list[dict[str, Any]] = []
    flattened_text_association_records: list[dict[str, Any]] = []
    for page, page_record in page_records.items():
        page_detections = detections_by_page.get(page, [])
        page_text_anchors = text_anchors_by_page.get(page, [])
        page_graphic_atoms = graphic_atoms_by_page.get(page, [])
        page_wire_segments = _wire_segments_from_graphic_atoms(
            graphic_atoms=page_graphic_atoms,
            page_record=page_record,
            dpi=dpi,
        )
        page_component_marks = _component_mark_candidates_from_text_anchors(page_text_anchors)
        page_component_boxes = _component_box_candidates_from_marks(
            component_marks=page_component_marks,
            graphic_atoms=page_graphic_atoms,
            detections=page_detections,
            template=template,
            page_record=page_record,
        )
        page_height = float(page_record["pdf_mediabox"][3]) - float(page_record["pdf_mediabox"][1])
        page_reference_candidates = _reference_candidates_from_text_anchors(
            page_text_anchors,
            page_height=page_height,
        )
        page_wire_trace_segments = _wire_trace_segments_from_candidates(
            wire_segments=page_wire_segments,
            text_anchors=page_text_anchors,
            reference_candidates=page_reference_candidates,
            component_boxes=page_component_boxes,
        )
        page_wire_interactions = _detect_wire_interactions(
            wire_segments=page_wire_trace_segments,
            page_record=page_record,
            dpi=dpi,
        )
        page_text_associations = _associate_text_to_geometry(
            text_anchors=page_text_anchors,
            wire_segments=page_wire_trace_segments,
            component_boxes=page_component_boxes,
        )
        page_terminal_nodes = _terminal_node_candidates_from_text_and_graphics(
            text_anchors=page_text_anchors,
            graphic_atoms=page_graphic_atoms,
        )
        page_terminal_wire_associations = _associate_terminal_nodes_to_wire_segments(
            terminal_nodes=page_terminal_nodes,
            wire_segments=page_wire_segments,
        )
        page_reference_wire_associations = _associate_references_to_wire_segments(
            reference_candidates=page_reference_candidates,
            wire_segments=page_wire_segments,
        )
        page_wire_paths = _wire_path_candidates_from_trace_segments(
            wire_trace_segments=page_wire_trace_segments,
            wire_interactions=page_wire_interactions,
            terminal_wire_associations=page_terminal_wire_associations,
            reference_wire_associations=page_reference_wire_associations,
            text_associations=page_text_associations,
        )
        page_wire_endpoints = _wire_endpoint_candidates_from_paths(
            wire_paths=page_wire_paths,
            wire_trace_segments=page_wire_trace_segments,
            wire_interactions=page_wire_interactions,
            terminal_nodes=page_terminal_nodes,
            reference_candidates=page_reference_candidates,
            component_boxes=page_component_boxes,
        )
        page_wire_object_associations = _wire_object_associations_from_endpoints(
            page_wire_endpoints
        )
        reconstruction_path = _write_reconstruction_overlay(
            page_record=page_record,
            text_anchors=page_text_anchors,
            output_dir=output_dir,
        )
        component_marks_overlay_path = _write_component_marks_overlay(
            page_record=page_record,
            component_marks=page_component_marks,
            text_anchors=page_text_anchors,
            output_dir=output_dir,
        )
        component_boxes_overlay_path = _write_component_boxes_overlay(
            page_record=page_record,
            component_boxes=page_component_boxes,
            output_dir=output_dir,
        )
        reference_candidates_overlay_path = _write_reference_candidates_overlay(
            page_record=page_record,
            reference_candidates=page_reference_candidates,
            output_dir=output_dir,
        )
        terminal_nodes_overlay_path = _write_terminal_nodes_overlay(
            page_record=page_record,
            terminal_nodes=page_terminal_nodes,
            output_dir=output_dir,
        )
        terminal_wire_overlay_path = _write_terminal_wire_associations_overlay(
            page_record=page_record,
            terminal_nodes=page_terminal_nodes,
            terminal_wire_associations=page_terminal_wire_associations,
            output_dir=output_dir,
        )
        reference_wire_overlay_path = _write_reference_wire_associations_overlay(
            page_record=page_record,
            reference_candidates=page_reference_candidates,
            reference_wire_associations=page_reference_wire_associations,
            output_dir=output_dir,
        )
        graphic_atoms_overlay_path = _write_graphic_atoms_overlay(
            page_record=page_record,
            graphic_atoms=page_graphic_atoms,
            output_dir=output_dir,
            dpi=dpi,
        )
        wire_segments_overlay_path = _write_wire_segments_overlay(
            page_record=page_record,
            wire_segments=page_wire_segments,
            output_dir=output_dir,
        )
        wire_trace_overlay_path = _write_wire_trace_overlay(
            page_record=page_record,
            wire_trace_segments=page_wire_trace_segments,
            output_dir=output_dir,
        )
        wire_paths_overlay_path = _write_wire_paths_overlay(
            page_record=page_record,
            wire_trace_segments=page_wire_trace_segments,
            wire_paths=page_wire_paths,
            output_dir=output_dir,
        )
        wire_endpoints_overlay_path = _write_wire_endpoints_overlay(
            page_record=page_record,
            wire_trace_segments=page_wire_trace_segments,
            wire_endpoints=page_wire_endpoints,
            output_dir=output_dir,
        )
        clean_validation_overlay_path = _write_clean_validation_overlay(
            page_record=page_record,
            text_anchors=page_text_anchors,
            component_boxes=page_component_boxes,
            terminal_nodes=page_terminal_nodes,
            reference_candidates=page_reference_candidates,
            wire_trace_segments=page_wire_trace_segments,
            wire_endpoints=page_wire_endpoints,
            output_dir=output_dir,
        )
        wire_interactions_overlay_path = _write_wire_interactions_overlay(
            page_record=page_record,
            wire_segments=page_wire_trace_segments,
            wire_interactions=page_wire_interactions,
            output_dir=output_dir,
        )
        text_associations_overlay_path = _write_text_associations_overlay(
            page_record=page_record,
            associations=page_text_associations,
            output_dir=output_dir,
        )
        overlay_path = _write_validation_overlay(
            page_record=page_record,
            component_boxes=page_component_boxes,
            output_dir=output_dir,
        )
        evidence_overlay_path = _write_evidence_overlay(
            page_record=page_record,
            text_anchors=page_text_anchors,
            component_boxes=page_component_boxes,
            output_dir=output_dir,
        )
        page_record["reconstruction_overlay"] = reconstruction_path
        page_record["component_marks_overlay"] = component_marks_overlay_path
        page_record["component_boxes_overlay"] = component_boxes_overlay_path
        page_record["reference_candidates_overlay"] = reference_candidates_overlay_path
        page_record["terminal_nodes_overlay"] = terminal_nodes_overlay_path
        page_record["terminal_wire_overlay"] = terminal_wire_overlay_path
        page_record["reference_wire_overlay"] = reference_wire_overlay_path
        page_record["graphic_atoms_overlay"] = graphic_atoms_overlay_path
        page_record["wire_segments_overlay"] = wire_segments_overlay_path
        page_record["wire_trace_overlay"] = wire_trace_overlay_path
        page_record["wire_paths_overlay"] = wire_paths_overlay_path
        page_record["wire_endpoints_overlay"] = wire_endpoints_overlay_path
        page_record["clean_validation_overlay"] = clean_validation_overlay_path
        page_record["wire_interactions_overlay"] = wire_interactions_overlay_path
        page_record["text_associations_overlay"] = text_associations_overlay_path
        page_record["validation_overlay"] = overlay_path
        page_record["evidence_overlay"] = evidence_overlay_path
        page_record["text_anchors"] = [
            _text_anchor_to_record(anchor, source_file=source_file)
            for anchor in page_text_anchors
        ]
        page_record["component_mark_candidates"] = [
            _component_mark_to_record(candidate, source_file=source_file)
            for candidate in page_component_marks
        ]
        page_record["component_box_candidates"] = [
            _component_box_to_record(candidate, source_file=source_file)
            for candidate in page_component_boxes
        ]
        page_record["component_box_review_summary"] = (
            _component_box_review_summary(page_record["component_box_candidates"])
        )
        page_record["component_box_review_flag_count"] = page_record[
            "component_box_review_summary"
        ]["flagged_component_box_count"]
        page_record["reference_candidates"] = [
            _reference_candidate_to_record(candidate, source_file=source_file)
            for candidate in page_reference_candidates
        ]
        page_record["terminal_node_candidates"] = [
            _terminal_node_to_record(candidate, source_file=source_file)
            for candidate in page_terminal_nodes
        ]
        page_record["terminal_wire_associations"] = [
            _terminal_wire_association_to_record(association, source_file=source_file)
            for association in page_terminal_wire_associations
        ]
        page_record["reference_wire_associations"] = [
            _reference_wire_association_to_record(association, source_file=source_file)
            for association in page_reference_wire_associations
        ]
        page_record["graphic_atoms"] = [
            _graphic_atom_to_record(atom, source_file=source_file)
            for atom in page_graphic_atoms
        ]
        page_record["wire_segments"] = [
            _wire_segment_to_record(segment, source_file=source_file)
            for segment in page_wire_segments
        ]
        page_record["wire_trace_candidates"] = [
            _wire_trace_segment_to_record(segment, source_file=source_file)
            for segment in page_wire_trace_segments
        ]
        page_record["wire_path_candidates"] = [
            _wire_path_to_record(path, source_file=source_file)
            for path in page_wire_paths
        ]
        page_record["wire_endpoint_candidates"] = [
            _wire_endpoint_to_record(endpoint, source_file=source_file)
            for endpoint in page_wire_endpoints
        ]
        page_record["wire_object_associations"] = [
            _wire_object_association_to_record(association, source_file=source_file)
            for association in page_wire_object_associations
        ]
        wire_object_associations_overlay_path = _write_wire_object_associations_overlay(
            page_record=page_record,
            component_boxes=page_component_boxes,
            terminal_nodes=page_terminal_nodes,
            reference_candidates=page_reference_candidates,
            wire_object_associations=page_wire_object_associations,
            output_dir=output_dir,
        )
        page_record["wire_object_associations_overlay"] = (
            wire_object_associations_overlay_path
        )
        page_record["wire_interactions"] = [
            _wire_interaction_to_record(interaction, source_file=source_file)
            for interaction in page_wire_interactions
        ]
        page_record["text_associations"] = [
            _text_association_to_record(association, source_file=source_file)
            for association in page_text_associations
        ]
        page_record["detections"] = [
            {
                **_match_to_record(match, template=template, source_file=source_file),
                "validation_overlay": overlay_path,
                "evidence_overlay": evidence_overlay_path,
            }
            for match in page_detections
        ]
        flattened_text_anchor_records.extend(page_record["text_anchors"])
        flattened_component_mark_records.extend(page_record["component_mark_candidates"])
        flattened_component_box_records.extend(page_record["component_box_candidates"])
        flattened_reference_candidate_records.extend(page_record["reference_candidates"])
        flattened_terminal_node_records.extend(page_record["terminal_node_candidates"])
        flattened_terminal_wire_records.extend(page_record["terminal_wire_associations"])
        flattened_reference_wire_records.extend(page_record["reference_wire_associations"])
        flattened_graphic_atom_records.extend(page_record["graphic_atoms"])
        flattened_wire_segment_records.extend(page_record["wire_segments"])
        flattened_wire_trace_records.extend(page_record["wire_trace_candidates"])
        flattened_wire_path_records.extend(page_record["wire_path_candidates"])
        flattened_wire_endpoint_records.extend(page_record["wire_endpoint_candidates"])
        flattened_wire_object_association_records.extend(
            page_record["wire_object_associations"]
        )
        flattened_wire_interaction_records.extend(page_record["wire_interactions"])
        flattened_text_association_records.extend(page_record["text_associations"])
        flattened_detection_records.extend(page_record["detections"])
        page_record["page_evidence_artifact"] = str(
            output_dir / f"page_{page:03d}_evidence_bundle.json"
        )
        page_record["completion_state"] = "evidence_bundle_ready"
        page_record["semantic_depth"] = [
            "canonical_render",
            "text_anchors",
            "component_mark_candidates",
            "component_box_candidates",
            "reference_candidates",
            "terminal_node_candidates",
            "terminal_wire_associations",
            "reference_wire_associations",
            "graphic_atoms",
            "wire_segment_candidates",
            "wire_trace_candidates",
            "wire_path_candidates",
            "wire_endpoint_candidates",
            "wire_object_associations",
            "wire_interaction_candidates",
            "text_geometry_associations",
            "component_template_detections",
        ]
        Path(page_record["page_evidence_artifact"]).write_text(
            json.dumps(
                {
                    "machine_id": machine_id,
                    "document_id": document_id,
                    "source_file": source_file,
                    "source_pdf_path": str(pdf_path),
                    "vector_db_path": str(vector_db_path),
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "page": page_record,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    first_page_record = page_records[pages.start]
    page_summaries = [
        {
            "source_page": page_record["source_page"],
            "canonical_render": page_record["canonical_render"],
            "reconstruction_overlay": page_record["reconstruction_overlay"],
            "component_marks_overlay": page_record["component_marks_overlay"],
            "component_boxes_overlay": page_record["component_boxes_overlay"],
            "reference_candidates_overlay": page_record["reference_candidates_overlay"],
            "terminal_nodes_overlay": page_record["terminal_nodes_overlay"],
            "terminal_wire_overlay": page_record["terminal_wire_overlay"],
            "reference_wire_overlay": page_record["reference_wire_overlay"],
            "graphic_atoms_overlay": page_record["graphic_atoms_overlay"],
            "wire_segments_overlay": page_record["wire_segments_overlay"],
            "wire_trace_overlay": page_record["wire_trace_overlay"],
            "wire_paths_overlay": page_record["wire_paths_overlay"],
            "wire_endpoints_overlay": page_record["wire_endpoints_overlay"],
            "clean_validation_overlay": page_record["clean_validation_overlay"],
            "wire_object_associations_overlay": page_record[
                "wire_object_associations_overlay"
            ],
            "wire_interactions_overlay": page_record["wire_interactions_overlay"],
            "text_associations_overlay": page_record["text_associations_overlay"],
            "validation_overlay": page_record["validation_overlay"],
            "evidence_overlay": page_record["evidence_overlay"],
            "page_evidence_artifact": page_record["page_evidence_artifact"],
            "text_anchor_count": len(page_record["text_anchors"]),
            "component_mark_count": len(page_record["component_mark_candidates"]),
            "component_box_count": len(page_record["component_box_candidates"]),
            "component_box_review_flag_count": page_record[
                "component_box_review_flag_count"
            ],
            "component_box_review_summary": page_record[
                "component_box_review_summary"
            ],
            "reference_candidate_count": len(page_record["reference_candidates"]),
            "terminal_node_count": len(page_record["terminal_node_candidates"]),
            "terminal_wire_association_count": len(page_record["terminal_wire_associations"]),
            "reference_wire_association_count": len(
                page_record["reference_wire_associations"]
            ),
            "graphic_atom_count": len(page_record["graphic_atoms"]),
            "wire_segment_count": len(page_record["wire_segments"]),
            "wire_trace_count": len(page_record["wire_trace_candidates"]),
            "wire_path_count": len(page_record["wire_path_candidates"]),
            "wire_endpoint_count": len(page_record["wire_endpoint_candidates"]),
            "wire_object_association_count": len(
                page_record["wire_object_associations"]
            ),
            "wire_interaction_count": len(page_record["wire_interactions"]),
            "text_association_count": len(page_record["text_associations"]),
            "detection_count": len(page_record["detections"]),
            "completion_state": page_record["completion_state"],
            "semantic_depth": page_record["semantic_depth"],
        }
        for page_record in page_records.values()
    ]
    component_box_review_summary = _aggregate_component_box_review_summaries(
        list(page_records.values())
    )
    result = {
        "machine_id": machine_id,
        "document_id": document_id,
        "source_file": source_file,
        "source_pdf_path": str(pdf_path),
        "vector_db_path": str(vector_db_path),
        "source_page": pages.start,
        "render_dpi": dpi,
        "render_width_px": first_page_record["render_width_px"],
        "render_height_px": first_page_record["render_height_px"],
        "canonical_render": first_page_record["canonical_render"],
        "reconstruction_overlay": first_page_record["reconstruction_overlay"],
        "component_marks_overlay": first_page_record["component_marks_overlay"],
        "component_boxes_overlay": first_page_record["component_boxes_overlay"],
        "reference_candidates_overlay": first_page_record["reference_candidates_overlay"],
        "terminal_nodes_overlay": first_page_record["terminal_nodes_overlay"],
        "terminal_wire_overlay": first_page_record["terminal_wire_overlay"],
        "reference_wire_overlay": first_page_record["reference_wire_overlay"],
        "graphic_atoms_overlay": first_page_record["graphic_atoms_overlay"],
        "wire_segments_overlay": first_page_record["wire_segments_overlay"],
        "wire_trace_overlay": first_page_record["wire_trace_overlay"],
        "wire_paths_overlay": first_page_record["wire_paths_overlay"],
        "wire_endpoints_overlay": first_page_record["wire_endpoints_overlay"],
        "clean_validation_overlay": first_page_record["clean_validation_overlay"],
        "wire_object_associations_overlay": first_page_record[
            "wire_object_associations_overlay"
        ],
        "wire_interactions_overlay": first_page_record["wire_interactions_overlay"],
        "text_associations_overlay": first_page_record["text_associations_overlay"],
        "validation_overlay": first_page_record["validation_overlay"],
        "evidence_overlay": first_page_record["evidence_overlay"],
        "template": {
            "template_id": template.template_id,
            "label": template.label,
            "source_page": template.source_page,
            "core_seq_start": template.core_seq_start,
            "core_seq_end": template.core_seq_end,
            "component_bbox_pdf": list(template.component_bbox_pdf),
        },
        "extraction_method": VECTOR_FINGERPRINT_METHOD,
        "text_anchor_method": TEXT_ANCHOR_METHOD,
        "component_mark_method": COMPONENT_MARK_METHOD,
        "component_box_method": COMPONENT_BOX_METHOD,
        "reference_candidate_method": REFERENCE_CANDIDATE_METHOD,
        "terminal_node_method": TERMINAL_NODE_METHOD,
        "terminal_wire_association_method": TERMINAL_WIRE_ASSOCIATION_METHOD,
        "reference_wire_association_method": REFERENCE_WIRE_ASSOCIATION_METHOD,
        "graphic_atom_method": GRAPHIC_ATOM_METHOD,
        "wire_segment_method": WIRE_SEGMENT_METHOD,
        "wire_trace_method": WIRE_TRACE_METHOD,
        "wire_path_method": WIRE_PATH_METHOD,
        "wire_endpoint_method": WIRE_ENDPOINT_METHOD,
        "wire_object_association_method": WIRE_OBJECT_ASSOCIATION_METHOD,
        "wire_interaction_method": WIRE_INTERACTION_METHOD,
        "uses_annotation_candidate_boxes": False,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "text_anchor_count": len(flattened_text_anchor_records),
        "component_mark_count": len(flattened_component_mark_records),
        "component_box_count": len(flattened_component_box_records),
        "component_box_review_flag_count": sum(
            1
            for component_box in flattened_component_box_records
            if component_box["visual_review_flags"]
        ),
        "component_box_review_summary": component_box_review_summary,
        "reference_candidate_count": len(flattened_reference_candidate_records),
        "terminal_node_count": len(flattened_terminal_node_records),
        "terminal_wire_association_count": len(flattened_terminal_wire_records),
        "reference_wire_association_count": len(flattened_reference_wire_records),
        "graphic_atom_count": len(flattened_graphic_atom_records),
        "wire_segment_count": len(flattened_wire_segment_records),
        "wire_trace_count": len(flattened_wire_trace_records),
        "wire_path_count": len(flattened_wire_path_records),
        "wire_endpoint_count": len(flattened_wire_endpoint_records),
        "wire_object_association_count": len(flattened_wire_object_association_records),
        "wire_interaction_count": len(flattened_wire_interaction_records),
        "text_association_method": TEXT_GEOMETRY_ASSOCIATION_METHOD,
        "text_association_count": len(flattened_text_association_records),
        "detection_count": len(flattened_detection_records),
        "page_summaries": page_summaries,
        "pages": [page_records[page] for page in pages],
    }
    if include_flattened_records:
        result.update(
            {
                "text_anchors": flattened_text_anchor_records,
                "component_mark_candidates": flattened_component_mark_records,
                "component_box_candidates": flattened_component_box_records,
                "reference_candidates": flattened_reference_candidate_records,
                "terminal_node_candidates": flattened_terminal_node_records,
                "terminal_wire_associations": flattened_terminal_wire_records,
                "reference_wire_associations": flattened_reference_wire_records,
                "graphic_atoms": flattened_graphic_atom_records,
                "wire_segments": flattened_wire_segment_records,
                "wire_trace_candidates": flattened_wire_trace_records,
                "wire_path_candidates": flattened_wire_path_records,
                "wire_endpoint_candidates": flattened_wire_endpoint_records,
                "wire_object_associations": flattened_wire_object_association_records,
                "wire_interactions": flattened_wire_interaction_records,
                "text_associations": flattened_text_association_records,
                "detections": flattened_detection_records,
            }
        )
    else:
        result["detections"] = flattened_detection_records

    artifact_path = output_dir / artifact_filename
    result["artifact_json"] = str(artifact_path)
    artifact_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return result


def build_schematic_page_evidence_bundle(
    *,
    pdf_path: Path,
    vector_db_path: Path = DEFAULT_VECTOR_DB_PATH,
    output_dir: Path,
    page_from: int,
    page_to: int = 0,
    max_pages: int = 1,
    dpi: int = 300,
    min_score: float = 0.999,
    machine_id: str = DEFAULT_MACHINE_ID,
    document_id: str = DEFAULT_DOCUMENT_ID,
    template: VectorTemplate = ELB_3_PHASE_TEMPLATE,
) -> dict[str, Any]:
    """Build page-owned evidence bundles without requiring a component detection."""
    return build_schematic_spine_slice0(
        pdf_path=pdf_path,
        vector_db_path=vector_db_path,
        output_dir=output_dir,
        page_from=page_from,
        page_to=page_to,
        max_pages=max_pages,
        dpi=dpi,
        min_score=min_score,
        machine_id=machine_id,
        document_id=document_id,
        template=template,
        require_detection=False,
        artifact_filename="schematic_page_evidence_index.json",
        include_flattened_records=False,
    )
