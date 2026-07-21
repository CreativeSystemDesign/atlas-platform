"""Atlas Code - VM-wide coding/operator Deep Agent graph.

This graph is intentionally separate from the Atlas Architect and extraction graphs.
It shares the FastAPI/LangGraph backbone only. Its operating boundary is the VM,
not the Atlas Platform product or repository.
"""

from __future__ import annotations

import os
from typing import Any, Literal

from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend, StoreBackend
from deepagents.middleware.subagents import SubAgent
from langchain_openai import ChatOpenAI
from langchain.tools import ToolRuntime

from src.config import settings
from src.graphs.code_tools import CODE_TOOLS
from src.graphs.hitl_policy import interrupt_on_policy

CODE_SKILLS_DIR = os.path.join(os.path.dirname(__file__), "code_skills")
ATLAS_ROOT = settings.atlas_root
ATLAS_CODE_FILESYSTEM_ROOT = "/"
_TOOLS_BY_NAME = {tool.name: tool for tool in CODE_TOOLS}
CodeReasoningEffort = Literal["minimal", "low", "medium", "high", "xhigh"]

_CODE_TOOL_NAMES = (
    "shell",
    "read_file_anywhere",
    "write_file_anywhere",
    "append_file",
    "query_neon",
)


def _toolset(*names: str):
    missing = [name for name in names if name not in _TOOLS_BY_NAME]
    if missing:
        raise ValueError(f"Unknown Atlas Code tool(s): {', '.join(sorted(missing))}")
    return [_TOOLS_BY_NAME[name] for name in names]


def _reasoning_extra_body(reasoning_effort: str | None = None) -> dict[str, Any] | None:
    if reasoning_effort not in {"minimal", "low", "medium", "high", "xhigh"}:
        return None
    return {"reasoning": {"effort": reasoning_effort}}


def make_code_llm(
    model_id: str | None = None,
    reasoning_effort: CodeReasoningEffort | None = None,
) -> ChatOpenAI:
    return ChatOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=settings.openrouter_api_key,
        model=model_id or settings.code_model,
        temperature=0.1,
        max_retries=3,
        extra_body=_reasoning_extra_body(reasoning_effort),
    )


def make_code_worker_llm(model_id: str | None = None) -> ChatOpenAI:
    return ChatOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=settings.openrouter_api_key,
        model=model_id or settings.code_worker_model,
        temperature=0.1,
        max_retries=3,
    )


def make_code_ui_llm(model_id: str | None = None) -> ChatOpenAI:
    return ChatOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=settings.openrouter_api_key,
        model=model_id or settings.code_ui_model,
        temperature=0.1,
        max_retries=3,
    )


def _make_code_backend(runtime: ToolRuntime) -> CompositeBackend:
    """VM filesystem access; /code-memories/ routes to LangGraph Store."""
    del runtime
    fs = FilesystemBackend(root_dir=ATLAS_CODE_FILESYSTEM_ROOT, virtual_mode=False)
    store_backend = StoreBackend(
        namespace=lambda ctx: ("atlas-code", "memories"),
    )
    return CompositeBackend(default=fs, routes={"/code-memories/": store_backend})


def _code_prompt(base_prompt: str | None = None) -> str:
    global_context = (base_prompt or "").strip()
    prompt = (
        "You are Atlas Code, Shane's VM-resident coding and systems operator agent. "
        "You are not an Atlas Platform product agent, not the Architect, and not an extraction worker. "
        "You only share the same FastAPI/LangGraph backbone and VM with those systems.\n\n"
        "Operating boundary:\n"
        "- The VM is your sandbox and trust boundary. Do not artificially restrict yourself to the Atlas repo.\n"
        "- Any file, folder, service, process, dependency tree, project checkout, terminal command, package manager, "
        "system resource, configured account, or reachable local/network service on this VM can be in scope when "
        "the operator's task calls for it.\n"
        "- You may work on unrelated repositories, VM services, OS packages, deployment configuration, credentials "
        "already present on the VM, email or external-service workflows exposed through available tools, and your own "
        "agent framework.\n"
        "- Treat access as unlocked. If the operator assigns a task that naturally involves deleting or replacing "
        "ordinary project/user files, you may do that work without a second permission prompt.\n"
        "- Do not accidentally brick the VM or yourself. Before destructive changes to VM operating-system files, boot/service "
        "plumbing, package-manager state, credentials, mounted storage, firewall/network access, or Atlas Code's own runtime "
        "framework, pause and make the risk explicit unless the current instruction already clearly authorizes that exact action.\n"
        "- Understand first, make reversible changes where practical, and preserve unrelated user work.\n\n"
        "Hard product boundary: you are not the document extraction Architect. Do not invoke, imitate, or describe "
        "extraction-oriented workflows unless the operator explicitly asks about that code. You do not own production "
        "PDF extraction, schematic extraction, OCR, CSV parser missions, machine-document validation, or Extraction "
        "Studio truth authoring. Those are separate graphs.\n\n"
        "Coding operating contract:\n"
        "- Read applicable repo instructions before editing.\n"
        "- Inspect before changing; do not patch blindly.\n"
        "- Use the real terminal for commands so the operator can watch work happen.\n"
        "- Narrate like a collaborative senior engineer: one short intent update before a group of actions, "
        "then let command/search/edit evidence sit underneath. Do not narrate every tiny action.\n"
        "- When work takes time, explain what phase you are in before tool use rather than going silent.\n"
        "- Keep UI work purpose-built, polished, responsive, animated where it helps, and validated in-browser.\n"
        "- Preserve user changes and branch hygiene. Never revert unrelated work.\n"
        "- Use focused subagents for independent research or implementation slices when parallel work helps.\n"
        "- Run relevant verification before claiming success and surface failures plainly.\n"
        "- Prefer small, safe architectural steps, but do not ship placeholder behavior or fake UI.\n\n"
        "Structured output contract:\n"
        "- Atlas Code is rendered through assistant-ui message parts and Google's A2UI v0.9 protocol, not Markdown.\n"
        "- assistant-ui, A2UI, catalog IDs, component protocols, and rendering machinery are implementation details. "
        "Do not mention them to the operator unless the operator explicitly asks about the implementation.\n"
        "- For progress updates, worker handoffs, test reports, file-change reports, blockers, or final work summaries, "
        "emit A2UI v0.9 JSON messages only, with no Markdown fences and no prose around them.\n"
        "- Use A2UI server-to-client messages: createSurface, updateComponents, updateDataModel, and deleteSurface.\n"
        "- Use catalogId atlas-code://a2ui/catalog/v1 for Atlas-specific coding components.\n"
        "- Available Atlas components: AtlasWorkCard, AtlasCommandPanel, AtlasDataTable. "
        "You may also use the A2UI basic catalog components when useful.\n"
        "- AtlasWorkCard properties: kind, status, summary, details, metrics, artifacts, warnings, nextAction. "
        "Bind these to the data model with {\"path\":\"/...\"} values.\n"
        "- A valid work summary is a JSON array containing createSurface, updateComponents, and updateDataModel messages. "
        "The UI client will parse this array directly into native React components.\n"
        "- Casual greetings may be plain text, but coding work visibility and final work reports should be A2UI payloads.\n"
        "- User-visible text must be calm, direct, and operational. Avoid demo-language such as generative surface, "
        "stream in progress, composing, shaping, or other copy that advertises the UI machinery.\n\n"
        "Tool policy:\n"
        "- shell is the primary execution path for VM inspection, git, tests, package scripts, service checks, and OS work.\n"
        "- read_file_anywhere/write_file_anywhere/append_file may edit any VM file when the task requires it.\n"
        "- query_neon can execute SQL against the configured Neon database when that database is relevant to the task.\n"
        "- /code-memories/ is Atlas Code's durable memory route. Use it only when the operator asks you to remember "
        "coding-agent operational knowledge across sessions."
    )
    if not global_context:
        return prompt
    return (
        f"{prompt}\n\n"
        f"Additional Atlas Code operating context follows. Treat it as coding/operator context, not as permission to become the extraction graph:\n{global_context}"
    )


def _code_subagents(
    worker_model_id: str | None = None,
    ui_model_id: str | None = None,
) -> list[SubAgent]:
    common_tools = (
        "shell",
        "read_file_anywhere",
        "write_file_anywhere",
        "append_file",
        "query_neon",
    )
    read_only_tools = (
        "shell",
        "read_file_anywhere",
        "query_neon",
    )
    return [
        {
            "name": "general-purpose",
            "description": (
                "Use for delegated Atlas Code work that does not fit a specialist lane, including "
                "small implementation support, broad investigation, and mixed coding/operator tasks."
            ),
            "system_prompt": (
                "You are Atlas Code general-purpose. You are a spawned Atlas Code worker, not the "
                "Atlas Architect and not an extraction agent. Use the VM-wide coding/operator rules, "
                "preserve unrelated work, and keep updates concise. Return A2UI v0.9 JSON messages "
                "using catalogId atlas-code://a2ui/catalog/v1 and AtlasWorkCard. Do not return Markdown."
            ),
            "model": make_code_worker_llm(worker_model_id),
            "tools": _toolset(*common_tools),
            "skills": [CODE_SKILLS_DIR],
        },
        {
            "name": "repo-scout",
            "description": (
                "Use for bounded read-only repository investigation, architecture mapping, dependency checks, "
                "and locating relevant files before implementation."
            ),
            "system_prompt": (
                "You are Atlas Code repo-scout. Work read-only unless the parent explicitly asks otherwise. "
                "Return A2UI v0.9 JSON messages using catalogId atlas-code://a2ui/catalog/v1 and AtlasWorkCard. "
                "Do not return Markdown."
            ),
            "model": make_code_worker_llm(worker_model_id),
            "tools": _toolset(*read_only_tools),
            "skills": [CODE_SKILLS_DIR],
        },
        {
            "name": "frontend-craft",
            "description": (
                "Use for Next.js, React, Tiptap, terminal UI, motion, responsive layout, and browser validation work."
            ),
            "system_prompt": (
                "You are Atlas Code frontend-craft. Build polished, purpose-built interfaces. "
                "Respect existing Next.js boundaries, avoid generic UI, and verify user-facing changes in the browser. "
                "Return A2UI v0.9 JSON messages using catalogId atlas-code://a2ui/catalog/v1 and AtlasWorkCard. "
                "Do not return Markdown."
            ),
            "model": make_code_ui_llm(ui_model_id),
            "tools": _toolset(*common_tools),
            "skills": [CODE_SKILLS_DIR],
        },
        {
            "name": "runtime-engineer",
            "description": (
                "Use for FastAPI, LangGraph, Deep Agents, terminal runtime, Redis/Postgres persistence, and SSE behavior."
            ),
            "system_prompt": (
                "You are Atlas Code runtime-engineer. Focus on correctness, persistence, streaming, "
                "terminal visibility, and clean API contracts. Verify with targeted backend tests. "
                "Return A2UI v0.9 JSON messages using catalogId atlas-code://a2ui/catalog/v1 and AtlasWorkCard. "
                "Do not return Markdown."
            ),
            "model": make_code_worker_llm(worker_model_id),
            "tools": _toolset(*common_tools),
            "skills": [CODE_SKILLS_DIR],
        },
        {
            "name": "verification-runner",
            "description": (
                "Use for focused lint, type, test, build, browser, and regression validation once implementation exists."
            ),
            "system_prompt": (
                "You are Atlas Code verification-runner. Run the relevant checks, isolate failures, "
                "and report exact commands, results, and likely ownership. Do not hide broken behavior. "
                "Return A2UI v0.9 JSON messages using catalogId atlas-code://a2ui/catalog/v1 and AtlasWorkCard. "
                "Do not return Markdown."
            ),
            "model": make_code_worker_llm(worker_model_id),
            "tools": _toolset(*read_only_tools),
            "skills": [CODE_SKILLS_DIR],
        },
    ]


def build_code_graph(
    checkpointer=None,
    store=None,
    system_prompt: str | None = None,
    model_id: str | None = None,
    worker_model_id: str | None = None,
    ui_model_id: str | None = None,
    reasoning_effort: CodeReasoningEffort | None = None,
) -> Any:
    """Build the Atlas Code deep agent graph."""
    return create_deep_agent(
        name="atlas-code",
        model=make_code_llm(model_id, reasoning_effort=reasoning_effort),
        system_prompt=_code_prompt(system_prompt),
        tools=_toolset(*_CODE_TOOL_NAMES),
        backend=_make_code_backend,
        skills=[CODE_SKILLS_DIR],
        subagents=_code_subagents(
            worker_model_id=worker_model_id,
            ui_model_id=ui_model_id,
        ),
        checkpointer=checkpointer,
        store=store,
        interrupt_on=interrupt_on_policy(),
    )


def get_code_topology() -> dict[str, list[dict[str, object]]]:
    nodes: list[dict[str, object]] = [
        {
            "id": "atlas-code",
            "type": "deep-agent",
            "role": "coordinator",
            "label": "Atlas Code",
            "description": "VM-wide coding and systems operator coordinator.",
            "tools": list(_CODE_TOOL_NAMES),
            "model_lane": "atlas",
        },
        {
            "id": "general-purpose",
            "type": "deep-agent",
            "role": "worker",
            "label": "General purpose",
            "description": "Default Atlas Code worker for mixed delegated coding/operator tasks.",
            "tools": list(_CODE_TOOL_NAMES),
            "model_lane": "worker",
        },
        {
            "id": "repo-scout",
            "type": "deep-agent",
            "role": "worker",
            "label": "Repo scout",
            "description": "Read-only project, filesystem, and codebase investigator.",
            "tools": ["shell", "read_file_anywhere", "query_neon"],
            "model_lane": "worker",
        },
        {
            "id": "frontend-craft",
            "type": "deep-agent",
            "role": "worker",
            "label": "Frontend craft",
            "description": "Next.js, React, Tiptap, motion, and browser validation worker.",
            "tools": list(_CODE_TOOL_NAMES),
            "model_lane": "ui",
        },
        {
            "id": "runtime-engineer",
            "type": "deep-agent",
            "role": "worker",
            "label": "Runtime engineer",
            "description": "Services, LangGraph, terminals, Redis/Postgres, and persistence worker.",
            "tools": list(_CODE_TOOL_NAMES),
            "model_lane": "worker",
        },
        {
            "id": "verification-runner",
            "type": "deep-agent",
            "role": "worker",
            "label": "Verification runner",
            "description": "Focused lint, test, build, and browser validation worker.",
            "tools": ["shell", "read_file_anywhere", "query_neon"],
            "model_lane": "worker",
        },
    ]
    edges = [
        {"source": "atlas-code", "target": "general-purpose", "kind": "delegates_to"},
        {"source": "atlas-code", "target": "repo-scout", "kind": "delegates_to"},
        {"source": "atlas-code", "target": "frontend-craft", "kind": "delegates_to"},
        {"source": "atlas-code", "target": "runtime-engineer", "kind": "delegates_to"},
        {"source": "atlas-code", "target": "verification-runner", "kind": "delegates_to"},
    ]
    return {"nodes": nodes, "edges": edges}
