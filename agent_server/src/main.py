"""Atlas Agent Server — main FastAPI application."""

import asyncio
import os
import sys
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.persistence.checkpointer import close_checkpointer
from src.persistence.database import close_pool
from src.persistence.langgraph_store import close_store
from src.routes import (
    artifacts,
    assistants,
    code_uploads,
    codex_interface,
    codex_runtime,
    codex_ui,
    crons,
    boards,
    data_map,
    documents,
    experimental,
    experimental_v2,
    experimental_v2_bridge,
    experimental_v2_copilot,
    extraction_workbench,
    extractions,
    joins,
    openrouter_proxy,
    overview,
    projects,
    runs,
    relations,
    schemas,
    store,
    system,
    terminals,
    threads,
)
from src.terminal.manager import init_terminal_manager


def _journal_server_lifecycle(event: str) -> None:
    """Slate 6.8: journal every server start/stop durably — a restart drops
    all sockets (the WebSocket 1012 class) and the page-10 forensics had to
    infer restarts from gaps in the stream. One JSON line per event."""
    try:
        import json as _json
        import time as _time
        from pathlib import Path as _Path

        log_dir = _Path(__file__).resolve().parents[2] / ".atlas" / "run-logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        # A blue-green GREEN validation instance journals to its OWN file so it
        # never pollutes the live restart history the ops health feed reads.
        fname = ("green-lifecycle.jsonl" if os.getenv("ATLAS_GREEN") == "1"
                 else "server-lifecycle.jsonl")
        with open(log_dir / fname, "a", encoding="utf-8") as fh:
            fh.write(_json.dumps({"ts": _time.time(), "event": event,
                                  "pid": os.getpid()}) + "\n")
    except Exception:
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    # GREEN = a blue-green validation instance (ATLAS_GREEN=1) booted on an
    # alternate port to prove new code serves BEFORE the live server restarts.
    # It skips the terminal-PTY startup (which would spawn a second agent
    # terminal and isn't needed to validate that routes boot) and, via
    # ATLAS_SESSION_FILE, never touches live copilot state. Validate green with
    # /ok + /experimental-v2/bridge/stats (NOT /healthz, which needs the PTY).
    green = os.getenv("ATLAS_GREEN") == "1"
    print(f"Atlas Agent Server starting on {settings.host}:{settings.port}"
          f"{' [GREEN validation]' if green else ''}")
    print(f"Architect model: {settings.architect_model}")
    print(f"Worker model: {settings.worker_model}")
    print("Neon PostgreSQL initialization is lazy; first DB-backed action opens the pool.")
    _journal_server_lifecycle("server-start")
    tm = None
    if not green:
        tm = init_terminal_manager()
        tm.configure_loop(asyncio.get_running_loop())
        tm.startup()
        print(f"Primary agent terminal: {tm.primary_agent_id}")
    else:
        print("GREEN validation instance — terminal manager skipped; live state untouched.")
    yield
    print("Shutting down...")
    _journal_server_lifecycle("server-stop")
    from src.canvas_copilot.copilot import copilot_session

    await copilot_session.shutdown()
    if tm is not None:
        tm.shutdown()
    await close_checkpointer()
    await close_store()
    await close_pool()
    print("Atlas Agent Server stopped")


app = FastAPI(
    title="Atlas Agent Server",
    version="0.1.0",
    description="Free, API-compatible LangGraph Agent Server for Atlas Platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router)
app.include_router(artifacts.router)
app.include_router(codex_interface.router)
app.include_router(codex_runtime.router)
app.include_router(codex_ui.router)
app.include_router(code_uploads.router)
app.include_router(openrouter_proxy.router)
app.include_router(assistants.router)
app.include_router(projects.router)
app.include_router(threads.router)
app.include_router(runs.router)
app.include_router(store.router)
app.include_router(crons.router)
app.include_router(experimental.router)
app.include_router(experimental.workbench_router)
app.include_router(experimental_v2.router)
app.include_router(experimental_v2_bridge.router)
app.include_router(experimental_v2_copilot.router)
app.include_router(extraction_workbench.router)
app.include_router(overview.router)
app.include_router(documents.router)
app.include_router(extractions.router)
app.include_router(schemas.router)
app.include_router(relations.router)
app.include_router(boards.router)
app.include_router(data_map.router)
app.include_router(joins.router)
app.include_router(terminals.router)
