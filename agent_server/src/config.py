from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
ATLAS_REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    database_uri: str = Field(
        default="",
        validation_alias=AliasChoices("DATABASE_URI", "DATABASE_URL"),
    )
    #: R3 (Platform Graduation): all intake files live OUTSIDE the repo under
    #: this root — {root}/{project_slug}/{originals|masters|workspace}/...
    atlas_data_root: str = Field(
        default="", validation_alias=AliasChoices("ATLAS_DATA_ROOT"))

    redis_uri: str = "redis://localhost:6379/0"
    redis_required: bool = True
    redis_min_major_version: int = 8
    redis_require_json_search: bool = True
    redis_runtime_stream_key: str = "atlas:runtime:events"
    redis_runtime_stream_maxlen: int = 10000
    redis_runtime_event_replay_max_scan: int = 1000
    redis_run_wake_list_key: str = "atlas:runs:wake"
    redis_run_wake_list_maxlen: int = 1000
    redis_run_cancel_ttl_seconds: int = 3600
    redis_checkpoint_prefix: str = "atlas_checkpoint"
    redis_checkpoint_write_prefix: str = "atlas_checkpoint_write"
    redis_store_prefix: str = "atlas_store"
    redis_store_vector_prefix: str = "atlas_store_vectors"
    redis_checkpoint_required_commit: str = "9421ab27e116ea466ba47aa28749da09d7bd8d05"
    nvidia_api_key: str = ""
    langchain_docs_embed_model: str = "nvidia/nv-embed-v1"
    langchain_docs_corpus_name: str = "langchain_docs"
    langchain_docs_search_max_results: int = 50
    qdrant_host: str = "127.0.0.1"
    qdrant_port: int = 6333
    qdrant_langchain_docs_collection: str = "langchain_docs"

    openrouter_api_key: str = ""
    openrouter_data_extraction_api_key: str = ""
    moonshot_api_key: str = ""
    vision_assist_enabled: bool = False
    vision_assist_provider: str = "moonshot"
    vision_assist_model: str = "kimi-k2.5"
    vision_assist_base_url: str = "https://api.moonshot.ai/v1"
    vision_assist_api_key: str = ""
    vision_assist_timeout_seconds: float = 60.0
    vision_assist_max_retries: int = 2
    vision_assist_image_dpi: int = 200
    architect_model: str = "moonshotai/kimi-k2.5"
    worker_model: str = "moonshotai/kimi-k2.5"
    code_model: str = "openrouter/owl-alpha"
    code_worker_model: str = "openrouter/owl-alpha"
    code_ui_model: str = "openrouter/owl-alpha"
    codex_lane: str = Field(
        default="live",
        validation_alias=AliasChoices("ATLAS_CODEX_LANE", "CODEX_LANE"),
    )
    codex_public_host: str = Field(
        default="",
        validation_alias=AliasChoices("ATLAS_CODEX_PUBLIC_HOST", "CODEX_PUBLIC_HOST"),
    )
    codex_dashboard_url: str = Field(
        default="",
        validation_alias=AliasChoices("ATLAS_CODEX_DASHBOARD_URL", "CODEX_DASHBOARD_URL"),
    )
    codex_interface_mutation_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "ATLAS_CODEX_INTERFACE_MUTATION_ENABLED",
            "CODEX_INTERFACE_MUTATION_ENABLED",
        ),
    )
    codex_interface_drafts_root: str = Field(
        default="",
        validation_alias=AliasChoices(
            "ATLAS_CODEX_INTERFACE_DRAFTS_ROOT",
            "CODEX_INTERFACE_DRAFTS_ROOT",
        ),
    )
    codex_frontend_restart_service: str = Field(
        default="",
        validation_alias=AliasChoices(
            "ATLAS_CODEX_FRONTEND_RESTART_SERVICE",
            "CODEX_FRONTEND_RESTART_SERVICE",
        ),
    )
    codex_backend_restart_service: str = Field(
        default="",
        validation_alias=AliasChoices(
            "ATLAS_CODEX_BACKEND_RESTART_SERVICE",
            "CODEX_BACKEND_RESTART_SERVICE",
        ),
    )
    codex_layout_model: str = "nvidia/nemotron-3-super-120b-a12b:free"
    codex_component_model: str = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"
    codex_transcription_model: str = "qwen/qwen3-asr-flash-2026-02-10"
    codex_bin: str = "codex"
    codex_memory_mode: str = "enabled"
    data_extraction_model: str = "minimax/minimax-m2.7"

    langsmith_api_key: str = ""
    langsmith_tracing: bool = False

    host: str = "0.0.0.0"
    port: int = 8123
    async_subagent_server_url: str = "http://127.0.0.1:8123"
    api_key: str = ""
    atlas_root: str = str(ATLAS_REPO_ROOT)
    atlas_documents_root: str = str(ATLAS_REPO_ROOT / "documents")
    atlas_agent_workbench_root: str = str(ATLAS_REPO_ROOT / ".atlas" / "agent-workbench")
    atlas_parser_experiments_root: str = str(ATLAS_REPO_ROOT / ".atlas" / "parser-experiments")

    #: Max LangGraph steps per run. Default 25 in the library is low for multi-tool sessions.
    graph_recursion_limit: int = 100

    #: Comma-separated tool names for HITL. Empty = disabled (recommended default).
    #: Example: edit_file,write_file,shell,query_neon,write_file_anywhere
    hitl_interrupt_tools: str = ""

    #: Max characters returned inline from the shell tool; larger output is spilled to a file.
    shell_output_max_chars: int = 50_000
    #: Characters included in the tool return after spill (preview block).
    shell_spill_preview_chars: int = 8_000
    #: Directory for spilled shell output (created if missing).
    shell_artifact_dir: str = str(ATLAS_REPO_ROOT / ".atlas" / "shell-artifacts")

    #: VM inbox for files uploaded through the Atlas Code composer.
    code_upload_dir: str = str(ATLAS_REPO_ROOT / ".atlas" / "code-uploads")

    #: Max seconds to wait for one `shell` tool command (PTY or subprocess fallback).
    #: npm install / build often exceed 60s; override via env if needed.
    shell_command_timeout_sec: float = 3600.0

    model_config = {
        "env_file": str(ENV_FILE),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
