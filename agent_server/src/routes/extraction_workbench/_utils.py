"""Geometry, normalization, and dataset utilities for extraction workbench."""

from __future__ import annotations
import math
import re
import unicodedata
from typing import Any
from pathlib import Path

def _component_identity_from_symbol(symbol: dict[str, object]) -> dict[str, object]:
    return {
        "full_symbol": _clean_text(symbol.get("symbol")),
        "class_family": _clean_text(symbol.get("family")),
        "description": _clean_text(symbol.get("description")),
        "part_number": _clean_text(symbol.get("part_number")),
        "location": _clean_text(symbol.get("location")),
        "source_page": _clean_text(symbol.get("source_page")),
        "source": "parts_symbol_match",
        "match_status": "symbol_match",
    }


def _yolov26_label_candidates_for_bbox(
    component_bbox: dict[str, object],
    page_metadata: dict[str, object],
    symbol_entries: object,
) -> list[dict[str, object]]:
    scale = page_metadata.get("scale")
    text_blocks = page_metadata.get("text_blocks")
    if not isinstance(scale, (int, float)) or not isinstance(text_blocks, list):
        return []
    if not isinstance(symbol_entries, list):
        return []

    symbol_map = {
        _normalize_symbol(entry.get("symbol")): entry
        for entry in symbol_entries
        if isinstance(entry, dict) and _normalize_symbol(entry.get("symbol"))
    }
    component = _bbox_float_dict(component_bbox)
    expanded = _expand_px_bbox(component, 420.0)
    component_center = _bbox_center(component)
    candidates: list[dict[str, object]] = []

    for block in text_blocks:
        if not isinstance(block, dict):
            continue
        text = _clean_text(block.get("text"))
        normalized = _normalize_symbol(text)
        if not normalized or normalized.isdigit():
            continue
        pdf_bbox = block.get("bbox")
        if not _pdf_bbox_is_valid(pdf_bbox):
            continue
        bbox = _pdf_bbox_to_px(pdf_bbox, float(scale))
        if not _boxes_intersect(expanded, bbox):
            continue

        symbol = symbol_map.get(normalized)
        if not symbol:
            symbol = _symbol_from_adjacent_digits(
                block,
                text_blocks,
                symbol_map,
                float(scale),
            )
        distance = _point_distance(component_center, _bbox_center(bbox))
        candidates.append(
            {
                "text": text,
                "normalizedText": normalized,
                "bbox": bbox,
                "textFragments": [
                    {
                        "text": text,
                        "normalizedText": normalized,
                        "bbox": bbox,
                    }
                ],
                "score": distance,
                "distance": distance,
                "source": "parts_symbol_match" if symbol else "text_proximity",
                "reason": (
                    "known_parts_list_symbol_nearby"
                    if symbol
                    else "nearby_vector_text"
                ),
                **({"symbol": symbol} if symbol else {}),
            }
        )

    return sorted(
        candidates,
        key=lambda candidate: _yolov26_candidate_rank(candidate, component),
    )[:24]


def _symbol_from_adjacent_digits(
    block: dict[str, object],
    text_blocks: list[object],
    symbol_map: dict[str, dict[str, object]],
    scale: float,
) -> dict[str, object] | None:
    base = _normalize_symbol(block.get("text"))
    if not re.fullmatch(r"[A-Z]+", base):
        return None
    pdf_bbox = block.get("bbox")
    if not _pdf_bbox_is_valid(pdf_bbox):
        return None
    bbox = _pdf_bbox_to_px(pdf_bbox, scale)
    right_edge = bbox["x"] + bbox["width"]
    center_y = bbox["y"] + bbox["height"] / 2.0
    line_tolerance = max(8.0, bbox["height"] * 0.8)
    max_gap = max(18.0, bbox["height"] * 1.25)
    digit_blocks: list[dict[str, object]] = []
    for candidate in text_blocks:
        if not isinstance(candidate, dict):
            continue
        normalized = _normalize_symbol(candidate.get("text"))
        if not normalized.isdigit():
            continue
        candidate_pdf_bbox = candidate.get("bbox")
        if not _pdf_bbox_is_valid(candidate_pdf_bbox):
            continue
        candidate_bbox = _pdf_bbox_to_px(candidate_pdf_bbox, scale)
        candidate_center_y = candidate_bbox["y"] + candidate_bbox["height"] / 2.0
        gap = candidate_bbox["x"] - right_edge
        if (
            gap >= -2
            and gap <= max_gap
            and abs(candidate_center_y - center_y) <= line_tolerance
        ):
            digit_blocks.append({"normalized": normalized, "bbox": candidate_bbox})
    digit_blocks.sort(key=lambda item: float(item["bbox"]["x"]))

    cursor_right = right_edge
    suffix = ""
    for digit_block in digit_blocks:
        digit_bbox = digit_block["bbox"]
        gap = float(digit_bbox["x"]) - cursor_right
        if gap > max_gap:
            break
        suffix += str(digit_block["normalized"])
        cursor_right = float(digit_bbox["x"]) + float(digit_bbox["width"])
        symbol = symbol_map.get(f"{base}{suffix}")
        if symbol:
            return symbol
    return None


def _bbox_float_dict(bbox: dict[str, object]) -> dict[str, float]:
    return {
        "x": float(bbox["x"]),
        "y": float(bbox["y"]),
        "width": float(bbox["width"]),
        "height": float(bbox["height"]),
    }


def _pdf_bbox_is_valid(bbox: object) -> bool:
    return (
        isinstance(bbox, list)
        and len(bbox) == 4
        and all(isinstance(value, (int, float)) for value in bbox)
    )


def _pdf_bbox_to_px(bbox: object, scale: float) -> dict[str, float]:
    if not _pdf_bbox_is_valid(bbox):
        raise ValueError(f"invalid PDF bbox: {bbox}")
    left, top, right, bottom = [float(value) for value in bbox]
    return {
        "x": left * scale,
        "y": top * scale,
        "width": max(0.0, (right - left) * scale),
        "height": max(0.0, (bottom - top) * scale),
    }


def _expand_px_bbox(bbox: dict[str, float], amount: float) -> dict[str, float]:
    return {
        "x": bbox["x"] - amount,
        "y": bbox["y"] - amount,
        "width": bbox["width"] + amount * 2.0,
        "height": bbox["height"] + amount * 2.0,
    }


def _bbox_center(bbox: dict[str, float]) -> dict[str, float]:
    return {
        "x": bbox["x"] + bbox["width"] / 2.0,
        "y": bbox["y"] + bbox["height"] / 2.0,
    }


def _point_distance(left: dict[str, float], right: dict[str, float]) -> float:
    return math.hypot(left["x"] - right["x"], left["y"] - right["y"])


def _boxes_intersect(left: dict[str, float], right: dict[str, float]) -> bool:
    return not (
        right["x"] > left["x"] + left["width"]
        or right["x"] + right["width"] < left["x"]
        or right["y"] > left["y"] + left["height"]
        or right["y"] + right["height"] < left["y"]
    )


def _yolov26_candidate_rank(
    candidate: dict[str, object],
    component: dict[str, float],
) -> tuple[float, float, float, float]:
    bbox = candidate.get("bbox")
    if not isinstance(bbox, dict):
        return (99.0, 0.0, 0.0, float(candidate.get("distance") or 0.0))
    candidate_bbox = {
        "x": float(bbox["x"]),
        "y": float(bbox["y"]),
        "width": float(bbox["width"]),
        "height": float(bbox["height"]),
    }
    candidate_center = _bbox_center(candidate_bbox)
    candidate_bottom = candidate_bbox["y"] + candidate_bbox["height"]
    component_center = _bbox_center(component)
    component_right = component["x"] + component["width"]
    candidate_right = candidate_bbox["x"] + candidate_bbox["width"]
    horizontal_padding = max(16.0, component["width"] * 0.25)
    overlaps_x = candidate_bbox["x"] <= component_right and candidate_right >= component["x"]
    near_x = (
        candidate_bbox["x"] <= component_right + horizontal_padding
        and candidate_right >= component["x"] - horizontal_padding
    )
    above = candidate_bottom <= component["y"] + 10.0
    zone = 0 if above and overlaps_x else 1 if above and near_x else 2 if above else 3
    known_penalty = 0.0 if candidate.get("symbol") else 1.0
    return (
        float(zone),
        known_penalty,
        abs(candidate_center["x"] - component_center["x"]),
        float(candidate.get("distance") or 0.0),
    )


def _yolov26_bbox_is_valid(bbox: dict[str, object]) -> bool:
    try:
        x = float(bbox["x"])
        y = float(bbox["y"])
        width = float(bbox["width"])
        height = float(bbox["height"])
    except (KeyError, TypeError, ValueError):
        return False
    return (
        width > 0
        and height > 0
        and x >= 0
        and y >= 0
        and x + width <= _PAGE_WIDTH_PX
        and y + height <= _PAGE_HEIGHT_PX
    )


def _validated_yolov26_roi(roi: WorkbenchYolov26DetectRoi) -> tuple[int, int, int, int]:
    left = int(math.floor(roi.x))
    top = int(math.floor(roi.y))
    right = int(math.ceil(roi.x + roi.width))
    bottom = int(math.ceil(roi.y + roi.height))
    if (
        roi.width <= 0
        or roi.height <= 0
        or left < 0
        or top < 0
        or right > _PAGE_WIDTH_PX
        or bottom > _PAGE_HEIGHT_PX
        or right <= left
        or bottom <= top
    ):
        raise HTTPException(status_code=400, detail=f"invalid YOLOv26 ROI: {roi.model_dump()}")
    return left, top, right, bottom


def _offset_yolov26_prediction_bbox(
    prediction: object,
    offset_x: float,
    offset_y: float,
) -> dict[str, object]:
    if not isinstance(prediction, dict):
        raise HTTPException(status_code=500, detail=f"invalid YOLOv26 prediction object: {prediction}")
    bbox = prediction.get("bbox")
    if not isinstance(bbox, dict):
        raise HTTPException(status_code=500, detail=f"YOLOv26 ROI prediction is missing bbox: {prediction}")
    try:
        x = float(bbox["x"]) + offset_x
        y = float(bbox["y"]) + offset_y
        width = float(bbox["width"])
        height = float(bbox["height"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"invalid YOLOv26 ROI bbox: {prediction}") from exc
    adjusted_bbox = {
        "x": x,
        "y": y,
        "width": width,
        "height": height,
    }
    if not _yolov26_bbox_is_valid(adjusted_bbox):
        raise HTTPException(status_code=500, detail=f"YOLOv26 ROI bbox offset outside page: {prediction}")
    return {
        **prediction,
        "bbox": adjusted_bbox,
        "bbox_xyxy": [x, y, x + width, y + height],
    }


def _yolov26_prediction_center_in_roi(
    prediction: object,
    roi: tuple[int, int, int, int],
) -> bool:
    if not isinstance(prediction, dict):
        raise HTTPException(status_code=500, detail=f"invalid YOLOv26 prediction object: {prediction}")
    bbox = prediction.get("bbox")
    if not isinstance(bbox, dict):
        raise HTTPException(status_code=500, detail=f"YOLOv26 prediction is missing bbox: {prediction}")
    try:
        center_x = float(bbox["x"]) + float(bbox["width"]) / 2.0
        center_y = float(bbox["y"]) + float(bbox["height"]) / 2.0
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"invalid YOLOv26 bbox: {prediction}") from exc
    left, top, right, bottom = roi
    return float(left) <= center_x <= float(right) and float(top) <= center_y <= float(bottom)


def _snap_yolov26_prediction_to_metadata(
    prediction: object,
    metadata: dict[str, object],
) -> dict[str, object]:
    if not isinstance(prediction, dict):
        raise HTTPException(status_code=500, detail=f"invalid YOLOv26 prediction object: {prediction}")
    bbox = prediction.get("bbox")
    if not isinstance(bbox, dict):
        raise HTTPException(status_code=500, detail=f"YOLOv26 prediction is missing bbox: {prediction}")
    try:
        x = float(bbox["x"])
        y = float(bbox["y"])
        width = float(bbox["width"])
        height = float(bbox["height"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"invalid YOLOv26 bbox: {prediction}") from exc

    if width > 220 or height > 140:
        return prediction
    scale = metadata.get("scale")
    shapes = metadata.get("shapes")
    if not isinstance(scale, (int, float)) or scale <= 0:
        raise HTTPException(status_code=500, detail="YOLOv26 metadata snap requires page scale")
    if not isinstance(shapes, list):
        raise HTTPException(status_code=500, detail="YOLOv26 metadata snap requires page shapes")

    center_pdf = {
        "x": (x + width / 2) / float(scale),
        "y": (y + height / 2) / float(scale),
    }
    predicted_pdf = {
        "x0": x / float(scale),
        "y0": y / float(scale),
        "x1": (x + width) / float(scale),
        "y1": (y + height) / float(scale),
    }
    candidates: list[tuple[float, dict[str, float]]] = []
    for shape in shapes:
        if not isinstance(shape, dict):
            continue
        raw = shape.get("bbox")
        if not isinstance(raw, list) or len(raw) != 4:
            continue
        try:
            sx0, sy0, sx1, sy1 = [float(value) for value in raw]
        except (TypeError, ValueError):
            continue
        shape_box = _normalized_pdf_box(sx0, sy0, sx1, sy1)
        if not _is_compact_yolov26_component_shape(shape_box):
            continue
        distance = _pdf_distance_to_box(center_pdf, shape_box)
        if distance > 12 and not _pdf_boxes_intersect(_expand_pdf_box(shape_box, 2.5), predicted_pdf):
            continue
        area_delta = abs(
            (shape_box["x1"] - shape_box["x0"]) * (shape_box["y1"] - shape_box["y0"])
            - (predicted_pdf["x1"] - predicted_pdf["x0"]) * (predicted_pdf["y1"] - predicted_pdf["y0"])
        )
        candidates.append((distance * 1000 + area_delta, shape_box))

    if not candidates:
        return prediction
    _, snapped_pdf = sorted(candidates, key=lambda item: item[0])[0]
    padding_pdf = 2 / float(scale)
    snapped_pdf = _expand_pdf_box(snapped_pdf, padding_pdf)
    snapped_bbox = {
        "x": max(0.0, snapped_pdf["x0"] * float(scale)),
        "y": max(0.0, snapped_pdf["y0"] * float(scale)),
        "width": max(1.0, (snapped_pdf["x1"] - snapped_pdf["x0"]) * float(scale)),
        "height": max(1.0, (snapped_pdf["y1"] - snapped_pdf["y0"]) * float(scale)),
    }
    if not _yolov26_bbox_is_valid(snapped_bbox):
        raise HTTPException(status_code=500, detail=f"YOLOv26 metadata snap produced invalid bbox: {prediction}")
    return {
        **prediction,
        "bbox": snapped_bbox,
        "bbox_xyxy": [
            snapped_bbox["x"],
            snapped_bbox["y"],
            snapped_bbox["x"] + snapped_bbox["width"],
            snapped_bbox["y"] + snapped_bbox["height"],
        ],
        "metadata_snap": {
            "source": "page_shape_compact_component",
            "original_bbox": bbox,
        },
    }


def _normalized_pdf_box(x0: float, y0: float, x1: float, y1: float) -> dict[str, float]:
    left = min(x0, x1)
    top = min(y0, y1)
    right = max(x0, x1)
    bottom = max(y0, y1)
    return {"x0": left, "y0": top, "x1": right, "y1": bottom}


def _expand_pdf_box(box: dict[str, float], amount: float) -> dict[str, float]:
    return {
        "x0": box["x0"] - amount,
        "y0": box["y0"] - amount,
        "x1": box["x1"] + amount,
        "y1": box["y1"] + amount,
    }


def _is_compact_yolov26_component_shape(box: dict[str, float]) -> bool:
    width = box["x1"] - box["x0"]
    height = box["y1"] - box["y0"]
    if width <= 0 or height <= 0:
        return False
    max_side = max(width, height)
    min_side = min(width, height)
    if max_side > 70 or min_side > 24:
        return False
    if max_side < 6 or min_side < 2:
        return False
    return True


def _pdf_distance_to_box(point: dict[str, float], box: dict[str, float]) -> float:
    dx = max(box["x0"] - point["x"], 0.0, point["x"] - box["x1"])
    dy = max(box["y0"] - point["y"], 0.0, point["y"] - box["y1"])
    return math.hypot(dx, dy)


def _pdf_boxes_intersect(left: dict[str, float], right: dict[str, float]) -> bool:
    return not (
        right["x0"] > left["x1"]
        or right["x1"] < left["x0"]
        or right["y0"] > left["y1"]
        or right["y1"] < left["y0"]
    )


def _dedupe_yolov26_predictions(
    predictions: list[object],
    *,
    iou_threshold: float = 0.45,
    contained_overlap_threshold: float = 0.62,
) -> list[dict[str, object]]:
    typed_predictions = [
        prediction for prediction in predictions if isinstance(prediction, dict)
    ]
    ordered = sorted(
        typed_predictions,
        key=lambda prediction: float(prediction.get("confidence") or 0),
        reverse=True,
    )
    kept: list[dict[str, object]] = []
    for prediction in ordered:
        bbox = prediction.get("bbox")
        if not isinstance(bbox, dict):
            kept.append(prediction)
            continue
        duplicate = False
        for existing in kept:
            existing_bbox = existing.get("bbox")
            if not isinstance(existing_bbox, dict):
                continue
            if (
                _bbox_iou_px(bbox, existing_bbox) >= iou_threshold
                or _bbox_min_area_overlap_px(bbox, existing_bbox)
                >= contained_overlap_threshold
            ):
                duplicate = True
                break
        if not duplicate:
            kept.append(prediction)
    return sorted(kept, key=lambda prediction: int(prediction.get("index") or 0))


def _bbox_iou_px(left: dict[str, object], right: dict[str, object]) -> float:
    lx, ly, lw, lh = _bbox_metrics_px(left)
    rx, ry, rw, rh = _bbox_metrics_px(right)
    intersection = _bbox_intersection_area(lx, ly, lw, lh, rx, ry, rw, rh)
    union = lw * lh + rw * rh - intersection
    if union <= 0:
        return 0.0
    return intersection / union


def _bbox_min_area_overlap_px(left: dict[str, object], right: dict[str, object]) -> float:
    lx, ly, lw, lh = _bbox_metrics_px(left)
    rx, ry, rw, rh = _bbox_metrics_px(right)
    intersection = _bbox_intersection_area(lx, ly, lw, lh, rx, ry, rw, rh)
    smaller_area = min(lw * lh, rw * rh)
    if smaller_area <= 0:
        return 0.0
    return intersection / smaller_area


def _bbox_metrics_px(bbox: dict[str, object]) -> tuple[float, float, float, float]:
    return (
        float(bbox["x"]),
        float(bbox["y"]),
        float(bbox["width"]),
        float(bbox["height"]),
    )


def _bbox_intersection_area(
    lx: float,
    ly: float,
    lw: float,
    lh: float,
    rx: float,
    ry: float,
    rw: float,
    rh: float,
) -> float:
    ix1 = max(lx, rx)
    iy1 = max(ly, ry)
    ix2 = min(lx + lw, rx + rw)
    iy2 = min(ly + lh, ry + rh)
    return max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)


def _metadata_with_attachment_identity(
    metadata: dict[str, object],
    symbol_entries: list[dict[str, object]],
    *,
    label: object = "",
) -> dict[str, object]:
    if not isinstance(metadata, dict):
        return metadata
    if isinstance(metadata.get("componentIdentity"), dict):
        return metadata
    identity = _component_identity_from_attachments(metadata, symbol_entries, label=label)
    if not identity:
        return metadata
    return {**metadata, "componentIdentity": identity}


def _component_identity_from_attachments(
    metadata: dict[str, object],
    symbol_entries: list[dict[str, object]],
    *,
    label: object = "",
) -> dict[str, object] | None:
    attachments = metadata.get("attachments")
    if not isinstance(attachments, list):
        return None
    attachment_parts = {
        _normalize_part_number(attachment.get("text"))
        for attachment in attachments
        if isinstance(attachment, dict)
        and str(attachment.get("type") or "") in {"part_number", "spec"}
    }
    attachment_parts.discard("")
    if not attachment_parts:
        return None
    for symbol in symbol_entries:
        part_number = _normalize_part_number(symbol.get("part_number"))
        if part_number and part_number in attachment_parts:
            return {
                "full_symbol": _clean_text(symbol.get("symbol")),
                "class_family": _clean_text(symbol.get("family")),
                "description": _clean_text(symbol.get("description")),
                "part_number": _clean_text(symbol.get("part_number")),
                "location": _clean_text(symbol.get("location")),
                "source_page": _clean_text(symbol.get("source_page")),
                "source": "parts_attachment_match",
                "match_status": "part_number_attachment_match",
            }
    schematic_part_number = _first_attachment_text(attachments, {"part_number", "spec"})
    schematic_context = _first_attachment_text(attachments, {"text"})
    schematic_label = _clean_text(label)
    if not schematic_part_number and not schematic_context:
        return None
    description = _human_readable_context_text(schematic_context) or schematic_label
    return {
        "full_symbol": schematic_label,
        "class_family": _symbol_family(schematic_label) if schematic_label else "",
        "description": description,
        "part_number": schematic_part_number,
        "location": "",
        "source_page": "",
        "source": "schematic_context",
        "match_status": "no_parts_list_match_schematic_attachments",
    }


def _first_attachment_text(
    attachments: list[object],
    attachment_types: set[str],
) -> str:
    for attachment in attachments:
        if not isinstance(attachment, dict):
            continue
        if str(attachment.get("type") or "") not in attachment_types:
            continue
        text = _clean_text(attachment.get("text"))
        if text:
            return text
    return ""


def _human_readable_context_text(value: object) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"[_\s-]+", " ", text).strip()
    if text.isupper() and " " not in text:
        known_terms = {
            "SERVOMOTOR": "SERVO MOTOR",
            "NOISEFILTER": "NOISE FILTER",
            "LINENOISEFILTER": "LINE NOISE FILTER",
            "MAGNETICCONTACTOR": "MAGNETIC CONTACTOR",
            "EARTHLEAKAGEBREAKER": "EARTH LEAKAGE BREAKER",
        }
        return known_terms.get(text, text)
    return text


def _annotation_snapshot_row(
    row: Any,
    *,
    include_annotations: bool = True,
) -> dict[str, object]:
    payload = {
        "snapshot_id": str(row[0]),
        "project_id": str(row[1]),
        "document_id": row[2],
        "page_num": row[3],
        "name": row[4],
        "notes": row[5],
        "annotation_count": row[7],
        "source": row[8],
        "metadata": row[9] or {},
        "created_at": row[10].isoformat() if hasattr(row[10], "isoformat") else row[10],
    }
    if include_annotations:
        payload["annotations"] = row[6] or []
    return payload


async def _get_workbench_symbol_bank(
    project: dict[str, object],
    document_id: str,
) -> dict[str, object]:
    """Return known component symbols for Workbench label auto-pairing.

    Neon is the preferred source because it is the platform system of record for
    extracted documents. A local CSV fallback keeps the development Workbench
    usable when Neon is temporarily unavailable.
    """
    if document_id != _DEFAULT_DOCUMENT_ID:
        raise HTTPException(status_code=404, detail="workbench document not found")

    neon_entries = await _load_symbol_bank_from_neon(uuid.UUID(_project_id(project)))
    if neon_entries:
        return {
            "project_id": _project_id(project),
            "document_id": document_id,
            "source": "neon:document_extraction_rows",
            "symbols": neon_entries,
        }

    csv_entries = _load_symbol_bank_from_csv()
    return {
        "project_id": _project_id(project),
        "document_id": document_id,
        "source": "local_csv_fallback",
        "symbols": csv_entries,
    }


async def _get_workbench_wire_label_bank(
    project: dict[str, object],
    document_id: str,
) -> dict[str, object]:
    """Return known machine-cable wire labels for Workbench wire-label classification."""
    if document_id != _DEFAULT_DOCUMENT_ID:
        raise HTTPException(status_code=404, detail="workbench document not found")

    entries = await _load_wire_label_bank_from_neon(uuid.UUID(_project_id(project)))
    return {
        "project_id": _project_id(project),
        "document_id": document_id,
        "source": "neon:document_extraction_rows",
        "wire_labels": entries,
    }


async def _load_symbol_bank_from_neon(project_id: uuid.UUID) -> list[dict[str, object]]:
    try:
        pool = await get_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT r.symbol_text, r.description, r.part_number, r.location, r.source_page
                FROM document_extraction_rows r
                JOIN document_extractions e ON e.extraction_id = r.extraction_id
                WHERE r.symbol_text IS NOT NULL
                  AND r.symbol_text <> ''
                  AND e.project_id = %s
                  AND e.extraction_kind = 'electrical_parts_list'
                  AND e.source_pdf_path ILIKE %s
                ORDER BY e.created_at DESC, r.row_index ASC
                LIMIT 5000
                """,
                (project_id, "%ELECTRICAL%PARTS%LIST%151%E8810%601%0%"),
            )
            rows = await cur.fetchall()
    except Exception:
        return []

    entries: list[dict[str, object]] = []
    for symbol_text, description, part_number, location, source_page in rows:
        for symbol in _split_symbols(str(symbol_text or "")):
            entries.append(
                _symbol_entry(
                    symbol=symbol,
                    description=description,
                    part_number=part_number,
                    location=location,
                    source_page=source_page,
                )
            )
    return _dedupe_symbol_entries(entries)


async def _load_wire_label_bank_from_neon(project_id: uuid.UUID) -> list[dict[str, object]]:
    try:
        pool = await get_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT
                    r.row_data ->> 'Wire Label' AS wire_label,
                    r.row_data ->> 'Cable Number' AS cable_number,
                    r.row_data ->> 'Originating Point' AS originating_point,
                    r.row_data ->> 'Termination Point' AS termination_point,
                    r.source_page,
                    e.extraction_id,
                    e.created_at
                FROM document_extraction_rows r
                JOIN document_extractions e ON e.extraction_id = r.extraction_id
                WHERE e.project_id = %s
                  AND e.extraction_kind = 'dcm_cable_list_wire_labels'
                  AND e.output_contract = 'wire_labels'
                  AND COALESCE(r.row_data ->> 'Wire Label', '') <> ''
                ORDER BY e.created_at DESC, r.row_index ASC
                LIMIT 10000
                """,
                (project_id,),
            )
            rows = await cur.fetchall()
    except Exception:
        return []

    entries: list[dict[str, object]] = []
    for (
        wire_label,
        cable_number,
        originating_point,
        termination_point,
        source_page,
        extraction_id,
        created_at,
    ) in rows:
        label = _normalize_wire_label(wire_label)
        if not label:
            continue
        entries.append(
            {
                "wire_label": label,
                "raw_label": _clean_text(wire_label),
                "cable_number": _clean_text(cable_number),
                "originating_point": _clean_text(originating_point),
                "termination_point": _clean_text(termination_point),
                "source_page": _clean_text(source_page),
                "extraction_id": str(extraction_id),
                "extracted_at": created_at.isoformat() if created_at else "",
            }
        )
    return _dedupe_wire_label_entries(entries)


def _load_symbol_bank_from_csv() -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for path in _SYMBOL_BANK_CSV_PATHS:
        if not path.exists():
            continue
        with path.open(newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                for symbol in _split_symbols(row.get("Symbol Text", "")):
                    entries.append(
                        _symbol_entry(
                            symbol=symbol,
                            description=row.get("Description"),
                            part_number=row.get("Part Number"),
                            location=row.get("Location"),
                            source_page=row.get("Source Page"),
                        )
                    )
        if entries:
            break
    return _dedupe_symbol_entries(entries)


def _symbol_entry(
    *,
    symbol: str,
    description: object = None,
    part_number: object = None,
    location: object = None,
    source_page: object = None,
) -> dict[str, object]:
    normalized = _normalize_symbol(symbol)
    return {
        "symbol": normalized,
        "family": _symbol_family(normalized),
        "suffix": _symbol_suffix(normalized),
        "suffix_semantics": "opaque_identifier",
        "description": _clean_text(description),
        "part_number": _clean_text(part_number),
        "location": _clean_text(location),
        "source_page": _clean_text(source_page),
    }


def _dedupe_symbol_entries(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    deduped: dict[str, dict[str, object]] = {}
    for entry in entries:
        symbol = str(entry.get("symbol") or "")
        if symbol and symbol not in deduped:
            deduped[symbol] = entry
    return sorted(deduped.values(), key=lambda item: str(item["symbol"]))


def _dedupe_wire_label_entries(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    deduped: dict[str, dict[str, object]] = {}
    for entry in entries:
        wire_label = str(entry.get("wire_label") or "")
        cable_number = str(entry.get("cable_number") or "")
        origin = str(entry.get("originating_point") or "")
        termination = str(entry.get("termination_point") or "")
        key = f"{wire_label}|{cable_number}|{origin}|{termination}"
        if wire_label and key not in deduped:
            deduped[key] = entry
    return sorted(
        deduped.values(),
        key=lambda item: (
            str(item.get("wire_label") or ""),
            str(item.get("cable_number") or ""),
        ),
    )


def _split_symbols(value: object) -> list[str]:
    normalized = str(value or "").replace("\r", "\n").replace("\u3000", " ")
    symbols: list[str] = []
    for line in normalized.split("\n"):
        text = _normalize_symbol(line)
        if not text:
            continue
        shorthand = re.fullmatch(r"([A-Z]+)(\d+[A-Z]?),(\d+[A-Z]?)", text)
        if shorthand:
            family, left, right = shorthand.groups()
            symbols.extend([f"{family}{left}", f"{family}{right}"])
            continue
        spaced = re.fullmatch(r"([A-Z]+)\s+(\d+[A-Z]?)", line.strip().upper())
        if spaced:
            symbols.append(f"{spaced.group(1)}{spaced.group(2)}")
            continue
        for part in re.split(r"[,;/]", text):
            part = _normalize_symbol(part)
            if part:
                symbols.extend(_split_concatenated_symbols(part))
    return symbols


def _split_concatenated_symbols(value: str) -> list[str]:
    if not value:
        return []
    family_match = re.match(r"^([A-Z]+)\d", value)
    if not family_match:
        return [value]
    family = family_match.group(1)
    token_pattern = re.compile(rf"{re.escape(family)}\d+")
    tokens = [match.group(0) for match in token_pattern.finditer(value)]
    if len(tokens) > 1 and "".join(tokens) == value:
        return tokens
    return [value]


def _normalize_symbol(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).upper()
    text = "".join(
        chr(ord(char) - 0xFEE0) if "！" <= char <= "～" else char for char in text
    )
    return re.sub(r"[^A-Z0-9-]", "", text)


def _normalize_wire_label(value: object) -> str:
    text = str(value or "").upper()
    text = "".join(
        chr(ord(char) - 0xFEE0) if "！" <= char <= "～" else char for char in text
    )
    text = text.replace("−", "-").replace("–", "-").replace("—", "-")
    return re.sub(r"[^A-Z0-9+\\-]", "", text)


def _dataset_component_class_name(label: str) -> str:
    normalized = _normalize_symbol(label)
    if normalized == "CONTINUATION":
        return "continuation"
    match = re.match(r"[A-Z]+", normalized)
    if match:
        return match.group(0)
    embedded_matches = [
        (normalized.rfind(family), len(family), family)
        for family in _KNOWN_COMPONENT_CLASS_FAMILIES
        if normalized.rfind(family) >= 0
    ]
    if embedded_matches:
        _, _, family = max(embedded_matches)
        return family
    return "unknown_component"


def _dataset_attachment_class_name(
    attachment_type: str,
    attachment_text: str,
    owner_label: str,
) -> str:
    if attachment_type == "wire_label":
        return _dataset_wire_label_class_name(attachment_text)
    if attachment_type == "part_number":
        return f"{_dataset_component_class_name(owner_label)}_part_number"
    if attachment_type == "spec":
        return f"{_dataset_component_class_name(owner_label)}_spec"
    return f"component_{attachment_type or 'attachment'}"


def _dataset_root_class_name(root_type: str, label: str) -> str:
    if root_type == "wire_label":
        return _dataset_wire_label_class_name(label)
    if root_type == "part_number":
        return "unknown_component_part_number"
    if root_type == "spec":
        return "unknown_component_spec"
    if root_type == "continuation":
        return "continuation"
    return root_type


def _dataset_wire_label_class_name(value: str) -> str:
    label = _normalize_wire_label(value)
    if label == "P5":
        return "Wire Label (+5v)"
    if label == "N5":
        return "Wire Label (-5v)"
    if label == "P24":
        return "Wire Label (+24v)"
    if label == "N24":
        return "Wire Label (-24v)"
    if label == "NC24":
        return "Wire Label (com24v)"
    if re.fullmatch(r"X\d{4,}", label):
        return "Input Signal Wire"
    if re.fullmatch(r"Y\d{4,}", label):
        return "Output Signal Wire"
    return "Wire Label"


def _symbol_family(symbol: str) -> str:
    match = re.match(r"[A-Z-]+", symbol)
    return match.group(0).rstrip("-") if match else symbol


def _symbol_suffix(symbol: str) -> str:
    family = _symbol_family(symbol)
    return symbol[len(family) :]


def _clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()

# --- Route helpers ---
async def _resolve_project(project_id: uuid.UUID | None = None) -> dict[str, object]:
    selected = project_id or DEFAULT_PROJECT_ID
    project = await get_project(selected)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return project


def _project_id(project: dict[str, object]) -> str:
    return str(project["project_id"])


def _document_payload(project: dict[str, object]) -> dict[str, object]:
    return {
        "project_id": _project_id(project),
        "document_id": _DEFAULT_DOCUMENT_ID,
        "label": "reference schematic",
        "role": "reference-development-source",
        "page_count": _PAGE_COUNT,
        "canonical_width_px": _PAGE_WIDTH_PX,
        "canonical_height_px": _PAGE_HEIGHT_PX,
    }


def _first_existing_path(paths: list[Path]) -> Path | None:
    for path in paths:
        if path.exists():
            return path
    return None


def _workbench_page_image_path(document_id: str, page_num: int) -> Path:
    if document_id != _DEFAULT_DOCUMENT_ID:
        raise HTTPException(status_code=404, detail="workbench document not found")
    if page_num < 1 or page_num > _PAGE_COUNT:
        raise HTTPException(status_code=404, detail="workbench page not found")

    image_path = _first_existing_path(
        [
            candidate
            for root in _PAGE_IMAGE_ROOTS
            for candidate in (
                root / f"page-{page_num:03d}.png",
                root / f"page_{page_num}.png",
            )
        ]
    )
    if image_path is None:
        raise HTTPException(status_code=404, detail="workbench page image not found")
    return image_path


def _qwen3vl_sweep_page_image_path(page_num: int) -> Path | None:
    candidates = [
        _QWEN3VL_300DPI_PAGE_ROOT / f"page-{page_num:03d}.png",
        _QWEN3VL_300DPI_PAGE_ROOT / f"page_{page_num}.png",
        *_PAGE_IMAGE_ROOTS,
    ]
    for candidate in candidates:
        path = candidate if candidate.suffix else candidate / f"page_{page_num}.png"
        if path.exists():
            return path
    return None


def _clamp_roi_to_page(roi: WorkbenchRoiBox) -> dict[str, int]:
    left = max(0, min(_PAGE_WIDTH_PX, int(round(roi.x))))
    top = max(0, min(_PAGE_HEIGHT_PX, int(round(roi.y))))
    right = max(0, min(_PAGE_WIDTH_PX, int(round(roi.x + roi.width))))
    bottom = max(0, min(_PAGE_HEIGHT_PX, int(round(roi.y + roi.height))))
    if right <= left or bottom <= top:
        raise HTTPException(status_code=400, detail="roi is outside the page")
    return {
        "x": left,
        "y": top,
        "width": right - left,
        "height": bottom - top,
    }


def _extract_json_object(text: str) -> Any:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    match = re.search(r"(\{.*\}|\[.*\])", cleaned, flags=re.DOTALL)
    if not match:
        raise HTTPException(status_code=502, detail="qwen roi response did not include JSON")
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"qwen roi JSON parse failed: {exc}") from exc


def _normalize_qwen_detection(payload: Any, roi: dict[str, int]) -> dict[str, Any] | None:
    item = payload
    if isinstance(payload, list):
        item = payload[0] if payload else None
    if not isinstance(item, dict):
        return None
    if item.get("bbox_2d") is None and item.get("bbox") is None:
        return None
    if item.get("label") is None and item.get("text") is None and item.get("confidence") is None:
        return None

    raw_bbox = item.get("bbox_2d") or item.get("bbox")
    if not isinstance(raw_bbox, list) or len(raw_bbox) != 4:
        raise HTTPException(status_code=502, detail="qwen roi bbox must be [x1, y1, x2, y2]")
    try:
        x1, y1, x2, y2 = [float(value) for value in raw_bbox]
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="qwen roi bbox contains non-numeric values") from exc

    crop_width = roi["width"]
    crop_height = roi["height"]
    left = max(0.0, min(float(crop_width), min(x1, x2)))
    top = max(0.0, min(float(crop_height), min(y1, y2)))
    right = max(0.0, min(float(crop_width), max(x1, x2)))
    bottom = max(0.0, min(float(crop_height), max(y1, y2)))
    if right - left < 3 or bottom - top < 3:
        return None

    return {
        "bbox": {
            "x": roi["x"] + left,
            "y": roi["y"] + top,
            "width": right - left,
            "height": bottom - top,
        },
        "crop_bbox": {
            "x": left,
            "y": top,
            "width": right - left,
            "height": bottom - top,
        },
        "label": item.get("label"),
        "text": item.get("text"),
        "confidence": item.get("confidence"),
    }


@router.get("/documents")
async def _get_page_annotations(
    project: dict[str, object],
    document_id: str,
    page_num: int,
    annotation_mode: AnnotationWorkspaceMode = "digital_twin",
) -> dict[str, object]:
    _validate_workbench_page(document_id, page_num)
    annotation_table = _annotation_table(annotation_mode)
    pool = await get_pool()
    async with pool.connection() as conn:
        rows = await conn.execute(
            f"""
            SELECT
                client_annotation_id,
                page_num,
                label,
                annotation_type,
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
            FROM {annotation_table}
            WHERE project_id = %s
              AND document_id = %s
              AND page_num = %s
            ORDER BY created_at ASC, client_annotation_id ASC
            """,
            (uuid.UUID(_project_id(project)), document_id, page_num),
        )
        results = await rows.fetchall()
    symbol_entries = (await _get_workbench_symbol_bank(project, document_id)).get(
        "symbols", []
    )
    return {
        "project_id": _project_id(project),
        "document_id": document_id,
        "page_num": page_num,
        "annotationMode": annotation_mode,
        "annotations": [_annotation_row(row, symbol_entries) for row in results],
    }


async def _get_workbench_class_tracker(
    project: dict[str, object],
    document_id: str,
    annotation_mode: AnnotationWorkspaceMode,
) -> dict[str, object]:
    if document_id != _DEFAULT_DOCUMENT_ID:
        raise HTTPException(status_code=404, detail="workbench document not found")
    annotation_table = _annotation_table(annotation_mode)

    if annotation_mode == "yolo":
        annotations = await _load_yolo_component_annotations(
            project,
            document_id,
            annotation_mode,
        )
        counts: dict[str, int] = {}
        source_counts: dict[str, int] = {}
        for annotation in annotations:
            export_row = _yolov26_export_row_from_annotation(annotation)
            class_name = _yolov26_record_class_name(export_row)
            counts[class_name] = counts.get(class_name, 0) + 1
            source = str(annotation.get("source") or "unknown")
            source_counts[source] = source_counts.get(source, 0) + 1

        classes = [
            {
                "className": class_name,
                "mark": class_name,
                "rootType": "yolo",
                "count": count,
                "source": "yolocolab",
            }
            for class_name, count in sorted(counts.items())
        ]
        return {
            "source": f"{annotation_mode}:{annotation_table}",
            "total": sum(counts.values()),
            "classes": classes,
            "source_counts": source_counts,
        }

    pool = await get_pool()
    async with pool.connection() as conn:
        rows = await conn.execute(
            f"""
            SELECT label, annotation_type, label_bbox, metadata
            FROM {annotation_table}
            WHERE project_id = %s
              AND document_id = %s
            """,
            (uuid.UUID(_project_id(project)), document_id),
        )
        results = await rows.fetchall()

    counts: dict[tuple[str, str], int] = {}

    def increment(class_name: str, root_type: str) -> None:
        key = (class_name, root_type)
        counts[key] = counts.get(key, 0) + 1

    for label, annotation_type, label_bbox, metadata in results:
        root_type = (metadata or {}).get("rootType") or annotation_type or "component"
        if root_type == "component":
            component_class = _dataset_component_class_name(str(label or ""))
            increment(component_class, root_type)
            if label_bbox:
                increment(f"{component_class}_label", root_type)
        else:
            increment(_dataset_root_class_name(str(root_type), str(label or "")), str(root_type))

        attachments = (metadata or {}).get("attachments") or []
        if isinstance(attachments, list):
            for attachment in attachments:
                if not isinstance(attachment, dict):
                    continue
                attachment_type = str(attachment.get("type") or "")
                attachment_text = str(attachment.get("text") or "")
                increment(
                    _dataset_attachment_class_name(
                        attachment_type,
                        attachment_text,
                        str(label or ""),
                    ),
                    attachment_type,
                )

    classes = [
        {
            "className": class_name,
            "mark": class_name,
            "rootType": root_type,
            "count": count,
        }
        for (class_name, root_type), count in sorted(counts.items())
    ]
    return {
        "source": f"{annotation_mode}:{annotation_table}",
        "total": sum(counts.values()),
        "classes": classes,
    }

