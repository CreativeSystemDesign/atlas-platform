from pathlib import Path

import pytest

from src.extractors.schematic_spine import (
    DEFAULT_VECTOR_DB_PATH,
    build_schematic_page_evidence_bundle,
    build_schematic_spine_slice0,
)
from src.graphs import custom_tools
from src.graphs.architect import _ARCHITECT_TOOL_NAMES, get_architect_topology
from src.graphs.tools import ATLAS_TOOLS

AGENT_SERVER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = AGENT_SERVER_ROOT.parent
SCHEMATIC_PDF_PATH = (
    REPO_ROOT / "documents/the reference machine/the reference machine/01_SCHEMATIC DIAGRAM_<drawing-no>.pdf"
)


def _assert_bbox_close(
    actual: list[int],
    expected: tuple[int, int, int, int],
    tolerance: int,
) -> None:
    deltas = [
        abs(int(actual_value) - expected_value)
        for actual_value, expected_value in zip(actual, expected)
    ]
    assert max(deltas) <= tolerance


def _find_text_anchor(result: dict, normalized_text: str, class_name: str) -> dict:
    for anchor in result["text_anchors"]:
        if (
            anchor["normalized_text"] == normalized_text
            and class_name in anchor["class_candidates"]
        ):
            return anchor
    raise AssertionError(f"Missing text anchor {normalized_text!r} with class {class_name!r}")


def test_schematic_spine_slice0_tool_is_spatial_worker_only() -> None:
    assert "detect_schematic_spine_slice0" in {tool.name for tool in ATLAS_TOOLS}
    assert "build_schematic_page_evidence" in {tool.name for tool in ATLAS_TOOLS}
    assert "detect_schematic_spine_slice0" not in _ARCHITECT_TOOL_NAMES
    assert "build_schematic_page_evidence" not in _ARCHITECT_TOOL_NAMES

    topology = get_architect_topology()
    spatial_node = next(
        node for node in topology["nodes"] if node["id"] == "spatial-analysis-agent"
    )
    assert "detect_schematic_spine_slice0" in spatial_node["tools"]
    assert "build_schematic_page_evidence" in spatial_node["tools"]
    architect_source = (AGENT_SERVER_ROOT / "src/graphs/architect.py").read_text(
        encoding="utf-8"
    )
    assert "Do not pass output_dir or vector_db_path" in architect_source


def test_schematic_spine_slice0_contract_is_in_data_extraction_workflow_skill() -> None:
    skill = (
        AGENT_SERVER_ROOT
        / "src/graphs/skills/data-extraction-workflow/SKILL.md"
    ).read_text(encoding="utf-8")

    assert (
        "Named production extraction contracts override generic document-family behavior"
        in skill
    )
    assert (
        "Schematic Spine Slice 0 extraction is a vector-geometry component detection contract"
        in skill
    )
    assert "detect_schematic_spine_slice0" in skill
    assert "call `prepare_data_extraction_workflow(...)` with no `output_path`" in skill
    assert "Do not broaden it into wire extraction" in skill
    assert "page-local evidence candidates for visual validation" in skill
    assert "After the operator prompt, Architect-visible text" in skill
    assert "not \"I will extract the data\"" in skill


def test_production_extraction_contract_standard_is_documented() -> None:
    contract_doc = REPO_ROOT / "docs/production-extraction-contracts.md"
    custom_tools_skill = (
        AGENT_SERVER_ROOT / "src/graphs/skills/custom-tools/SKILL.md"
    ).read_text(encoding="utf-8")

    assert contract_doc.exists()
    contract_text = contract_doc.read_text(encoding="utf-8")
    assert "named production extraction contract" in contract_text.lower()
    assert "NAMED_PRODUCTION_EXTRACTION_CONTRACTS" in contract_text
    assert "Schematic Spine Slice 0" in contract_text
    assert "candidate evidence for visual validation" in contract_text
    assert "component truth until a later" in contract_text
    assert "docs/production-extraction-contracts.md" in custom_tools_skill


def test_schematic_spine_slice0_workflow_brief_uses_tool_owned_outputs() -> None:
    brief = custom_tools.prepare_data_extraction_workflow.invoke(
        {
            "pdf_path": str(SCHEMATIC_PDF_PATH),
            "extraction_goal": "Extract Schematic Spine Slice 0 data for machine the reference machine.",
        }
    )

    assert "Schematic Spine Slice 0 tool contract:" in brief
    assert "Do not pass output_dir" in brief
    assert "Do not pass vector_db_path" in brief
    assert "artifact_json" in brief
    assert "reconstruction_overlay" in brief
    assert "component_marks_overlay" in brief
    assert "component_boxes_overlay" in brief
    assert "reference_candidates_overlay" in brief
    assert "terminal_nodes_overlay" in brief
    assert "terminal_wire_overlay" in brief
    assert "reference_wire_overlay" in brief
    assert "graphic_atoms_overlay" in brief
    assert "wire_segments_overlay" in brief
    assert "wire_trace_overlay" in brief
    assert "wire_paths_overlay" in brief
    assert "wire_endpoints_overlay" in brief
    assert "clean_validation_overlay" in brief
    assert "wire_object_associations_overlay" in brief
    assert "wire_interactions_overlay" in brief
    assert "text_associations_overlay" in brief
    assert "evidence_overlay" in brief
    assert "text_anchor_count" in brief
    assert "component_mark_count" in brief
    assert "component_box_count" in brief
    assert "component_box_review_flag_count" in brief
    assert "component_box_review_summary" in brief
    assert "reference_candidate_count" in brief
    assert "terminal_node_count" in brief
    assert "terminal_wire_association_count" in brief
    assert "reference_wire_association_count" in brief
    assert "graphic_atom_count" in brief
    assert "wire_segment_count" in brief
    assert "wire_trace_count" in brief
    assert "wire_path_count" in brief
    assert "wire_endpoint_count" in brief
    assert "wire_object_association_count" in brief
    assert "wire_interaction_count" in brief
    assert "text_association_count" in brief
    assert "Write output to:" not in brief
    assert "data-extraction-supervisor/outputs" not in brief


def test_generic_extraction_workflow_brief_makes_output_path_authoritative() -> None:
    pdf_path = (
        REPO_ROOT
        / "documents/the reference machine/the reference machine/04_ELECTRICAL PARTS LIST_<drawing-no>.pdf"
    )
    brief = custom_tools.prepare_data_extraction_workflow.invoke(
        {
            "pdf_path": str(pdf_path),
            "extraction_goal": "Extract electrical parts list data for machine the reference machine.",
        }
    )

    assert "Artifact path policy:" in brief
    assert "The path below is the only canonical extraction artifact path" in brief
    assert "Do not copy, mirror, export, or rewrite the artifact" in brief
    assert "Write output to:" in brief
    assert "data-extraction-supervisor/outputs" in brief
    output_line = next(line for line in brief.splitlines() if line.startswith("Write output to:"))
    assert "documents/the reference machine/the reference machine" not in output_line


def test_schematic_spine_slice0_uses_named_production_contract_registry() -> None:
    names = {
        str(contract["name"])
        for contract in custom_tools.NAMED_PRODUCTION_EXTRACTION_CONTRACTS
    }

    assert "Schematic Spine Slice 0" in names


def test_schematic_spine_slice0_workflow_rejects_generic_output_path(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Schematic Spine Slice 0 uses"):
        custom_tools.prepare_data_extraction_workflow.invoke(
            {
                "pdf_path": str(SCHEMATIC_PDF_PATH),
                "extraction_goal": "Extract Schematic Spine Slice 0 data for machine the reference machine.",
                "output_path": str(tmp_path / "slice0.csv"),
            }
        )


@pytest.mark.skipif(not SCHEMATIC_PDF_PATH.exists(), reason="fixture schematic PDF not present")
@pytest.mark.skipif(not DEFAULT_VECTOR_DB_PATH.exists(), reason="legacy vector DB not present")
def test_schematic_spine_slice0_detects_page7_elb_from_vector_data(tmp_path: Path) -> None:
    result = build_schematic_spine_slice0(
        pdf_path=SCHEMATIC_PDF_PATH,
        vector_db_path=DEFAULT_VECTOR_DB_PATH,
        output_dir=tmp_path,
        page_from=7,
        page_to=7,
        max_pages=1,
    )

    assert result["uses_annotation_candidate_boxes"] is False
    assert result["render_dpi"] == 300
    assert result["render_width_px"] == 2481
    assert result["render_height_px"] == 3509
    assert Path(result["canonical_render"]).exists()
    assert Path(result["reconstruction_overlay"]).exists()
    assert Path(result["component_marks_overlay"]).exists()
    assert Path(result["component_boxes_overlay"]).exists()
    assert Path(result["reference_candidates_overlay"]).exists()
    assert Path(result["terminal_nodes_overlay"]).exists()
    assert Path(result["terminal_wire_overlay"]).exists()
    assert Path(result["reference_wire_overlay"]).exists()
    assert Path(result["graphic_atoms_overlay"]).exists()
    assert Path(result["wire_segments_overlay"]).exists()
    assert Path(result["wire_trace_overlay"]).exists()
    assert Path(result["wire_paths_overlay"]).exists()
    assert Path(result["wire_endpoints_overlay"]).exists()
    assert Path(result["clean_validation_overlay"]).exists()
    assert Path(result["wire_object_associations_overlay"]).exists()
    assert Path(result["wire_interactions_overlay"]).exists()
    assert Path(result["text_associations_overlay"]).exists()
    assert Path(result["validation_overlay"]).exists()
    assert Path(result["evidence_overlay"]).exists()
    assert Path(result["artifact_json"]).exists()
    assert result["text_anchor_method"] == "pymupdf_text_words_v1"
    assert result["component_mark_method"] == "text_anchor_component_mark_candidate_v1"
    assert result["component_box_method"] == "mark_guided_component_box_candidate_v1"
    assert result["reference_candidate_method"] == "stacked_numeric_reference_candidate_v1"
    assert result["terminal_node_method"] == "text_enclosed_terminal_node_candidate_v1"
    assert result["terminal_wire_association_method"] == "terminal_wire_touch_candidate_v1"
    assert result["reference_wire_association_method"] == "reference_wire_proximity_candidate_v1"
    assert result["graphic_atom_method"] == "legacy_vectors_db_drawing_items_v1"
    assert result["wire_segment_method"] == "graphic_atom_wire_segment_candidate_v1"
    assert result["wire_trace_method"] == "filtered_wire_trace_candidate_v1"
    assert result["wire_path_method"] == "wire_trace_connected_component_candidate_v1"
    assert result["wire_endpoint_method"] == "wire_path_endpoint_candidate_v1"
    assert result["wire_object_association_method"] == (
        "wire_endpoint_object_association_candidate_v1"
    )
    assert result["wire_interaction_method"] == "orthogonal_wire_interaction_candidate_v1"
    assert result["text_association_method"] == "nearest_text_to_geometry_candidate_v1"
    assert result["text_anchor_count"] >= 200
    assert result["component_mark_count"] == 12
    assert result["component_box_count"] == 12
    assert result["component_box_review_flag_count"] >= 0
    assert result["component_box_review_summary"]["flagged_component_box_count"] == result[
        "component_box_review_flag_count"
    ]
    assert "flag_counts" in result["component_box_review_summary"]
    assert "pages" in result["component_box_review_summary"]
    assert result["reference_candidate_count"] == 6
    assert result["terminal_node_count"] == 10
    assert result["terminal_wire_association_count"] == 28
    assert result["reference_wire_association_count"] == 10
    assert result["graphic_atom_count"] == 681
    assert result["wire_segment_count"] == 100
    assert result["wire_trace_count"] == 42
    assert result["wire_path_count"] == 29
    assert result["wire_endpoint_count"] == 70
    assert result["wire_object_association_count"] == 48
    assert result["wire_interaction_count"] == 36
    assert result["text_association_count"] == 39
    assert result["detection_count"] == 2
    assert any(
        "orthogonal_wire_or_border_candidate" in atom["class_candidates"]
        for atom in result["graphic_atoms"]
    )
    assert any(atom["kind"] == "c" for atom in result["graphic_atoms"])
    assert any(atom["kind"] == "re" for atom in result["graphic_atoms"])
    assert any(
        segment["orientation"] == "horizontal"
        and "wire_segment_candidate" in segment["class_candidates"]
        for segment in result["wire_segments"]
    )
    assert any(
        trace["orientation"] == "horizontal"
        and "wire_trace_candidate" in trace["class_candidates"]
        for trace in result["wire_trace_candidates"]
    )
    assert any(
        "connected_wire_path_candidate" in path["class_candidates"]
        and path["wire_interaction_ids"]
        for path in result["wire_path_candidates"]
    )
    assert any(
        box["mark_text"] == "MCB10"
        and "component_box_candidate" in box["class_candidates"]
        for box in result["component_box_candidates"]
    )
    assert any(
        box["mark_text"] == "ELB11"
        and "fingerprint_component_box_candidate" in box["class_candidates"]
        for box in result["component_box_candidates"]
    )
    assert any(
        "open_wire_endpoint_candidate" in endpoint["class_candidates"]
        for endpoint in result["wire_endpoint_candidates"]
    )
    assert any(
        "terminal_wire_endpoint_candidate" in endpoint["class_candidates"]
        for endpoint in result["wire_endpoint_candidates"]
    )
    assert any(
        "continuation_reference_endpoint_candidate" in endpoint["class_candidates"]
        for endpoint in result["wire_endpoint_candidates"]
    )
    assert any(
        "component_boundary_endpoint_candidate" in endpoint["class_candidates"]
        and endpoint["near_component_box_ids"]
        for endpoint in result["wire_endpoint_candidates"]
    )
    assert any(
        association["target_label"] == "ELB11"
        and association["relation_candidate"] == "wire_endpoint_near_component_box"
        for association in result["wire_object_associations"]
    )
    assert any(
        association["relation_candidate"] == "wire_endpoint_near_terminal_node"
        for association in result["wire_object_associations"]
    )
    assert any(
        association["relation_candidate"] == "wire_endpoint_near_continuation_reference"
        for association in result["wire_object_associations"]
    )
    assert any(
        component["mark_text"] == "ELB11"
        and "component_mark_candidate" in component["class_candidates"]
        for component in result["component_mark_candidates"]
    )
    assert any(
        reference["reference_text"] == "12/9"
        and "stacked_numeric_reference_candidate" in reference["class_candidates"]
        for reference in result["reference_candidates"]
    )
    assert any(
        reference["reference_text"] == "32/7"
        and reference["source_anchor"]["method"] == "stacked_numeric_reference_candidate_v1"
        for reference in result["reference_candidates"]
    )
    assert any(
        terminal["terminal_text"] == "23"
        and "text_enclosed_by_curve_candidate" in terminal["class_candidates"]
        for terminal in result["terminal_node_candidates"]
    )
    assert any(
        terminal["terminal_text"] == "25"
        and terminal["source_anchor"]["method"] == "text_enclosed_terminal_node_candidate_v1"
        for terminal in result["terminal_node_candidates"]
    )
    assert any(
        association["terminal_text"] == "23"
        and association["relation_candidate"] == "terminal_node_touching_wire_segment"
        and association["source_anchor"]["method"] == "terminal_wire_touch_candidate_v1"
        for association in result["terminal_wire_associations"]
    )
    assert any(
        association["reference_text"] == "12/9"
        and association["relation_candidate"] == "reference_marker_near_wire_segment"
        and association["source_anchor"]["method"] == "reference_wire_proximity_candidate_v1"
        for association in result["reference_wire_associations"]
    )
    assert any(
        interaction["interaction_type"] == "crossing_without_junction_evidence_candidate"
        for interaction in result["wire_interactions"]
    )
    assert any(
        association["relation_candidate"] == "wire_label_near_wire_segment"
        for association in result["text_associations"]
    )
    assert any(
        association["relation_candidate"] == "terminal_label_near_wire_segment"
        for association in result["text_associations"]
    )
    assert any(
        association["relation_candidate"] == "component_mark_near_component_box"
        for association in result["text_associations"]
    )
    assert any(
        association["source_anchor_text"] == "ELB12"
        and association["relation_candidate"] == "component_mark_near_component_box"
        for association in result["text_associations"]
    )

    assert len(result["detections"]) == 2
    first_detection = result["detections"][0]
    assert first_detection["template_id"] == "elb_3_phase_page7_pair10"
    assert first_detection["source_page"] == 7
    assert first_detection["source_vector_ids"]
    assert first_detection["source_anchor"]["method"] == "vector_sequence_fingerprint_v1"
    assert Path(first_detection["evidence_overlay"]).exists()
    _assert_bbox_close(first_detection["bbox_px"], (743, 2221, 910, 2446), tolerance=2)
    second_detection = next(
        detection
        for detection in result["detections"]
        if detection["source_seqnos"][0] == 344
    )
    assert second_detection["score"] >= 0.997
    _assert_bbox_close(second_detection["bbox_px"], (743, 2596, 910, 2822), tolerance=2)
    assert Path(result["page_summaries"][0]["page_evidence_artifact"]).exists()
    assert Path(result["page_summaries"][0]["component_marks_overlay"]).exists()
    assert result["page_summaries"][0]["component_mark_count"] == 12
    assert Path(result["page_summaries"][0]["component_boxes_overlay"]).exists()
    assert result["page_summaries"][0]["component_box_count"] == 12
    assert result["page_summaries"][0]["component_box_review_flag_count"] == result[
        "component_box_review_flag_count"
    ]
    assert result["page_summaries"][0]["component_box_review_summary"][
        "flagged_component_box_count"
    ] == result["page_summaries"][0]["component_box_review_flag_count"]
    assert Path(result["page_summaries"][0]["reference_candidates_overlay"]).exists()
    assert result["page_summaries"][0]["reference_candidate_count"] == 6
    assert Path(result["page_summaries"][0]["terminal_nodes_overlay"]).exists()
    assert result["page_summaries"][0]["terminal_node_count"] == 10
    assert Path(result["page_summaries"][0]["terminal_wire_overlay"]).exists()
    assert result["page_summaries"][0]["terminal_wire_association_count"] == 28
    assert Path(result["page_summaries"][0]["reference_wire_overlay"]).exists()
    assert result["page_summaries"][0]["reference_wire_association_count"] == 10
    assert Path(result["page_summaries"][0]["wire_trace_overlay"]).exists()
    assert result["page_summaries"][0]["wire_trace_count"] == 42
    assert Path(result["page_summaries"][0]["wire_paths_overlay"]).exists()
    assert result["page_summaries"][0]["wire_path_count"] == result["wire_path_count"]
    assert Path(result["page_summaries"][0]["wire_endpoints_overlay"]).exists()
    assert result["page_summaries"][0]["wire_endpoint_count"] == result["wire_endpoint_count"]
    assert Path(result["page_summaries"][0]["clean_validation_overlay"]).exists()
    assert Path(result["page_summaries"][0]["wire_object_associations_overlay"]).exists()
    assert result["page_summaries"][0]["wire_object_association_count"] == 48
    assert Path(result["page_summaries"][0]["text_associations_overlay"]).exists()
    assert result["page_summaries"][0]["text_association_count"] == 39
    assert result["page_summaries"][0]["completion_state"] == "evidence_bundle_ready"

    mcb_anchor = _find_text_anchor(result, "MCB10", "component_mark")
    _assert_bbox_close(mcb_anchor["bbox_px"], (656, 631, 740, 659), tolerance=2)
    assert mcb_anchor["source_anchor"]["method"] == "pymupdf_text_words_v1"

    wire_anchor = _find_text_anchor(result, "R100", "wire_label")
    _assert_bbox_close(wire_anchor["bbox_px"], (997, 1888, 1064, 1908), tolerance=2)

    location_anchor = _find_text_anchor(result, "(PP)", "location_tag")
    assert location_anchor["source_page"] == 7

    assert any(
        anchor["normalized_text"] == "MAIN POWER,POWER LAMP"
        and "page_metadata" in anchor["class_candidates"]
        for anchor in result["text_anchors"]
    )


@pytest.mark.skipif(not SCHEMATIC_PDF_PATH.exists(), reason="fixture schematic PDF not present")
@pytest.mark.skipif(not DEFAULT_VECTOR_DB_PATH.exists(), reason="legacy vector DB not present")
def test_schematic_page_evidence_bundle_does_not_require_template_match(
    tmp_path: Path,
) -> None:
    result = build_schematic_page_evidence_bundle(
        pdf_path=SCHEMATIC_PDF_PATH,
        vector_db_path=DEFAULT_VECTOR_DB_PATH,
        output_dir=tmp_path,
        page_from=8,
        page_to=8,
        max_pages=1,
        min_score=0.999,
    )

    assert result["source_page"] == 8
    assert result["detection_count"] >= 0
    assert result["text_anchor_count"] > 0
    assert result["component_mark_count"] > 0
    assert result["component_box_count"] > 0
    assert result["component_box_review_flag_count"] >= 0
    assert result["component_box_review_summary"]["flagged_component_box_count"] == result[
        "component_box_review_flag_count"
    ]
    assert result["reference_candidate_count"] > 0
    assert result["terminal_node_count"] > 0
    assert result["terminal_wire_association_count"] > 0
    assert result["reference_wire_association_count"] > 0
    assert result["graphic_atom_count"] > 0
    assert result["wire_segment_count"] > 0
    assert result["wire_trace_count"] > 0
    assert result["wire_path_count"] > 0
    assert result["wire_endpoint_count"] > 0
    assert result["wire_object_association_count"] > 0
    assert result["text_association_count"] >= 0
    assert "text_anchors" not in result
    assert "component_mark_candidates" not in result
    assert "component_box_candidates" not in result
    assert "reference_candidates" not in result
    assert "terminal_node_candidates" not in result
    assert "terminal_wire_associations" not in result
    assert "reference_wire_associations" not in result
    assert "graphic_atoms" not in result
    assert "wire_segments" not in result
    assert "wire_trace_candidates" not in result
    assert "wire_path_candidates" not in result
    assert "wire_endpoint_candidates" not in result
    assert "wire_object_associations" not in result
    assert "text_associations" not in result
    page_summary = result["page_summaries"][0]
    assert page_summary["source_page"] == 8
    assert page_summary["component_box_review_summary"][
        "flagged_component_box_count"
    ] == page_summary["component_box_review_flag_count"]
    assert Path(page_summary["canonical_render"]).exists()
    assert Path(page_summary["reconstruction_overlay"]).exists()
    assert Path(page_summary["component_marks_overlay"]).exists()
    assert Path(page_summary["component_boxes_overlay"]).exists()
    assert Path(page_summary["reference_candidates_overlay"]).exists()
    assert Path(page_summary["terminal_nodes_overlay"]).exists()
    assert Path(page_summary["terminal_wire_overlay"]).exists()
    assert Path(page_summary["reference_wire_overlay"]).exists()
    assert Path(page_summary["graphic_atoms_overlay"]).exists()
    assert Path(page_summary["wire_segments_overlay"]).exists()
    assert Path(page_summary["wire_trace_overlay"]).exists()
    assert Path(page_summary["wire_paths_overlay"]).exists()
    assert Path(page_summary["wire_endpoints_overlay"]).exists()
    assert Path(page_summary["clean_validation_overlay"]).exists()
    assert Path(page_summary["wire_object_associations_overlay"]).exists()
    assert Path(page_summary["wire_interactions_overlay"]).exists()
    assert Path(page_summary["text_associations_overlay"]).exists()
    assert Path(page_summary["page_evidence_artifact"]).exists()


@pytest.mark.skipif(not SCHEMATIC_PDF_PATH.exists(), reason="fixture schematic PDF not present")
@pytest.mark.skipif(not DEFAULT_VECTOR_DB_PATH.exists(), reason="legacy vector DB not present")
def test_schematic_page_evidence_bundle_detects_terminal_block_marks(
    tmp_path: Path,
) -> None:
    result = build_schematic_page_evidence_bundle(
        pdf_path=SCHEMATIC_PDF_PATH,
        vector_db_path=DEFAULT_VECTOR_DB_PATH,
        output_dir=tmp_path,
        page_from=9,
        page_to=9,
        max_pages=1,
        min_score=0.999,
    )

    page = result["pages"][0]
    assert any(
        component["mark_text"] == "TB30"
        and "component_mark_candidate" in component["class_candidates"]
        for component in page["component_mark_candidates"]
    )
    terminal_block_box = next(
        box for box in page["component_box_candidates"] if box["mark_text"] == "TB30"
    )
    assert terminal_block_box["source_kind"] == "mark_guided_graphic_cluster"
    assert "tb_component_box_candidate" in terminal_block_box["class_candidates"]
    assert "large_component_box_relative_to_mark_review" in terminal_block_box[
        "visual_review_flags"
    ]
    assert result["component_box_review_summary"]["flag_counts"][
        "large_component_box_relative_to_mark_review"
    ] >= 1
    _assert_bbox_close(
        terminal_block_box["bbox_px"],
        (564, 284, 997, 2262),
        tolerance=3,
    )
