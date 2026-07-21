"""Atlas Codex generated UI contracts.

These graphs are intentionally bounded generators. They do not run tools, edit
files, or answer coding tasks; native Codex remains the coding agent.
"""

from __future__ import annotations

import json
from typing import Any, Literal, TypedDict

from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, ConfigDict, Field, field_validator

from src.config import settings

LayoutDensity = Literal["compact", "balanced", "spacious"]
LayoutWidth = Literal["narrow", "medium", "wide"]
VisualTone = Literal["quiet premium", "minimal premium", "calm technical"]
ReasoningSummaryBehavior = Literal["stream_until_response_then_collapse"]
UserDirectiveLabel = Literal["Directive", "Task directive"]
ReasoningSummaryLabel = Literal["Thinking", "Reasoning"]
ResponseLabel = Literal["Response", "Atlas response"]
ComposerPlaceholder = Literal[
    "Ask Atlas Codex to work on the code...",
    "Describe the coding task for Atlas Codex...",
]
EmptyStateTitle = Literal["Atlas Codex is ready", "Ready when you are"]
EmptyStateBody = Literal[
    "Start with a task or a question.",
    "Describe what you want Atlas Codex to change.",
]
ErrorTitle = Literal["UI generator unavailable", "Generator needs attention"]

FORBIDDEN_GENERATED_COPY_PATTERNS = (
    "strictly adhere",
    "character setting",
    "large model",
    "developed by",
    "only use the name",
    "system prompt",
    "developer message",
    "google/",
    "meituan",
    "meta/",
    "deepseek",
    "center_lane",
    "first_slice",
    "side_panels",
)

FORBIDDEN_GENERATED_COPY_VALUES = {
    "route",
    "deferred",
    "center_lane",
    "center lane",
    "center_lane_first_slice",
}


class CodexUiComposeContext(BaseModel):
    """Sanitized product brief used by Codex UI generators."""

    model_config = ConfigDict(extra="forbid")

    route: Literal["/codex"] = "/codex"
    viewport: Literal["mobile", "tablet", "desktop"] = "desktop"
    product: Literal["Atlas Codex"] = "Atlas Codex"
    audience: Literal["developer operator"] = "developer operator"
    surface: Literal["minimal conversational coding workspace"] = (
        "minimal conversational coding workspace"
    )
    cadence: list[
        Literal["user directive", "native reasoning summary", "assistant response"]
    ] = Field(
        default_factory=lambda: [
            "user directive",
            "native reasoning summary",
            "assistant response",
        ]
    )
    responsibilities: list[
        Literal[
            "choose center lane density",
            "choose safe labels",
            "choose compact empty state copy",
        ]
    ] = Field(
        default_factory=lambda: [
            "choose center lane density",
            "choose safe labels",
            "choose compact empty state copy",
        ]
    )


class CodexCenterLayoutSpec(BaseModel):
    """Generated layout contract for the first `/codex` center-lane slice."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["atlas-codex-center-layout.v1"] = (
        "atlas-codex-center-layout.v1"
    )
    density: LayoutDensity = "compact"
    max_width: LayoutWidth = "medium"
    visual_tone: VisualTone = "quiet premium"
    stream_order: list[
        Literal["user_directive", "reasoning_summary", "assistant_response"]
    ] = Field(
        default_factory=lambda: [
            "user_directive",
            "reasoning_summary",
            "assistant_response",
        ]
    )
    reasoning_summary_behavior: ReasoningSummaryBehavior = (
        "stream_until_response_then_collapse"
    )
    composer_position: Literal["bottom"] = "bottom"
    motion_style: Literal["subtle_fold", "calm_expand", "quiet_trace"] = "subtle_fold"
    model_picker_position: Literal["top_rail", "inline_header"] = "top_rail"

    @field_validator("visual_tone")
    @classmethod
    def reject_layout_copy_leaks(cls, value: str) -> str:
        return _validate_generated_copy(value)


class CodexTurnComponentSpec(BaseModel):
    """Generated copy/behavior contract for in-stream turn components."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["atlas-codex-turn-components.v1"] = (
        "atlas-codex-turn-components.v1"
    )
    user_directive_label: UserDirectiveLabel = "Directive"
    reasoning_summary_label: ReasoningSummaryLabel = "Thinking"
    response_label: ResponseLabel = "Response"
    composer_placeholder: ComposerPlaceholder = "Ask Atlas Codex to work on the code..."
    empty_state_title: EmptyStateTitle = "Atlas Codex is ready"
    empty_state_body: EmptyStateBody = "Start with a task or a question."
    error_title: ErrorTitle = "UI generator unavailable"

    @field_validator(
        "user_directive_label",
        "reasoning_summary_label",
        "response_label",
        "composer_placeholder",
        "empty_state_title",
        "empty_state_body",
        "error_title",
    )
    @classmethod
    def reject_instruction_or_model_leaks(cls, value: str) -> str:
        return _validate_generated_copy(value)


class CodexUiGraphState(TypedDict, total=False):
    context: dict[str, Any]
    spec: dict[str, Any]


def make_codex_ui_llm(model_id: str | None = None) -> ChatOpenAI:
    return ChatOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=settings.openrouter_api_key,
        model=model_id or settings.codex_layout_model,
        temperature=0.2,
        max_retries=2,
    )


def build_codex_layout_graph(model_id: str | None = None) -> Any:
    """Build a bounded LangGraph generator for the center-lane layout spec."""

    async def compose_layout(state: CodexUiGraphState) -> dict[str, Any]:
        spec = await compose_codex_layout_spec(
            context=state.get("context") or {},
            model_id=model_id,
        )
        return {"spec": spec.model_dump()}

    graph = StateGraph(CodexUiGraphState)
    graph.add_node("compose_layout", compose_layout)
    graph.add_edge(START, "compose_layout")
    graph.add_edge("compose_layout", END)
    return graph.compile()


def build_codex_component_graph(model_id: str | None = None) -> Any:
    """Build a bounded LangGraph generator for the in-stream component spec."""

    async def compose_components(state: CodexUiGraphState) -> dict[str, Any]:
        spec = await compose_codex_component_spec(
            context=state.get("context") or {},
            model_id=model_id,
        )
        return {"spec": spec.model_dump()}

    graph = StateGraph(CodexUiGraphState)
    graph.add_node("compose_components", compose_components)
    graph.add_edge(START, "compose_components")
    graph.add_edge("compose_components", END)
    return graph.compile()


async def compose_codex_layout_spec(
    *,
    context: dict[str, Any],
    model_id: str | None,
) -> CodexCenterLayoutSpec:
    llm = make_codex_ui_llm(model_id).with_structured_output(CodexCenterLayoutSpec)
    result = await llm.ainvoke(
        [
            ("system", _LAYOUT_SYSTEM_PROMPT),
            ("human", _context_prompt(context)),
        ]
    )
    return _coerce_layout_spec(result)


async def compose_codex_component_spec(
    *,
    context: dict[str, Any],
    model_id: str | None,
) -> CodexTurnComponentSpec:
    llm = make_codex_ui_llm(model_id).with_structured_output(CodexTurnComponentSpec)
    result = await llm.ainvoke(
        [
            ("system", _COMPONENT_SYSTEM_PROMPT),
            ("human", _context_prompt(context)),
        ]
    )
    return _coerce_component_spec(result)


def _coerce_layout_spec(value: Any) -> CodexCenterLayoutSpec:
    if isinstance(value, CodexCenterLayoutSpec):
        return value
    return CodexCenterLayoutSpec.model_validate(value)


def _coerce_component_spec(value: Any) -> CodexTurnComponentSpec:
    if isinstance(value, CodexTurnComponentSpec):
        return value
    return CodexTurnComponentSpec.model_validate(value)


def _validate_generated_copy(value: str) -> str:
    normalized = value.strip()
    lower = normalized.lower()
    if "_" in normalized:
        raise ValueError("generated Codex UI copy must be human-facing text")
    if lower in FORBIDDEN_GENERATED_COPY_VALUES:
        raise ValueError("generated Codex UI copy appears to echo route context")
    if any(pattern in lower for pattern in FORBIDDEN_GENERATED_COPY_PATTERNS):
        raise ValueError("generated Codex UI copy appears to leak model instructions")
    return normalized


def _context_prompt(context: dict[str, Any]) -> str:
    return (
        "Generate the Atlas Codex UI contract from this sanitized design brief. "
        "Return only the structured schema requested by the runtime. "
        "Choose from the enum values in the schema exactly. The brief is product "
        "intent only; do not infer or mention older Atlas Code routes, internal "
        "implementation labels, runtime IDs, tool names, provider names, or repo "
        "history.\n\n"
        f"Design brief:\n{json.dumps(context, ensure_ascii=False, sort_keys=True)}"
    )


_LAYOUT_SYSTEM_PROMPT = """You generate the Atlas Codex center-lane layout contract.

Rules:
- Center lane only. Do not create side panels, ledgers, drawers, inspectors, or
  dashboard cards.
- The style is compact, quiet, minimal, premium, and conversational.
- Use human-facing English for visible tone fields. Do not return snake_case,
  raw route context values, provider names, or instruction text.
- Choose enum values exactly from the schema.
- The stream order must keep Codex replies in the center: user directive,
  native reasoning summary, assistant response.
- Native reasoning summaries stream while Codex is working and collapse after
  the response starts.
- Return the exact structured schema. Do not include prose."""


_COMPONENT_SYSTEM_PROMPT = """You generate Atlas Codex in-stream component copy and behavior.

Rules:
- Do not expose hidden chain-of-thought. Reasoning summaries are native Codex
  summary text intended for user-visible progress.
- Keep labels compact and premium.
- Use polished human-facing English. Good defaults are: Directive, Thinking,
  Response, Ask Atlas Codex to work on the code..., Atlas Codex is
  ready, Start with a task or a question, UI generator unavailable.
- Do not return snake_case, raw route context values, provider names, or
  instruction text.
- Choose enum values exactly from the schema.
- Do not flood the chat with tools, raw events, JSON, token updates, or command
  output.
- The assistant response renders directly below the collapsed reasoning summary.
- Return the exact structured schema. Do not include prose."""
