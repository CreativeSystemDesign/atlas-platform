"""Deterministic title-rule classification (Shane's ruling, 2026-07-20).

The library's classification axis is HOW YOU HAVE TO READ THE DOC to
extract it — visual examination vs transcribing printed rows — and at the
document level the curated titles carry it: "Cable List" is tabular,
"Wiring Diagram" is visual, even when the diagram *produces* tables (the
TB docs required visual reading; the doc-level class is correct).

Rules over model calls: the normalized names are already curated (skim +
Shane's confirms), so a keyword rule is exact, free, and instantly
re-runnable. The built Sonnet classify pass (intake_classify) stays in
reserve for genuinely ambiguous titles. A title no rule matches proposes
NOTHING — a wrong guess pollutes; unmatched is reported honestly.

classification vocabulary (documents.classification, free text but keep to
the established set): schematic | manual | parts-list | plc-reference |
cable-list | other.  method: tabular | visual | reference.
"""

from __future__ import annotations

import re

# Ordered — first match wins. (pattern, classification, method, rule_name)
_RULES: list[tuple[str, str, str, str]] = [
    (r"cable\s*list", "cable-list", "tabular", "cable-list"),
    (r"parts\s*list", "parts-list", "tabular", "parts-list"),
    (r"interface\s*list", "plc-reference", "tabular", "interface-list"),
    (r"cross[\s_-]*reference", "plc-reference", "tabular", "cross-reference"),
    (r"address\s*list|i/?o\s*list", "plc-reference", "tabular", "io-list"),
    (r"parameter", "plc-reference", "tabular", "parameter"),
    # printed fault/alarm/error code tables — tabular extraction targets
    (r"(fault|alarm|error)\s*(code\s*)?(and\s*error\s*)?(reference|list)",
     "plc-reference", "tabular", "fault-reference"),
    # the program itself — consulted, not extracted (reference docs beat
    # the program for joins; the listings are the deep background).
    # "ladder logic listing" belongs HERE, before the schematic rule's bare
    # "ladder" catches it (review 2026-07-20: the P08 doc misfiled).
    (r"plc\s*(program\s*|logic\s*)?listing|program\s*listing|main_program|"
     r"plc\s*program|(ladder|logic)\s*(logic\s*)?listing",
     "plc-reference", "reference", "plc-listing"),
    # inverter/sensor setting lists — printed settings tables
    (r"setting\s*list", "other", "tabular", "setting-list"),
    (r"table\s*of\s*contents|\btoc\b", "other", "reference", "toc"),
    (r"schematic|circuit\s*diagram|ladder", "schematic", "visual", "schematic"),
    (r"wiring\s*diagram|connection\s*diagram|terminal\s*box",
     "schematic", "visual", "wiring-diagram"),
    # vendor datasheets/spec sheets — manuals for the library's purposes
    (r"data\s*sheet|datasheet|specification\s*sheet",
     "manual", "visual", "datasheet"),
    (r"manual|instruction|handbook", "manual", "visual", "manual"),
    # Shane's visual keywords: diagram, drawing, layout, outline,
    # arrangement — a print you must LOOK at to extract
    (r"diagram|drawing|layout|outline|arrangement|dimension",
     "other", "visual", "visual-print"),
    # bare "Specification" last — vendor spec documents
    (r"specification", "manual", "visual", "specification"),
]

_COMPILED = [(re.compile(p, re.IGNORECASE), c, m, r) for p, c, m, r in _RULES]


def classify_title(*names: str | None) -> dict[str, str] | None:
    """First rule that matches any provided name (normalized first, then
    original), or None — never guess."""
    for name in names:
        if not name:
            continue
        for rx, classification, method, rule in _COMPILED:
            if rx.search(str(name)):
                return {"classification": classification, "method": method,
                        "rule": rule}
    return None
