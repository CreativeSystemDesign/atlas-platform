"""Custom LangChain tools ? extend the Architect?s toolset.

The Architect (or an operator) adds new `@tool` functions here and appends them to
`CUSTOM_TOOLS`. They are merged into `ATLAS_TOOLS` in `tools.py`.

Rules:
- Use `from langchain.tools import tool` and a **docstring** ? the model uses it to decide when to call the tool.
- Prefer **typed** arguments (`name: str`, `limit: int = 10`).
- Return a **string** (or something that stringifies cleanly) for the dashboard Activity panel.
- Keep tools **synchronous** unless you know the runtime supports async tools.
- This VM is the Architect?s sandbox ? editing here is expected. After changes,
  either restart `atlas-server` **or** use an in-process reload path when the
  server exposes one (`reload_toolkit` / admin reload), so new tools register
  without a full reboot when possible.

Do not put secrets in source; read from `agent_server/.env` via `src.config.settings` if needed.
"""

from __future__ import annotations

import base64
import csv
import json
import os
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import fitz
import httpx
import pdfplumber
import pytesseract
from langchain.tools import tool
from PIL import Image
from qdrant_client import QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchValue

from src.config import settings
from src.extractors.schematic_spine import (
    DEFAULT_SCHEMATIC_RELATIVE_PATH,
    DEFAULT_VECTOR_DB_PATH,
    build_schematic_page_evidence_bundle,
    build_schematic_spine_slice0,
)
from src.persistence.extractions import persist_extracted_dataset as _persist_extracted_dataset
from src.persistence.projects import DEFAULT_PROJECT_ID

# Canonical on-disk library of real machine manuals (not demos).
ATLAS_DOCUMENTS_ROOT = Path(settings.atlas_documents_root)
ATLAS_AGENT_WORKBENCH_ROOT = Path(settings.atlas_agent_workbench_root)
DOCUMENT_TOOL_ARTIFACT_DIR = ATLAS_AGENT_WORKBENCH_ROOT / "document-tools" / "artifacts"
DATA_EXTRACTION_OUTPUT_DIR = (
    ATLAS_AGENT_WORKBENCH_ROOT / "data-extraction-supervisor" / "outputs"
)
PARSER_EXPERIMENT_OUTPUT_DIR = Path(settings.atlas_parser_experiments_root)
SCHEMATIC_SPINE_OUTPUT_DIR = ATLAS_AGENT_WORKBENCH_ROOT / "schematic-spine" / "outputs"
LOCAL_TESSERACT_ROOT = Path(settings.atlas_root) / ".atlas" / "tool-runtimes" / "tesseract"
ELECTRICAL_PARTS_FIELDNAMES = [
    "Table Title",
    "Customer",
    "Location",
    "Symbol Text",
    "Description",
    "Part Number",
    "Quantity",
    "Manufacturer",
    "Notes",
    "Number",
    "Drawing Number",
    "Equipment",
    "Order Number",
]
ROW_PRESERVING_ELECTRICAL_PARTS_FIELDNAMES = [
    *ELECTRICAL_PARTS_FIELDNAMES,
    "Row Type",
    "Parent Symbol Text",
    "Parent Description",
    "Parent Part Number",
    "Parent Number",
    "Source Page",
]
CABLE_LIST_FIELDNAMES = [
    "Order Number",
    "Drawing Number",
    "Equipment",
    "Customer",
    "Cable Number",
    "Originating Point",
    "Termination Point",
    "Cable Type",
    "Cable Color",
    "Wire1",
    "Wire2",
    "Wire3",
    "Wire4",
    "Wire5",
    "Wire6",
    "Wire7",
    "Wire8",
    "Wire9",
    "Wire10",
    "Conduit Size",
    "Conduit Qty",
    "Remarks",
    "Notes",
    "Source Page",
]

CABLE_WIRE_LINK_FIELDNAMES = [
    "Source Page",
    "Cable Number",
    "Originating Point",
    "Termination Point",
    "Wire Label",
    "Is Continuation Row",
]


def _prepend_env_path(name: str, path: Path) -> None:
    current = os.environ.get(name, "")
    path_text = str(path)
    parts = [part for part in current.split(os.pathsep) if part]
    if path_text not in parts:
        os.environ[name] = os.pathsep.join([path_text, *parts])


def _configure_tesseract_runtime() -> None:
    tesseract_bin = LOCAL_TESSERACT_ROOT / "usr" / "bin" / "tesseract"
    if not tesseract_bin.exists():
        return

    tesseract_lib = LOCAL_TESSERACT_ROOT / "usr" / "lib" / "x86_64-linux-gnu"
    tessdata = LOCAL_TESSERACT_ROOT / "usr" / "share" / "tesseract-ocr" / "5" / "tessdata"
    pytesseract.pytesseract.tesseract_cmd = str(tesseract_bin)
    _prepend_env_path("PATH", tesseract_bin.parent)
    if tesseract_lib.exists():
        _prepend_env_path("LD_LIBRARY_PATH", tesseract_lib)
    if tessdata.exists():
        os.environ.setdefault("TESSDATA_PREFIX", str(tessdata))


_configure_tesseract_runtime()


def _normalize_library_relative_path(path: str) -> Path:
    normalized = path.strip().replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    if normalized == "documents":
        return Path()
    if normalized.startswith("documents/"):
        normalized = normalized[len("documents/"):]
    return Path(normalized).expanduser()


def _resolve_document_library_path(path: str) -> Path:
    candidate = _normalize_library_relative_path(path)
    if not candidate.is_absolute():
        candidate = ATLAS_DOCUMENTS_ROOT / candidate
    candidate = candidate.resolve()
    return candidate


def _resolve_document_path(path: str) -> Path:
    candidate = _resolve_document_library_path(path)
    if not candidate.exists():
        raise ValueError(f"Document path does not exist: {candidate}")
    if candidate.suffix.lower() != ".pdf":
        raise ValueError(f"Expected a PDF path, got: {candidate}")
    return candidate


def _safe_stem(text: str) -> str:
    stem = re.sub(r"[^a-zA-Z0-9._-]+", "-", text).strip("-")
    return stem[:80] or "artifact"


def _timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _page_span(total_pages: int, page_from: int = 1, page_to: int = 0, max_pages: int = 6) -> range:
    start = max(1, page_from)
    end = total_pages if page_to <= 0 else min(total_pages, page_to)
    if end < start:
        end = start
    if max_pages > 0:
        end = min(end, start + max_pages - 1)
    return range(start, end + 1)


def _parse_bbox_json(bbox_json: str) -> tuple[float, float, float, float] | None:
    raw = bbox_json.strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"bbox_json must be valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError("bbox_json must decode to an object with x0, y0, x1, y1")
    try:
        x0 = float(parsed["x0"])
        y0 = float(parsed["y0"])
        x1 = float(parsed["x1"])
        y1 = float(parsed["y1"])
    except KeyError as exc:
        raise ValueError(f"bbox_json is missing required key: {exc}") from exc
    return (x0, y0, x1, y1)


def _pdf_page_count(pdf_path: Path) -> int:
    with pdfplumber.open(pdf_path) as pdf:
        return len(pdf.pages)


def _relative_document_path_or_none(path: Path) -> str | None:
    try:
        return str(path.resolve().relative_to(ATLAS_DOCUMENTS_ROOT.resolve()))
    except ValueError:
        return None


def _default_extraction_output_path(
    pdf_path: Path,
    *,
    suffix: str,
    output_dir: Path | None = None,
) -> Path:
    relative_parent = _relative_document_path_or_none(pdf_path.parent)
    target_dir = output_dir or DATA_EXTRACTION_OUTPUT_DIR
    if relative_parent:
        target_dir = target_dir / relative_parent
    target_dir.mkdir(parents=True, exist_ok=True)
    return (target_dir / f"{pdf_path.stem}{suffix}").resolve()


def _parser_output_root(output_scope: str) -> Path:
    scope = output_scope.strip().lower() or "agent"
    if scope == "agent":
        return DATA_EXTRACTION_OUTPUT_DIR
    if scope == "experiment":
        return PARSER_EXPERIMENT_OUTPUT_DIR
    raise ValueError("output_scope must be 'agent' or 'experiment'")


def _relative_to_or_none(path: Path, root: Path) -> Path | None:
    try:
        return path.resolve().relative_to(root.resolve())
    except ValueError:
        return None


def _ensure_extraction_output_root(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    if _relative_to_or_none(resolved, root) is None:
        raise ValueError(
            "Extraction output path must be under the configured output root "
            f"{root.resolve()}; got {resolved}. Omit output_path to use the standard "
            "location automatically."
        )
    return resolved


def _normalize_extraction_output_path(
    raw_path: str,
    *,
    pdf_path: Path,
    suffix: str,
    output_dir: Path | None = None,
) -> Path:
    target_output_dir = output_dir or DATA_EXTRACTION_OUTPUT_DIR
    candidate_raw = raw_path.strip()
    if not candidate_raw:
        return _default_extraction_output_path(
            pdf_path,
            suffix=suffix,
            output_dir=target_output_dir,
        )

    candidate = Path(candidate_raw).expanduser()
    if candidate.is_absolute():
        relative = _relative_to_or_none(candidate, ATLAS_DOCUMENTS_ROOT)
        if relative is None:
            return _ensure_extraction_output_root(candidate, target_output_dir)
        return (target_output_dir / relative).resolve()

    relative = _normalize_library_relative_path(candidate_raw)
    return (target_output_dir / relative).resolve()


def _resolve_any_path(path: str) -> Path:
    candidate = Path(path).expanduser()
    if not candidate.is_absolute():
        candidate = (Path.cwd() / candidate).resolve()
    else:
        candidate = candidate.resolve()
    if not candidate.exists():
        raise ValueError(f"Path does not exist: {candidate}")
    return candidate


def _render_pdf_region(
    pdf_path: Path,
    page_number: int,
    *,
    bbox: tuple[float, float, float, float] | None = None,
    dpi: int = 200,
) -> tuple[bytes, str]:
    doc = fitz.open(pdf_path)
    try:
        page_index = page_number - 1
        if page_index < 0 or page_index >= doc.page_count:
            raise ValueError(f"Page {page_number} is out of range for {pdf_path.name}")
        page = doc.load_page(page_index)
        rect = fitz.Rect(bbox) if bbox else page.rect
        matrix = fitz.Matrix(dpi / 72.0, dpi / 72.0)
        pix = page.get_pixmap(matrix=matrix, clip=rect, alpha=False)
        png_bytes = pix.tobytes("png")
    finally:
        doc.close()

    DOCUMENT_TOOL_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    suffix = f"page-{page_number}"
    if bbox:
        suffix += "-region"
    output_path = DOCUMENT_TOOL_ARTIFACT_DIR / f"{_safe_stem(pdf_path.stem)}-{suffix}.png"
    output_path.write_bytes(png_bytes)
    return png_bytes, str(output_path)


def _openrouter_chat_completion(
    messages: list[dict], *, model_id: str | None = None, max_tokens: int = 900
) -> str:
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured in agent_server/.env")

    response = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.openrouter_api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model_id or settings.architect_model,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": max_tokens,
        },
        timeout=120.0,
    )
    response.raise_for_status()
    payload = response.json()
    content = payload["choices"][0]["message"].get("content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
        return "\n".join(part for part in parts if part).strip()
    return str(content).strip()


def _moonshot_model_id(model_id: str | None = None) -> str:
    chosen = model_id or settings.architect_model
    return chosen.split('/', 1)[1] if '/' in chosen else chosen


def _should_use_moonshot_direct(model_id: str | None = None) -> bool:
    chosen = model_id or settings.architect_model
    return bool(settings.moonshot_api_key) and (chosen.startswith('moonshotai/') or chosen.startswith('kimi-'))


def _moonshot_chat_completion(
    messages: list[dict], *, model_id: str | None = None, max_tokens: int = 900
) -> str:
    if not settings.moonshot_api_key:
        raise ValueError('MOONSHOT_API_KEY is not configured in agent_server/.env')

    response = httpx.post(
        'https://api.moonshot.ai/v1/chat/completions',
        headers={
            'Authorization': f'Bearer {settings.moonshot_api_key}',
            'Content-Type': 'application/json',
        },
        json={
            'model': _moonshot_model_id(model_id),
            'messages': messages,
            'thinking': {'type': 'disabled'},
            'max_tokens': max_tokens,
        },
        timeout=180.0,
    )
    response.raise_for_status()
    payload = response.json()
    content = payload['choices'][0]['message'].get('content', '')
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get('type') == 'text':
                parts.append(str(item.get('text', '')))
        return '\n'.join(part for part in parts if part).strip()
    return str(content).strip()


def _vision_assist_provider() -> str:
    provider = _normalize_cable_text(settings.vision_assist_provider).lower()
    return provider or "moonshot"


def _vision_assist_model_id(model_id: str | None = None) -> str:
    chosen = model_id or settings.vision_assist_model or settings.architect_model
    provider = _vision_assist_provider()
    if provider == "moonshot" and "/" in chosen:
        return chosen.split("/", 1)[1]
    return chosen


def _vision_assist_base_url(provider: str) -> str:
    configured = settings.vision_assist_base_url.strip().rstrip("/")
    if configured:
        return configured
    if provider == "moonshot":
        return "https://api.moonshot.ai/v1"
    if provider == "openrouter":
        return "https://openrouter.ai/api/v1"
    raise ValueError(f"Unsupported VISION_ASSIST_PROVIDER: {provider}")


def _vision_assist_extract_text(payload: dict) -> str:
    content = payload["choices"][0]["message"].get("content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
        return "\n".join(part for part in parts if part).strip()
    return str(content).strip()


def _strip_markdown_fences(raw: str) -> str:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def _parse_json_object_response(raw: str, *, context_label: str) -> dict[str, object]:
    cleaned = _strip_markdown_fences(raw)
    if not cleaned or cleaned == "None":
        raise ValueError(f"{context_label}: vision assist returned an empty response.")
    candidates = [cleaned]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidates.append(cleaned[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise ValueError(
        f"{context_label}: vision assist returned non-JSON output. Raw response: {cleaned[:1200]}"
    )


def _vision_assist_chat_completion(
    messages: list[dict], *, model_id: str | None = None, max_tokens: int = 900
) -> str:
    provider = _vision_assist_provider()
    api_key = settings.vision_assist_api_key.strip()
    if not api_key:
        raise ValueError("VISION_ASSIST_API_KEY is not configured in agent_server/.env")

    endpoint = _vision_assist_base_url(provider) + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://agent.atlas-platform.cloud"
        headers["X-Title"] = "Atlas Platform"

    payload = {
        "model": _vision_assist_model_id(model_id),
        "messages": messages,
        "max_tokens": max_tokens,
    }
    if provider == "moonshot":
        payload["thinking"] = {"type": "disabled"}
    elif provider == "openrouter":
        payload["temperature"] = 0.1
    else:
        raise ValueError(f"Unsupported VISION_ASSIST_PROVIDER: {provider}")

    timeout = max(5.0, float(settings.vision_assist_timeout_seconds))
    max_retries = max(0, int(settings.vision_assist_max_retries))
    last_error: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            response = httpx.post(
                endpoint,
                headers=headers,
                json=payload,
                timeout=timeout,
            )
            if response.is_error:
                body = response.text.strip()
                raise ValueError(
                    f"Vision assist provider error ({response.status_code}) at {endpoint}: {body}"
                )
            return _vision_assist_extract_text(response.json())
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            last_error = exc
            if attempt >= max_retries:
                raise
    if last_error is not None:
        raise last_error
    raise RuntimeError("Vision assist request failed without an error payload")


def _multimodal_chat_completion(
    messages: list[dict], *, model_id: str | None = None, max_tokens: int = 900
) -> str:
    if settings.vision_assist_enabled:
        return _vision_assist_chat_completion(messages, model_id=model_id, max_tokens=max_tokens)
    if _should_use_moonshot_direct(model_id):
        return _moonshot_chat_completion(messages, model_id=model_id, max_tokens=max_tokens)
    return _openrouter_chat_completion(messages, model_id=model_id, max_tokens=max_tokens)


def _analyze_pdf_visual_region_payload(
    pdf_path: Path,
    page_number: int,
    prompt: str,
    *,
    bbox: tuple[float, float, float, float] | None = None,
    dpi: int = 0,
    max_tokens: int = 900,
) -> tuple[dict[str, object], str]:
    render_dpi = dpi if dpi > 0 else int(settings.vision_assist_image_dpi)
    png_bytes, artifact_path = _render_pdf_region(pdf_path, page_number, bbox=bbox, dpi=render_dpi)
    data_url = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
    raw = _multimodal_chat_completion(
        [
            {
                "role": "system",
                "content": (
                    "You are a grounded industrial-document visual analysis assistant. "
                    "Return strict JSON only with no markdown fences. "
                    "Only describe what is visible in the supplied PDF image. "
                    "When uncertain, say so explicitly in the JSON."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt.strip()},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
        model_id=settings.vision_assist_model,
        max_tokens=max_tokens,
    )
    parsed = _parse_json_object_response(
        raw,
        context_label=f"PDF page {page_number} visual analysis",
    )
    return parsed, artifact_path


def _embed_query(text: str) -> list[float]:
    if not settings.nvidia_api_key:
        raise ValueError("NVIDIA_API_KEY is not configured in agent_server/.env")

    payload = {
        "input": [text],
        "model": settings.langchain_docs_embed_model,
        "input_type": "query",
        "truncate": "END",
        "encoding_format": "float",
    }
    response = httpx.post(
        "https://integrate.api.nvidia.com/v1/embeddings",
        headers={
            "Authorization": f"Bearer {settings.nvidia_api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=60.0,
    )
    response.raise_for_status()
    data = response.json()
    return list(data["data"][0]["embedding"])


def _normalize_inline_text(value: object) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r", "\n").replace("\u3000", " ")
    text = text.replace("•", "●")
    text = re.sub(r"\s+", " ", text.replace("\n", " ")).strip()
    return text


def _split_lines(value: object) -> list[str]:
    if value is None:
        return []
    raw = str(value).replace("\r", "\n").replace("\u3000", " ")
    return [re.sub(r"\s+", " ", line).strip() for line in raw.split("\n") if line.strip()]


def _englishish_lines(value: object) -> list[str]:
    lines = _split_lines(value)
    output: list[str] = []
    for line in lines:
        if re.search(r"[A-Za-z]", line):
            output.append(line)
    return output


def _clean_location(value: str) -> str:
    english_lines = _englishish_lines(value)
    cleaned = english_lines[0] if english_lines else _normalize_inline_text(value)
    cleaned = re.sub(r"^\d+\.", "", cleaned).strip()
    cleaned = cleaned.replace("\uFF08", "(").replace("\uFF09", ")")
    cleaned = re.sub(r"([A-Za-z])\(", r"\1 (", cleaned)
    return f" {cleaned}" if cleaned else ""


def _clean_manufacturer(value: str) -> str:
    lines = _englishish_lines(value)
    if not lines:
        cleaned = _normalize_inline_text(value)
    else:
        cleaned = " ".join(lines)
        cleaned = re.sub(r"[^\x00-\x7F]+", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

    manufacturer_overrides = {
        "山洋電気": "SANYO ELECTRIC",
        "三木 ﾌﾟｰﾘｰ": "MIKI PULLEY",
    }
    if cleaned in manufacturer_overrides:
        return manufacturer_overrides[cleaned]

    if not lines:
        return cleaned
    cleaned = cleaned.replace("Allen- Bradley", "Allen-Bradley")
    cleaned = cleaned.replace("Allen -Bradley", "Allen-Bradley")
    return cleaned.strip()


def _clean_notes(value: str) -> str:
    english_lines = _englishish_lines(value)
    cleaned = " ".join(english_lines).strip() if english_lines else _normalize_inline_text(value)
    if not cleaned:
        return ""
    if ("備考欄" in cleaned or "宇部支給品" in cleaned or "意味する" in cleaned) and not re.search(
        r"(UL|kA|KA|RU|NEMA|HS-|H-)",
        cleaned,
    ):
        return ""
    if "300kA" in cleaned and ("備考欄" in cleaned or "意味する" in cleaned or "●" in cleaned):
        return "UL 300kA. ● mark in the remarks column means Ube-supplied item."
    cleaned = cleaned.replace("UL489 50KA", "UL489 50kA")
    cleaned = cleaned.replace("UL489 14KA", "UL489 14kA")
    return cleaned


def _split_symbols(value: str) -> list[str]:
    groups = _split_symbol_groups(value)
    return [symbol for group in groups for symbol in group]


def _expand_symbol_span(start: str, end: str) -> list[str] | None:
    start = _normalize_inline_text(start).lstrip("-").rstrip("-")
    end = _normalize_inline_text(end).lstrip("-").rstrip("-")
    if not start or not end:
        return None

    prefix_length = 0
    max_prefix = min(len(start), len(end))
    while prefix_length < max_prefix and start[prefix_length] == end[prefix_length]:
        prefix_length += 1

    prefix = start[:prefix_length]
    start_tail = start[prefix_length:]
    end_tail = end[prefix_length:]
    if not prefix or not start_tail or not end_tail:
        return None

    if start_tail.isdigit() and end_tail.isdigit():
        start_num = int(start_tail)
        end_num = int(end_tail)
        if end_num < start_num:
            return None
        width = max(len(start_tail), len(end_tail))
        return [f"{prefix}{number:0{width}d}" for number in range(start_num, end_num + 1)]

    alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if len(start_tail) == 1 and len(end_tail) == 1 and start_tail in alphabet and end_tail in alphabet:
        start_index = alphabet.index(start_tail)
        end_index = alphabet.index(end_tail)
        if end_index < start_index:
            return None
        return [f"{prefix}{alphabet[index]}" for index in range(start_index, end_index + 1)]

    return None


def _trailing_symbols_for_followup_description(
    page_words: list[dict[str, object]],
    explicit_symbols: list[str],
    followup_description: str,
) -> list[str]:
    if not page_words or not explicit_symbols or not followup_description:
        return []
    first_token = _normalize_inline_text(followup_description).split(" ")[0]
    if not first_token:
        return []
    description_words = [
        word for word in page_words if _normalize_inline_text(str(word.get("text", ""))) == first_token
    ]
    if not description_words:
        return []
    symbol_words = []
    for symbol in explicit_symbols:
        matches = [
            word for word in page_words if _normalize_inline_text(str(word.get("text", ""))) == symbol
        ]
        if matches:
            symbol_words.append((symbol, float(matches[0].get("top", 0.0))))
    if len(symbol_words) != len(explicit_symbols):
        return []
    symbol_words.sort(key=lambda item: item[1])
    for desc_word in sorted(description_words, key=lambda word: float(word.get("top", 0.0))):
        desc_top = float(desc_word.get("top", 0.0))
        trailing = [symbol for symbol, top in symbol_words if top >= desc_top - 1.0]
        if 0 < len(trailing) < len(explicit_symbols):
            return trailing
    return []


def _split_symbol_groups(value: str) -> list[list[str]]:
    lines = [_normalize_inline_text(line) for line in str(value).replace("\r", "\n").split("\n")]
    groups: list[list[str]] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line:
            index += 1
            continue
        compact = re.sub(r"\s+", " ", line).strip()
        if compact.startswith("(") and compact.endswith(")"):
            if groups and groups[-1]:
                groups[-1][-1] = f"{groups[-1][-1]} {compact}".strip()
            index += 1
            continue
        if compact.endswith("-") and index + 1 < len(lines):
            next_line = re.sub(r"\s+", " ", lines[index + 1]).strip()
            if next_line.startswith("-"):
                expanded = _expand_symbol_span(compact[:-1], next_line[1:])
                if expanded:
                    groups.append(expanded)
                    index += 2
                    continue
        if compact.endswith("~") and index + 1 < len(lines):
            next_line = re.sub(r"\s+", " ", lines[index + 1]).strip()
            combined = compact + next_line
            range_match = re.fullmatch(r"([A-Z-]*?)(\d+)~(?:[A-Z-]*?)(\d+)", combined)
            if range_match:
                prefix, start_text, end_text = range_match.groups()
                start_num = int(start_text)
                end_num = int(end_text)
                width = max(len(start_text), len(end_text))
                groups.append([f"{prefix}{number:0{width}d}" for number in range(start_num, end_num + 1)])
                index += 2
                continue
        shorthand = re.fullmatch(r"([A-Z]+)\s*(\d+[A-Z]?)\s*,\s*(\d+[A-Z]?)", compact)
        if shorthand:
            prefix, left, right = shorthand.groups()
            groups.append([f"{prefix}{left}", f"{prefix}{right}"])
            index += 1
            continue
        range_match = re.fullmatch(r"([A-Z-]*?)(\d+)~(\d+)", compact)
        if range_match:
            prefix, start_text, end_text = range_match.groups()
            start_num = int(start_text)
            end_num = int(end_text)
            width = max(len(start_text), len(end_text))
            groups.append([f"{prefix}{number:0{width}d}" for number in range(start_num, end_num + 1)])
            index += 1
            continue
        comma_range_match = re.fullmatch(r"([A-Z-]*?)(\d+),\s*(\d+)", compact)
        if comma_range_match:
            prefix, left, right = comma_range_match.groups()
            groups.append([f"{prefix}{left}", f"{prefix}{right}"])
            index += 1
            continue
        spaced = re.fullmatch(r"([A-Z]+)\s+(\d+[A-Z]?)", compact)
        if spaced:
            prefix, suffix = spaced.groups()
            groups.append([f"{prefix}{suffix}"])
            index += 1
            continue
        groups.append([compact])
        index += 1
    return groups


def _looks_like_blank_separator(number: str, symbol: str, designation: str, spec: str, qty: str, maker: str, notes: str) -> bool:
    return bool(number) and not any([symbol, designation, spec, qty, maker, notes])


def _looks_like_number_only_placeholder(
    number: str,
    symbol: str,
    designation: str,
    spec: str,
    qty: str,
    maker: str,
    notes: str,
) -> bool:
    return bool(number) and bool(qty) and not any([symbol, designation, spec, maker, notes])


def _looks_like_symbol_only_placeholder(
    number: str,
    symbol: str,
    designation: str,
    spec: str,
    qty: str,
    maker: str,
    notes: str,
) -> bool:
    return bool(number) and bool(symbol) and bool(qty) and not any([designation, spec, maker, notes])


def _qty_as_int(value: str) -> int | None:
    cleaned = value.strip()
    if not cleaned or not re.fullmatch(r"\d+", cleaned):
        return None
    return int(cleaned)


def _normalize_quantity(value: str) -> str:
    return _normalize_inline_text(value)


def _quantity_lines(value: str) -> list[str]:
    return [
        _normalize_inline_text(line)
        for line in str(value).replace("\r", "\n").split("\n")
        if _normalize_inline_text(line)
    ]


def _symbol_family(symbol: str) -> str:
    match = re.match(r"([A-Z]+)", symbol.strip())
    return match.group(1) if match else ""


def _group_symbols_by_family(symbols: list[str]) -> list[list[str]]:
    ordered_families: list[str] = []
    grouped: dict[str, list[str]] = {}
    for symbol in symbols:
        family = _symbol_family(symbol)
        key = family or symbol
        if key not in grouped:
            grouped[key] = []
            ordered_families.append(key)
        grouped[key].append(symbol)
    return [grouped[key] for key in ordered_families]


def _clean_designation_text(value: str) -> str:
    cleaned = _normalize_inline_text(value)
    if not cleaned:
        return ""
    if re.search(r"[A-Za-z]", cleaned) and re.search(r"[\u3040-\u30ff\uff66-\uff9f\u4e00-\u9fff]", cleaned):
        match = re.search(r"[\u3040-\u30ff\uff66-\uff9f\u4e00-\u9fff]", cleaned)
        if match:
            cleaned = cleaned[: match.start()].strip()
            tokens = cleaned.split()
            if len(tokens) > 1:
                first_token = tokens[0]
                last_token = tokens[-1]
                candidate = " ".join(tokens[:-1]).strip()
                if last_token == first_token or candidate.endswith(last_token):
                    cleaned = candidate
    tokens = cleaned.split()
    if len(tokens) > 1:
        first_token = tokens[0]
        last_token = tokens[-1]
        candidate = " ".join(tokens[:-1]).strip()
        if last_token == first_token or candidate.endswith(last_token):
            cleaned = candidate
    return cleaned.strip()


def _derive_description_and_part_number(designation: str, spec: str) -> tuple[str, str]:
    designation_lines = [_clean_designation_text(line) for line in _englishish_lines(designation)]
    designation_lines = [line for line in designation_lines if line]
    collapsed_designation_lines: list[str] = []
    for line in designation_lines:
        if collapsed_designation_lines and len(line.split()) == 1:
            previous = collapsed_designation_lines[-1]
            if previous.endswith(f" {line}") or previous.split()[0] == line:
                continue
        collapsed_designation_lines.append(line)
    designation_lines = collapsed_designation_lines
    spec_lines = _englishish_lines(spec)

    description = " ".join(designation_lines).strip() or _normalize_inline_text(designation)
    part_number = " ".join(spec_lines).strip() or _normalize_inline_text(spec)

    translation_overrides = {
        "分岐端子": "Branch terminal",
        "ﾌﾞﾚｰｷﾓｼﾞｭｰﾙ": "BRAKE MODULE",
        "信号変換器": "SIGNAL CONVERTER",
        "ｴﾝｺｰﾀﾞ変換器": "ENCODER CONVERTER",
        "ﾎﾞｯｸｽ": "BOX",
    }
    if description in translation_overrides:
        description = translation_overrides[description]

    description = (
        description.replace("CONECTION", "CONNECTION")
        .replace("REACTL", "REACTOR")
        .replace("CONPACKT", "COMPACT")
        .replace("CONTOROL", "CONTROL")
    )
    if description == "BREAK":
        description = "BRAKE"

    if description in {
        "CIRCUIT PROTECTOR",
        "MAGNETIC SWITCH",
        "MANUAL MOTOR STARTER",
        "PUSH BUTTON SWITCH",
        "ILLUMINATED PUSH BUTTON SWITCH",
        "PILOT LAMP",
    } and len(spec_lines) > 1:
        part_number = spec_lines[0].strip()
        description = f"{description} {' '.join(spec_lines[1:]).strip()}".strip()

    return description, part_number


def _extract_item_text_block(page_text: str, item_number: str) -> list[str]:
    if not page_text or not item_number:
        return []
    lines = page_text.splitlines()
    capture = False
    block: list[str] = []
    for line in lines:
        normalized = _normalize_inline_text(line)
        if normalized.startswith(f"{item_number} "):
            capture = True
        elif capture and re.match(r"^\d+\s", normalized):
            break
        if capture:
            block.append(normalized)
    return block


def _extract_counted_variant_specs(spec_lines: list[str]) -> list[tuple[str, int]]:
    variants: list[tuple[str, int]] = []
    for line in spec_lines:
        normalized = _normalize_inline_text(line)
        match = re.search(r"\((\d+)\s*PCS\)", normalized, re.IGNORECASE)
        if not match:
            continue
        count = int(match.group(1))
        cleaned = re.sub(r"\(\d+\s*PCS\)", "", normalized, flags=re.IGNORECASE).strip()
        if cleaned:
            variants.append((cleaned, count))
    return variants


def _extract_inline_symbol_accessories(item_lines: list[str], explicit_symbols: list[str]) -> dict[str, list[str]]:
    if not item_lines or not explicit_symbols:
        return {}
    accessory_labels = [
        'SOCKET',
        'FINGER PROTECTOR',
        'COVER',
        'SURGE ABS. UNIT',
        'DIN RAIL ADAPTER',
        'DIN Rail Adapter',
    ]
    mapping: dict[str, list[str]] = {}
    symbol_set = set(explicit_symbols)
    index = 1
    while index < len(item_lines):
        line = item_lines[index]
        matched_label = ''
        matched_symbol = ''
        for symbol in explicit_symbols:
            prefix = f"{symbol} "
            if not line.startswith(prefix):
                continue
            remainder = line[len(prefix):].strip()
            upper_remainder = remainder.upper()
            for label in accessory_labels:
                if upper_remainder.startswith(label.upper()):
                    matched_label = label
                    matched_symbol = symbol
                    break
            if matched_label:
                break
        if not matched_label:
            index += 1
            continue
        symbols_for_label = mapping.setdefault(matched_label, [])
        symbols_for_label.append(matched_symbol)
        follow_index = index + 1
        while follow_index < len(item_lines):
            follow_line = _normalize_inline_text(item_lines[follow_index])
            if follow_line in symbol_set:
                symbols_for_label.append(follow_line)
                follow_index += 1
                continue
            break
        index = follow_index
    return mapping





def _extract_leading_item_symbols(item_lines: list[str], explicit_symbols: list[str]) -> list[str]:
    if not item_lines or not explicit_symbols:
        return []

    accessory_labels = {'SOCKET', 'FINGER', 'COVER', 'SURGE', 'DIN'}
    explicit_set = set(explicit_symbols)
    leading: list[str] = []

    for index, line in enumerate(item_lines):
        normalized = _normalize_inline_text(line)
        tokens = normalized.split()
        if not tokens:
            continue
        if index == 0 and tokens[0].isdigit():
            tokens = tokens[1:]
        if not tokens:
            continue
        candidate = tokens[0]
        if candidate not in explicit_set:
            break
        if len(tokens) > 1 and tokens[1].upper() in accessory_labels:
            break
        leading.append(candidate)

    return leading


def _flatten_symbol_mapping_values(mapping: dict[str, list[str]]) -> list[str]:
    flattened: list[str] = []
    for symbols in mapping.values():
        for symbol in symbols:
            if symbol not in flattened:
                flattened.append(symbol)
    return flattened

def _looks_like_variant_spec(line: str) -> bool:
    compact = _normalize_inline_text(line).replace(" ", "")
    return compact.startswith("AC") or compact.startswith("DC")


def _write_csv_rows(path: Path, rows: list[dict[str, str]], fieldnames: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames or ELECTRICAL_PARTS_FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)


def _write_json_rows(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")


def _base_table_metadata() -> dict[str, str]:
    return {
        "table_title": "",
        "customer": "",
        "drawing_number": "",
        "equipment": "",
        "order_number": "",
        "location": "",
    }


def _collapse_electrical_parts_to_row_preserving(
    provenance_rows: list[dict[str, object]],
) -> list[dict[str, str]]:
    grouped: dict[
        tuple[object, object, object, object, object, object, object],
        dict[str, object],
    ] = {}
    ordered_keys: list[
        tuple[object, object, object, object, object, object, object]
    ] = []

    for index, row in enumerate(provenance_rows):
        key = (
            row.get("source_page"),
            row.get("Number", ""),
            row.get("Location", ""),
            row.get("Description", ""),
            row.get("Part Number", ""),
            row.get("Manufacturer", ""),
            row.get("Notes", ""),
        )
        bucket = grouped.get(key)
        if bucket is None:
            bucket = {"first_index": index, "rows": []}
            grouped[key] = bucket
            ordered_keys.append(key)
        bucket["rows"].append(row)

    def _symbol_join(values: list[str]) -> str:
        cleaned: list[str] = []
        for value in values:
            normalized = _normalize_inline_text(value)
            if normalized and normalized not in cleaned:
                cleaned.append(normalized)
        return ", ".join(cleaned)

    def _derive_collapsed_quantity(rows: list[dict[str, object]]) -> str:
        source_quantities = []
        for row in rows:
            value = _normalize_quantity(str(row.get("source_row_quantity", "")))
            if value and value not in source_quantities:
                source_quantities.append(value)
        if len(source_quantities) == 1:
            return source_quantities[0]
        if len(source_quantities) > 1:
            return source_quantities[0]

        quantities = [_normalize_quantity(str(row.get("Quantity", ""))) for row in rows]
        nonblank = [value for value in quantities if value]
        if not nonblank:
            return ""
        ints: list[int] = []
        for value in nonblank:
            parsed = _qty_as_int(value)
            if not parsed:
                return nonblank[0]
            ints.append(parsed)
        if not ints:
            return nonblank[0]
        return str(sum(ints))

    collapsed_rows: list[dict[str, str]] = []
    parent_context_by_scope: dict[tuple[str, str, str], dict[str, str]] = {}

    for key in ordered_keys:
        rows = grouped[key]["rows"]
        sample = rows[0]
        source_page = str(sample.get("source_page", "") or "")
        number = str(sample.get("Number", "") or "")
        location = str(sample.get("Location", "") or "")
        scope = (source_page, number, location)
        symbol_values = [str(row.get("Symbol Text", "") or "") for row in rows]
        joined_symbols = _symbol_join(symbol_values)
        all_symbol_inherited = all(
            "Symbol Text" in list(row.get("inherited_fields", []) or []) for row in rows
        )

        parent_context = parent_context_by_scope.get(scope, {})
        parent_symbols = _symbol_join([str(parent_context.get("Symbol Text", "") or "")])

        if joined_symbols:
            if all_symbol_inherited and parent_symbols and joined_symbols == parent_symbols:
                row_type = "attached_row"
            else:
                row_type = "symbol_row"
        else:
            row_type = "standalone_nonsymbol_row"

        if row_type != "attached_row":
            parent_context = {}

        collapsed_record = {
            "Table Title": str(sample.get("Table Title", "") or ""),
            "Customer": str(sample.get("Customer", "") or ""),
            "Location": location,
            "Symbol Text": "" if row_type == "attached_row" else joined_symbols,
            "Description": str(sample.get("Description", "") or ""),
            "Part Number": str(sample.get("Part Number", "") or ""),
            "Quantity": _derive_collapsed_quantity(rows),
            "Manufacturer": str(sample.get("Manufacturer", "") or ""),
            "Notes": str(sample.get("Notes", "") or ""),
            "Number": number,
            "Drawing Number": str(sample.get("Drawing Number", "") or ""),
            "Equipment": str(sample.get("Equipment", "") or ""),
            "Order Number": str(sample.get("Order Number", "") or ""),
            "Row Type": row_type,
            "Parent Symbol Text": str(parent_context.get("Symbol Text", "") or ""),
            "Parent Description": str(parent_context.get("Description", "") or ""),
            "Parent Part Number": str(parent_context.get("Part Number", "") or ""),
            "Parent Number": str(parent_context.get("Number", "") or ""),
            "Source Page": source_page,
        }
        collapsed_rows.append(collapsed_record)

        if row_type == "symbol_row":
            parent_context_by_scope[scope] = collapsed_record

    return collapsed_rows


def _parse_electrical_parts_rows(pdf_path: Path, page_from: int, page_to: int, max_pages: int) -> tuple[list[dict[str, str]], list[dict[str, object]], list[str]]:
    canonical_rows: list[dict[str, str]] = []
    provenance_rows: list[dict[str, object]] = []
    warnings: list[str] = []

    with pdfplumber.open(pdf_path) as pdf:
        current_metadata = _base_table_metadata()
        current_context: dict[str, object] = {}

        for page_number in _page_span(len(pdf.pages), page_from, page_to, max_pages):
            page = pdf.pages[page_number - 1]
            page_words = page.extract_words(use_text_flow=True, keep_blank_chars=False) or []
            page_text = page.extract_text() or ""
            table = page.extract_table()
            if not table:
                warnings.append(f"Page {page_number}: no table extracted.")
                continue

            in_data_section = False
            for row_index, raw_row in enumerate(table):
                row = ["" if cell is None else str(cell) for cell in raw_row]
                while row and not row[-1].strip():
                    row.pop()
                if not row:
                    continue

                padded = row + [""] * max(0, 8 - len(row))
                c0, c1, c2, c3, c4, c5, c6, c7 = padded[:8]
                n0 = _normalize_inline_text(c0)
                n1 = _normalize_inline_text(c1)
                n2 = _normalize_inline_text(c2)
                n3 = _normalize_inline_text(c3)
                n4 = _normalize_inline_text(c4)
                n5 = _normalize_inline_text(c5)
                n6 = _normalize_inline_text(c6)
                n7 = _normalize_inline_text(c7)

                if "DWG.No." in c0:
                    title_lines = _englishish_lines(c0)
                    if title_lines:
                        current_metadata["table_title"] = title_lines[0]
                    match = re.search(r"DWG\.No\.\s*([A-Za-z0-9:.-]+)", c0)
                    if match:
                        current_metadata["drawing_number"] = match.group(1).strip()
                    if "CUSTOMER" in n5 and n6:
                        current_metadata["customer"] = _normalize_inline_text(c6)
                    continue
                if "EQUIPMENT" in n5 and n6:
                    current_metadata["equipment"] = _normalize_inline_text(c6)
                    continue
                if "LOCATION" in n0 and n2:
                    current_metadata["location"] = _clean_location(c2)
                    current_metadata["order_number"] = _normalize_inline_text(c6)
                    continue
                if n0 == "No." and "SYMBOL" in n1:
                    in_data_section = True
                    continue
                if not in_data_section:
                    continue
                if not any([n0, n1, n2, n3, n4, n5, n6, n7]):
                    continue
                if _looks_like_blank_separator(n0, n1, n2, n3, n4, n5, n6 + (" " + n7 if n7 else "")):
                    continue
                if _looks_like_number_only_placeholder(
                    n0, n1, n2, n3, n4, n5, n6 + (" " + n7 if n7 else "")
                ):
                    continue
                if _looks_like_symbol_only_placeholder(
                    n0, n1, n2, n3, n4, n5, n6 + (" " + n7 if n7 else "")
                ):
                    continue

                notes_cell = "\n".join(part for part in [c6, c7] if part)

                if n0:
                    symbol_groups = _split_symbol_groups(c1)
                    explicit_symbols = [symbol for group in symbol_groups for symbol in group]
                    quantity_count = _qty_as_int(_normalize_quantity(n4))
                    family_groups = _group_symbols_by_family(explicit_symbols)
                    ms_thr_pair = False
                    ms_symbol = ""
                    thr_symbol = ""
                    pd_cab_pair = False
                    pd_symbol = ""
                    cab_symbol = ""
                    if len(explicit_symbols) == 2 and len(family_groups) == 2:
                        first_family = _symbol_family(explicit_symbols[0])
                        second_family = _symbol_family(explicit_symbols[1])
                        if {first_family, second_family} == {"MS", "THR"}:
                            ms_thr_pair = True
                            ms_symbol = next(
                                (symbol for symbol in explicit_symbols if _symbol_family(symbol) == "MS"),
                                "",
                            )
                            thr_symbol = next(
                                (symbol for symbol in explicit_symbols if _symbol_family(symbol) == "THR"),
                                "",
                            )
                        if {first_family, second_family} == {"PD", "CAB"}:
                            pd_cab_pair = True
                            pd_symbol = next(
                                (symbol for symbol in explicit_symbols if _symbol_family(symbol) == "PD"),
                                "",
                            )
                            cab_symbol = next(
                                (symbol for symbol in explicit_symbols if _symbol_family(symbol) == "CAB"),
                                "",
                            )
                    primary_symbols = explicit_symbols
                    pending_symbol_groups: list[list[str]] = []
                    if ms_thr_pair and ms_symbol:
                        primary_symbols = [ms_symbol]
                    if pd_cab_pair and pd_symbol:
                        primary_symbols = [pd_symbol]
                    if (
                        not ms_thr_pair
                        and not pd_cab_pair
                        and (
                        quantity_count
                        and len(explicit_symbols) > quantity_count
                        and len(family_groups) > 1
                        and all(len(group) == quantity_count for group in family_groups)
                        )
                    ):
                        primary_symbols = family_groups[0]
                        pending_symbol_groups = family_groups[1:]
                    followup_symbols: list[str] = []
                    followup_description = ""
                    row_quantity_lines = _quantity_lines(c4)
                    row_quantity_count = _qty_as_int(row_quantity_lines[0]) if row_quantity_lines else _qty_as_int(_normalize_quantity(n4))
                    item_lines = _extract_item_text_block(page_text, n0)
                    inline_accessory_symbols = _extract_inline_symbol_accessories(
                        item_lines,
                        explicit_symbols,
                    )
                    leading_item_symbols = _extract_leading_item_symbols(item_lines, explicit_symbols)
                    trailing_item_symbols = explicit_symbols[len(leading_item_symbols):]
                    inline_claimed_symbols = _flatten_symbol_mapping_values(inline_accessory_symbols)
                    if (
                        inline_accessory_symbols
                        and 0 < len(leading_item_symbols) < len(explicit_symbols)
                        and inline_claimed_symbols == trailing_item_symbols
                    ):
                        primary_symbols = leading_item_symbols
                    elif (
                        inline_accessory_symbols
                        and 0 < len(leading_item_symbols) < len(explicit_symbols)
                        and (
                            (row_quantity_count and row_quantity_count < len(explicit_symbols))
                            or len(row_quantity_lines) > 1
                        )
                    ):
                        primary_symbols = leading_item_symbols
                    if (
                        len(explicit_symbols) > 2
                        and quantity_count == len(explicit_symbols)
                        and len(family_groups) == 1
                        and row_index + 1 < len(table)
                    ):
                        next_raw_row = ["" if cell is None else str(cell) for cell in table[row_index + 1]]
                        next_padded = next_raw_row + [""] * max(0, 8 - len(next_raw_row))
                        next_n0 = _normalize_inline_text(next_padded[0])
                        next_n1 = _normalize_inline_text(next_padded[1])
                        next_n2 = _normalize_inline_text(next_padded[2])
                        if not next_n0 and not next_n1 and next_n2 == "HOLDER":
                            trailing_symbols = _trailing_symbols_for_followup_description(page_words, explicit_symbols, next_n2)
                            if trailing_symbols:
                                followup_symbols = trailing_symbols
                                followup_description = next_n2
                                primary_symbols = [symbol for symbol in explicit_symbols if symbol not in trailing_symbols]

                    primary_symbols_split_one_each = bool(
                        quantity_count
                        and len(primary_symbols) > 1
                        and quantity_count == len(primary_symbols)
                    )

                    current_context = {
                        "number": n0,
                        "symbols": primary_symbols,
                        "primary_symbols_split_one_each": primary_symbols_split_one_each,
                        "symbol_groups": symbol_groups,
                        "pending_symbol_groups": pending_symbol_groups,
                        "ms_thr_pair": ms_thr_pair,
                        "ms_symbol": ms_symbol,
                        "thr_symbol": thr_symbol,
                        "accessory_symbol_sequence": [thr_symbol, ms_symbol] if ms_thr_pair else [],
                        "followup_symbols": followup_symbols,
                        "followup_description": followup_description,
                        "followup_primary_split": bool(followup_symbols),
                        "inline_accessory_symbols": inline_accessory_symbols,
                        "pd_cab_pair": pd_cab_pair,
                        "pd_symbol": pd_symbol,
                        "cab_symbol": cab_symbol,
                        "manufacturer": _clean_manufacturer(c5),
                        "notes": _clean_notes(notes_cell),
                        **current_metadata,
                    }

                if not current_context:
                    continue

                if not any([n1, n2, n3, n4, n5, notes_cell]):
                    continue

                description, part_number = _derive_description_and_part_number(c2, c3)
                if n0 and pending_symbol_groups and description == "I/O RELAY TERMINAL":
                    first_spec_line = _englishish_lines(c3)
                    if first_spec_line:
                        part_number = first_spec_line[0]
                if n0 and description:
                    current_context["base_description"] = description
                if not description and part_number and not n2:
                    description = str(current_context.get("base_description", ""))
                parent_symbols = list(current_context.get("symbols", []))
                multi_symbol_parent = len(parent_symbols) > 1
                manufacturer = _clean_manufacturer(c5)
                notes = _clean_notes(notes_cell)
                if not manufacturer:
                    manufacturer = str(current_context.get("manufacturer", ""))
                if not notes:
                    notes = str(current_context.get("notes", ""))
                quantity = _normalize_quantity(n4)
                quantity_lines = _quantity_lines(c4)
                spec_lines = _englishish_lines(c3)
                number = n0 or str(current_context.get("number", ""))
                if n1 and n0:
                    symbol_list = list(current_context.get("symbols", []))
                else:
                    symbol_list = _split_symbols(c1) if n1 else parent_symbols
                symbol_groups = list(current_context.get("symbol_groups", []))
                pending_symbol_groups = list(current_context.get("pending_symbol_groups", []))

                inherited_fields: list[str] = []
                if not n1:
                    inherited_fields.append("Symbol Text")
                if not n5:
                    inherited_fields.append("Manufacturer")
                if not notes_cell:
                    inherited_fields.append("Notes")
                if not n0:
                    inherited_fields.append("Number")

                if not symbol_list:
                    symbol_list = [""]

                line_aligned_groups = False
                if n0 and symbol_groups and len(symbol_groups) > 1 and len(spec_lines) >= 3 and len(quantity_lines) >= 2:
                    variant_start = next(
                        (index for index, line in enumerate(spec_lines) if _looks_like_variant_spec(line)),
                        None,
                    )
                    if variant_start is not None:
                        base_spec = " ".join(spec_lines[:variant_start]).strip()
                        variant_specs = spec_lines[variant_start:]
                        if len(variant_specs) == len(symbol_groups) and len(quantity_lines) == len(symbol_groups) + 1:
                            line_aligned_groups = True
                            variant_quantities = quantity_lines[1:]
                            for group_symbols, variant_spec, variant_quantity in zip(
                                symbol_groups, variant_specs, variant_quantities
                            ):
                                expanded_quantity = _qty_as_int(variant_quantity)
                                per_symbol_quantity = "1"
                                if not expanded_quantity or expanded_quantity != len(group_symbols):
                                    per_symbol_quantity = variant_quantity
                                combined_part_number = " ".join(part for part in [base_spec, variant_spec] if part).strip()
                                for grouped_symbol in group_symbols:
                                    record = {
                                        "Table Title": str(current_context.get("table_title", current_metadata["table_title"])),
                                        "Customer": str(current_context.get("customer", current_metadata["customer"])),
                                        "Location": str(current_context.get("location", current_metadata["location"])),
                                        "Symbol Text": grouped_symbol,
                                        "Description": description,
                                        "Part Number": combined_part_number,
                                        "Quantity": per_symbol_quantity,
                                        "Manufacturer": manufacturer,
                                        "Notes": notes,
                                        "Number": number,
                                        "Drawing Number": str(current_context.get("drawing_number", current_metadata["drawing_number"])),
                                        "Equipment": str(current_context.get("equipment", current_metadata["equipment"])),
                                        "Order Number": str(current_context.get("order_number", current_metadata["order_number"])),
                                    }
                                    canonical_rows.append(record)
                                    provenance_rows.append(
                                        {
                                            **record,
                                            "source_page": page_number,
                                            "source_row_quantity": variant_quantity,
                                            "inherited_fields": list(inherited_fields),
                                            "split_from_symbols": True,
                                            "line_aligned_group": True,
                                        }
                                    )

                if line_aligned_groups:
                    continue

                counted_variants = _extract_counted_variant_specs(spec_lines[1:]) if n0 and len(symbol_groups) > 1 else []
                if n0 and counted_variants and sum(count for _, count in counted_variants) == len(explicit_symbols):
                    base_spec = spec_lines[0].strip() if spec_lines else part_number
                    symbol_index = 0
                    for variant_spec, variant_count in counted_variants:
                        group_symbols = explicit_symbols[symbol_index : symbol_index + variant_count]
                        symbol_index += variant_count
                        combined_part_number = " ".join(part for part in [base_spec, variant_spec] if part).strip()
                        for grouped_symbol in group_symbols:
                            record = {
                                "Table Title": str(current_context.get("table_title", current_metadata["table_title"])),
                                "Customer": str(current_context.get("customer", current_metadata["customer"])),
                                "Location": str(current_context.get("location", current_metadata["location"])),
                                "Symbol Text": grouped_symbol,
                                "Description": description,
                                "Part Number": combined_part_number,
                                "Quantity": "1",
                                "Manufacturer": manufacturer,
                                "Notes": notes,
                                "Number": number,
                                "Drawing Number": str(current_context.get("drawing_number", current_metadata["drawing_number"])),
                                "Equipment": str(current_context.get("equipment", current_metadata["equipment"])),
                                "Order Number": str(current_context.get("order_number", current_metadata["order_number"])),
                            }
                            canonical_rows.append(record)
                            provenance_rows.append(
                                {
                                    **record,
                                    "source_page": page_number,
                                    "source_row_quantity": str(variant_count),
                                    "inherited_fields": list(inherited_fields),
                                    "split_from_symbols": True,
                                    "counted_variant_group": True,
                                }
                            )
                    continue

                quantity_count = _qty_as_int(quantity)
                primary_quantity_count = _qty_as_int(quantity_lines[0]) if quantity_lines else quantity_count
                split_rows = False
                emitted_quantity = quantity
                source_row_quantity_value = quantity
                preserve_group_quantity_descriptions = {
                    "CONNECTOR CONVERTED TERMINAL BLOCK",
                    "CABLE",
                }
                if n1 and len(symbol_list) > 1 and primary_quantity_count:
                    if primary_quantity_count == len(symbol_list):
                        split_rows = True
                        if description in preserve_group_quantity_descriptions:
                            emitted_quantity = str(primary_quantity_count)
                        else:
                            emitted_quantity = "1"
                    else:
                        split_rows = True
                        emitted_quantity = str(primary_quantity_count)
                elif n1 and len(symbol_list) > 1 and quantity:
                    split_rows = True
                    emitted_quantity = quantity
                extra_quantity_record = False
                extra_quantity_value = ""
                followup_symbols = list(current_context.get("followup_symbols", []))
                followup_description = str(current_context.get("followup_description", ""))
                followup_primary_split = bool(current_context.get("followup_primary_split"))
                if n1 and followup_primary_split and len(symbol_list) > 1:
                    split_rows = True
                    emitted_quantity = "1"
                followup_handled = False
                if not n1 and followup_symbols and description == followup_description:
                    symbol_list = followup_symbols
                    split_rows = True
                    emitted_quantity = "1"
                    followup_handled = True
                    current_context["followup_symbols"] = []
                    current_context["followup_description"] = ""
                    current_context["followup_primary_split"] = False
                inline_accessory_symbols = dict(current_context.get("inline_accessory_symbols", {}))
                matched_inline_label = next(
                    (
                        label
                        for label in inline_accessory_symbols
                        if description.upper() == label.upper()
                    ),
                    "",
                )
                if not n1 and not followup_handled and matched_inline_label:
                    symbol_list = inline_accessory_symbols[matched_inline_label]
                    split_rows = len(symbol_list) > 1
                    emitted_quantity = quantity
                elif (
                    not n1
                    and not followup_handled
                    and not matched_inline_label
                    and inline_accessory_symbols
                    and description.upper() in {"SOCKET", "FINGER PROTECTOR", "COVER", "SURGE ABS. UNIT", "DIN RAIL ADAPTER"}
                ):
                    inline_owned_symbols = _flatten_symbol_mapping_values(inline_accessory_symbols)
                    if len(inline_owned_symbols) == 1:
                        symbol_list = inline_owned_symbols
                        split_rows = False
                        emitted_quantity = quantity
                    elif inline_owned_symbols:
                        symbol_list = [", ".join(inline_owned_symbols)]
                        split_rows = False
                        emitted_quantity = quantity
                    else:
                        symbol_list = [""]
                        inherited_fields = [field for field in inherited_fields if field != "Symbol Text"]
                    followup_handled = True
                accessory_symbol_sequence = list(current_context.get("accessory_symbol_sequence", []))
                if not n1 and not followup_handled and not matched_inline_label and accessory_symbol_sequence:
                    symbol_list = [accessory_symbol_sequence[0]]
                    split_rows = False
                    emitted_quantity = quantity
                    if len(accessory_symbol_sequence) > 1:
                        current_context["accessory_symbol_sequence"] = accessory_symbol_sequence[1:]
                    else:
                        current_context["accessory_symbol_sequence"] = accessory_symbol_sequence
                elif not n1 and not followup_handled and not matched_inline_label and bool(current_context.get("pd_cab_pair")):
                    accessory_description = description.upper()
                    if "CABLE" in accessory_description and str(current_context.get("cab_symbol", "")).strip():
                        symbol_list = [str(current_context.get("cab_symbol", ""))]
                    else:
                        symbol_list = [str(current_context.get("pd_symbol", "")) or symbol_list[0]]
                    split_rows = False
                    emitted_quantity = quantity
                elif not n1 and not followup_handled and not matched_inline_label and pending_symbol_groups:
                    next_group = pending_symbol_groups[0]
                    if quantity_count and quantity_count >= len(next_group):
                        symbol_list = next_group
                        if quantity_count % len(next_group) == 0:
                            split_rows = True
                            emitted_quantity = str(quantity_count // len(next_group))
                            source_row_quantity_value = emitted_quantity
                        else:
                            split_rows = True
                            emitted_quantity = "1"
                            if quantity_count > len(next_group):
                                extra_quantity_record = True
                                extra_quantity_value = str(quantity_count - len(next_group))
                        current_context["pending_symbol_groups"] = pending_symbol_groups[1:]
                    else:
                        symbol_list = [""]
                        inherited_fields = [field for field in inherited_fields if field != "Symbol Text"]
                elif not n1 and not followup_handled and not matched_inline_label and multi_symbol_parent:
                    if quantity_count and len(parent_symbols) and quantity_count >= len(parent_symbols):
                        if quantity_count % len(parent_symbols) == 0:
                            symbol_list = parent_symbols
                            split_rows = True
                            emitted_quantity = str(quantity_count // len(parent_symbols))
                        else:
                            symbol_list = [", ".join(parent_symbols)]
                            split_rows = False
                            emitted_quantity = quantity
                    elif parent_symbols:
                        symbol_list = [", ".join(parent_symbols)]
                        split_rows = False
                        emitted_quantity = quantity
                    else:
                        symbol_list = [""]
                        inherited_fields = [field for field in inherited_fields if field != "Symbol Text"]

                emitted_symbols = symbol_list if split_rows else [symbol_list[0]]

                for symbol in emitted_symbols:
                    record = {
                        "Table Title": str(current_context.get("table_title", current_metadata["table_title"])),
                        "Customer": str(current_context.get("customer", current_metadata["customer"])),
                        "Location": str(current_context.get("location", current_metadata["location"])),
                        "Symbol Text": symbol,
                        "Description": description,
                        "Part Number": part_number,
                        "Quantity": emitted_quantity,
                        "Manufacturer": manufacturer,
                        "Notes": notes,
                        "Number": number,
                        "Drawing Number": str(current_context.get("drawing_number", current_metadata["drawing_number"])),
                        "Equipment": str(current_context.get("equipment", current_metadata["equipment"])),
                        "Order Number": str(current_context.get("order_number", current_metadata["order_number"])),
                    }
                    if not any(value.strip() for value in record.values()):
                        continue
                    canonical_rows.append(record)
                    provenance_rows.append(
                        {
                            **record,
                            "source_page": page_number,
                            "source_row_quantity": source_row_quantity_value,
                            "inherited_fields": list(inherited_fields),
                            "split_from_symbols": split_rows,
                        }
                    )

                if n0 and bool(current_context.get("ms_thr_pair")) and str(current_context.get("thr_symbol", "")).strip():
                    thr_record = {
                        "Table Title": str(current_context.get("table_title", current_metadata["table_title"])),
                        "Customer": str(current_context.get("customer", current_metadata["customer"])),
                        "Location": str(current_context.get("location", current_metadata["location"])),
                        "Symbol Text": str(current_context.get("thr_symbol", "")),
                        "Description": "THERMAL RELAY",
                        "Part Number": "",
                        "Quantity": emitted_quantity,
                        "Manufacturer": manufacturer,
                        "Notes": notes,
                        "Number": number,
                        "Drawing Number": str(current_context.get("drawing_number", current_metadata["drawing_number"])),
                        "Equipment": str(current_context.get("equipment", current_metadata["equipment"])),
                        "Order Number": str(current_context.get("order_number", current_metadata["order_number"])),
                    }
                    canonical_rows.append(thr_record)
                    provenance_rows.append(
                        {
                            **thr_record,
                            "source_page": page_number,
                            "source_row_quantity": quantity,
                            "inherited_fields": list(inherited_fields),
                            "split_from_symbols": False,
                            "compound_pair_inference": "MS/THR",
                        }
                    )

                if extra_quantity_record:
                    extra_record = {
                        "Table Title": str(current_context.get("table_title", current_metadata["table_title"])),
                        "Customer": str(current_context.get("customer", current_metadata["customer"])),
                        "Location": str(current_context.get("location", current_metadata["location"])),
                        "Symbol Text": "",
                        "Description": description,
                        "Part Number": part_number,
                        "Quantity": extra_quantity_value,
                        "Manufacturer": manufacturer,
                        "Notes": notes,
                        "Number": number,
                        "Drawing Number": str(current_context.get("drawing_number", current_metadata["drawing_number"])),
                        "Equipment": str(current_context.get("equipment", current_metadata["equipment"])),
                        "Order Number": str(current_context.get("order_number", current_metadata["order_number"])),
                    }
                    canonical_rows.append(extra_record)
                    provenance_rows.append(
                        {
                            **extra_record,
                            "source_page": page_number,
                            "source_row_quantity": extra_quantity_value,
                            "inherited_fields": list(inherited_fields),
                            "split_from_symbols": False,
                            "quantity_remainder": True,
                        }
                    )

    return canonical_rows, provenance_rows, warnings


@tool
def search_langchain_docs(query: str, limit: int = 15) -> str:
    """Semantic search over the local LangChain/LangGraph/Deep Agents docs corpus.
    Use this when implementing or debugging LangChain, LangGraph, Deep Agents,
    streaming, subagents, time travel, memory, middleware, or vector-store behavior.
    Choose limit based on task breadth; use higher limits for specific fact-finding
    where repeated small searches would be wasteful. Returns local vector-store
    matches with path, section, score, and snippet."""
    q = query.strip()
    if not q:
        return "Query must not be empty."

    requested_limit = max(1, limit)
    effective_limit = min(requested_limit, settings.langchain_docs_search_max_results)

    vector = _embed_query(q)
    client = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
    fetch_limit = min(effective_limit * 3, settings.langchain_docs_search_max_results * 3)
    response = client.query_points(
        collection_name=settings.qdrant_langchain_docs_collection,
        query=vector,
        limit=fetch_limit,
        query_filter=Filter(
            must=[
                FieldCondition(
                    key="corpus_name",
                    match=MatchValue(value=settings.langchain_docs_corpus_name),
                )
            ]
        ),
    )
    seen_content: set[str] = set()
    results = []
    for point in response.points:
        payload = point.payload or {}
        content_key = str(payload.get("content_sha256") or payload.get("content", ""))
        if content_key in seen_content:
            continue
        seen_content.add(content_key)
        results.append(point)
        if len(results) >= effective_limit:
            break

    if not results:
        return f'No LangChain docs matches found for "{q}".'

    lines = [f'LangChain docs search for "{q}":']
    if requested_limit != effective_limit:
        lines.append(
            f"Requested limit {requested_limit} capped at {effective_limit} by platform config."
        )
    for index, point in enumerate(results, start=1):
        payload = point.payload or {}
        file_path = str(payload.get("file_path", "(unknown path)"))
        title = str(payload.get("doc_title", "")).strip()
        section = str(payload.get("doc_section", "Introduction"))
        snippet = " ".join(str(payload.get("content", "")).split())
        if len(snippet) > 220:
            snippet = snippet[:217] + "..."
        heading = f"{file_path} - {section}"
        if title:
            heading = f"{file_path} - {title} - {section}"
        lines.append(
            f"{index}. {heading} (score {point.score:.3f})\n   {snippet}"
        )
    return "\n".join(lines)


@tool
def inspect_pdf_document(pdf_path: str, max_pages: int = 3) -> str:
    """Inspect a production PDF and summarize extraction-relevant structure.
    Use before choosing OCR, table extraction, or visual analysis. Returns page count,
    whether a text layer exists, sample page dimensions, and table counts."""
    resolved = _resolve_document_path(pdf_path)
    summary: dict[str, object] = {
        "pdf_path": str(resolved),
        "file_name": resolved.name,
        "page_count": 0,
        "pages_with_text_layer": 0,
        "pages_with_tables": 0,
        "sample_pages": [],
    }

    with pdfplumber.open(resolved) as pdf:
        summary["page_count"] = len(pdf.pages)
        for page_number in _page_span(len(pdf.pages), max_pages=max_pages):
            page = pdf.pages[page_number - 1]
            text = page.extract_text() or ""
            tables = page.extract_tables() or []
            if text.strip():
                summary["pages_with_text_layer"] = int(summary["pages_with_text_layer"]) + 1
            if tables:
                summary["pages_with_tables"] = int(summary["pages_with_tables"]) + 1
            summary["sample_pages"].append(
                {
                    "page": page_number,
                    "width": round(page.width, 2),
                    "height": round(page.height, 2),
                    "text_layer": bool(text.strip()),
                    "table_count": len(tables),
                    "text_preview": " ".join(text.split())[:240],
                }
            )
    return json.dumps(summary, indent=2, ensure_ascii=False)


@tool
def extract_pdf_text_layer(pdf_path: str, page_from: int = 1, page_to: int = 0, max_pages: int = 6) -> str:
    """Extract the native PDF text layer for one PDF across a page range.
    Use this first on born-digital manuals, parts lists, and schematics before OCR."""
    resolved = _resolve_document_path(pdf_path)
    chunks: list[str] = []
    with pdfplumber.open(resolved) as pdf:
        for page_number in _page_span(len(pdf.pages), page_from, page_to, max_pages):
            page = pdf.pages[page_number - 1]
            text = (page.extract_text() or "").strip()
            chunks.append(f"===== Page {page_number} =====")
            chunks.append(text or "[no text layer extracted]")
    return "\n\n".join(chunks)


@tool
def extract_pdf_tables(pdf_path: str, page_from: int = 1, page_to: int = 0, max_pages: int = 6) -> str:
    """Extract tables from a PDF and return structured JSON summaries with row samples.
    Use for parts lists, cable lists, parameter sheets, and other tabular machine documents."""
    resolved = _resolve_document_path(pdf_path)
    output: list[dict[str, object]] = []
    with pdfplumber.open(resolved) as pdf:
        for page_number in _page_span(len(pdf.pages), page_from, page_to, max_pages):
            page = pdf.pages[page_number - 1]
            found_tables = page.find_tables() or []
            extracted_tables = page.extract_tables() or []
            tables = found_tables if found_tables else extracted_tables
            if not tables:
                continue
            for index, table in enumerate(tables, start=1):
                if hasattr(table, "extract"):
                    table_data = table.extract() or []
                    bbox = getattr(table, "bbox", None)
                else:
                    table_data = table or []
                    bbox = None
                header = table_data[0] if table_data else []
                output.append(
                    {
                        "page": page_number,
                        "table_index": index,
                        "bbox": {
                            "x0": round(bbox[0], 2),
                            "top": round(bbox[1], 2),
                            "x1": round(bbox[2], 2),
                            "bottom": round(bbox[3], 2),
                        }
                        if bbox
                        else None,
                        "row_count": len(table_data),
                        "column_count": len(table_data[0]) if table_data and table_data[0] else 0,
                        "header_row": [str(cell).strip() if cell is not None else "" for cell in header],
                        "sample_rows": [
                            [str(cell).strip() if cell is not None else "" for cell in row]
                            for row in table_data[1:6]
                        ],
                    }
                )
    if not output:
        return f"No tables found in {resolved} for the requested page span."
    return json.dumps(output, indent=2, ensure_ascii=False)


@tool
def ocr_pdf_pages(
    pdf_path: str,
    page_from: int = 1,
    page_to: int = 0,
    max_pages: int = 4,
    dpi: int = 200,
    lang: str = "eng+jpn",
) -> str:
    """Run Tesseract OCR on rendered PDF pages and return page-by-page text.
    Use when the PDF text layer is missing, unreliable, or visually misaligned."""
    resolved = _resolve_document_path(pdf_path)
    doc = fitz.open(resolved)
    try:
        chunks: list[str] = []
        for page_number in _page_span(doc.page_count, page_from, page_to, max_pages):
            png_bytes, artifact_path = _render_pdf_region(resolved, page_number, dpi=dpi)
            image = Image.open(BytesIO(png_bytes))
            text = pytesseract.image_to_string(image, lang=lang).strip()
            chunks.append(
                f"===== OCR Page {page_number} =====\nartifact: {artifact_path}\n{text or '[no OCR text extracted]'}"
            )
        return "\n\n".join(chunks)
    finally:
        doc.close()


@tool
def analyze_pdf_visual_region(
    pdf_path: str,
    page_number: int,
    prompt: str,
    bbox_json: str = "",
    dpi: int = 0,
) -> str:
    """Render one PDF page or region and ask the multimodal architect model to analyze it.
    Use for visual layout interpretation, ambiguous tables, symbols, diagrams, or spatial reasoning."""
    resolved = _resolve_document_path(pdf_path)
    bbox = _parse_bbox_json(bbox_json)
    analysis, artifact_path = _analyze_pdf_visual_region_payload(
        resolved,
        page_number,
        prompt,
        bbox=bbox,
        dpi=dpi,
    )
    return f"artifact: {artifact_path}\n\n{json.dumps(analysis, ensure_ascii=False, indent=2)}"


_CABLE_LIST_COLUMN_RANGES: tuple[tuple[str, float, float], ...] = (
    ("cable", 0.0, 60.0),
    ("origin", 60.0, 125.0),
    ("termination", 125.0, 195.0),
    ("cable_type", 195.0, 299.0),
    ("cable_color", 299.0, 330.0),
    ("wire1", 330.0, 352.0),
    ("wire2", 352.0, 388.0),
    ("wire3", 388.0, 424.0),
    ("wire4", 424.0, 460.0),
    ("wire5", 460.0, 496.0),
    ("wire6", 496.0, 532.0),
    ("wire7", 532.0, 568.0),
    ("wire8", 568.0, 604.0),
    ("wire9", 604.0, 640.0),
    ("wire10", 640.0, 680.0),
    ("conduit_size", 680.0, 723.0),
    ("conduit_qty", 723.0, 748.0),
    ("remarks", 748.0, 900.0),
)

_CABLE_LIST_NONQ_COLUMNS = {
    "origin",
    "termination",
    "cable_type",
    "cable_color",
    "wire1",
    "wire2",
    "wire3",
    "wire4",
    "wire5",
    "wire6",
    "wire7",
    "wire8",
    "wire9",
    "wire10",
    "conduit_size",
    "remarks",
}


def _fullwidth_to_ascii(text: str) -> str:
    return unicodedata.normalize("NFKC", text or "")


def _infer_cable_list_profile(pdf_path: Path) -> str:
    name = pdf_path.name.upper()
    if "VACUUM" in name:
        return "vacuum"
    if "machine-cable" in name:
        return "dcm"

    with pdfplumber.open(pdf_path) as pdf:
        first_page = _fullwidth_to_ascii(pdf.pages[0].extract_text() or "")
    if "SENSOR VACUUM UNIT" in first_page:
        return "vacuum"
    return "dcm"


def _extract_cable_list_metadata(pdf_path: Path, *, profile: str) -> dict[str, str]:
    customer = ""
    equipment = ""
    order_number = ""
    with pdfplumber.open(pdf_path) as pdf:
        first_page_text = _fullwidth_to_ascii(pdf.pages[0].extract_text() or "")

    customer_match = re.search(r"AISIN\s+AUTOMOTIVE\s+CASTING[,，]\s*LLC", first_page_text, re.IGNORECASE)
    if customer_match:
        customer = "AISIN AUTOMOTIVE CASTING, LLC"

    order_match = re.search(r"\b(\d{5})\b", first_page_text)
    if order_match:
        order_number = order_match.group(1)

    drawing_match = re.search(
        r"(\d{3}-E\d{4}[:\-]\d{3}-\d)",
        _fullwidth_to_ascii(pdf_path.name + "\n" + first_page_text),
    )
    drawing_number = drawing_match.group(1) if drawing_match else ""

    if profile == "vacuum":
        equipment = "SENSOR VACUUM UNIT"
    elif "the reference machine DIE CASTING MACHINE" in first_page_text:
        equipment = "the reference machine DIE CASTING MACHINE"
    else:
        equipment = "the reference machine DIE CASTING MACHINE" if "the reference machine" in first_page_text else ""

    return {
        "Order Number": order_number,
        "Drawing Number": drawing_number,
        "Equipment": equipment,
        "Customer": customer,
    }


def _cable_list_column_name(x_center: float) -> str | None:
    for name, start, end in _CABLE_LIST_COLUMN_RANGES:
        if start <= x_center < end:
            return name
    return None


def _group_pdf_words_into_lines(words: list[dict[str, object]], *, tolerance: float = 2.2) -> list[dict[str, object]]:
    grouped: list[dict[str, object]] = []
    for word in sorted(words, key=lambda item: (round(float(item["top"]) / 2.0) * 2.0, float(item["x0"]))):
        top = float(word["top"])
        if not grouped or abs(float(grouped[-1]["top"]) - top) > tolerance:
            grouped.append({"top": top, "words": [word]})
        else:
            grouped[-1]["words"].append(word)
    return grouped


def _line_to_cable_list_columns(line: dict[str, object]) -> dict[str, list[str]]:
    pieces: dict[str, list[str]] = defaultdict(list)
    for word in line["words"]:
        name = _cable_list_column_name((float(word["x0"]) + float(word["x1"])) / 2.0)
        if name:
            pieces[name].append(str(word["text"]))
    return pieces


def _normalize_cable_text(text: str) -> str:
    return re.sub(r"\s+", " ", _fullwidth_to_ascii(text)).strip()


def _has_meaningful_cable_values(values: list[str]) -> bool:
    for value in values:
        normalized = _normalize_cable_text(value)
        if normalized and normalized not in {"?", "SP", "?"}:
            return True
    return False


def _line_has_wire_content(line: dict[str, object]) -> bool:
    pieces = _line_to_cable_list_columns(line)
    return any(_has_meaningful_cable_values(pieces[f"wire{wire_index}"]) for wire_index in range(1, 11))


def _line_has_early_wire_content(line: dict[str, object]) -> bool:
    pieces = _line_to_cable_list_columns(line)
    return any(_has_meaningful_cable_values(pieces[f"wire{wire_index}"]) for wire_index in range(1, 7))


def _line_has_late_wire_only_content(line: dict[str, object]) -> bool:
    pieces = _line_to_cable_list_columns(line)
    has_late = any(_has_meaningful_cable_values(pieces[f"wire{wire_index}"]) for wire_index in range(7, 11))
    if not has_late:
        return False
    if _has_meaningful_cable_values(pieces["cable"]):
        return False
    if _has_meaningful_cable_values(pieces["origin"]) or _has_meaningful_cable_values(pieces["termination"]):
        return False
    if _has_meaningful_cable_values(pieces["cable_type"]) or _has_meaningful_cable_values(pieces["cable_color"]):
        return False
    if _has_meaningful_cable_values(pieces["conduit_size"]):
        return False
    if any(_has_meaningful_cable_values(pieces[f"wire{wire_index}"]) for wire_index in range(1, 7)):
        return False
    return True


def _line_has_placeholder_only_wire_content(line: dict[str, object]) -> bool:
    pieces = _line_to_cable_list_columns(line)
    wire_values = [
        _normalize_cable_text(value)
        for wire_index in range(1, 11)
        for value in pieces[f"wire{wire_index}"]
    ]
    wire_values = [value for value in wire_values if value]
    if not wire_values:
        return False
    if any(value not in {"SP", "?"} for value in wire_values):
        return False
    if _has_meaningful_cable_values(pieces["cable"]):
        return False
    if _has_meaningful_cable_values(pieces["origin"]) or _has_meaningful_cable_values(pieces["termination"]):
        return False
    if _has_meaningful_cable_values(pieces["cable_type"]) or _has_meaningful_cable_values(pieces["cable_color"]):
        return False
    if _has_meaningful_cable_values(pieces["conduit_size"]):
        return False
    return True


def _line_is_numeric_annotation_only(line: dict[str, object]) -> bool:
    pieces = _line_to_cable_list_columns(line)
    wire_values = [
        _normalize_cable_text(value)
        for wire_index in range(1, 11)
        for value in pieces[f"wire{wire_index}"]
    ]
    wire_values = [value for value in wire_values if value]
    if not wire_values:
        return False
    if len(wire_values) > 2:
        return False
    if any(not value.isdigit() or len(value) > 2 for value in wire_values):
        return False
    for key in ("cable", "origin", "termination", "remarks", "cable_type", "cable_color", "conduit_size", "conduit_qty"):
        if _has_meaningful_cable_values(pieces[key]):
            return False
    return True


def _count_filled_late_wire_columns(block: list[dict[str, object]]) -> int:
    filled: set[int] = set()
    for line in block:
        pieces = _line_to_cable_list_columns(line)
        for wire_index in range(7, 11):
            if _has_meaningful_cable_values(pieces[f"wire{wire_index}"]):
                filled.add(wire_index)
    return len(filled)


def _join_deduped(parts: list[str]) -> str:
    normalized: list[str] = []
    for part in parts:
        item = _normalize_cable_text(part)
        if not item:
            continue
        if normalized and normalized[-1] == item:
            continue
        normalized.append(item)
    return " ".join(normalized).strip()


def _is_cable_prefix_token(text: str) -> bool:
    normalized = _normalize_cable_text(text)
    return normalized.endswith("-") and normalized.count("-") >= 1 and any(ch.isalpha() for ch in normalized[:2])


def _build_cable_row_from_block(
    block: list[dict[str, object]],
    *,
    metadata: dict[str, str],
    source_page: int,
    default_cable_number: str = "",
) -> dict[str, str] | None:
    aggregated: dict[str, list[str]] = defaultdict(list)
    for line in block:
        pieces = _line_to_cable_list_columns(line)
        for key, values in pieces.items():
            text = _normalize_cable_text(" ".join(values))
            if text:
                aggregated[key].append(text)

    cable_number = "".join(item for item in aggregated["cable"] if _normalize_cable_text(item) not in {"?", "?"}).strip() or default_cable_number
    if not cable_number:
        return None

    row = {field: "" for field in CABLE_LIST_FIELDNAMES}
    row.update(metadata)
    row["Cable Number"] = cable_number
    row["Originating Point"] = _join_deduped(aggregated["origin"])
    row["Termination Point"] = _join_deduped(aggregated["termination"])
    row["Cable Type"] = _join_deduped(aggregated["cable_type"])
    row["Cable Color"] = _join_deduped(aggregated["cable_color"])
    row["Conduit Size"] = _join_deduped([item for item in aggregated["conduit_size"] if item != "φ"])
    row["Conduit Qty"] = _join_deduped([item for item in aggregated["conduit_qty"] if item != "φ"])
    row["Remarks"] = _join_deduped(aggregated["remarks"])
    row["Notes"] = ""
    row["Source Page"] = str(source_page)
    for wire_index in range(1, 11):
        row[f"Wire{wire_index}"] = _join_deduped(aggregated[f"wire{wire_index}"])
    return row


def _group_cable_block_into_chunks(
    block: list[dict[str, object]],
    *,
    profile: str,
) -> list[list[dict[str, object]]]:
    if profile != "dcm" or not block:
        return [block]

    sorted_block = sorted(block, key=lambda line: float(line["top"]))
    chunks: list[list[dict[str, object]]] = []
    current_chunk: list[dict[str, object]] = []
    current_chunk_has_wires = False
    current_chunk_has_early_wires = False
    current_chunk_cable_text = ""

    for index, line in enumerate(sorted_block):
        pieces = _line_to_cable_list_columns(line)
        line_cable_text = _normalize_cable_text("".join(pieces["cable"]))
        line_has_wire1 = any(_normalize_cable_text(value) not in {"", "?"} for value in pieces["wire1"])
        next_line = sorted_block[index + 1] if index + 1 < len(sorted_block) else None
        line_is_forward_prelude = bool(
            current_chunk
            and current_chunk_has_early_wires
            and not current_chunk_cable_text.endswith("-")
            and (_line_has_late_wire_only_content(line) or _line_has_placeholder_only_wire_content(line))
            and _count_filled_late_wire_columns(current_chunk) >= 2
            and next_line is not None
            and _line_has_early_wire_content(next_line)
        )
        starts_new_chunk = bool(
            current_chunk
            and current_chunk_has_early_wires
            and not current_chunk_cable_text.endswith("-")
            and (line_has_wire1 or line_is_forward_prelude)
        )
        if starts_new_chunk:
            chunks.append(current_chunk)
            current_chunk = []
            current_chunk_has_wires = False
            current_chunk_has_early_wires = False
            current_chunk_cable_text = ""
        current_chunk.append(line)
        if line_cable_text:
            current_chunk_cable_text += line_cable_text
        current_chunk_has_wires = current_chunk_has_wires or _line_has_wire_content(line)
        current_chunk_has_early_wires = current_chunk_has_early_wires or _line_has_early_wire_content(line)

    if current_chunk:
        chunks.append(current_chunk)
    return chunks


def _split_trailing_cable_prelude_lines(
    block: list[dict[str, object]],
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    retained = list(block)
    carried: list[dict[str, object]] = []

    while retained:
        line = retained[-1]
        pieces = _line_to_cable_list_columns(line)
        has_cable = _normalize_cable_text("".join(pieces["cable"])) != ""
        has_locations = _has_meaningful_cable_values(pieces["origin"]) or _has_meaningful_cable_values(pieces["termination"])
        has_type_or_color = _has_meaningful_cable_values(pieces["cable_type"]) or _has_meaningful_cable_values(pieces["cable_color"])
        has_conduit_size = _has_meaningful_cable_values(pieces["conduit_size"])
        has_wire1 = _has_meaningful_cable_values(pieces["wire1"])
        is_forward_wrap_line = _line_has_placeholder_only_wire_content(line)
        if has_cable or has_locations or has_type_or_color or has_conduit_size or (not has_wire1 and not is_forward_wrap_line):
            break
        carried.insert(0, retained.pop())

    return retained, carried


def _build_cable_rows_from_block(
    block: list[dict[str, object]],
    *,
    metadata: dict[str, str],
    source_page: int,
    profile: str,
) -> list[dict[str, str]]:
    full_row = _build_cable_row_from_block(block, metadata=metadata, source_page=source_page)
    if not full_row:
        return []

    chunks = _group_cable_block_into_chunks(block, profile=profile)
    if len(chunks) <= 1:
        return [full_row]

    cable_number = full_row["Cable Number"]
    carry_fields = {
        "Originating Point": full_row["Originating Point"],
        "Termination Point": full_row["Termination Point"],
        "Cable Type": full_row["Cable Type"],
        "Cable Color": full_row["Cable Color"],
    }
    chunk_rows: list[dict[str, str]] = []

    for chunk in chunks:
        chunk_row = _build_cable_row_from_block(
            chunk,
            metadata=metadata,
            source_page=source_page,
            default_cable_number=cable_number,
        )
        if not chunk_row:
            continue
        if not any(chunk_row[f"Wire{wire_index}"] for wire_index in range(1, 11)):
            if not any(_line_has_wire_content(line) for line in chunk):
                continue
        chunk_row["Cable Number"] = cable_number
        for field_name, carried_value in carry_fields.items():
            normalized_field = _normalize_cable_text(chunk_row[field_name])
            if not normalized_field or set(normalized_field.replace(" ", "")) <= {"?", "?"}:
                chunk_row[field_name] = carried_value
        chunk_rows.append(chunk_row)

    return chunk_rows or [full_row]


def _carry_forward_cable_locations(rows: list[dict[str, str]]) -> None:
    last_origin = ""
    last_termination = ""
    for row in rows:
        origin = _normalize_cable_text(row.get("Originating Point", ""))
        termination = _normalize_cable_text(row.get("Termination Point", ""))

        if not origin or set(origin.replace(" ", "")) <= {"↓"}:
            row["Originating Point"] = last_origin
        else:
            row["Originating Point"] = origin.replace("↓ ", "").strip()
            last_origin = row["Originating Point"]

        if not termination or set(termination.replace(" ", "")) <= {"↓"}:
            row["Termination Point"] = last_termination
        else:
            row["Termination Point"] = termination.replace("↓ ", "").strip()
            last_termination = row["Termination Point"]


def _filled_wire_indices(row: dict[str, str]) -> list[int]:
    return [wire_index for wire_index in range(1, 11) if _normalize_cable_text(row.get(f"Wire{wire_index}", ""))]


def _filled_wire_values(row: dict[str, str]) -> list[str]:
    return [
        _normalize_cable_text(row.get(f"Wire{wire_index}", ""))
        for wire_index in range(1, 11)
        if _normalize_cable_text(row.get(f"Wire{wire_index}", ""))
    ]


def _row_has_cable_support_fields(row: dict[str, str]) -> bool:
    return any(
        _normalize_cable_text(row.get(field_name, ""))
        for field_name in ("Conduit Size", "Conduit Qty", "Remarks", "Notes")
    )


def _wire_value_is_label_like(value: str) -> bool:
    normalized = _normalize_cable_text(value)
    if not normalized:
        return False
    return bool(
        re.fullmatch(
            r"(?:SP\s*[A-Z0-9-]+|TB\d+-\d+|OP-\d+|[A-Z]+(?:/[A-Z]+)?|根元でカット|<CAB\d+>?)",
            normalized,
        )
    )


def _wire_value_is_identifier_like(value: str) -> bool:
    normalized = _normalize_cable_text(value)
    if not normalized:
        return False
    return bool(re.search(r"\d", normalized)) or normalized in {"PC24", "NC24", "PL24", "NL24", "NOP24", "P24"}


def _normalize_dcm_cable_type(value: str) -> str:
    normalized = _normalize_cable_text(value)
    if not normalized:
        return ""
    normalized = re.sub(r"\s+[xX]\s+", " × ", normalized)
    normalized = re.sub(r"\s*×\s*", " × ", normalized)
    normalized = re.sub(r"×\s*(\d)", r"× \1", normalized)
    normalized = re.sub(r"\b([A-Z0-9.-]+\s+\d+(?:\.\d+)?\s*(?:sq|AWG)\s*-\s*\d+\s*[CWP])\s+([A-Z0-9-]+)\b", r"\2 \1", normalized)
    normalized = re.sub(r"\b([A-Z0-9-]+)\s+([A-Z0-9.-]+\s+\d+(?:\.\d+)?\s*(?:sq|AWG)\s*-\s*\d+\s*[CWP])\b", r"\2 \1", normalized)
    normalized = re.sub(r"\b([A-Z0-9-]+)\s+×\s+(\d+\s*W)\b", r"\1 × \2", normalized)
    normalized = re.sub(r"^(?:×\s+)?(\d+\s*W)\s+([A-Z0-9-]+)$", r"\2 × \1", normalized)
    if "D-LIST-MTW" in normalized and "AWG" in normalized and re.search(r"\b\d+\s*C\b", normalized):
        awg_match = re.search(r"(\d+\s*AWG)", normalized)
        conductor_match = re.search(r"(\d+)\s*C\b", normalized)
        if awg_match and conductor_match:
            normalized = f"D-LIST-MTW {awg_match.group(1)} - {conductor_match.group(1)} C"
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _normalize_dcm_wire_value(value: str) -> str:
    normalized = _normalize_cable_text(value)
    if not normalized:
        return ""
    normalized = re.sub(r"^SP(TB\d+-\d+)\s+(.+)$", r"SP \1 / \2", normalized)
    normalized = re.sub(r"^(.+?)\s+SP(TB\d+-\d+)$", r"\1 / SP \2", normalized)
    normalized = re.sub(r"^SP(TB\d+-\d+)$", r"SP \1", normalized)
    normalized = re.sub(r"^(SP(?:CL|GF|RBT|PCU))\s*0?(\d+)$", r"\1 \2", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def _move_split_wire_suffix_to_next_row(previous_row: dict[str, str], row: dict[str, str]) -> None:
    for wire_index in range(1, 11):
        key = f"Wire{wire_index}"
        prev_value = _normalize_dcm_wire_value(previous_row.get(key, ""))
        curr_value = _normalize_dcm_wire_value(row.get(key, ""))
        if not prev_value:
            row[key] = curr_value
            continue
        if not curr_value:
            previous_row[key] = prev_value
            continue

        prefix_only = re.fullmatch(r"(.+?)\s+(SP|SP[A-Z]+)$", prev_value)
        if prefix_only and re.fullmatch(r"(?:\d+|TB\d+-\d+|OP-\d+)", curr_value):
            previous_row[key] = prefix_only.group(1)
            row[key] = _normalize_dcm_wire_value(f"{prefix_only.group(2)} {curr_value}")
            continue

        doubled_signal = re.fullmatch(r"([A-Z0-9()/-]+)\s+([A-Z]\d+[A-Z0-9/-]*)", prev_value)
        if doubled_signal and re.fullmatch(r"(?:SP\s+TB\d+-\d+|TB\d+-\d+)", curr_value):
            previous_row[key] = doubled_signal.group(1)
            row[key] = _normalize_dcm_wire_value(f"{doubled_signal.group(2)} / {curr_value}")
            continue

        previous_row[key] = prev_value
        row[key] = curr_value


def _normalize_dcm_row_values(rows: list[dict[str, str]]) -> None:
    for row in rows:
        row["Cable Type"] = _normalize_dcm_cable_type(row.get("Cable Type", ""))
        cable_color = _normalize_cable_text(row.get("Cable Color", ""))
        if cable_color == "1":
            row["Cable Color"] = ""
        elif cable_color.endswith(" 1"):
            row["Cable Color"] = cable_color[:-2].strip()
        else:
            row["Cable Color"] = cable_color
        for wire_index in range(1, 11):
            key = f"Wire{wire_index}"
            row[key] = _normalize_dcm_wire_value(row.get(key, ""))

    for index in range(1, len(rows)):
        previous_row = rows[index - 1]
        row = rows[index]
        if (
            previous_row["Cable Number"] == row["Cable Number"]
            and previous_row["Source Page"] == row["Source Page"]
        ):
            _move_split_wire_suffix_to_next_row(previous_row, row)


def _normalize_dcm_special_rows(rows: list[dict[str, str]]) -> None:
    for row in rows:
        cable_number = _normalize_cable_text(row.get("Cable Number", ""))
        termination = _normalize_cable_text(row.get("Termination Point", ""))
        cable_type = _normalize_cable_text(row.get("Cable Type", ""))
        cable_color = _normalize_cable_text(row.get("Cable Color", ""))
        wire1 = _normalize_cable_text(row.get("Wire1", ""))
        wire2 = _normalize_cable_text(row.get("Wire2", ""))
        wire3 = _normalize_cable_text(row.get("Wire3", ""))

        # Bracketed cable labels often get split across Wire1-3 by the text layer.
        if wire1.startswith("<") and wire2 == "FROM" and wire3.endswith(">"):
            row["Wire1"] = f"{wire1} {wire2} {wire3}".strip()
            row["Wire2"] = ""
            row["Wire3"] = ""
        elif wire1.startswith("<") and wire3.endswith(">"):
            row["Wire1"] = f"{wire1} {wire2} {wire3}".strip()
            row["Wire2"] = ""
            row["Wire3"] = ""
        elif not wire1 and wire2.startswith("<") and wire3.endswith(">"):
            row["Wire1"] = f"{wire2} {wire3}".strip()
            row["Wire2"] = ""
            row["Wire3"] = ""

        # Sensor rows split the cable-type count into the color column.
        sensor_match = re.fullmatch(r".*ES(\d)1D-L1", cable_number)
        if sensor_match:
            if re.match(r"^(?:x|-)\s+\d+\s*[Ww]\b", cable_type):
                row["Cable Type"] = "4P-RBT-0103-40 × 1 W"
            if not cable_color:
                row["Cable Color"] = "-"
            es_prefix = f"ES-{sensor_match.group(1)}1D"
            if termination:
                if es_prefix in termination:
                    trailing = termination.split(es_prefix, 1)[1]
                    trailing = re.split(r"\bES-\d{2}D\b", trailing, maxsplit=1)[0].strip()
                    row["Termination Point"] = f"{es_prefix} {trailing}".strip()
                elif termination.startswith("("):
                    row["Termination Point"] = f"{es_prefix} CYL位置{sensor_match.group(1)} {termination}".strip()

        # Page-4 encoder rows bleed into the fan row and lose the leading encoder label.
        if cable_number == "PP-M1-P3":
            row["Termination Point"] = "FAN OF M1"
            row["Cable Type"] = "UE/STO(N)/TC LF 16 AWG - 4E"
            row["Cable Color"] = "-"
            row["Wire2"] = "FV1"
        if cable_number == "PP-M1-L1":
            row["Termination Point"] = "ENCODER OF MOTOR 1"
            row["Cable Type"] = "SC-ENECBL40M-H X 1W"
            row["Cable Color"] = "-"
            row["Wire1"] = "<FOR ENCODER>"
            row["Wire2"] = "<エンコーダケーブル>"
            row["Wire3"] = "<CAB22>"
        if cable_number == "PP-M40-L1" and wire1.startswith("<ENCODER"):
            row["Wire1"] = "<ENCODER CABLE (CAB42)>"
            row["Wire2"] = ""
            row["Wire3"] = ""
            row["Cable Type"] = "MR-J3ENSCBL20M-H X 1 W"

        if cable_number == "CP-TB11-C1-4":
            wire_values = [row.get(f"Wire{wire_index}", "") for wire_index in range(1, 11)]
            compact_values = [value for value in wire_values if _normalize_cable_text(value)]
            if compact_values == ["6000", "6001", "6002 SH", "1"]:
                for wire_index in range(1, 11):
                    row[f"Wire{wire_index}"] = compact_values[wire_index - 1] if wire_index <= len(compact_values) else ""

        if cable_number == "PP-TB14-L1-1" and wire1 == "4312 BLUE":
            row["Wire1"] = "BLUE 4312"
            row["Wire2"] = "BU/WH 4311"
            row["Wire3"] = "SHIELD 4321"
            row["Wire4"] = "<CAB430"

        if cable_number == "CP-TB14-L1-5" and row.get("Wire3", "") == "5402 SH 5422":
            row["Wire3"] = "5402 SH"
        if cable_number == "CP-TB14-L1-6" and row.get("Wire3", "") == "(SH) 5432":
            row["Wire3"] = "5422 (SH)"
        if cable_number == "CP-TB14-L1-7":
            if row.get("Wire3", "") == "(SH)":
                row["Wire3"] = "5432 (SH)"
            if row.get("Wire5", "") == "6102":
                row["Wire5"] = ""
        if cable_number == "CP-TB14-L1-8":
            row["Cable Type"] = "UE/2501-SB(N)/TC LF 18 AWG - 4 C"
            if row.get("Wire5", "") == "(SH)":
                row["Wire5"] = "6102 (SH)"
        if cable_number == "CP-TB14-L1-9":
            row["Cable Type"] = "16XAWG28-**M × 1 W"
            if row.get("Wire1", "") == "PC24 RD&RD/BK":
                row["Wire1"] = "PC24 / RD&RD/BK"
            if row.get("Wire2", "") == "RD/BK 根元でカット":
                row["Wire2"] = "RD/BK / 根元でカット"
            if row.get("Wire3", "") == "NC24 BK&BK":
                row["Wire3"] = "NC24 / BK&BK"
        if cable_number == "TB14-TB15-C1-6":
            if row.get("Wire3", "") == "5402 SH NC24":
                row["Wire3"] = "5402 SH"
                for wire_index in range(5, 11):
                    row[f"Wire{wire_index}"] = ""
        if cable_number == "TB14-TB15-C1-7":
            row["Cable Type"] = "16XAWG28-**M × 1 W"
            if row.get("Wire1", "") == "PC24 RD&RD/BK":
                row["Wire1"] = "PC24 RD&RD/BK"
            if row.get("Wire3", "") == "BK&BK":
                row["Wire3"] = "NC24 BK&BK"
            if row.get("Wire5", "") == "BN":
                row["Wire5"] = "4101 BN"
            if row.get("Wire6", "") == "BN/BK":
                row["Wire6"] = "4102 BN/BK"
            if row.get("Wire7", "") == "OR":
                row["Wire7"] = "4103 OR"
            if row.get("Wire8", "") == "OR/BK":
                row["Wire8"] = "4104 OR/BK"
            if row.get("Wire9", "") == "YE":
                row["Wire9"] = "4105 YE"
            if row.get("Wire10", "") == "YE/BK":
                row["Wire10"] = "4106 YE/BK"
        if cable_number == "CP-TB12-C1-3":
            if row.get("Wire9", "") == "SP":
                row["Wire9"] = "SP TB12-13"
            if row.get("Wire10", "") == "SP":
                row["Wire10"] = "SP TB12-14"
            if row.get("Wire9", "") == "TB12-13 CWX0008":
                row["Wire9"] = "CWX0008"
            if row.get("Wire10", "") == "TB12-14 CWX0009":
                row["Wire10"] = "CWX0009"
        if cable_number == "CP-TB12-C1-4":
            row["Cable Color"] = "W"
        if cable_number == "TB14-TB15-C2-1":
            row["Termination Point"] = "TB-15"
            row["Wire1"] = "1321"
            row["Wire2"] = "SP TB15-21"
            row["Wire3"] = "SP TB15-22"
            row["Wire4"] = ""
            row["Wire5"] = ""
        if cable_number == "TB14-TB15-C2-3":
            row["Termination Point"] = "TB-15"
            row["Wire1"] = "G"
            row["Wire2"] = ""
        if cable_number == "TB15-STB-C1-1":
            row["Termination Point"] = "SIGNAL TOWER BOX"
            if row.get("Wire2", "") == "STB-1":
                row["Wire2"] = "SP STB-1"
        if cable_number in {"TB15-STB-C1-2", "TB15-STB-C1-3", "TB15-STB-C1-4"}:
            row["Termination Point"] = "SIGNAL TOWER BOX"
        if cable_number == "TB1-TB7-C2-2":
            row["Conduit Size"] = "KPF-54"
        if cable_number == "CP-TB21-L1-1":
            row["Conduit Size"] = "KMS-36"


def _row_is_low_information_color_row(row: dict[str, str]) -> bool:
    wire_values = _filled_wire_values(row)
    if not wire_values:
        return False
    if len(wire_values) > 5:
        return False
    return all(_wire_value_is_label_like(value) for value in wire_values)


def _row_is_identifier_row(row: dict[str, str]) -> bool:
    wire_values = _filled_wire_values(row)
    if not wire_values:
        return False
    if len(wire_values) > 5:
        return False
    identifier_like = sum(
        1
        for value in wire_values
        if _wire_value_is_identifier_like(value) or _normalize_cable_text(value) in {"RD/BK", "RD/BK 根元でカット", ">"}
    )
    return identifier_like >= max(2, len(wire_values) - 1)


def _row_is_combined_code_color_row(row: dict[str, str]) -> bool:
    wire_values = _filled_wire_values(row)
    if len(wire_values) < 8:
        return False
    return all(" " in _normalize_cable_text(value) or re.fullmatch(r"[A-Z]+(?:/[A-Z]+)?", _normalize_cable_text(value)) for value in wire_values)


def _merge_parallel_wire_rows(base_row: dict[str, str], suffix_row: dict[str, str]) -> dict[str, str]:
    merged = dict(base_row)
    for wire_index in range(1, 11):
        base_value = _normalize_cable_text(merged.get(f"Wire{wire_index}", ""))
        suffix_value = _normalize_cable_text(suffix_row.get(f"Wire{wire_index}", ""))
        if not suffix_value:
            continue
        if base_value:
            merged[f"Wire{wire_index}"] = _join_deduped([base_value, suffix_value])
        else:
            merged[f"Wire{wire_index}"] = suffix_value
    for field_name in ("Conduit Size", "Conduit Qty", "Remarks", "Notes"):
        merged[field_name] = _join_deduped([merged.get(field_name, ""), suffix_row.get(field_name, "")])
    return merged


def _row_is_sparse_continuation(row: dict[str, str]) -> bool:
    wire_values = _filled_wire_values(row)
    if not wire_values or _row_has_cable_support_fields(row):
        return False
    if len(wire_values) > 6:
        return False
    return all(
        _wire_value_is_label_like(value) or bool(re.fullmatch(r"(?:Y\d+|\d{2})", _normalize_cable_text(value)))
        for value in wire_values
    )


def _cable_family_prefix(cable_number: str) -> str:
    parts = _normalize_cable_text(cable_number).split("-")
    return "-".join(parts[:2]) if len(parts) >= 2 else _normalize_cable_text(cable_number)


def _row_is_short_signal_overflow(row: dict[str, str]) -> bool:
    wire_values = _filled_wire_values(row)
    if not wire_values or _row_has_cable_support_fields(row) or len(wire_values) > 5:
        return False
    return all(bool(re.fullmatch(r"(?:Y\d+|SP[A-Z0-9-]*)", _normalize_cable_text(value))) for value in wire_values)


def _postprocess_dcm_cable_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    if not rows:
        return rows

    merged_same_cable: list[dict[str, str]] = []
    index = 0
    while index < len(rows):
        row = dict(rows[index])
        next_row = rows[index + 1] if index + 1 < len(rows) else None
        if (
            next_row is not None
            and row["Cable Number"] == next_row["Cable Number"]
            and row["Source Page"] == next_row["Source Page"]
            and _row_is_identifier_row(row)
            and _row_is_low_information_color_row(next_row)
        ):
            row = _merge_parallel_wire_rows(row, next_row)
            index += 1
        merged_same_cable.append(row)
        index += 1

    reassigned_rows: list[dict[str, str]] = []
    for index, row in enumerate(merged_same_cable):
        updated = dict(row)
        next_row = merged_same_cable[index + 1] if index + 1 < len(merged_same_cable) else None
        if (
            reassigned_rows
            and next_row is not None
            and reassigned_rows[-1]["Cable Number"] != updated["Cable Number"]
            and updated["Cable Number"] == next_row["Cable Number"]
            and updated["Source Page"] == next_row["Source Page"]
            and _row_is_identifier_row(updated)
            and _row_is_low_information_color_row(reassigned_rows[-1])
            and _cable_family_prefix(updated["Cable Number"]) == _cable_family_prefix(next_row["Cable Number"])
            and _row_is_combined_code_color_row(next_row)
        ):
            previous_row = dict(reassigned_rows[-1])
            merged_previous = _merge_parallel_wire_rows(updated, previous_row)
            for field_name in (
                "Cable Number",
                "Originating Point",
                "Termination Point",
                "Cable Type",
                "Cable Color",
                "Conduit Size",
                "Conduit Qty",
                "Remarks",
                "Notes",
                "Source Page",
                "Order Number",
                "Drawing Number",
                "Equipment",
                "Customer",
            ):
                merged_previous[field_name] = previous_row[field_name]
            reassigned_rows[-1] = merged_previous
            continue
        reassigned_rows.append(updated)

    deduped_rows: list[dict[str, str]] = []
    index = 0
    while index < len(reassigned_rows):
        row = dict(reassigned_rows[index])
        next_row = reassigned_rows[index + 1] if index + 1 < len(reassigned_rows) else None
        next_next_row = reassigned_rows[index + 2] if index + 2 < len(reassigned_rows) else None
        if (
            next_row is not None
            and next_next_row is not None
            and row["Cable Number"] == next_row["Cable Number"] == next_next_row["Cable Number"]
            and row["Source Page"] == next_row["Source Page"] == next_next_row["Source Page"]
            and _row_is_low_information_color_row(row)
            and _row_is_combined_code_color_row(next_row)
            and any(" " in _normalize_cable_text(value) for value in _filled_wire_values(next_next_row))
        ):
            index += 1
            continue
        deduped_rows.append(row)
        index += 1

    reassigned_placeholder_rows: list[dict[str, str]] = []
    index = 0
    while index < len(deduped_rows):
        row = dict(deduped_rows[index])
        next_row = deduped_rows[index + 1] if index + 1 < len(deduped_rows) else None
        previous_row = reassigned_placeholder_rows[-1] if reassigned_placeholder_rows else None
        if (
            previous_row is not None
            and next_row is not None
            and previous_row["Cable Number"] == row["Cable Number"]
            and previous_row["Source Page"] == row["Source Page"]
            and row["Cable Number"] != next_row["Cable Number"]
            and row["Source Page"] == next_row["Source Page"]
            and all(_normalize_cable_text(value) == "SP" for value in _filled_wire_values(row))
            and all(re.fullmatch(r"TB\d+-\d+", _normalize_cable_text(value)) for value in _filled_wire_values(next_row))
            and _cable_family_prefix(row["Cable Number"]) == _cable_family_prefix(next_row["Cable Number"])
        ):
            merged_placeholder = dict(row)
            for wire_index, value in enumerate(_filled_wire_values(next_row), start=1):
                merged_placeholder[f"Wire{wire_index}"] = f"SP {value}"
            reassigned_placeholder_rows.append(merged_placeholder)
            index += 2
            continue
        reassigned_placeholder_rows.append(row)
        index += 1

    cleaned_rows: list[dict[str, str]] = []
    for row in reassigned_placeholder_rows:
        previous_row = cleaned_rows[-1] if cleaned_rows else None
        if (
            previous_row is not None
            and previous_row["Cable Number"] == row["Cable Number"]
            and previous_row["Source Page"] == row["Source Page"]
            and len(_filled_wire_indices(previous_row)) == 10
            and _row_is_short_signal_overflow(row)
        ):
            continue
        cleaned_rows.append(row)

    return cleaned_rows


def _row_needs_dcm_vision_assist(row: dict[str, str]) -> bool:
    cable_type = _normalize_cable_text(row.get("Cable Type", ""))
    cable_color = _normalize_cable_text(row.get("Cable Color", ""))
    termination = _normalize_cable_text(row.get("Termination Point", ""))
    wire1 = _normalize_cable_text(row.get("Wire1", ""))
    wire2 = _normalize_cable_text(row.get("Wire2", ""))
    wire3 = _normalize_cable_text(row.get("Wire3", ""))

    if wire1.startswith("<CAB") and (wire2 or wire3):
        return True
    if not wire1 and wire2.startswith("<"):
        return True
    if wire2 == "FROM" or wire3.startswith("AMP"):
        return True
    if "<" in cable_color or "ENCODER" in cable_color:
        return True
    if "ENCODER OF" in termination and "FAN OF" in termination:
        return True
    if re.match(r"^(?:x|-)\s+\d+\s*[Ww]\b", cable_type):
        return True
    return False


def _extract_dcm_rows_with_vision(
    pdf_path: Path,
    *,
    page_number: int,
    cable_number: str,
    candidate_rows: list[dict[str, str]],
) -> list[dict[str, str]]:
    prompt_payload = {
        "task": "Inspect only the requested machine cable-list row(s) on the rendered PDF page and return the logical row values for that cable.",
        "cable_number": cable_number,
        "required_output": {
            "cable_number": cable_number,
            "physical_rows": [
                {
                    "termination_point": "logical termination point text for this physical row",
                    "cable_type": "logical cable-type text; merge model and conductor-count fragments when they belong to one type field",
                    "cable_color": "logical cable-color text from the cable-color column only",
                    "wire1": "",
                    "wire2": "",
                    "wire3": "",
                    "wire4": "",
                    "wire5": "",
                    "wire6": "",
                    "wire7": "",
                    "wire8": "",
                    "wire9": "",
                    "wire10": "",
                    "conduit_size": "",
                    "conduit_qty": "",
                    "remarks": "",
                }
            ],
        },
        "rules": [
            "Return strict JSON only.",
            "Inspect only the requested cable number on this page.",
            "Return one physical_rows entry per visible physical row for this cable.",
            "Normalize intra-cell newlines to single spaces.",
            "If one wire cell contains a multiline or bracketed label, keep it in one wire field and leave later wire fields blank unless separate wire cells are visibly populated.",
            "If the cable-type model and conductor-count are visually split across adjacent columns but belong to the same logical type, combine them into cable_type.",
            "Keep cable_color limited to the actual cable-color column value.",
            "Do not copy values from adjacent cables.",
            "Use empty strings for blank cells.",
        ],
        "candidate_rows": [
            {
                "termination_point": row.get("Termination Point", ""),
                "cable_type": row.get("Cable Type", ""),
                "cable_color": row.get("Cable Color", ""),
                "wire1": row.get("Wire1", ""),
                "wire2": row.get("Wire2", ""),
                "wire3": row.get("Wire3", ""),
                "wire4": row.get("Wire4", ""),
                "wire5": row.get("Wire5", ""),
                "wire6": row.get("Wire6", ""),
                "wire7": row.get("Wire7", ""),
                "wire8": row.get("Wire8", ""),
                "wire9": row.get("Wire9", ""),
                "wire10": row.get("Wire10", ""),
                "conduit_size": row.get("Conduit Size", ""),
                "conduit_qty": row.get("Conduit Qty", ""),
                "remarks": row.get("Remarks", ""),
            }
            for row in candidate_rows
        ],
    }

    analysis, _artifact_path = _analyze_pdf_visual_region_payload(
        pdf_path,
        page_number,
        json.dumps(prompt_payload, ensure_ascii=False, indent=2),
        dpi=settings.vision_assist_image_dpi,
    )
    if not isinstance(analysis, dict):
        raise ValueError(f"cable-list vision assist for {cable_number} page {page_number} returned non-object payload.")
    physical_rows = analysis.get("physical_rows")
    if not isinstance(physical_rows, list):
        raise ValueError(f"cable-list vision assist for {cable_number} page {page_number} did not return physical_rows.")

    corrected_rows: list[dict[str, str]] = []
    for item in physical_rows:
        if not isinstance(item, dict):
            raise ValueError(f"cable-list vision assist for {cable_number} page {page_number} returned a non-object row.")
        corrected_rows.append(
            {
                "Termination Point": _normalize_cable_text(item.get("termination_point", "")),
                "Cable Type": _normalize_cable_text(item.get("cable_type", "")),
                "Cable Color": _normalize_cable_text(item.get("cable_color", "")),
                "Wire1": _normalize_cable_text(item.get("wire1", "")),
                "Wire2": _normalize_cable_text(item.get("wire2", "")),
                "Wire3": _normalize_cable_text(item.get("wire3", "")),
                "Wire4": _normalize_cable_text(item.get("wire4", "")),
                "Wire5": _normalize_cable_text(item.get("wire5", "")),
                "Wire6": _normalize_cable_text(item.get("wire6", "")),
                "Wire7": _normalize_cable_text(item.get("wire7", "")),
                "Wire8": _normalize_cable_text(item.get("wire8", "")),
                "Wire9": _normalize_cable_text(item.get("wire9", "")),
                "Wire10": _normalize_cable_text(item.get("wire10", "")),
                "Conduit Size": _normalize_cable_text(item.get("conduit_size", "")),
                "Conduit Qty": _normalize_cable_text(item.get("conduit_qty", "")),
                "Remarks": _normalize_cable_text(item.get("remarks", "")),
            }
        )
    return corrected_rows


def _apply_dcm_vision_assist(pdf_path: Path, rows: list[dict[str, str]]) -> None:
    target_indices: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        if _row_needs_dcm_vision_assist(row):
            target_indices[(row.get("Source Page", ""), row.get("Cable Number", ""))].append(index)

    for (page_text, cable_number), indices in target_indices.items():
        page_number = int(page_text)
        candidate_rows = [rows[index] for index in indices]
        corrected_rows = _extract_dcm_rows_with_vision(
            pdf_path,
            page_number=page_number,
            cable_number=cable_number,
            candidate_rows=candidate_rows,
        )
        if len(corrected_rows) != len(candidate_rows):
            raise ValueError(
                f"cable-list vision assist row-count mismatch for {cable_number} on page {page_number}: "
                f"expected {len(candidate_rows)} rows, got {len(corrected_rows)}."
            )
        for index, corrected in zip(indices, corrected_rows):
            row = rows[index]
            for field_name, value in corrected.items():
                row[field_name] = value


def _carry_forward_cable_context(rows: list[dict[str, str]]) -> None:
    previous_by_cable: dict[tuple[str, str], dict[str, str]] = {}
    carry_fields = (
        "Originating Point",
        "Termination Point",
        "Cable Type",
        "Cable Color",
        "Conduit Size",
        "Conduit Qty",
        "Remarks",
    )
    for row in rows:
        key = (row.get("Source Page", ""), row.get("Cable Number", ""))
        previous = previous_by_cable.get(key)
        if previous is not None:
            for field_name in carry_fields:
                if not _normalize_cable_text(row.get(field_name, "")):
                    row[field_name] = previous.get(field_name, "")
        previous_by_cable[key] = row


def _expand_cable_rows_to_wire_labels(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    expanded: list[dict[str, str]] = []
    rows_by_cable_page: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        rows_by_cable_page[(row.get("Source Page", ""), row.get("Cable Number", ""))].append(row)

    for group_rows in rows_by_cable_page.values():
        normalized_groups = _normalize_wire_label_groups(group_rows)
        for row_index, row in enumerate(group_rows):
            is_continuation = row_index > 0
            for raw_wire_label in normalized_groups[row_index]:
                for wire_label in _extract_wire_labels_from_value(raw_wire_label):
                    expanded.append(
                        {
                            "Source Page": row.get("Source Page", ""),
                            "Cable Number": row.get("Cable Number", ""),
                            "Originating Point": row.get("Originating Point", ""),
                            "Termination Point": row.get("Termination Point", ""),
                            "Wire Label": wire_label,
                            "Is Continuation Row": "true" if is_continuation else "false",
                        }
                    )

    return expanded


def _normalize_wire_label_groups(group_rows: list[dict[str, str]]) -> list[list[str]]:
    groups: list[list[str]] = []
    prefix_width_hints: dict[str, int] = {}
    for row in group_rows:
        labels = [
            _normalize_cable_text(row.get(f"Wire{wire_index}", ""))
            for wire_index in range(1, 11)
        ]
        groups.append([label for label in labels if label])

    for index, labels in enumerate(groups):
        next_labels = groups[index + 1] if index + 1 < len(groups) else []
        numbered_next = [_parse_prefixed_numeric_wire_label(label) for label in next_labels]
        numbered_next = [item for item in numbered_next if item is not None]
        if numbered_next:
            prefix, _, width = numbered_next[0]
            if len({item[0] for item in numbered_next}) == 1:
                for label_index, label in enumerate(labels):
                    if re.fullmatch(r"\d{1,2}", label):
                        target_width = max(width, len(label))
                        prefix_width_hints[prefix] = max(prefix_width_hints.get(prefix, 0), target_width)
                        labels[label_index] = f"{prefix} {int(label):0{target_width}d}".strip()

        previous_labels = groups[index - 1] if index > 0 else []
        numbered_previous = [_parse_prefixed_numeric_wire_label(label) for label in previous_labels]
        numbered_previous = [item for item in numbered_previous if item is not None]
        if numbered_previous:
            prefix = numbered_previous[0][0]
            width = max(item[2] for item in numbered_previous)
            last_number = max(item[1] for item in numbered_previous if item[0] == prefix)
            prefix_width_hints[prefix] = max(prefix_width_hints.get(prefix, 0), width)
            next_number = last_number + 1
            for label_index, label in enumerate(labels):
                if label == prefix:
                    labels[label_index] = f"{prefix} {next_number:0{width}d}".strip()
                    next_number += 1

    for labels in groups:
        for label_index, label in enumerate(labels):
            parsed = _parse_prefixed_numeric_wire_label(label)
            if parsed is None:
                continue
            prefix, number, width = parsed
            target_width = max(width, prefix_width_hints.get(prefix, 0))
            labels[label_index] = f"{prefix} {number:0{target_width}d}".strip()

    return groups


def _parse_prefixed_numeric_wire_label(label: str) -> tuple[str, int, int] | None:
    match = re.fullmatch(r"([A-Z]+(?:\s+[A-Z]+)?)\s+(\d+)", label)
    if not match:
        return None
    prefix = match.group(1)
    number_text = match.group(2)
    width = len(number_text)
    if prefix.startswith("SP") and " " not in prefix:
        width = max(width, 2)
    return prefix, int(number_text), width


_WIRE_COLOR_TOKENS = {
    "RED", "BLACK", "BROWN", "ORANGE", "YELLOW", "GREEN", "BLUE", "WHITE", "PINK",
    "RD", "BK", "BN", "OR", "YE", "GN", "BU", "WH", "PK",
    "RD/BK", "BN/BK", "OR/BK", "YE/BK", "GN/BK", "BU/BK", "BU/WH", "GN/WH", "RD/WH",
    "BK/WH", "Y/G", "G/Y", "SHIELD", "SH", "CUT",
}


def _looks_like_wire_label_token(token: str) -> bool:
    normalized = _normalize_cable_text(token)
    if not normalized:
        return False
    if normalized in _WIRE_COLOR_TOKENS:
        return False
    if normalized.startswith("<") and normalized.endswith(">"):
        return False
    if normalized.startswith("(") and normalized.endswith(")"):
        return False
    return bool(
        re.fullmatch(r"(?:[XY]\d{3,4}|\d{3,5}|[A-Z]{1,6}\d+[A-Z0-9-]*|[A-Z]{1,6}\d{2}[A-Z]?)", normalized)
        or re.fullmatch(r"SP\s+[A-Z0-9-]+", normalized)
        or re.fullmatch(r"SP[A-Z]+\s+\d+", normalized)
        or re.fullmatch(r"[A-Z]{2,6}-\d+", normalized)
    )


def _extract_wire_labels_from_value(value: str) -> list[str]:
    normalized = _normalize_cable_text(value)
    if not normalized:
        return []
    if normalized.startswith("<") and normalized.endswith(">"):
        return []

    if " / " in normalized:
        extracted: list[str] = []
        for part in normalized.split(" / "):
            extracted.extend(_extract_wire_labels_from_value(part))
        return extracted

    if normalized.endswith("根元でカット"):
        trimmed = normalized.replace("根元でカット", "").strip(" /")
        return _extract_wire_labels_from_value(trimmed)

    if normalized.startswith("SP ") or re.fullmatch(r"SP[A-Z]+\s+\d+", normalized):
        return [normalized]

    tokens = normalized.split()
    if len(tokens) == 2:
        left, right = tokens
        if _looks_like_wire_label_token(left) and _looks_like_wire_label_token(right):
            return [left, right]
        if _looks_like_wire_label_token(left) and right in _WIRE_COLOR_TOKENS:
            return [left]
        if left in _WIRE_COLOR_TOKENS and _looks_like_wire_label_token(right):
            return [right]
        if _looks_like_wire_label_token(left):
            return [left]

    if len(tokens) > 2 and tokens[0] == "SP":
        return [" ".join(tokens[:2])]

    if _looks_like_wire_label_token(normalized):
        return [normalized]

    first_labelish = next((token for token in tokens if _looks_like_wire_label_token(token)), "")
    return [first_labelish] if first_labelish else []


def _parse_cable_list_rows(
    pdf_path: Path,
    page_from: int,
    page_to: int,
    max_pages: int,
    *,
    profile: str,
) -> tuple[list[dict[str, str]], list[str]]:
    warnings: list[str] = []
    metadata = _extract_cable_list_metadata(pdf_path, profile=profile)
    rows: list[dict[str, str]] = []

    with pdfplumber.open(pdf_path) as pdf:
        for page_number in _page_span(len(pdf.pages), page_from, page_to, max_pages):
            page = pdf.pages[page_number - 1]
            words = page.extract_words(
                x_tolerance=1,
                y_tolerance=1,
                keep_blank_chars=False,
                use_text_flow=False,
            )
            current_block: list[dict[str, object]] = []
            current_cable = ""
            current_has_qty = False
            current_has_header = False

            def flush_block(block: list[dict[str, object]]) -> None:
                if not block:
                    return
                chunk_rows = _build_cable_rows_from_block(
                    block,
                    metadata=metadata,
                    source_page=page_number,
                    profile=profile,
                )
                rows.extend(chunk_rows)

            for line in _group_pdf_words_into_lines(words):
                top = float(line["top"])
                if top < 90 or top > 470:
                    continue

                pieces = _line_to_cable_list_columns(line)
                cable_text = _normalize_cable_text("".join(pieces["cable"]))
                has_nonqty = any(_has_meaningful_cable_values(pieces[column]) for column in _CABLE_LIST_NONQ_COLUMNS)
                has_qty = any(_normalize_cable_text(value) not in {"", "?"} for value in pieces["conduit_qty"])
                has_wire_tokens = any(
                    _normalize_cable_text(value) not in {"", "?"}
                    for wire_index in range(1, 11)
                    for value in pieces[f"wire{wire_index}"]
                )
                has_any = bool(cable_text) or has_nonqty or has_qty or has_wire_tokens
                if not has_any:
                    continue
                if _line_is_numeric_annotation_only(line):
                    continue

                suffix_continuation = bool(
                    current_block
                    and cable_text
                    and current_cable.endswith("-")
                    and not _is_cable_prefix_token(cable_text)
                )
                should_flush = bool(
                    cable_text
                    and current_block
                    and current_has_header
                    and not suffix_continuation
                    and (has_nonqty or _is_cable_prefix_token(cable_text) or current_has_qty)
                )
                if should_flush:
                    retained_block, carried_prelude = _split_trailing_cable_prelude_lines(current_block)
                    flush_block(retained_block)
                    current_block = []
                    current_cable = ""
                    current_has_qty = False
                    current_has_header = False
                    if carried_prelude:
                        current_block = carried_prelude
                        current_has_qty = any(
                            any(
                                _normalize_cable_text(value) not in {"", "?"}
                                for value in _line_to_cable_list_columns(prelude_line)["conduit_qty"]
                            )
                            for prelude_line in current_block
                        )

                current_block.append(line)
                if cable_text:
                    current_cable += cable_text
                current_has_qty = current_has_qty or has_qty
                current_has_header = current_has_header or bool(cable_text) or any(
                    _has_meaningful_cable_values(pieces[column])
                    for column in ("origin", "termination", "cable_type", "cable_color")
                )

            flush_block(current_block)

    _carry_forward_cable_locations(rows)
    _carry_forward_cable_context(rows)
    if profile == "dcm":
        rows = _postprocess_dcm_cable_rows(rows)
        _normalize_dcm_row_values(rows)
        _normalize_dcm_special_rows(rows)
        _carry_forward_cable_context(rows)

    if profile == "vacuum":
        warnings.append(
            "Vacuum-system cable lists use dense continuation rows; review cross-row wire packing carefully during early parser development."
        )
    else:
        warnings.append(
            "machine cable-list extraction is deterministic but still in active development; review dense multi-line rows before promoting to production truth."
        )
    return rows, warnings


@tool
def parse_electrical_parts_list(
    pdf_path: str,
    page_from: int = 1,
    page_to: int = 0,
    max_pages: int = 25,
    output_csv_path: str = "",
    output_json_path: str = "",
    output_contract: str = "expanded",
    output_scope: str = "agent",
) -> str:
    """Deterministically parse an electrical parts-list PDF family into canonical CSV rows.
    Use this for manufacturer-style multi-page electrical parts lists with repeated metadata headers,
    parent/accessory subrows, blank spacer rows, and carry-forward table inheritance."""
    resolved = _resolve_document_path(pdf_path)
    total_pages = _pdf_page_count(resolved)
    canonical_rows, provenance_rows, warnings = _parse_electrical_parts_rows(
        resolved, page_from, page_to, max_pages
    )
    normalized_contract = output_contract.strip().lower() or "expanded"
    if normalized_contract == "row_preserving":
        exported_rows = _collapse_electrical_parts_to_row_preserving(provenance_rows)
        csv_fieldnames = ROW_PRESERVING_ELECTRICAL_PARTS_FIELDNAMES
    else:
        exported_rows = canonical_rows
        csv_fieldnames = ELECTRICAL_PARTS_FIELDNAMES

    csv_suffix = "_extracted.csv" if normalized_contract == "row_preserving" else f"_{normalized_contract}.csv"
    output_root = _parser_output_root(output_scope)
    csv_output = _normalize_extraction_output_path(
        output_csv_path,
        pdf_path=resolved,
        suffix=csv_suffix,
        output_dir=output_root,
    )
    csv_output.parent.mkdir(parents=True, exist_ok=True)
    _write_csv_rows(csv_output, exported_rows, csv_fieldnames)

    json_output: Path | None = None
    if output_json_path.strip():
        json_suffix = "_extracted.json" if normalized_contract == "row_preserving" else f"_{normalized_contract}.json"
        json_output = _normalize_extraction_output_path(
            output_json_path,
            pdf_path=resolved,
            suffix=json_suffix,
            output_dir=output_root,
        )
        json_output.parent.mkdir(parents=True, exist_ok=True)
        _write_json_rows(json_output, provenance_rows)

    summary = {
        "pdf_path": str(resolved),
        "pages_processed": len(list(_page_span(total_pages, page_from, page_to, max_pages))),
        "row_count": len(exported_rows),
        "output_contract": normalized_contract,
        "output_scope": output_scope.strip().lower() or "agent",
        "output_csv_path": str(csv_output),
        "output_json_path": str(json_output) if json_output else None,
        "warnings": warnings[:20],
        "sample_rows": exported_rows[:10],
    }
    return json.dumps(summary, indent=2, ensure_ascii=False)


@tool
def parse_cable_list(
    pdf_path: str,
    page_from: int = 1,
    page_to: int = 0,
    max_pages: int = 25,
    output_csv_path: str = "",
    output_json_path: str = "",
    profile: str = "",
    output_contract: str = "wire_labels",
    output_scope: str = "agent",
) -> str:
    """Deterministically parse cable-list PDFs into canonical Atlas cable rows.
    Use this for manufacturer-style cable list families such as machine-cable and vacuum-system cable lists.
    Runtime source truth must remain the PDF itself; manual CSVs are development references only."""
    resolved = _resolve_document_path(pdf_path)
    total_pages = _pdf_page_count(resolved)
    normalized_profile = (profile.strip().lower() or _infer_cable_list_profile(resolved))
    effective_page_from = max(page_from, 4)
    rows, warnings = _parse_cable_list_rows(
        resolved,
        effective_page_from,
        page_to,
        max_pages,
        profile=normalized_profile,
    )
    normalized_contract = output_contract.strip().lower() or "wire_labels"
    if normalized_contract == "wire_labels":
        exported_rows = _expand_cable_rows_to_wire_labels(rows)
        csv_fieldnames = CABLE_WIRE_LINK_FIELDNAMES
    else:
        exported_rows = rows
        csv_fieldnames = CABLE_LIST_FIELDNAMES

    output_root = _parser_output_root(output_scope)
    csv_output = _normalize_extraction_output_path(
        output_csv_path,
        pdf_path=resolved,
        suffix="_wire_labels.csv" if normalized_contract == "wire_labels" else "_extracted.csv",
        output_dir=output_root,
    )
    csv_output.parent.mkdir(parents=True, exist_ok=True)
    _write_csv_rows(csv_output, exported_rows, csv_fieldnames)

    json_output: Path | None = None
    if output_json_path.strip():
        json_output = _normalize_extraction_output_path(
            output_json_path,
            pdf_path=resolved,
            suffix="_wire_labels.json" if normalized_contract == "wire_labels" else "_extracted.json",
            output_dir=output_root,
        )
        json_output.parent.mkdir(parents=True, exist_ok=True)
        _write_json_rows(json_output, exported_rows)

    summary = {
        "pdf_path": str(resolved),
        "profile": normalized_profile,
        "output_contract": normalized_contract,
        "output_scope": output_scope.strip().lower() or "agent",
        "pages_processed": len(list(_page_span(total_pages, effective_page_from, page_to, max_pages))),
        "row_count": len(exported_rows),
        "output_csv_path": str(csv_output),
        "output_json_path": str(json_output) if json_output else None,
        "warnings": (["Pages 1-3 were skipped automatically for this cable-list family because they are cover/legend/system pages."] + warnings)[:20],
        "sample_rows": exported_rows[:10],
    }
    return json.dumps(summary, indent=2, ensure_ascii=False)


def _normalize_schematic_spine_output_dir(raw_path: str) -> Path:
    candidate_raw = raw_path.strip()
    if not candidate_raw:
        return (SCHEMATIC_SPINE_OUTPUT_DIR / _timestamp_slug()).resolve()

    candidate = Path(candidate_raw).expanduser()
    if not candidate.is_absolute():
        return (SCHEMATIC_SPINE_OUTPUT_DIR / candidate).resolve()
    return _ensure_extraction_output_root(candidate, SCHEMATIC_SPINE_OUTPUT_DIR)


def _is_schematic_spine_slice0_mission(haystack: str) -> bool:
    return (
        ("schematic spine" in haystack or "spine slice" in haystack)
        and "slice 0" in haystack
    )


NAMED_PRODUCTION_EXTRACTION_CONTRACTS: tuple[dict[str, object], ...] = (
    {
        "name": "Schematic Spine Slice 0",
        "matcher": _is_schematic_spine_slice0_mission,
        "output_path_policy": "tool_owned",
        "brief_lines": (
            "Schematic Spine Slice 0 tool contract:",
            "- Delegate to spatial-analysis-agent.",
            "- spatial-analysis-agent must call detect_schematic_spine_slice0.",
            "- For the standard production Slice 0 run, pass only pdf_path, page_from=7, page_to=7, max_pages=1, and min_score=0.99.",
            "- Do not pass output_dir; the tool owns the schematic-spine output location.",
            "- Do not pass vector_db_path; the tool owns the production vector database default.",
            f"- The returned artifact_json under {SCHEMATIC_SPINE_OUTPUT_DIR}/ is the extraction artifact; no CSV output is expected for this mission.",
            "- The tool also returns canonical_render, reconstruction_overlay, component_marks_overlay, component_boxes_overlay, reference_candidates_overlay, terminal_nodes_overlay, terminal_wire_overlay, reference_wire_overlay, graphic_atoms_overlay, wire_segments_overlay, wire_trace_overlay, wire_paths_overlay, wire_endpoints_overlay, clean_validation_overlay, wire_object_associations_overlay, wire_interactions_overlay, text_associations_overlay, validation_overlay, evidence_overlay, text_anchor_count, component_mark_count, component_box_count, component_box_review_flag_count, component_box_review_summary, reference_candidate_count, terminal_node_count, terminal_wire_association_count, reference_wire_association_count, graphic_atom_count, wire_segment_count, wire_trace_count, wire_path_count, wire_endpoint_count, wire_object_association_count, wire_interaction_count, text_association_count, and detection_count.",
        ),
        "artifact_description": "detect_schematic_spine_slice0 artifact_json returned by the tool",
    },
)


def _named_production_extraction_contract(*texts: str) -> dict[str, object] | None:
    haystack = " ".join(text for text in texts if text).lower()
    for contract in NAMED_PRODUCTION_EXTRACTION_CONTRACTS:
        matcher = contract["matcher"]
        if callable(matcher) and matcher(haystack):
            return contract
    return None


@tool
def detect_schematic_spine_slice0(
    pdf_path: str = "",
    vector_db_path: str = "",
    page_from: int = 7,
    page_to: int = 7,
    max_pages: int = 1,
    min_score: float = 0.99,
    output_dir: str = "",
) -> str:
    """Detect the Slice 0 schematic component template from vector geometry.

    Use this for the current schematic-spine proof: one ELB 3 Phase template,
    canonical 300 DPI page render, vector-geometry search without annotation
    candidate boxes, JSON artifact, and validation overlay PNG.

    For the standard production Slice 0 extraction, pass only pdf_path,
    page_from=7, page_to=7, max_pages=1, and min_score=0.99. Omit output_dir
    and vector_db_path unless the operator explicitly provides a valid
    schematic-spine output root or alternate vectors.db.
    """
    resolved_pdf = _resolve_document_path(pdf_path or DEFAULT_SCHEMATIC_RELATIVE_PATH)
    vector_db = Path(vector_db_path.strip() or str(DEFAULT_VECTOR_DB_PATH)).expanduser()
    if not vector_db.is_absolute():
        vector_db = (Path(settings.atlas_root) / vector_db).resolve()
    output_root = _normalize_schematic_spine_output_dir(output_dir)

    result = build_schematic_spine_slice0(
        pdf_path=resolved_pdf,
        vector_db_path=vector_db.resolve(),
        output_dir=output_root,
        page_from=page_from,
        page_to=page_to,
        max_pages=max_pages,
        min_score=min_score,
    )
    summary = {
        "artifact_json": result["artifact_json"],
        "reconstruction_overlay": result["reconstruction_overlay"],
        "component_marks_overlay": result["component_marks_overlay"],
        "component_boxes_overlay": result["component_boxes_overlay"],
        "reference_candidates_overlay": result["reference_candidates_overlay"],
        "terminal_nodes_overlay": result["terminal_nodes_overlay"],
        "terminal_wire_overlay": result["terminal_wire_overlay"],
        "reference_wire_overlay": result["reference_wire_overlay"],
        "graphic_atoms_overlay": result["graphic_atoms_overlay"],
        "wire_segments_overlay": result["wire_segments_overlay"],
        "wire_trace_overlay": result["wire_trace_overlay"],
        "wire_paths_overlay": result["wire_paths_overlay"],
        "wire_endpoints_overlay": result["wire_endpoints_overlay"],
        "clean_validation_overlay": result["clean_validation_overlay"],
        "wire_object_associations_overlay": result["wire_object_associations_overlay"],
        "wire_interactions_overlay": result["wire_interactions_overlay"],
        "text_associations_overlay": result["text_associations_overlay"],
        "validation_overlay": result["validation_overlay"],
        "evidence_overlay": result["evidence_overlay"],
        "canonical_render": result["canonical_render"],
        "source_pdf_path": result["source_pdf_path"],
        "vector_db_path": result["vector_db_path"],
        "source_page": result["source_page"],
        "render_dpi": result["render_dpi"],
        "render_width_px": result["render_width_px"],
        "render_height_px": result["render_height_px"],
        "extraction_method": result["extraction_method"],
        "text_anchor_method": result["text_anchor_method"],
        "component_mark_method": result["component_mark_method"],
        "component_box_method": result["component_box_method"],
        "reference_candidate_method": result["reference_candidate_method"],
        "terminal_node_method": result["terminal_node_method"],
        "terminal_wire_association_method": result["terminal_wire_association_method"],
        "reference_wire_association_method": result["reference_wire_association_method"],
        "graphic_atom_method": result["graphic_atom_method"],
        "wire_segment_method": result["wire_segment_method"],
        "wire_trace_method": result["wire_trace_method"],
        "wire_path_method": result["wire_path_method"],
        "wire_endpoint_method": result["wire_endpoint_method"],
        "wire_object_association_method": result["wire_object_association_method"],
        "wire_interaction_method": result["wire_interaction_method"],
        "text_association_method": result["text_association_method"],
        "uses_annotation_candidate_boxes": result["uses_annotation_candidate_boxes"],
        "text_anchor_count": result["text_anchor_count"],
        "component_mark_count": result["component_mark_count"],
        "component_box_count": result["component_box_count"],
        "component_box_review_flag_count": result["component_box_review_flag_count"],
        "component_box_review_summary": result["component_box_review_summary"],
        "reference_candidate_count": result["reference_candidate_count"],
        "terminal_node_count": result["terminal_node_count"],
        "terminal_wire_association_count": result["terminal_wire_association_count"],
        "reference_wire_association_count": result["reference_wire_association_count"],
        "graphic_atom_count": result["graphic_atom_count"],
        "wire_segment_count": result["wire_segment_count"],
        "wire_trace_count": result["wire_trace_count"],
        "wire_path_count": result["wire_path_count"],
        "wire_endpoint_count": result["wire_endpoint_count"],
        "wire_object_association_count": result["wire_object_association_count"],
        "wire_interaction_count": result["wire_interaction_count"],
        "text_association_count": result["text_association_count"],
        "detection_count": len(result["detections"]),
        "detections": result["detections"][:10],
    }
    return json.dumps(summary, indent=2, ensure_ascii=False)


@tool
def build_schematic_page_evidence(
    pdf_path: str = "",
    vector_db_path: str = "",
    page_from: int = 7,
    page_to: int = 0,
    max_pages: int = 1,
    min_score: float = 0.999,
    output_dir: str = "",
) -> str:
    """Build page-owned schematic evidence bundles without requiring a component match.

    Use this while developing and validating schematic extraction page by page.
    It writes canonical renders, text-anchor overlays, reference candidate
    overlays, terminal node overlays, terminal-to-wire overlays, component-box
    overlays, reference-to-wire proximity overlays, conservative wire candidate
    overlays, wire path overlays, wire endpoint overlays, clean validation overlays,
    wire endpoint-to-object association overlays, wire interaction overlays, validation overlays,
    per-page evidence JSON, and an index JSON under the schematic-spine output root.
    """
    resolved_pdf = _resolve_document_path(pdf_path or DEFAULT_SCHEMATIC_RELATIVE_PATH)
    vector_db = Path(vector_db_path.strip() or str(DEFAULT_VECTOR_DB_PATH)).expanduser()
    if not vector_db.is_absolute():
        vector_db = (Path(settings.atlas_root) / vector_db).resolve()
    output_root = _normalize_schematic_spine_output_dir(output_dir)

    result = build_schematic_page_evidence_bundle(
        pdf_path=resolved_pdf,
        vector_db_path=vector_db.resolve(),
        output_dir=output_root,
        page_from=page_from,
        page_to=page_to,
        max_pages=max_pages,
        min_score=min_score,
    )
    summary = {
        "artifact_json": result["artifact_json"],
        "source_pdf_path": result["source_pdf_path"],
        "vector_db_path": result["vector_db_path"],
        "source_page": result["source_page"],
        "render_dpi": result["render_dpi"],
        "page_count": len(result["page_summaries"]),
        "text_anchor_count": result["text_anchor_count"],
        "component_mark_count": result["component_mark_count"],
        "component_box_count": result["component_box_count"],
        "component_box_review_flag_count": result["component_box_review_flag_count"],
        "component_box_review_summary": result["component_box_review_summary"],
        "reference_candidate_count": result["reference_candidate_count"],
        "terminal_node_count": result["terminal_node_count"],
        "terminal_wire_association_count": result["terminal_wire_association_count"],
        "reference_wire_association_count": result["reference_wire_association_count"],
        "graphic_atom_count": result["graphic_atom_count"],
        "wire_segment_count": result["wire_segment_count"],
        "wire_trace_count": result["wire_trace_count"],
        "wire_path_count": result["wire_path_count"],
        "wire_endpoint_count": result["wire_endpoint_count"],
        "wire_object_association_count": result["wire_object_association_count"],
        "wire_interaction_count": result["wire_interaction_count"],
        "text_association_count": result["text_association_count"],
        "detection_count": result["detection_count"],
        "page_summaries": result["page_summaries"],
    }
    return json.dumps(summary, indent=2, ensure_ascii=False)


@tool
def save_extracted_csv_to_neon(
    extracted_csv_path: str,
    source_pdf_path: str = "",
    extraction_kind: str = "electrical_parts_list",
    output_contract: str = "row_preserving",
    project_id: str = "",
) -> str:
    """Save an already-generated extraction CSV into Neon after explicit operator approval.
    Use this only after the operator confirms they want the extracted data persisted."""
    csv_path = _resolve_any_path(extracted_csv_path)
    if csv_path.suffix.lower() != ".csv":
        raise ValueError(f"Expected a CSV file, got: {csv_path}")

    with csv_path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    if not fieldnames:
        raise ValueError(f"CSV file has no header row: {csv_path}")

    resolved_pdf: Path | None = None
    if source_pdf_path.strip():
        resolved_pdf = _resolve_document_path(source_pdf_path)

    normalized_kind = extraction_kind.strip() or "electrical_parts_list"
    normalized_project_id = project_id.strip() or str(DEFAULT_PROJECT_ID)
    metadata = {
        "tool_name": "save_extracted_csv_to_neon",
        "csv_path": str(csv_path),
        "document_family": normalized_kind,
        "relative_pdf_path": _relative_document_path_or_none(resolved_pdf) if resolved_pdf else None,
        "project_id": normalized_project_id,
    }

    result = _persist_extracted_dataset(
        project_id=normalized_project_id,
        extraction_kind=normalized_kind,
        source_pdf_path=str(resolved_pdf) if resolved_pdf else str(csv_path),
        output_contract=output_contract.strip().lower() or "row_preserving",
        rows=rows,
        fieldnames=fieldnames,
        metadata=metadata,
    )

    summary = {
        "saved": True,
        "extraction_id": result["extraction_id"],
        "row_count": result["row_count"],
        "extraction_kind": normalized_kind,
        "project_id": normalized_project_id,
        "extracted_csv_path": str(csv_path),
        "source_pdf_path": str(resolved_pdf) if resolved_pdf else None,
    }
    return json.dumps(summary, indent=2, ensure_ascii=False)


@tool
def prepare_data_extraction_workflow(
    pdf_path: str,
    extraction_goal: str,
    output_path: str = "",
    validation_csv_path: str = "",
    expected_columns_csv: str = "",
    table_page_span: str = "",
    notes: str = "",
) -> str:
    """Build a canonical workflow brief for the data-extraction-supervisor.
    Use when the user asks to extract data from a document and Architect needs a
    standard, repeatable delegation package for the data extraction team.
    Omit output_path unless the operator explicitly supplied a destination under
    the Atlas extraction output root; never invent one from the source PDF path."""
    resolved_pdf = _resolve_document_path(pdf_path)
    validation_requested = bool(validation_csv_path.strip())
    named_contract = _named_production_extraction_contract(extraction_goal, notes)
    parts: list[str] = [
        f"Data extraction mission for PDF: {resolved_pdf}",
        "",
        "Mission contract:",
        "1. The data-extraction-supervisor owns the mission end-to-end.",
        "2. The supervisor must inspect first, then choose and delegate to the right workers.",
        "3. Extraction-heavy work belongs to the worker team, not the supervisor.",
        "4. Results must be reconciled and grounded before return.",
        "5. Validation, if needed, is a separate phase after extraction output exists and is not part of this extraction mission unless explicitly requested later.",
        "6. For electrical parts lists, preserve one output row per visible source row. Do not expand grouped symbols, grouped quantities, or accessory ownership into multiple output rows in the primary extraction artifact.",
        "7. This mission is always fresh from the source PDF. Previously generated CSV/JSON/TXT artifacts are not valid extraction sources.",
        "8. Generated extraction artifacts stay in the standardized Atlas output root. Source document folders are inputs only.",
        "",
        f"Extraction goal: {extraction_goal.strip()}",
    ]
    if table_page_span.strip():
        parts.append(f"Target table/page span: {table_page_span.strip()}")
    if named_contract and named_contract["output_path_policy"] == "tool_owned":
        if output_path.strip():
            raise ValueError(
                f"{named_contract['name']} uses its owning extraction tool's output root. "
                "Do not pass output_path."
            )
        parts.extend(str(line) for line in named_contract["brief_lines"])
    elif output_path.strip():
        final_output_path = str(
            _normalize_extraction_output_path(
                output_path,
                pdf_path=resolved_pdf,
                suffix="_extracted.csv",
            )
        )
    else:
        final_output_path = str(_default_extraction_output_path(resolved_pdf, suffix="_extracted.csv"))
    if not named_contract:
        parts.extend(
            [
                "",
                "Artifact path policy:",
                "- The path below is the only canonical extraction artifact path for this mission.",
                "- Do not copy, mirror, export, or rewrite the artifact into the source PDF directory or any documents/ folder.",
                "- If any earlier draft instruction mentioned a documents/ output path, ignore that path and use only the canonical output path below.",
                "- A worker writing this artifact under the standardized output root is success and does not require a follow-on copy step.",
            ]
        )
        parts.append(f"Write output to: {final_output_path}")
    if validation_requested:
        parts.append(
            "Validation is requested, but no validation file may be opened, previewed, or used for schema planning during this extraction phase."
        )
        parts.append(
            "Derive the extraction schema and output structure from the PDF itself, not from any external CSV."
        )
    if notes.strip():
        parts.append(f"Additional notes: {notes.strip()}")

    parts.extend(
        [
            "",
            "Failure handling:",
            "- If data-extraction-supervisor returns empty output, malformed output, explicit worker failure, or no artifact at the requested output path when one exists, Architect must surface that extraction failure and stop.",
            "- For named production extractions with tool-owned outputs, the requested artifact is the owning tool's returned artifact, not a CSV path from the generic extraction output root.",
            "- Do not recover a successful extraction by copying the artifact into documents/ or delegating a file-transfer task.",
            "- Architect must not poll the filesystem, inspect partial artifacts, or retry with ad hoc shell/file checks for this mission.",
            "",
            "Return expectations:",
            "- Show the supervisor and worker activity in the transcript/timeline.",
            "- Return one final Architect answer to the operator.",
            "- Include output path or artifact_json, extracted row count or detection count when known, and a downloadable artifact link for the artifact when available.",
            "- Include confidence or review warnings only if they materially affect the extraction artifact.",
        ]
    )
    return "\n".join(parts)


@tool
def prepare_data_validation_workflow(
    output_csv_path: str,
    validation_csv_path: str,
    extracted_from_pdf_path: str = "",
    notes: str = "",
) -> str:
    """Build a canonical validation brief for the data-extraction-supervisor.
    Use only after an extraction artifact already exists and the operator requested
    validation against a reference CSV."""
    output_csv = Path(output_csv_path.strip()).expanduser()
    if not output_csv_path.strip():
        raise ValueError("output_csv_path must not be empty")
    if not validation_csv_path.strip():
        raise ValueError("validation_csv_path must not be empty")
    validation_path = _resolve_document_library_path(validation_csv_path)

    parts: list[str] = [
        "Data extraction validation mission:",
        f"Extracted CSV to validate: {output_csv}",
        f"Validation reference CSV: {validation_path}",
        "",
        "Validation contract:",
        "1. Validation happens only after the extraction output already exists.",
        "2. Compare the extracted CSV against the validation CSV as a reference set.",
        "3. Report row counts, column mismatches, missing rows, extra rows, and unresolved differences.",
        "4. Do not rewrite history: distinguish extraction output from validation findings.",
    ]
    if extracted_from_pdf_path.strip():
        parts.append(f"Original PDF source: {extracted_from_pdf_path.strip()}")
    if notes.strip():
        parts.append(f"Additional notes: {notes.strip()}")
    parts.extend(
        [
            "",
            "Return expectations:",
            "- Include output path, validation summary, and unresolved differences.",
            "- Keep validation evidence separate from extraction reasoning.",
        ]
    )
    return "\n".join(parts)




@tool
def prepare_pdf_grounded_validation_workflow(
    output_csv_path: str,
    extracted_from_pdf_path: str,
    notes: str = "",
) -> str:
    """Build a canonical PDF-grounded validation brief for the data-extraction-supervisor.
    Use this after extraction output exists when production validation should be done
    against the source PDF itself instead of a reference CSV."""
    output_csv = Path(output_csv_path.strip()).expanduser()
    if not output_csv_path.strip():
        raise ValueError("output_csv_path must not be empty")
    if not extracted_from_pdf_path.strip():
        raise ValueError("extracted_from_pdf_path must not be empty")
    pdf_path = _resolve_document_path(extracted_from_pdf_path)

    parts: list[str] = [
        "PDF-grounded data validation mission:",
        f"Extracted CSV to validate: {output_csv}",
        f"Source PDF to validate against: {pdf_path}",
        "",
        "Validation contract:",
        "1. Validation happens only after the extraction output already exists.",
        "2. Validate the extracted CSV against the source PDF itself, not against a reference CSV.",
        "3. Use validate_parts_list_against_pdf page by page or in small chunks, and use analyze_pdf_visual_region only for focused follow-up on ambiguous regions.",
        "4. Report confirmed rows, suspect rows, missing_from_extraction, extra_in_extraction, ambiguous rows, and overall confidence.",
        "5. Do not silently rewrite extracted data during validation; distinguish extraction output from validation findings.",
        "6. Architect must delegate this validation mission without previewing CSV contents, and the supervisor must delegate validation to validation-analyst rather than validating directly.",
        "7. If validation-analyst fails, returns empty output, or returns malformed output, surface that failure upward immediately and stop. Do not self-rescue by validating manually.",
    ]
    if notes.strip():
        parts.append(f"Additional notes: {notes.strip()}")
    parts.extend(
        [
            "",
            "Return expectations:",
            "- Include output path, validation summary, unresolved differences, and confidence.",
            "- Keep validation evidence separate from extraction reasoning.",
            "- Validation worker output should be returned upward as a structured payload, not rewritten into a second long report.",
        ]
    )
    return "\n".join(parts)


@tool
def compare_csvs_deterministic(
    extracted_csv_path: str,
    reference_csv_path: str,
    key_columns_csv: str = "",
    ignore_columns_csv: str = "Table Title,Customer",
    sample_limit: int = 5,
) -> str:
    """Deterministically compare two CSV files and return exact counts plus sample discrepancies.

    Use this for validation work instead of ad hoc scripts. It reads both CSVs fully,
    computes exact row counts, schema differences, key-based matches, and sample missing/extra/differing rows.
    Paths must be absolute.
    """
    def _parse_csv_list(raw: str) -> list[str]:
        return [part.strip() for part in raw.split(",") if part.strip()]

    def _norm(value: object) -> str:
        return str(value or "").strip()

    extracted_path = Path(extracted_csv_path).expanduser()
    reference_path = Path(reference_csv_path).expanduser()
    for label, path_obj, raw in (("extracted", extracted_path, extracted_csv_path), ("reference", reference_path, reference_csv_path)):
        if not path_obj.is_absolute():
            return f"Error: {label} CSV path must be absolute. Got: {raw}"
        if not path_obj.exists():
            return f"Error: {label} CSV file not found: {path_obj}"
        if not path_obj.is_file():
            return f"Error: {label} CSV path is not a file: {path_obj}"
        if path_obj.suffix.lower() not in {'.csv', '.tsv'}:
            return f"Error: {label} CSV path must end with .csv or .tsv. Got: {path_obj.name}"

    try:
        with open(extracted_path, 'r', encoding='utf-8', errors='replace', newline='') as f:
            extracted_rows = list(csv.DictReader(f))
            extracted_headers = list((extracted_rows[0].keys() if extracted_rows else csv.DictReader(open(extracted_path, 'r', encoding='utf-8', errors='replace', newline='')).fieldnames) or [])
    except Exception:
        with open(extracted_path, 'r', encoding='utf-8', errors='replace', newline='') as f:
            reader = csv.DictReader(f)
            extracted_headers = list(reader.fieldnames or [])
            extracted_rows = list(reader)

    with open(reference_path, 'r', encoding='utf-8', errors='replace', newline='') as f:
        reader = csv.DictReader(f)
        reference_headers = list(reader.fieldnames or [])
        reference_rows = list(reader)

    ignore_columns = set(_parse_csv_list(ignore_columns_csv))
    common_headers = [h for h in extracted_headers if h in reference_headers and h not in ignore_columns]
    preferred_key_columns = [
        'Location', 'Symbol Text', 'Description', 'Part Number', 'Number'
    ]
    requested_key_columns = _parse_csv_list(key_columns_csv)
    if requested_key_columns:
        key_columns = [col for col in requested_key_columns if col in common_headers]
    else:
        key_columns = [col for col in preferred_key_columns if col in common_headers]
        if not key_columns:
            key_columns = common_headers[: min(3, len(common_headers))]

    compare_columns = [col for col in common_headers if col not in key_columns]

    def _row_key(row: dict[str, object]) -> tuple[str, ...]:
        return tuple(_norm(row.get(col, '')) for col in key_columns)

    def _index_rows(rows: list[dict[str, object]]) -> tuple[dict[tuple[str, ...], dict[str, object]], dict[tuple[str, ...], int]]:
        indexed: dict[tuple[str, ...], dict[str, object]] = {}
        duplicates: dict[tuple[str, ...], int] = {}
        for row in rows:
            key = _row_key(row)
            if key in indexed:
                duplicates[key] = duplicates.get(key, 1) + 1
            else:
                indexed[key] = row
        return indexed, duplicates

    extracted_index, extracted_dupes = _index_rows(extracted_rows)
    reference_index, reference_dupes = _index_rows(reference_rows)

    extracted_keys = set(extracted_index)
    reference_keys = set(reference_index)
    missing_keys = sorted(reference_keys - extracted_keys)
    extra_keys = sorted(extracted_keys - reference_keys)
    matched_keys = sorted(reference_keys & extracted_keys)

    differing_rows = []
    for key in matched_keys:
        extracted_row = extracted_index[key]
        reference_row = reference_index[key]
        diffs = {}
        for col in compare_columns:
            ev = _norm(extracted_row.get(col, ''))
            rv = _norm(reference_row.get(col, ''))
            if ev != rv:
                diffs[col] = {'extracted': ev, 'reference': rv}
        if diffs:
            differing_rows.append({'key': dict(zip(key_columns, key)), 'field_differences': diffs})

    def _sample_keys(keys: list[tuple[str, ...]]) -> list[dict[str, str]]:
        return [dict(zip(key_columns, key)) for key in keys[:sample_limit]]

    result = {
        'extracted_csv_path': str(extracted_path),
        'reference_csv_path': str(reference_path),
        'extracted_data_rows': len(extracted_rows),
        'reference_data_rows': len(reference_rows),
        'row_count_difference': len(extracted_rows) - len(reference_rows),
        'extracted_headers': extracted_headers,
        'reference_headers': reference_headers,
        'extra_columns_in_extracted': [h for h in extracted_headers if h not in reference_headers],
        'missing_columns_in_extracted': [h for h in reference_headers if h not in extracted_headers],
        'ignored_columns': sorted(ignore_columns),
        'key_columns': key_columns,
        'matched_row_keys': len(matched_keys),
        'missing_row_keys': len(missing_keys),
        'extra_row_keys': len(extra_keys),
        'rows_with_field_differences': len(differing_rows),
        'sample_missing_rows': _sample_keys(missing_keys),
        'sample_extra_rows': _sample_keys(extra_keys),
        'sample_field_differences': differing_rows[:sample_limit],
        'duplicate_keys_in_extracted': [dict(zip(key_columns, key)) | {'count': count} for key, count in list(extracted_dupes.items())[:sample_limit]],
        'duplicate_keys_in_reference': [dict(zip(key_columns, key)) | {'count': count} for key, count in list(reference_dupes.items())[:sample_limit]],
    }
    return json.dumps(result, indent=2, ensure_ascii=False)


@tool
def inspect_csv_deterministic(
    file_path: str,
    include_head: int = 3,
    include_tail: int = 3,
) -> str:
    """Deterministically inspect a CSV file and report exact row counts without truncation.

    Use this for validation work when you need accurate counts of total lines, data rows,
    and headers. Unlike read_file_anywhere, this tool never infers counts from truncated
    content—it reads the entire file to compute exact statistics.

    Returns:
        - Total lines in file (including header)
        - Data row count (excluding header)
        - Column headers
        - Optional head/tail samples (configurable, default 3 rows each)
        - File size and encoding info

    Use absolute paths."""
    import csv

    path = Path(file_path).expanduser()
    if not path.is_absolute():
        return f"Error: Path must be absolute. Got: {file_path}"
    if not path.exists():
        return f"Error: File not found: {path}"
    if not path.is_file():
        return f"Error: Not a file: {path}"
    if path.suffix.lower() not in {'.csv', '.tsv'}:
        return f"Error: inspect_csv_deterministic only accepts .csv or .tsv files. Got: {path.name}"

    file_size = path.stat().st_size

    # Read entire file to get exact line count
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
    except Exception as e:
        return f"Error reading {path}: {e}"

    total_lines = len(all_lines)

    # Parse as CSV to get headers and data rows
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.reader(f)
            rows = list(reader)
    except Exception as e:
        return f"Error parsing CSV {path}: {e}"

    if not rows:
        return (
            f"File: {path}\n"
            f"Size: {file_size:,} bytes\n"
            f"Total lines: {total_lines}\n"
            f"Status: Empty CSV (no rows found)"
        )

    headers = rows[0]
    data_rows = rows[1:]
    data_row_count = len(data_rows)

    # Build head sample
    head_rows = data_rows[:include_head] if include_head > 0 else []
    head_str = ""
    if head_rows:
        head_str = "\n".join(
            f"  Row {i+1}: {', '.join(cell[:50] + '...' if len(cell) > 50 else cell for cell in row)}"
            for i, row in enumerate(head_rows)
        )

    # Build tail sample
    tail_rows = data_rows[-include_tail:] if include_tail > 0 and data_row_count > include_head else []
    tail_str = ""
    if tail_rows and data_row_count > include_head:
        tail_str = "\n".join(
            f"  Row {data_row_count - len(tail_rows) + i + 1}: {', '.join(cell[:50] + '...' if len(cell) > 50 else cell for cell in row)}"
            for i, row in enumerate(tail_rows)
        )

    parts = [
        f"File: {path}",
        f"Size: {file_size:,} bytes",
        f"Total lines: {total_lines}",
        f"Data rows: {data_row_count}",
        f"Columns ({len(headers)}): {', '.join(headers)}",
    ]

    if head_str:
        parts.extend(["", f"First {len(head_rows)} data row(s):", head_str])

    if tail_str:
        parts.extend(["", f"Last {len(tail_rows)} data row(s):", tail_str])

    parts.append("")
    parts.append("Note: Row counts are exact—this tool reads the entire file.")

    return "\n".join(parts)


@tool
def validate_parts_list_against_pdf(
    pdf_path: str,
    extracted_csv_path: str,
    page_from: int = 1,
    page_to: int = 0,
    max_pages: int = 2,
    rows_per_page: int = 40,
    dpi: int = 170,
) -> str:
    """Validate extracted parts-list CSV rows against rendered PDF pages.

    Use this in production when no reference CSV exists. It uses the source PDF as the
    validation evidence, groups extracted rows by source page using deterministic parser provenance,
    renders each requested page, and asks the multimodal validator to classify rows as confirmed,
    suspect, extra, or visibly missing from extraction. Prefer page-by-page or small page chunks.
    """

    def _strip_fences(raw: str) -> str:
        cleaned = raw.strip()
        if cleaned.startswith('```'):
            lines = cleaned.splitlines()
            if lines and lines[0].startswith('```'):
                lines = lines[1:]
            if lines and lines[-1].startswith('```'):
                lines = lines[:-1]
            cleaned = '\n'.join(lines).strip()
        return cleaned

    def _parse_json_response(raw: str, page_number: int) -> dict[str, object]:
        cleaned = _strip_fences(raw)
        if not cleaned or cleaned == 'None':
            raise ValueError(f'Page {page_number}: validator returned an empty response.')
        candidates = [cleaned]
        start = cleaned.find('{')
        end = cleaned.rfind('}')
        if start != -1 and end != -1 and end > start:
            candidates.append(cleaned[start:end + 1])
        for candidate in candidates:
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                continue
        raise ValueError(
            f'Page {page_number}: validator returned non-JSON output. Raw response: {cleaned[:1200]}'
        )

    def _norm(value: object) -> str:
        return str(value or '').strip()

    def _row_key(row: dict[str, object]) -> tuple[str, ...]:
        fields = [
            'Location', 'Symbol Text', 'Description', 'Part Number', 'Quantity',
            'Manufacturer', 'Notes', 'Number', 'Drawing Number', 'Equipment', 'Order Number'
        ]
        return tuple(_norm(row.get(field, '')) for field in fields)

    def _row_summary(row: dict[str, object], row_id: str | None = None) -> dict[str, str]:
        payload = {
            'number': _norm(row.get('Number', '')),
            'symbol_text': _norm(row.get('Symbol Text', '')),
            'description': _norm(row.get('Description', '')),
            'part_number': _norm(row.get('Part Number', '')),
            'quantity': _norm(row.get('Quantity', '')),
            'manufacturer': _norm(row.get('Manufacturer', '')),
            'notes': _norm(row.get('Notes', '')),
            'location': _norm(row.get('Location', '')),
        }
        if row_id is not None:
            payload['row_id'] = row_id
        return payload

    resolved_pdf = _resolve_document_path(pdf_path)
    csv_path = Path(extracted_csv_path).expanduser()
    if not csv_path.is_absolute():
        return f"Error: extracted_csv_path must be absolute. Got: {extracted_csv_path}"
    if not csv_path.exists() or not csv_path.is_file():
        return f"Error: extracted CSV not found: {csv_path}"
    if rows_per_page < 1:
        return 'Error: rows_per_page must be at least 1.'
    if max_pages < 1:
        return 'Error: max_pages must be at least 1.'

    with open(csv_path, 'r', encoding='utf-8', errors='replace', newline='') as f:
        extracted_rows = list(csv.DictReader(f))

    total_pdf_pages = _pdf_page_count(resolved_pdf)
    requested_pages = list(_page_span(total_pdf_pages, page_from, page_to, max_pages))
    canonical_rows, provenance_rows, warnings = _parse_electrical_parts_rows(
        resolved_pdf, page_from, page_to, max_pages
    )

    provenance_by_key: dict[tuple[str, ...], list[dict[str, object]]] = {}
    for row in provenance_rows:
        provenance_by_key.setdefault(_row_key(row), []).append(row)

    assigned_by_page: dict[int, list[dict[str, object]]] = {}
    unassigned_extracted: list[dict[str, str]] = []
    for row in extracted_rows:
        key = _row_key(row)
        bucket = provenance_by_key.get(key, [])
        if bucket:
            matched = bucket.pop(0)
            page_number = int(matched.get('source_page', 0) or 0)
            assigned_by_page.setdefault(page_number, []).append(dict(row))
        else:
            unassigned_extracted.append(dict(row))

    expected_only_by_page: dict[int, list[dict[str, object]]] = {}
    for remaining in provenance_by_key.values():
        for row in remaining:
            page_number = int(row.get('source_page', 0) or 0)
            expected_only_by_page.setdefault(page_number, []).append(row)

    page_numbers = sorted({int(row.get('source_page', 0) or 0) for row in provenance_rows if int(row.get('source_page', 0) or 0) > 0})
    full_document_requested = len(requested_pages) == total_pdf_pages
    page_reports: list[dict[str, object]] = []
    confirmed_count = 0
    suspect_count = 0
    visible_missing_count = 0
    extra_count = len(unassigned_extracted) if full_document_requested else 0
    ambiguous_count = 0

    for page_number in page_numbers:
        png_bytes, artifact_path = _render_pdf_region(resolved_pdf, page_number, dpi=dpi)
        data_url = 'data:image/png;base64,' + base64.b64encode(png_bytes).decode('ascii')
        page_rows = assigned_by_page.get(page_number, [])
        visible_candidates = [_row_summary(row, str(index + 1)) for index, row in enumerate(page_rows[:rows_per_page])]
        expected_only_rows = [_row_summary(row) for row in expected_only_by_page.get(page_number, [])[:10]]
        truncated_count = max(0, len(page_rows) - len(visible_candidates))

        prompt = {
            'task': 'Validate extracted parts-list rows against the rendered PDF page. Use only visible evidence from the page image.',
            'required_output': {
                'page_number': page_number,
                'confirmed_row_ids': ['list of row_id strings that clearly match the page'],
                'suspect_rows': [
                    {'row_id': 'candidate row_id', 'reason': 'brief reason'}
                ],
                'extra_rows': [
                    {'row_id': 'candidate row_id', 'reason': 'brief reason'}
                ],
                'visible_missing_rows': [
                    {'number': 'visible row number if present', 'symbol_text': 'visible symbol', 'description': 'visible description', 'reason': 'why it looks missing from extraction'}
                ],
                'ambiguous_rows': [
                    {'row_id': 'candidate row_id or empty', 'reason': 'brief reason'}
                ],
                'notes': 'short page-level note'
            },
            'rules': [
                'Be strict and grounded. If a row cannot be confirmed visually, mark it suspect or ambiguous.',
                'Do not invent corrected data rows; report discrepancies only.',
                'Accessory rows such as COVER, HANDLE, SOCKET, DIN Rail Adapter, etc. should be treated as independent rows when visibly present.',
                'Table-level metadata should not be treated as row-level discrepancies unless it is obviously wrong for the page.',
            ],
            'page_context': {
                'page_number': page_number,
                'candidate_rows_truncated': truncated_count,
                'candidate_rows': visible_candidates,
                'expected_only_watchlist': expected_only_rows,
            },
        }

        raw = _multimodal_chat_completion(
            [
                {
                    'role': 'system',
                    'content': (
                        'You are a grounded industrial-document validation assistant. '
                        'Return strict JSON only and do not include markdown fences. '
                        'Use only the supplied PDF page image as evidence. '
                        'When uncertain, put the row in suspect_rows or ambiguous_rows.'
                    ),
                },
                {
                    'role': 'user',
                    'content': [
                        {'type': 'text', 'text': json.dumps(prompt, ensure_ascii=False, indent=2)},
                        {'type': 'image_url', 'image_url': {'url': data_url}},
                    ],
                },
            ],
            model_id=settings.vision_assist_model,
            max_tokens=3200,
        )

        parsed = _parse_json_response(raw, page_number)

        confirmed_ids = parsed.get('confirmed_row_ids', []) or []
        suspect_rows = parsed.get('suspect_rows', []) or []
        extra_rows = parsed.get('extra_rows', []) or []
        visible_missing_rows = parsed.get('visible_missing_rows', []) or []
        ambiguous_rows = parsed.get('ambiguous_rows', []) or []

        confirmed_count += len(confirmed_ids)
        suspect_count += len(suspect_rows)
        visible_missing_count += len(visible_missing_rows)
        extra_count += len(extra_rows)
        ambiguous_count += len(ambiguous_rows)

        page_reports.append(
            {
                'page_number': page_number,
                'artifact_path': artifact_path,
                'candidate_row_count': len(page_rows),
                'candidate_rows_sent': len(visible_candidates),
                'candidate_rows_truncated': truncated_count,
                'expected_only_count': len(expected_only_by_page.get(page_number, [])),
                'confirmed_count': len(confirmed_ids),
                'suspect_count': len(suspect_rows),
                'visible_missing_count': len(visible_missing_rows),
                'extra_count': len(extra_rows),
                'ambiguous_count': len(ambiguous_rows),
                'model_report': parsed,
            }
        )

    if suspect_count == 0 and visible_missing_count == 0 and extra_count == 0 and ambiguous_count == 0 and not warnings:
        confidence = 'high'
    elif suspect_count <= 5 and visible_missing_count <= 5 and ambiguous_count <= 5:
        confidence = 'medium'
    else:
        confidence = 'low'

    result = {
        'pdf_path': str(resolved_pdf),
        'extracted_csv_path': str(csv_path),
        'pages_validated': page_numbers,
        'summary': {
            'extracted_rows': len(extracted_rows),
            'parser_rows_in_range': len(canonical_rows),
            'matched_rows_to_pages': sum(len(rows) for rows in assigned_by_page.values()),
            'unassigned_extracted_rows': len(unassigned_extracted) if full_document_requested else 0,
            'ignored_out_of_scope_extracted_rows': 0 if full_document_requested else len(unassigned_extracted),
            'confirmed_rows': confirmed_count,
            'suspect_rows': suspect_count,
            'visible_missing_rows': visible_missing_count,
            'extra_rows': extra_count,
            'ambiguous_rows': ambiguous_count,
            'confidence': confidence,
            'parser_warnings': warnings,
        },
        'unassigned_extracted_row_samples': [_row_summary(row) for row in unassigned_extracted[:10]],
        'page_reports': page_reports,
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


CUSTOM_TOOLS = [
    search_langchain_docs,
    prepare_data_extraction_workflow,
    prepare_data_validation_workflow,
    prepare_pdf_grounded_validation_workflow,
    inspect_pdf_document,
    extract_pdf_text_layer,
    extract_pdf_tables,
    parse_electrical_parts_list,
    parse_cable_list,
    detect_schematic_spine_slice0,
    build_schematic_page_evidence,
    save_extracted_csv_to_neon,
    ocr_pdf_pages,
    analyze_pdf_visual_region,
    inspect_csv_deterministic,
    compare_csvs_deterministic,
    validate_parts_list_against_pdf,
]
