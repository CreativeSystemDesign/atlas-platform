from __future__ import annotations

import asyncio
import json

from src.graphs.code_agent import (
    ATLAS_CODE_FILESYSTEM_ROOT,
    _code_prompt,
    _code_subagents,
    get_code_topology,
    make_code_llm,
)
from src.graphs.code_tools import CODE_TOOLS
from src.graphs.model_resolution import model_metadata_key_for_graph
from src.graphs.registry import list_graph_ids
from src.routes.runs import _iter_sse_model_events
from src.routes.runs import _reasoning_effort_from_config


def test_atlas_code_graph_is_registered() -> None:
    assert "atlas-code" in list_graph_ids()


def test_atlas_code_topology_has_no_extraction_workers_or_tools() -> None:
    topology = get_code_topology()
    node_ids = {str(node["id"]) for node in topology["nodes"]}
    forbidden_nodes = {
        "extraction-orchestrator",
        "data-extraction-supervisor",
        "vision-extractor",
        "ocr-extractor",
        "table-structure-extractor",
        "schema-mapper",
        "spatial-analysis-agent",
        "validation-analyst",
    }
    assert node_ids.isdisjoint(forbidden_nodes)

    tools = {
        str(tool)
        for node in topology["nodes"]
        for tool in node.get("tools", [])
    }
    forbidden_tool_fragments = (
        "pdf",
        "ocr",
        "csv",
        "schematic",
        "extract_pdf",
        "parse_cable",
        "parse_electrical",
        "detect_schematic",
        "build_schematic",
    )
    assert not [
        tool
        for tool in tools
        if any(fragment in tool.lower() for fragment in forbidden_tool_fragments)
    ]


def test_atlas_code_topology_exposes_coding_workers() -> None:
    topology = get_code_topology()
    node_ids = {str(node["id"]) for node in topology["nodes"]}
    assert {
        "atlas-code",
        "general-purpose",
        "repo-scout",
        "frontend-craft",
        "runtime-engineer",
        "verification-runner",
    }.issubset(node_ids)

    edges = {(str(edge["source"]), str(edge["target"])) for edge in topology["edges"]}
    assert ("atlas-code", "general-purpose") in edges
    assert ("atlas-code", "repo-scout") in edges
    assert ("atlas-code", "frontend-craft") in edges
    assert ("atlas-code", "runtime-engineer") in edges

    lanes = {str(node["id"]): str(node.get("model_lane", "")) for node in topology["nodes"]}
    assert lanes["atlas-code"] == "atlas"
    assert lanes["general-purpose"] == "worker"
    assert lanes["repo-scout"] == "worker"
    assert lanes["frontend-craft"] == "ui"
    assert lanes["runtime-engineer"] == "worker"
    assert lanes["verification-runner"] == "worker"


def test_atlas_code_subagents_use_first_class_model_lanes() -> None:
    agents = {
        str(agent["name"]): agent
        for agent in _code_subagents(
            worker_model_id="openrouter/worker-lane",
            ui_model_id="openrouter/ui-craft-lane",
        )
    }

    assert {
        "general-purpose",
        "repo-scout",
        "frontend-craft",
        "runtime-engineer",
        "verification-runner",
    } == set(agents)

    assert agents["general-purpose"]["model"].model_name == "openrouter/worker-lane"
    assert agents["repo-scout"]["model"].model_name == "openrouter/worker-lane"
    assert agents["runtime-engineer"]["model"].model_name == "openrouter/worker-lane"
    assert agents["verification-runner"]["model"].model_name == "openrouter/worker-lane"
    assert agents["frontend-craft"]["model"].model_name == "openrouter/ui-craft-lane"


def test_atlas_code_primary_model_accepts_openrouter_reasoning_effort() -> None:
    llm = make_code_llm("openrouter/owl-alpha", reasoning_effort="xhigh")
    assert llm.model_name == "openrouter/owl-alpha"
    assert llm.extra_body == {"reasoning": {"effort": "xhigh"}}


def test_atlas_code_reasoning_effort_config_normalizes_extra_high() -> None:
    assert _reasoning_effort_from_config({"reasoning_effort": "extra_high"}) == "xhigh"
    assert _reasoning_effort_from_config({"reasoning_effort": "Extra High"}) == "xhigh"
    assert _reasoning_effort_from_config({"reasoning_effort": "fast"}) is None


def test_atlas_code_tools_are_clean_room_coding_tools() -> None:
    assert {tool.name for tool in CODE_TOOLS} == {
        "shell",
        "query_neon",
        "write_file_anywhere",
        "read_file_anywhere",
        "append_file",
    }


def test_atlas_code_module_does_not_import_architect_or_extraction_tools() -> None:
    import src.graphs.code_agent as code_agent
    import src.graphs.code_tools as code_tools

    module_names = {
        getattr(value, "__module__", "")
        for value in vars(code_agent).values()
    } | {
        getattr(value, "__module__", "")
        for value in vars(code_tools).values()
    }
    assert "src.graphs.architect" not in module_names
    assert "src.graphs.tools" not in module_names
    assert "src.graphs.custom_tools" not in module_names


def test_atlas_code_uses_code_model_metadata_key() -> None:
    assert model_metadata_key_for_graph("atlas-code") == "code_model"
    assert model_metadata_key_for_graph("atlas-architect") == "architect_model"


def test_atlas_code_scope_is_vm_wide_not_platform_product() -> None:
    prompt = _code_prompt()
    assert ATLAS_CODE_FILESYSTEM_ROOT == "/"
    assert "The VM is your sandbox and trust boundary" in prompt
    assert "not an Atlas Platform product agent" in prompt
    assert "ordinary project/user files" in prompt
    assert "Do not accidentally brick the VM or yourself" in prompt


def test_atlas_code_prompt_uses_generative_ui_contract() -> None:
    prompt = _code_prompt()
    assert "assistant-ui message parts and Google's A2UI v0.9 protocol" in prompt
    assert "createSurface, updateComponents, updateDataModel, and deleteSurface" in prompt
    assert "catalogId atlas-code://a2ui/catalog/v1" in prompt
    assert "AtlasWorkCard" in prompt
    assert "implementation details" in prompt
    assert "User-visible text must be calm, direct, and operational" in prompt


def test_atlas_code_streams_primary_chunks_immediately() -> None:
    class DummyChunk:
        def __init__(self, content: str) -> None:
            self.content = content

    class DummyMessage:
        def __init__(self, content: str) -> None:
            self.content = content
            self.tool_calls: list[dict] = []

    class DummyGraph:
        async def astream_events(self, *_args, **_kwargs):
            yield {
                "event": "on_chat_model_stream",
                "run_id": "code-run",
                "metadata": {"lc_agent_name": "atlas-code"},
                "data": {"chunk": DummyChunk("streamed ")},
            }
            yield {
                "event": "on_chat_model_stream",
                "run_id": "code-run",
                "metadata": {"lc_agent_name": "atlas-code"},
                "data": {"chunk": DummyChunk("delta")},
            }
            yield {
                "event": "on_chat_model_end",
                "run_id": "code-run",
                "metadata": {"lc_agent_name": "atlas-code"},
                "data": {"output": DummyMessage("streamed delta")},
            }

    async def collect_frames() -> list[dict[str, str]]:
        frames: list[dict[str, str]] = []
        async for frame in _iter_sse_model_events(
            DummyGraph(),
            stream_input={},
            config={},
            thread_id="thread-1",
            atlas_run_id="atlas-run-1",
            primary_actor_id="atlas-code",
        ):
            frames.append(frame)
        return frames

    frames = asyncio.run(collect_frames())
    partial_payloads = [
        json.loads(frame["data"])[0]["content"]
        for frame in frames
        if frame["event"] == "messages/partial"
    ]
    assert partial_payloads == ["streamed ", "delta"]
