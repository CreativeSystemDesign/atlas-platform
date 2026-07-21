"""Atlas Architect - the primary Deep Agent.

Full-featured Deep Agent with filesystem access, mixed worker delegation
(Deep Agents and regular agents), domain tools, and persistent memory via
Neon PostgreSQL.
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from typing import Any, cast

from deepagents import AsyncSubAgent, create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend, StoreBackend
from deepagents.middleware.filesystem import FilesystemMiddleware
from deepagents.middleware.patch_tool_calls import PatchToolCallsMiddleware
from deepagents.middleware.skills import SkillsMiddleware
from deepagents.middleware.subagents import CompiledSubAgent, SubAgent, SubAgentMiddleware
from deepagents.middleware.summarization import create_summarization_middleware
from langchain.agents import create_agent
from langchain.agents.middleware import (
    AgentMiddleware,
    ModelRequest,
    ModelResponse,
    TodoListMiddleware,
)
from langchain.tools import ToolRuntime
from langchain_anthropic.middleware import AnthropicPromptCachingMiddleware
from langchain_core.messages import SystemMessage
from langchain_core.messages.tool import ToolMessage
from langchain_openai import ChatOpenAI

from src.config import settings
from src.graphs.hitl_policy import interrupt_on_policy
from src.graphs.tools import ATLAS_TOOLS, search_architect_memories

SKILLS_DIR = os.path.join(os.path.dirname(__file__), "skills")
ATLAS_ROOT = settings.atlas_root
ATLAS_DOCUMENTS_ROOT = settings.atlas_documents_root
DATA_EXTRACTION_OUTPUT_ROOT = (
    f"{settings.atlas_agent_workbench_root}/data-extraction-supervisor/outputs"
)
_TOOLS_BY_NAME = {tool.name: tool for tool in ATLAS_TOOLS}
_DOCUMENT_EXTRACTION_TOOL_NAMES = {
    "inspect_pdf_document",
    "extract_pdf_text_layer",
    "extract_pdf_tables",
    "parse_electrical_parts_list",
    "parse_cable_list",
    "detect_schematic_spine_slice0",
    "build_schematic_page_evidence",
    "ocr_pdf_pages",
    "analyze_pdf_visual_region",
    "preview_csv",
    "inspect_csv_deterministic",
    "compare_csvs_deterministic",
    "validate_parts_list_against_pdf",
}
_ARCHITECT_TOOL_NAMES = tuple(
    tool.name for tool in ATLAS_TOOLS if tool.name not in _DOCUMENT_EXTRACTION_TOOL_NAMES
)

_INTERNAL_STATUS_JSON_CONTRACT = (
    "For every internal progress update or mission result you send upward, use a plain JSON object with no code fences and no markdown. "
    "Keep it dynamic but structured enough for the UI. "
    "Preferred keys: message_type, status, summary, details, metrics, artifacts, warnings, next_action. "
    "summary should be one concise sentence. "
    "details should be a short array of strings when needed. "
    "metrics should be an object for dynamic numeric facts such as row_count, pages_processed, or confidence. "
    "artifacts should be an array of absolute VM paths when you produced a file. "
    "warnings should be an array of strings when there are material caveats, otherwise an empty array. "
    "next_action should be a short string only when another immediate step is pending. "
    "Do not include markdown headings, bold text, tables, or prose outside the JSON object."
)


_ARCHITECT_LOCAL_INVARIANTS = (
    "Architect runtime memory: /memories/ is Atlas Architect's durable long-term memory filesystem. "
    "Paths under /memories/ are backed by the Redis LangGraph Store and persist across threads and server restarts. "
    "When the operator asks you to remember, save to memory, update memory, or preserve operational knowledge for future sessions, write or edit a concise Markdown note under /memories/. "
    "When prior Atlas operational knowledge is relevant, use search_architect_memories with a topic query before claiming you do not know; read exact /memories/ paths only when you know the path. "
    "Never use shell, sudo, ls, find, mkdir, cat, or other OS commands to inspect or modify /memories/; /memories/ is a virtual store route, not a Linux directory. "
    "Use file tools such as read_file_anywhere, write_file_anywhere, append_file, grep, or glob for /memories/ paths. "
    "Do not create files under the repository memory/ directory for Architect long-term memory unless the operator explicitly asks for a Git-tracked reference document. "
    "Use the architect-runtime skill when you need the detailed runtime reference for memory, backend routing, persistence, or framework capabilities. "
    "For local LangChain, LangGraph, or DeepAgents documentation corpus lookup, search_langchain_docs is the Qdrant vector-store retrieval tool; use it instead of shell, glob, grep, or direct local docs file reads unless the operator explicitly asks for filesystem inspection. "
    "Atlas local invariants: For every production-document extraction, validation, parser-development, parser-testing, single-document, multi-document, whole-machine, or long-running extraction mission, Architect is orchestration-only. "
    "Architect must launch the async extraction-orchestrator and report its task_id rather than delegating directly to data-extraction-supervisor or blocking on the extraction work. "
    "Architect must never call data-extraction-supervisor directly for extraction or validation. The canonical extraction chain is Architect -> extraction-orchestrator -> data-extraction-supervisor -> specialists. "
    "For extraction requests, Architect's responsibility is limited to identifying the target file or document set, passing the operator intent and constraints to extraction-orchestrator, and using async task controls for status, steering, or cancellation. "
    "Every operator request to extract data from a PDF or machine documentation set must be treated as a fresh extraction mission from the source documents. "
    "Architect must never satisfy an extraction request by reading or summarizing pre-existing CSV, JSON, TXT, or other derived artifacts unless the operator explicitly asked for that existing artifact. "
    f"Files under {DATA_EXTRACTION_OUTPUT_ROOT}/ and any derived sidecars stored under documents/ are outputs, not sources, and are off-limits for source selection during extraction requests. Never invent a new output path under documents/ for an extraction artifact. Do not launch a follow-on copy, move, schema-mapper pass, or file rewrite just to mirror an extraction artifact back into documents/. "
    "Architect must not inspect PDF contents, choose extraction specialists, or read extraction workflow skill files at runtime before delegation when the request is already clearly an extraction task. "
    "When using extraction-orchestrator, Architect must give it the machine/document scope, requested extraction goals, output constraints, and any operator priority; the orchestrator owns campaign execution and calls data-extraction-supervisor as needed. "
    "Specialist selection belongs to data-extraction-supervisor after delegation. "
    "If the target document is ambiguous, Architect may do one narrow document lookup only to resolve the file path, then it must delegate immediately. "
    "Architect must not preview extracted CSV contents during validation entry. "
    "If an extraction mission returns an empty supervisor result, malformed supervisor result, explicit worker failure, downstream STOPPED status, or no extracted artifact at the requested output path, Architect must surface that extraction failure to the operator and stop. "
    "If a validation mission returns a worker failure, empty output, malformed output, or downstream STOPPED status from data-extraction-supervisor, Architect must surface that failure to the operator and stop. "
    "Architect must not recover such extraction or validation failures by using shell, polling the filesystem, reading files for manual comparison, rendering PDFs, previewing CSVs, retrying with a more comprehensive mission brief, or delegating to general-purpose, repo-researcher, document-researcher, or any worker outside data-extraction-supervisor for that mission. "
    "No self-rescue, no manual validation, no filesystem polling, and no fallback outside the extraction chain. "
    "Operator-facing chat should stay drill-down friendly: keep the main answer concise, outcome-first, and free of raw JSON, mission packages, worker narration, or tool logs; those belong in runtime drill-down surfaces. "
    "For extraction requests, do not emit conversational preambles such as 'I'll read the workflow' or 'I'll extract the data.' "
    "After the operator prompt, visible Architect text should be limited to delegation/status updates and the final artifact result. "
    "Use wording such as 'Launching extraction-orchestrator' or 'Extraction task started'; the transcript should otherwise show what Architect instructed the async orchestrator to do. "
    "When returning any downloadable artifact, include the absolute VM path in backticks so the dashboard can render it as a download link, and prefer calling it out explicitly as the downloadable artifact. "
    "For successful extraction missions, the final operator-facing closeout must include the downloadable artifact path in backticks, the extracted row count when known, and a direct question asking whether the operator wants the extracted data saved to Neon. Architect must trust the successful supervisor artifact summary and must not use shell, filesystem checks, ls, cat, head, or ad hoc file reads just to verify or preview the artifact before replying. Architect must not run shell, list files, or preview the written CSV after a successful extraction just to restate row counts, sample rows, or file existence. "
    "Tell extraction-orchestrator to omit output_path unless the operator explicitly supplied an output path under "
    f"{DATA_EXTRACTION_OUTPUT_ROOT}/. "
    "Never invent ad hoc output paths such as .atlas/outputs, /tmp, /extractions, or documents/. "
    "If the operator asks for Schematic Spine Slice 0 extraction, tell extraction-orchestrator not to broaden the request into generic wire, terminal, connection-matrix, or CSV extraction, and to require detect_schematic_spine_slice0 via spatial-analysis-agent through data-extraction-supervisor. "
    "Do not list documents or read workflow skills first when the operator already provided the exact PDF path for Schematic Spine Slice 0; launch extraction-orchestrator with that exact scope. "
    "When no extraction output path is specified, use the standardized Atlas extraction "
    f"workbench root at {DATA_EXTRACTION_OUTPUT_ROOT}/ rather than documents/ or ad hoc "
    "repo locations. "
    "Do not suggest validation, reference-file comparison, database ingestion, or any other follow-up by default after a successful extraction unless the operator explicitly asked for that. "
    "Do not save extracted data to Neon unless the operator explicitly approves it. "
    "If the operator approves, use save_extracted_csv_to_neon rather than re-running extraction."
)

_MEMORY_RECALL_TRIGGER_TERMS = {
    "architect",
    "cable",
    "deep agent",
    "deepagent",
    "extract",
    "extraction",
    "framework",
    "langchain",
    "langgraph",
    "memory",
    "qdrant",
    "recall",
    "remember",
    "schematic",
    "slice",
    "tool",
    "validation",
    "vector",
    "workflow",
}


def _architect_system_prompt(system_prompt: str) -> str:
    return f"{_ARCHITECT_LOCAL_INVARIANTS}\n\n{system_prompt}"


def _content_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and isinstance(block.get("text"), str):
                parts.append(str(block["text"]))
        return " ".join(parts)
    return str(content) if content is not None else ""


def _latest_human_text(messages: list[object]) -> str:
    for message in reversed(messages):
        if getattr(message, "type", None) == "human":
            return _content_text(getattr(message, "content", ""))
    return ""


def _should_auto_recall_memory(text: str) -> bool:
    lower = text.lower()
    docs_vector_only = (
        "search_langchain_docs" in lower
        or "vector store" in lower
        or "vector-store" in lower
        or "qdrant" in lower
    ) and any(term in lower for term in ("langchain", "langgraph", "deep agent", "deepagents"))
    if docs_vector_only:
        return False
    if "what do you remember" in lower or "we solved" in lower or "last time" in lower:
        return True
    return any(term in lower for term in _MEMORY_RECALL_TRIGGER_TERMS)


def _is_vector_store_only_request(text: str) -> bool:
    lower = text.lower()
    source_limited = (
        "only your vector store" in lower
        or "only the vector store" in lower
        or "using only your vector store" in lower
        or "use only the search_langchain_docs tool" in lower
        or "do not use memory tools" in lower
        or "do not use shell" in lower
        or "do not use filesystem" in lower
    )
    docs_related = any(
        term in lower
        for term in (
            "langchain",
            "langgraph",
            "deep agent",
            "deepagents",
            "agents.md",
            "vector-store docs",
        )
    )
    return source_limited and docs_related


def _tool_name(tool: object) -> str:
    if isinstance(tool, dict):
        function = tool.get("function")
        if isinstance(function, dict) and isinstance(function.get("name"), str):
            return function["name"]
        if isinstance(tool.get("name"), str):
            return str(tool["name"])
        return ""
    return str(getattr(tool, "name", ""))


class ArchitectMemoryRecallMiddleware(AgentMiddleware):
    """Inject small, topic-matched Architect memories for high-signal prompts."""

    def _request_with_recall(self, request: ModelRequest) -> ModelRequest:
        user_text = _latest_human_text(cast("list[object]", request.messages)).strip()
        if _is_vector_store_only_request(user_text):
            allowed_tools = [tool for tool in request.tools if _tool_name(tool) == "search_langchain_docs"]
            return request.override(tools=allowed_tools)
        if not user_text or not _should_auto_recall_memory(user_text):
            return request

        recall = search_architect_memories.invoke({"query": user_text[:1200], "limit": 3})
        if (
            not isinstance(recall, str)
            or recall.startswith("No Architect memories matched")
            or recall.startswith("Error searching Architect memories")
            or recall.startswith("Query must")
        ):
            return request

        recall_prompt = (
            "Relevant Atlas Architect long-term memories were retrieved automatically. "
            "Use them only when relevant, preserve the source /memories/ paths when citing operational facts, "
            "and do not mention this automatic recall unless it helps the operator.\n\n"
            f"{recall}"
        )
        if request.system_message is not None:
            new_system_content = [
                *request.system_message.content_blocks,
                {"type": "text", "text": f"\n\n{recall_prompt}"},
            ]
        else:
            new_system_content = [{"type": "text", "text": recall_prompt}]
        return request.override(
            system_message=SystemMessage(
                content=cast("list[str | dict[str, str]]", new_system_content)
            )
        )

    def _block_non_vector_tool(self, request: Any) -> ToolMessage | None:
        state_messages = cast("dict[str, object]", request.state).get("messages", [])
        user_text = _latest_human_text(cast("list[object]", state_messages)).strip()
        if not _is_vector_store_only_request(user_text):
            return None
        tool_name = request.tool.name if request.tool else request.tool_call["name"]
        if tool_name == "search_langchain_docs":
            return None
        return ToolMessage(
            content=(
                "Tool blocked: the operator explicitly limited this run to the local "
                "Qdrant vector-store docs source. Use search_langchain_docs only."
            ),
            tool_call_id=request.tool_call["id"],
            name=tool_name,
            status="error",
        )

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        return handler(self._request_with_recall(request))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        return await handler(self._request_with_recall(request))

    def wrap_tool_call(
        self,
        request: Any,
        handler: Callable[[Any], ToolMessage | Any],
    ) -> ToolMessage | Any:
        if blocked := self._block_non_vector_tool(request):
            return blocked
        return handler(request)

    async def awrap_tool_call(
        self,
        request: Any,
        handler: Callable[[Any], Awaitable[ToolMessage | Any]],
    ) -> ToolMessage | Any:
        if blocked := self._block_non_vector_tool(request):
            return blocked
        return await handler(request)


def _toolset(*names: str):
    missing = [name for name in names if name not in _TOOLS_BY_NAME]
    if missing:
        msg = f"Unknown Architect tool(s): {', '.join(sorted(missing))}"
        raise ValueError(msg)
    return [_TOOLS_BY_NAME[name] for name in names]


def _make_composite_backend(runtime: ToolRuntime) -> CompositeBackend:
    """Disk under ATLAS_ROOT; `/memories/` routes to LangGraph Store."""
    del runtime
    fs = FilesystemBackend(root_dir=ATLAS_ROOT, virtual_mode=False)
    store_backend = StoreBackend(
        namespace=lambda ctx: ("atlas-architect", "memories"),
    )
    return CompositeBackend(default=fs, routes={"/memories/": store_backend})


def make_architect_llm(model_id: str | None = None) -> ChatOpenAI:
    mid = model_id or settings.architect_model
    return ChatOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=settings.openrouter_api_key,
        model=mid,
        temperature=0.1,
        max_retries=3,
    )


def make_worker_llm(model_id: str | None = None) -> ChatOpenAI:
    mid = model_id or settings.worker_model
    return ChatOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=settings.openrouter_api_key,
        model=mid,
        temperature=0.1,
        max_retries=3,
    )


def make_data_extraction_llm(model_id: str | None = None, *, json_mode: bool = False) -> Any:
    mid = model_id or settings.data_extraction_model
    api_key = settings.openrouter_data_extraction_api_key or settings.openrouter_api_key
    llm = ChatOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key,
        model=mid,
        temperature=0.1,
        max_retries=3,
    )
    if json_mode:
        return llm.bind(response_format={"type": "json_object"})
    return llm


def _deep_subagent(
    *,
    name: str,
    description: str,
    system_prompt: str,
    tool_names: tuple[str, ...],
    model: ChatOpenAI | None = None,
) -> SubAgent:
    """A Deep Agents-style worker subagent.

    The parent `create_deep_agent(...)` call applies the standard Deep Agents
    middleware stack to these dictionary specs, plus the explicit `skills`
    configured here.
    """

    return {
        "name": name,
        "description": description,
        "system_prompt": system_prompt,
        "model": model or make_worker_llm(),
        "tools": _toolset(*tool_names),
        "skills": [SKILLS_DIR],
    }


def _regular_subagent(
    *,
    name: str,
    description: str,
    system_prompt: str,
    tool_names: tuple[str, ...],
) -> CompiledSubAgent:
    """A focused regular LangChain agent exposed as a Deep Agents subagent."""

    runnable = create_agent(
        model=make_architect_llm(),
        system_prompt=_architect_system_prompt(system_prompt),
        tools=_toolset(*tool_names),
        name=name,
    )
    return {
        "name": name,
        "description": description,
        "runnable": runnable,
    }


def _compiled_extraction_worker(
    *,
    name: str,
    description: str,
    system_prompt: str,
    tool_names: tuple[str, ...],
    filesystem_access: bool = True,
) -> CompiledSubAgent:
    """A focused extraction worker with no nested subagent universe."""

    middleware = [
        TodoListMiddleware(),
        *( [FilesystemMiddleware(backend=_make_composite_backend)] if filesystem_access else [] ),
        SkillsMiddleware(backend=_make_composite_backend, sources=[SKILLS_DIR]),
        create_summarization_middleware(make_data_extraction_llm(), _make_composite_backend),
        AnthropicPromptCachingMiddleware(unsupported_model_behavior="ignore"),
        PatchToolCallsMiddleware(),
    ]
    runnable = create_agent(
        model=make_data_extraction_llm(json_mode=True),
        system_prompt=system_prompt,
        tools=_toolset(*tool_names),
        middleware=middleware,
        name=name,
    )
    return {
        "name": name,
        "description": description,
        "runnable": runnable,
    }


def build_data_extraction_subagents() -> list[CompiledSubAgent]:
    """Specialist worker topology for industrial PDF extraction and tracing."""

    return [
        _compiled_extraction_worker(
            name="vision-extractor",
            description=(
                "Use for visually complex document regions, mixed text-and-graphics pages, "
                "ambiguous layouts, bilingual labels, and visual verification from rendered PDF images."
            ),
            system_prompt=(
                "You are the Atlas vision extractor. Use rendered PDF images to inspect what is visually on the page. "
                "Focus on grounded observations, call out uncertainty, and include page numbers, regions, and evidence in your output."
            ),
            tool_names=(
                "inspect_pdf_document",
                "analyze_pdf_visual_region",
                "extract_pdf_text_layer",
                "ocr_pdf_pages",
                "read_file_anywhere",
            ),
        ),
        _compiled_extraction_worker(
            name="ocr-extractor",
            description=(
                "Use for scanned PDFs, broken text layers, and text recovery from rendered pages where OCR is the main path."
            ),
            system_prompt=(
                "You are the Atlas OCR extractor. Recover text faithfully from industrial PDFs when the native text layer is absent, noisy, or incomplete. "
                "Preserve page boundaries, note OCR uncertainty, and do not hallucinate unreadable text."
            ),
            tool_names=(
                "inspect_pdf_document",
                "ocr_pdf_pages",
                "extract_pdf_text_layer",
                "read_file_anywhere",
                "write_file_anywhere",
            ),
        ),
        _compiled_extraction_worker(
            name="table-structure-extractor",
            description=(
                "Use for parts lists, cable lists, parameter sheets, and any complex table with merged headers, nested fields, or continuation rows."
            ),
            system_prompt=(
                "You are the Atlas table structure extractor. Reconstruct complex industrial tables, including parent headers, child columns, merged cells, and row continuations. "
                "For manufacturer-style electrical parts lists with repeated metadata headers and carry-forward subrows, prefer parse_electrical_parts_list before improvising scripts or ad hoc parsing. For cable lists, prefer parse_cable_list and let it infer the family profile unless the mission explicitly calls out machine-cable or vacuum-system handling. "
                "For electrical parts lists, use parse_electrical_parts_list with output_contract='row_preserving' unless the mission explicitly requests expanded per-symbol output. "
                "For cable lists, use parse_cable_list with output_contract='wire_labels' unless the operator explicitly asks for a fuller row-preserving table export. The primary cable-list contract is one output row per wire label with Source Page, Cable Number, Originating Point, Termination Point, Wire Label, and Is Continuation Row. "
                "A successful cable-list artifact written with output_contract='wire_labels' is already the final deliverable. Do not reopen it, reshape it, explode it again, consolidate it, read it back for transformation, or ask Architect to post-process it. "
                "If the mission brief specifies an output path, call the relevant deterministic parser with output_csv_path set to that final path and write the artifact directly instead of returning a large inline dataset. "
                f"If the mission brief does not specify an output path, write the final extraction artifact under {DATA_EXTRACTION_OUTPUT_ROOT}/. "
                f"Generated extraction artifacts belong under {DATA_EXTRACTION_OUTPUT_ROOT}/; do not ask for, create, or mirror them under documents/. "
                "When you write the final artifact directly, return only a concise artifact summary with output path, row count, and any material warnings. "
                "After a successful direct artifact write, stop. Do not reopen the written CSV, do not inspect sample rows, and do not generate markdown tables, column inventories, or long prose summaries unless the operator explicitly asked for them. "
                "Do not ask another worker to wait for the full dataset in a follow-up message and do not paste large extracted tables into chat. "
                "Return explicit assumptions when the table structure is ambiguous. "
                f"{_INTERNAL_STATUS_JSON_CONTRACT}"
            ),
            tool_names=(
                "inspect_pdf_document",
                "extract_pdf_tables",
                "extract_pdf_text_layer",
                "parse_electrical_parts_list",
                "parse_cable_list",
                "ocr_pdf_pages",
                "read_file_anywhere",
                "write_file_anywhere",
            ),
        ),
        _compiled_extraction_worker(
            name="schema-mapper",
            description=(
                "Use for normalizing extracted document fields into canonical Atlas rows, CSV-ready structures, and validated schemas."
            ),
            system_prompt=(
                "You are the Atlas schema mapper. Convert raw document extraction results into clear, canonical structures. "
                f"Keep every field grounded to source evidence and avoid silently dropping columns or merged-cell context. Do not copy, move, or mirror completed extraction artifacts from {DATA_EXTRACTION_OUTPUT_ROOT}/ back into documents/. Source documents are inputs only; generated extraction artifacts stay in the standardized output root unless the operator explicitly requests a different export path."
            ),
            tool_names=(
                "extract_pdf_tables",
                "extract_pdf_text_layer",
                "ocr_pdf_pages",
                "read_file_anywhere",
                "write_file_anywhere",
                "append_file",
            ),
        ),
        _compiled_extraction_worker(
            name="spatial-analysis-agent",
            description=(
                "Use for wiring, terminals, connection tracing, continuation symbols, and page-to-page spatial reasoning through schematics and diagrams."
            ),
            system_prompt=(
                "You are the Atlas spatial analysis agent. Trace connections through diagrams, terminals, and page continuations. "
                "For the current schematic-spine proof, prefer detect_schematic_spine_slice0 when the mission asks for Slice 0 component fingerprint detection, and use build_schematic_page_evidence when the mission asks for page-owned evidence bundles without requiring the ELB template to appear. "
                "When using detect_schematic_spine_slice0 for the standard production Slice 0 mission, pass only pdf_path, page_from=7, page_to=7, max_pages=1, and min_score=0.99. "
                "Do not pass output_dir or vector_db_path unless the operator explicitly supplied a schematic-spine-specific output directory or alternate vectors.db. "
                "Ignore generic CSV output paths from extraction workflow briefs for this tool; detect_schematic_spine_slice0 returns artifact_json, canonical_render, reconstruction_overlay, component_marks_overlay, reference_candidates_overlay, terminal_nodes_overlay, terminal_wire_overlay, reference_wire_overlay, graphic_atoms_overlay, wire_segments_overlay, wire_trace_overlay, wire_paths_overlay, wire_interactions_overlay, text_associations_overlay, validation_overlay, and evidence_overlay under the schematic-spine output root. "
                "Prefer exact symbol-to-symbol and terminal-to-terminal evidence, and say when a connection cannot be confirmed from the visible document set."
            ),
            tool_names=(
                "inspect_pdf_document",
                "detect_schematic_spine_slice0",
                "build_schematic_page_evidence",
                "analyze_pdf_visual_region",
                "extract_pdf_text_layer",
                "ocr_pdf_pages",
                "read_file_anywhere",
            ),
        ),
        _compiled_extraction_worker(
            name="validation-analyst",
            description=(
                "Use only after extraction output exists and validation is required. Prefer PDF-grounded validation in production and use reference CSV comparison only when explicitly provided for development/testing."
            ),
            system_prompt=(
                "You are the Atlas validation analyst. Validate extracted artifacts only after extraction is complete. "
                "Return a structured validation package to the supervisor, not an operator-facing final report. "
                "Your first choice must be the deterministic validation tools you already have. Do not inspect SKILL.md or other non-CSV files during validation runs. "
                "For development/testing with an explicit reference CSV, use compare_csvs_deterministic first and inspect_csv_deterministic only for exact file statistics. "
                "For production validation without a reference CSV, use validate_parts_list_against_pdf page by page or in small chunks against the source PDF. "
                "When a deterministic validation tool returns structured output, your final answer must be that structured payload with only minimal wrapping and no markdown tables or long narrative rewrite. "
                "If validate_parts_list_against_pdf or compare_csvs_deterministic fails, returns empty output, or returns malformed output, surface that failure explicitly and stop. "
                "Do not use ad hoc scripts, grep, glob, or raw file reads to count or compare CSV files. "
                "Do not use a validation CSV to define the extraction schema retroactively. Report confirmed rows, suspect rows, missing_from_extraction, extra_in_extraction, ambiguous rows, unresolved differences, and confidence. "
                f"{_INTERNAL_STATUS_JSON_CONTRACT}"
            ),
            tool_names=(
                "inspect_csv_deterministic",
                "compare_csvs_deterministic",
                "validate_parts_list_against_pdf",
            ),
            filesystem_access=False,
        ),
    ]


def _data_extraction_specialist() -> CompiledSubAgent:
    """Nested Deep Agent that leads the data extraction worker team."""

    middleware = [
        TodoListMiddleware(),
        SkillsMiddleware(backend=_make_composite_backend, sources=[SKILLS_DIR]),
        SubAgentMiddleware(
            backend=_make_composite_backend,
            subagents=build_data_extraction_subagents(),
        ),
        create_summarization_middleware(make_data_extraction_llm(), _make_composite_backend),
        AnthropicPromptCachingMiddleware(unsupported_model_behavior="ignore"),
        PatchToolCallsMiddleware(),
    ]
    runnable = create_agent(
        model=make_data_extraction_llm(json_mode=True),
        system_prompt=(
            "You are the Atlas data extraction supervisor. You are accountable for the extraction mission end-to-end. "
            "Inspect the document first, choose the right extraction workers, delegate aggressively, reconcile disagreements, and return grounded structured output with evidence. "
            "You supervise the extraction; you do not perform extraction-heavy work yourself when a team worker is appropriate. "
            "Worker capability roster: "
            "vision-extractor -> inspect_pdf_document, analyze_pdf_visual_region, extract_pdf_text_layer, ocr_pdf_pages. "
            "ocr-extractor -> inspect_pdf_document, ocr_pdf_pages, extract_pdf_text_layer. "
            "table-structure-extractor -> inspect_pdf_document, extract_pdf_tables, extract_pdf_text_layer, parse_electrical_parts_list, parse_cable_list, ocr_pdf_pages. "
            "schema-mapper -> extract_pdf_tables, extract_pdf_text_layer, ocr_pdf_pages. "
            "spatial-analysis-agent -> inspect_pdf_document, detect_schematic_spine_slice0, build_schematic_page_evidence, analyze_pdf_visual_region, extract_pdf_text_layer, ocr_pdf_pages. "
            "validation-analyst -> inspect_csv_deterministic, compare_csvs_deterministic, validate_parts_list_against_pdf. "
            "Delegate based on those worker capabilities, but do not use worker-only tools yourself. "
            "For Schematic Spine Slice 0 missions, delegate to spatial-analysis-agent and preserve the tool contract: the worker should call detect_schematic_spine_slice0 with only pdf_path, page_from=7, page_to=7, max_pages=1, and min_score=0.99 unless the operator explicitly supplied schematic-spine-specific overrides. Do not turn a generic CSV output path into detect_schematic_spine_slice0 output_dir. "
            "If an extraction mission specifies a final output path and the selected worker can write that artifact directly, require the worker to write the final artifact at that path during the extraction step. "
            f"If no output path is specified, require the final extraction artifact to be written under {DATA_EXTRACTION_OUTPUT_ROOT}/. "
            f"Never invent a new output path under documents/ for an extraction artifact. Source documents under {ATLAS_DOCUMENTS_ROOT}/ are inputs, not destinations for generated extraction files. "
            f"If a worker returns a successful artifact path under {DATA_EXTRACTION_OUTPUT_ROOT}/, treat that returned path as canonical even if an earlier draft path differed. "
            "If a delegated task description or your own draft mentions copying an artifact into documents/, ignore that instruction and return the canonical output-root artifact instead. "
            "Do not launch a follow-on copy, move, schema-mapper pass, or file rewrite just to mirror an extraction artifact back into documents/. "
            "After the selected extraction worker returns a successful artifact path and row count, stop extraction work and return that result upward. "
            "A worker writing to the standardized output root is success, not a path mismatch that needs correction. "
            "Do not route large inline datasets through chat and do not ask a downstream worker to wait for the full dataset in a follow-up message. "
            "Do not ask workers to read workflow skills at runtime, summarize workflow skills, or explain their tool roster back to you. "
            "Supervisor updates should be operational status only: inspection started, worker delegated, extraction complete, or failure. Do not produce operator-style preambles while a worker is already running. "
            "Use schema-mapper only when normalization is actually needed after an artifact already exists or when a worker cannot write the final structure directly. "
            "During extraction, you may delegate only to the extraction team workers: vision-extractor, ocr-extractor, table-structure-extractor, schema-mapper, spatial-analysis-agent. "
            "Do not route extraction work to platform builders, repo researchers, or any broad general agent outside this team. "
            "After a worker returns a successful artifact summary with output path and row count, do not perform extra verification steps such as list_documents just to confirm the file exists unless the mission explicitly requires verification. "
            "For normal successful extraction missions, your operator-facing contribution should be minimal: one short mission result with artifact path, row count, and only material warnings. "
            "Use validation-analyst only in a separate validation phase after the extraction artifact exists. For validation missions, do not preview CSV or PDF contents yourself unless the mission brief itself is malformed. "
            "If validation-analyst fails, returns empty output, or returns malformed output, report that worker failure upward and stop; do not validate the CSV or PDF yourself. "
            "After validation, return one concise mission package upward to Architect; do not produce an operator-facing final report yourself. "
            "Do not create, edit, debug, or iterate on temporary scripts yourself. "
            "If an extraction pass is incomplete, choose one bounded re-extraction or one bounded normalization pass through the team. "
            "After one re-extraction and one normalization attempt, either return the best grounded result with explicit gaps or fail clearly. "
            "Do not loop on repeated verification of temporary files. "
            f"{_INTERNAL_STATUS_JSON_CONTRACT}"
        ),
        tools=_toolset(
            "list_documents",
            "inspect_pdf_document",
        ),
        middleware=middleware,
        name="data-extraction-supervisor",
    )
    return {
        "name": "data-extraction-supervisor",
        "description": (
            "Use for any serious PDF extraction, table reconstruction, OCR recovery, diagram tracing, "
            "or schema normalization task on production machine documentation. This specialist leads the data extraction worker team."
        ),
        "runnable": runnable,
    }


def _async_extraction_orchestrator() -> AsyncSubAgent:
    """Remote/background extraction campaign orchestrator for Architect."""

    return {
        "name": "extraction-orchestrator",
        "description": (
            "Use for every document extraction, validation, parser-development, parser-testing, "
            "single-document, multi-document, whole-machine, production-scale, or long-running "
            "extraction mission. This async orchestrator is the mandatory chain-of-command gate "
            "between Architect and data-extraction-supervisor so Architect remains available for "
            "other VM, file, repo, or operator tasks."
        ),
        "graph_id": "extraction-orchestrator",
        "url": settings.async_subagent_server_url,
    }


def _extraction_orchestrator_system_prompt() -> str:
    return (
        "You are Atlas extraction-orchestrator, an async Deep Agent responsible for long-running "
        "industrial documentation extraction campaigns. You are not the top-level Architect. "
        "Your job is to translate a machine-level or document-set request into bounded extraction "
        "missions, keep campaign state clear, and call data-extraction-supervisor for extraction "
        "strategy and specialist selection. "
        "You must not inspect PDF contents yourself, read source PDFs directly, parse document text, "
        "validate tables yourself, or use file-reading tools as a substitute for the supervisor chain. "
        "Use list_documents only to resolve the requested document set or disambiguate machine paths; "
        "do not use it after a concrete PDF path is already known unless the path is ambiguous. "
        "Use prepare_data_extraction_workflow when a concrete source PDF and extraction goal are known, "
        "then delegate the returned mission brief to data-extraction-supervisor without changing the "
        "canonical output path. "
        "For inspectability checks, parser development, parser testing, extraction readiness checks, "
        "validation smoke tests, single-document extraction, and full extraction, prepare the mission "
        "brief and call data-extraction-supervisor; do not answer from your own document inspection. "
        "For one document, call data-extraction-supervisor once. For multiple documents, sequence the "
        "current campaign into clear document-level missions and return a manifest-style status with "
        "task scope, document paths, output artifact paths, row counts when known, failures, and next "
        "action. Do not choose extraction specialists yourself; data-extraction-supervisor decides "
        "whether workers such as table-structure-extractor, ocr-extractor, vision-extractor, "
        "spatial-analysis-agent, schema-mapper, or validation-analyst are needed. "
        f"All generated extraction artifacts belong under {DATA_EXTRACTION_OUTPUT_ROOT}/ unless the "
        "operator explicitly supplied another allowed output path. Do not mirror generated artifacts "
        "back into documents/. "
        "Return concise structured progress and final results. Include the async task's useful outcome, "
        "not raw worker chatter. "
        f"{_INTERNAL_STATUS_JSON_CONTRACT}"
    )


def build_extraction_orchestrator_graph(
    checkpointer=None,
    store=None,
    system_prompt: str | None = None,
    model_id: str | None = None,
):
    """Build the async extraction campaign orchestrator graph.

    This graph is launched by Architect through Deep Agents' AsyncSubAgent
    middleware and keeps the existing compiled data-extraction-supervisor as
    the authority for document-level strategy and specialist selection.
    """

    base_prompt = system_prompt or ""
    prompt = _extraction_orchestrator_system_prompt()
    if base_prompt:
        prompt = f"{prompt}\n\nAtlas global operating context:\n{base_prompt}"
    return create_deep_agent(
        name="extraction-orchestrator",
        model=make_architect_llm(model_id),
        system_prompt=prompt,
        tools=_toolset(
            "list_documents",
            "prepare_data_extraction_workflow",
        ),
        backend=_make_composite_backend,
        skills=[SKILLS_DIR],
        subagents=[_data_extraction_specialist()],
        checkpointer=checkpointer,
        store=store,
    )


def get_extraction_orchestrator_topology() -> dict[str, list[dict[str, object]]]:
    """Static topology for the async extraction campaign graph."""

    topology = get_architect_topology()
    extraction_ids = {
        "data-extraction-supervisor",
        "validation-analyst",
        "vision-extractor",
        "ocr-extractor",
        "table-structure-extractor",
        "schema-mapper",
        "spatial-analysis-agent",
    }
    nodes: list[dict[str, object]] = [
        {
            "id": "extraction-orchestrator",
            "type": "deep-agent",
            "role": "campaign-orchestrator",
            "label": "Extraction orchestrator",
            "description": "Async campaign graph for machine-scale extraction work.",
            "tools": [
                "list_documents",
                "prepare_data_extraction_workflow",
                "task",
            ],
        },
        *[
            node for node in topology["nodes"] if str(node.get("id")) in extraction_ids
        ],
    ]
    edges = [
        {
            "source": "extraction-orchestrator",
            "target": "data-extraction-supervisor",
            "kind": "delegates_to",
        },
        *[
            edge
            for edge in topology["edges"]
            if str(edge.get("source")) in extraction_ids
            and str(edge.get("target")) in extraction_ids
        ],
    ]
    return {"nodes": nodes, "edges": edges}


def build_architect_subagents() -> list[SubAgent | CompiledSubAgent | AsyncSubAgent]:
    """Mixed worker topology for Architect.

    This intentionally uses both:
    - Deep Agents-style subagents (`SubAgent` dicts) for builder workers
    - regular compiled LangChain agents (`CompiledSubAgent`) for bounded,
      focused research workers
    - a nested Deep Agent specialist for data extraction work

    We explicitly override Deep Agents' default `general-purpose` worker so
    Atlas can forbid extraction/validation fallback outside the dedicated
    extraction chain.
    """

    return [
        _deep_subagent(
            name="general-purpose",
            description=(
                "Framework fallback worker for generic non-document tasks only. "
                "It must not perform production-document extraction or validation work."
            ),
            system_prompt=(
                "You are the Atlas general-purpose worker. Help only with generic non-document tasks that do not fit a specialized worker. "
                "You must never accept, recover, or continue a production-document extraction or validation mission. "
                "If a request involves extracting from PDFs, validating extracted data against source PDFs, recovering a failed validation mission, or continuing work already owned by extraction-orchestrator, data-extraction-supervisor, or validation-analyst, stop immediately and return a concise failure stating that the mission must remain in the extraction chain. "
                "Do not read CSVs, render PDFs, inspect page images, write temporary scripts, or perform manual validation for those missions. "
                "For validation failures, the only correct behavior is to surface the failure upward unchanged."
            ),
            tool_names=_ARCHITECT_TOOL_NAMES,
        ),
        _deep_subagent(
            name="backend-builder",
            description=(
                "Use for Python, FastAPI, LangGraph, database, and runtime "
                "backend tasks that may require multi-step coding work."
            ),
            system_prompt=(
                "You are the Atlas backend builder. Focus on server-side code, "
                "graph wiring, schemas, persistence, and runtime reliability. "
                "Inspect before changing, use a todo list for multi-step work, "
                "and return a concise engineering summary with files touched, "
                "key commands run, and verification."
            ),
            tool_names=(
                "shell",
                "query_neon",
                "execute_neon",
                "read_file_anywhere",
                "write_file_anywhere",
                "append_file",
            ),
        ),
        _deep_subagent(
            name="frontend-builder",
            description=(
                "Use for Next.js, React, dashboard UX, streaming UI, and "
                "runtime visualization work that requires multi-step coding."
            ),
            system_prompt=(
                "You are the Atlas frontend builder. Focus on the canonical "
                "Architect workbench, operator transparency, streaming behavior, "
                "and built-in visualizations. Verify behavior after changes and "
                "return a concise implementation summary with files touched and "
                "verification notes."
            ),
            tool_names=(
                "shell",
                "read_file_anywhere",
                "write_file_anywhere",
                "append_file",
            ),
        ),
        _deep_subagent(
            name="ops-builder",
            description=(
                "Use for systemd, Caddy, process management, builds, logs, and "
                "health checks on the VM."
            ),
            system_prompt=(
                "You are the Atlas operations builder. Focus on service health, "
                "runtime topology, logs, process ownership, and fail-fast "
                "diagnostics. Prefer exact causes over guesses and return an "
                "operator-ready report with commands run, observed state, and "
                "remediation taken."
            ),
            tool_names=(
                "shell",
                "query_neon",
                "read_file_anywhere",
                "write_file_anywhere",
                "append_file",
            ),
        ),
        _async_extraction_orchestrator(),
        _regular_subagent(
            name="repo-researcher",
            description=(
                "Use for focused read-only research across the repo, settings, "
                "docs, and database state when the main agent needs fast, "
                "bounded findings."
            ),
            system_prompt=(
                "You are the Atlas repository researcher. Work read-only. "
                "Inspect code, configuration, docs, and database state as "
                "needed, but do not modify files. Return a compact report with "
                "concrete findings, file paths, and direct answers."
            ),
            tool_names=(
                "query_neon",
                "list_documents",
                "preview_csv",
                "read_file_anywhere",
            ),
        ),
        _regular_subagent(
            name="document-researcher",
            description=(
                "Use for bounded investigation of production-line manuals, CSVs, "
                "and document-derived questions without changing the codebase."
            ),
            system_prompt=(
                "You are the Atlas document researcher. Focus on the machine "
                "document library, CSV previews, and grounded document questions. "
                "Work read-only and return concise, evidence-based findings."
            ),
            tool_names=(
                "list_documents",
                "preview_csv",
                "query_neon",
                "read_file_anywhere",
            ),
        ),
    ]


def get_architect_topology() -> dict[str, list[dict[str, object]]]:
    """Static topology description for the canonical Architect graph.

    This is the backend contract seed for future built-in visualizations.
    """

    nodes: list[dict[str, object]] = [
        {
            "id": "atlas-architect",
            "type": "deep-agent",
            "role": "coordinator",
            "label": "Architect",
            "description": "Primary coordinator deep agent for Atlas.",
            "tools": list(_ARCHITECT_TOOL_NAMES),
        },
        {
            "id": "general-purpose",
            "type": "deep-agent",
            "role": "worker",
            "label": "General purpose",
            "description": "Framework-provided default deep subagent.",
            "tools": list(_ARCHITECT_TOOL_NAMES),
        },
        {
            "id": "backend-builder",
            "type": "deep-agent",
            "role": "worker",
            "label": "Backend builder",
            "description": "Multi-step backend implementation worker.",
            "tools": [
                "shell",
                "query_neon",
                "execute_neon",
                "read_file_anywhere",
                "write_file_anywhere",
                "append_file",
            ],
        },
        {
            "id": "frontend-builder",
            "type": "deep-agent",
            "role": "worker",
            "label": "Frontend builder",
            "description": "Multi-step workbench and visualization worker.",
            "tools": [
                "shell",
                "read_file_anywhere",
                "write_file_anywhere",
                "append_file",
            ],
        },
        {
            "id": "ops-builder",
            "type": "deep-agent",
            "role": "worker",
            "label": "Ops builder",
            "description": "Runtime, service, and health worker.",
            "tools": [
                "shell",
                "query_neon",
                "read_file_anywhere",
                "write_file_anywhere",
                "append_file",
            ],
        },
        {
            "id": "extraction-orchestrator",
            "type": "async-subagent",
            "role": "campaign-orchestrator",
            "label": "Extraction orchestrator",
            "description": "Background campaign orchestrator for machine-scale extraction work.",
            "tools": [
                "start_async_task",
                "check_async_task",
                "update_async_task",
                "cancel_async_task",
                "list_async_tasks",
            ],
        },
        {
            "id": "data-extraction-supervisor",
            "type": "deep-agent",
            "role": "orchestrator-child",
            "label": "Data extraction supervisor",
            "description": (
                "Leads the specialized document extraction worker team after being delegated "
                "to by extraction-orchestrator."
            ),
            "tools": [
                "list_documents",
                "inspect_pdf_document",
            ],
        },
        {
            "id": "validation-analyst",
            "type": "deep-agent",
            "role": "worker",
            "label": "Validation analyst",
            "description": "Post-extraction validation worker for development CSV checks and production PDF-grounded review.",
            "tools": [
                "inspect_csv_deterministic",
                "compare_csvs_deterministic",
                "validate_parts_list_against_pdf",
            ],
        },
        {
            "id": "vision-extractor",
            "type": "deep-agent",
            "role": "worker",
            "label": "Vision extractor",
            "description": "Visual interpretation worker for rendered PDF content.",
            "tools": [
                "inspect_pdf_document",
                "analyze_pdf_visual_region",
                "extract_pdf_text_layer",
                "ocr_pdf_pages",
                "read_file_anywhere",
            ],
        },
        {
            "id": "ocr-extractor",
            "type": "deep-agent",
            "role": "worker",
            "label": "OCR extractor",
            "description": "Text recovery worker for scanned or degraded PDFs.",
            "tools": [
                "inspect_pdf_document",
                "ocr_pdf_pages",
                "extract_pdf_text_layer",
                "read_file_anywhere",
                "write_file_anywhere",
            ],
        },
        {
            "id": "table-structure-extractor",
            "type": "deep-agent",
            "role": "worker",
            "label": "Table structure extractor",
            "description": "Complex table reconstruction worker.",
            "tools": [
                "inspect_pdf_document",
                "extract_pdf_tables",
                "extract_pdf_text_layer",
                "parse_electrical_parts_list",
                "ocr_pdf_pages",
                "read_file_anywhere",
                "write_file_anywhere",
            ],
        },
        {
            "id": "schema-mapper",
            "type": "deep-agent",
            "role": "worker",
            "label": "Schema mapper",
            "description": "Canonical document-to-schema normalization worker.",
            "tools": [
                "extract_pdf_tables",
                "extract_pdf_text_layer",
                "ocr_pdf_pages",
                "read_file_anywhere",
                "write_file_anywhere",
                "append_file",
            ],
        },
        {
            "id": "spatial-analysis-agent",
            "type": "deep-agent",
            "role": "worker",
            "label": "Spatial analysis agent",
            "description": "Circuit and page-continuation tracing worker.",
            "tools": [
                "inspect_pdf_document",
                "detect_schematic_spine_slice0",
                "build_schematic_page_evidence",
                "analyze_pdf_visual_region",
                "extract_pdf_text_layer",
                "ocr_pdf_pages",
                "read_file_anywhere",
            ],
        },
        {
            "id": "repo-researcher",
            "type": "regular-agent",
            "role": "worker",
            "label": "Repo researcher",
            "description": "Read-only repo and configuration investigator.",
            "tools": [
                "query_neon",
                "list_documents",
                "preview_csv",
                "read_file_anywhere",
            ],
        },
        {
            "id": "document-researcher",
            "type": "regular-agent",
            "role": "worker",
            "label": "Document researcher",
            "description": "Read-only production document investigator.",
            "tools": [
                "list_documents",
                "preview_csv",
                "query_neon",
                "read_file_anywhere",
            ],
        },
    ]

    edges = [
        {"source": "atlas-architect", "target": "general-purpose", "kind": "delegates_to"},
        {"source": "atlas-architect", "target": "backend-builder", "kind": "delegates_to"},
        {"source": "atlas-architect", "target": "frontend-builder", "kind": "delegates_to"},
        {"source": "atlas-architect", "target": "ops-builder", "kind": "delegates_to"},
        {"source": "atlas-architect", "target": "extraction-orchestrator", "kind": "starts_async_task"},
        {"source": "atlas-architect", "target": "repo-researcher", "kind": "delegates_to"},
        {"source": "atlas-architect", "target": "document-researcher", "kind": "delegates_to"},
        {"source": "extraction-orchestrator", "target": "data-extraction-supervisor", "kind": "delegates_to"},
        {"source": "data-extraction-supervisor", "target": "vision-extractor", "kind": "delegates_to"},
        {"source": "data-extraction-supervisor", "target": "ocr-extractor", "kind": "delegates_to"},
        {"source": "data-extraction-supervisor", "target": "table-structure-extractor", "kind": "delegates_to"},
        {"source": "data-extraction-supervisor", "target": "schema-mapper", "kind": "delegates_to"},
        {"source": "data-extraction-supervisor", "target": "spatial-analysis-agent", "kind": "delegates_to"},
        {"source": "data-extraction-supervisor", "target": "validation-analyst", "kind": "delegates_to"},
    ]

    return {"nodes": nodes, "edges": edges}


def build_architect_graph(
    checkpointer=None,
    store=None,
    system_prompt: str | None = None,
    model_id: str | None = None,
):
    """Build the Architect deep agent graph.

    `system_prompt` must be provided from Neon via the graph registry.
    """

    if not system_prompt:
        raise ValueError(
            "system_prompt is required - load from Neon via get_system_prompt(), not code "
            "defaults"
        )
    policy = interrupt_on_policy()
    return create_deep_agent(
        name="atlas-architect",
        model=make_architect_llm(model_id),
        system_prompt=_architect_system_prompt(system_prompt),
        tools=_toolset(*_ARCHITECT_TOOL_NAMES),
        backend=_make_composite_backend,
        skills=[SKILLS_DIR],
        subagents=build_architect_subagents(),
        middleware=[ArchitectMemoryRecallMiddleware()],
        checkpointer=checkpointer,
        store=store,
        interrupt_on=policy,
    )
