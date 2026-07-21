"""Atlas Code tools.

These are intentionally independent from ``src.graphs.tools`` so the coding graph
does not import Architect document/extraction tools or custom extraction modules.
The VM is the Atlas Code sandbox boundary; these tools are VM-wide by design.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
from datetime import datetime, timezone

from langchain.tools import tool
from langchain_core.runnables import RunnableConfig

from src.config import settings
from src.persistence.langgraph_store import sync_store_context
from src.terminal.shell_output import format_shell_tool_return

_CODE_MEMORY_PREFIX = "/code-memories/"
_CODE_MEMORY_NAMESPACE = ("atlas-code", "memories")


def _code_memory_key(file_path: str) -> str | None:
    if file_path == "/code-memories":
        return "/"
    if file_path.startswith(_CODE_MEMORY_PREFIX):
        suffix = file_path[len(_CODE_MEMORY_PREFIX) :]
        return f"/{suffix}" if suffix else "/"
    return None


def _write_code_memory(file_path: str, content: str, *, append: bool = False) -> str:
    key = _code_memory_key(file_path)
    if key is None:
        raise ValueError(f"not an Atlas Code memory path: {file_path}")
    if key == "/":
        return "Error: /code-memories/ is a directory; provide a file path."
    try:
        with sync_store_context() as store:
            existing_content = ""
            created_at = None
            existing = store.get(_CODE_MEMORY_NAMESPACE, key)
            if existing is not None:
                created_at = existing.value.get("created_at")
            if append and existing is not None:
                raw_content = existing.value.get("content", "")
                existing_content = raw_content if isinstance(raw_content, str) else ""
            final_content = f"{existing_content}{content}" if append else content
            now = datetime.now(timezone.utc).isoformat()
            store.put(
                _CODE_MEMORY_NAMESPACE,
                key,
                {
                    "content": final_content,
                    "encoding": "utf-8",
                    "created_at": created_at or now,
                    "modified_at": now,
                },
            )
        action = "Appended to" if append else "Written"
        return f"{action} Atlas Code memory: {file_path} ({len(content)} chars)"
    except Exception as exc:
        return f"Error writing Atlas Code memory {file_path}: {exc}"


def _read_code_memory(file_path: str, max_lines: int) -> str:
    key = _code_memory_key(file_path)
    if key is None:
        raise ValueError(f"not an Atlas Code memory path: {file_path}")
    try:
        with sync_store_context() as store:
            if key == "/":
                items = store.search(_CODE_MEMORY_NAMESPACE, limit=100)
                if not items:
                    return "No Atlas Code memories found."
                return "\n".join(sorted(str(item.key) for item in items))
            item = store.get(_CODE_MEMORY_NAMESPACE, key)
        if item is None:
            return f"Atlas Code memory not found: {file_path}"
        raw_content = item.value.get("content", "")
        if not isinstance(raw_content, str):
            return f"Atlas Code memory has non-text content: {file_path}"
        lines = raw_content.splitlines(keepends=True)
        content = "".join(lines[:max_lines])
        if len(lines) > max_lines:
            content += f"\n... ({len(lines) - max_lines} more lines)"
        return content
    except Exception as exc:
        return f"Error reading Atlas Code memory {file_path}: {exc}"


def _shell_subprocess_fallback(command: str, working_directory: str) -> str:
    timeout = float(settings.shell_command_timeout_sec)
    result = subprocess.run(
        command,
        shell=True,
        cwd=working_directory,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    output = ""
    if result.stdout:
        output += result.stdout
    if result.stderr:
        output += ("\n--- stderr ---\n" + result.stderr) if result.stdout else result.stderr
    if result.returncode != 0:
        output += f"\n[exit code: {result.returncode}]"
    return format_shell_tool_return(output)


@tool
async def shell(
    command: str,
    working_directory: str = settings.atlas_root,
    *,
    config: RunnableConfig,
) -> str:
    """Execute a shell command on the VM and stream it to the thread terminal."""
    if "/code-memories" in command:
        return (
            "Error: /code-memories/ is Atlas Code's virtual memory route, "
            "not a Linux directory. Use read_file_anywhere, write_file_anywhere, "
            "or append_file with /code-memories/ paths instead of shell."
        )
    try:
        from src.terminal.manager import get_terminal_manager

        mgr = get_terminal_manager()
        cfg = config.get("configurable") or {}
        raw_tid = cfg.get("thread_id")
        thread_id = str(raw_tid) if raw_tid is not None else None
        return await asyncio.to_thread(
            mgr.run_agent_shell_command,
            command,
            working_directory,
            thread_id,
        )
    except RuntimeError:
        pass
    except Exception as exc:
        return f"Error: {exc}"
    try:
        return await asyncio.to_thread(
            _shell_subprocess_fallback,
            command,
            working_directory,
        )
    except subprocess.TimeoutExpired:
        return (
            f"Error: command timed out after {int(settings.shell_command_timeout_sec)} seconds"
        )
    except Exception as exc:
        return f"Error: {exc}"


@tool
def query_neon(sql: str) -> str:
    """Run a SQL statement against Neon PostgreSQL and return up to 50 rows."""
    import psycopg

    try:
        with psycopg.connect(settings.database_uri) as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                if not cur.description:
                    conn.commit()
                    return f"Query executed successfully. Rows affected: {cur.rowcount}"
                columns = [d.name for d in cur.description]
                rows = cur.fetchmany(50)
                output = " | ".join(columns) + "\n"
                output += "-" * len(output) + "\n"
                for row in rows:
                    output += " | ".join(str(v) for v in row) + "\n"
                return output
    except Exception as exc:
        return f"Query error: {exc}"


@tool
def write_file_anywhere(file_path: str, content: str) -> str:
    """Write content to a VM file, or to /code-memories/ for Atlas Code memory."""
    if _code_memory_key(file_path) is not None:
        return _write_code_memory(file_path, content)
    try:
        parent = os.path.dirname(file_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as handle:
            handle.write(content)
        return f"Written: {file_path} ({len(content)} chars)"
    except Exception as exc:
        return f"Error writing {file_path}: {exc}"


@tool
def read_file_anywhere(file_path: str, max_lines: int = 200) -> str:
    """Read a VM file, or /code-memories/ for Atlas Code memory."""
    if _code_memory_key(file_path) is not None:
        return _read_code_memory(file_path, max_lines)
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as handle:
            lines = handle.readlines()
        total = len(lines)
        content = "".join(lines[:max_lines])
        if total > max_lines:
            content += f"\n... ({total - max_lines} more lines)"
        return content
    except Exception as exc:
        return f"Error reading {file_path}: {exc}"


@tool
def append_file(file_path: str, content: str) -> str:
    """Append content to a VM file, or to /code-memories/ for Atlas Code memory."""
    if _code_memory_key(file_path) is not None:
        return _write_code_memory(file_path, content, append=True)
    try:
        parent = os.path.dirname(file_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(file_path, "a", encoding="utf-8") as handle:
            handle.write(content)
        return f"Appended to: {file_path} ({len(content)} chars)"
    except Exception as exc:
        return f"Error appending to {file_path}: {exc}"


CODE_TOOLS = [
    shell,
    query_neon,
    write_file_anywhere,
    read_file_anywhere,
    append_file,
]
