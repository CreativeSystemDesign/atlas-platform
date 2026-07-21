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
