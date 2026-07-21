"""Atlas tools — full VM and Neon access for the Architect agent."""

from __future__ import annotations

import asyncio
import csv
import os
import re
import subprocess
from datetime import datetime, timezone

from langchain.tools import tool
from langchain_core.runnables import RunnableConfig

from src.config import settings
from src.graphs.custom_tools import CUSTOM_TOOLS
from src.persistence.langgraph_store import sync_store_context
from src.terminal.shell_output import format_shell_tool_return

# Canonical on-disk library of real machine manuals (not demos).
# `the reference machine/the reference machine/` holds the full document set for machine **the reference machine-1**.
ATLAS_DOCUMENTS_ROOT = settings.atlas_documents_root
_ARCHITECT_MEMORY_PREFIX = "/memories/"
_ARCHITECT_MEMORY_NAMESPACE = ("atlas-architect", "memories")
_MEMORY_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9_/-]{2,}", re.IGNORECASE)


def _is_derived_document_artifact(root: str, file_name: str) -> bool:
    lower = file_name.lower()
    stem, ext = os.path.splitext(lower)
    if ext in {".csv", ".json", ".txt"} and ("extracted" in stem or "extraction_" in stem or stem.endswith("_test_run")):
        return True
    if lower == "electrical_parts_extracted.json":
        return True
    if ext == ".txt" and os.path.exists(os.path.join(root, f"{file_name[:-4]}.pdf")):
        return True
    return False


@tool
def list_documents(directory: str = "") -> str:
    """List files under the Atlas documents tree (paths relative to `documents/`).
    Root contains per-machine trees; e.g. `the reference machine/the reference machine` is machine the reference machine-1.
    Returns a formatted list of files with sizes."""
    target = os.path.join(ATLAS_DOCUMENTS_ROOT, directory)
    if not os.path.isdir(target):
        return f"Directory not found: {target}"

    entries = []
    for root, dirs, files in os.walk(target):
        rel = os.path.relpath(root, ATLAS_DOCUMENTS_ROOT)
        for f in files:
            if _is_derived_document_artifact(root, f):
                continue
            path = os.path.join(root, f)
            size = os.path.getsize(path)
            size_str = f"{size:,} bytes" if size < 1024 else f"{size / 1024:.1f} KB"
            entries.append(f"  {os.path.join(rel, f)} ({size_str})")

    if not entries:
        return "No documents found"
    return f"Documents in {target}:\n" + "\n".join(entries)


@tool
def preview_csv(file_path: str, max_rows: int = 10) -> str:
    """Preview the first rows of a CSV under `documents/`. Pass a path relative to
    that root (e.g. `the reference machine/the reference machine/Copy of 1650_dcm_cab.csv` for machine the reference machine-1)."""
    full_path = os.path.join(ATLAS_DOCUMENTS_ROOT, file_path)
    if not os.path.isfile(full_path):
        return f"File not found: {full_path}"
    if not full_path.endswith(".csv"):
        return "Only CSV files are supported by this tool"

    with open(full_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        rows = []
        for i, row in enumerate(reader):
            if i >= max_rows + 1:
                break
            rows.append(row)

    if not rows:
        return "Empty file"

    header = rows[0]
    data = rows[1:]
    output = f"File: {file_path}\nColumns: {', '.join(header)}\nRows shown: {len(data)}\n\n"
    for row in data:
        output += " | ".join(row) + "\n"
    return output


@tool
def query_neon(sql: str) -> str:
    """Execute a SQL query against the Neon PostgreSQL database.
    Supports SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP.
    Returns up to 50 rows for SELECT queries."""
    import psycopg

    try:
        with psycopg.connect(settings.database_uri) as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                if cur.description:
                    columns = [d.name for d in cur.description]
                    rows = cur.fetchmany(50)
                    output = " | ".join(columns) + "\n"
                    output += "-" * len(output) + "\n"
                    for row in rows:
                        output += " | ".join(str(v) for v in row) + "\n"
                    return output
                conn.commit()
                return f"Query executed successfully. Rows affected: {cur.rowcount}"
    except Exception as e:
        return f"Query error: {e}"


@tool
def execute_neon(sql: str) -> str:
    """Execute a DDL or DML statement against Neon PostgreSQL.
    Use for CREATE TABLE, INSERT, UPDATE, DELETE, ALTER, etc.
    Returns row count or error."""
    import psycopg

    try:
        with psycopg.connect(settings.database_uri) as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                conn.commit()
                return f"Executed successfully. Rows affected: {cur.rowcount}"
    except Exception as e:
        return f"Error: {e}"


def _shell_subprocess_fallback(command: str, working_directory: str) -> str:
    """Sync subprocess path when PTY / terminal manager is unavailable."""
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


def _architect_memory_key(file_path: str) -> str | None:
    if file_path == "/memories":
        return "/"
    if file_path.startswith(_ARCHITECT_MEMORY_PREFIX):
        suffix = file_path[len(_ARCHITECT_MEMORY_PREFIX) :]
        return f"/{suffix}" if suffix else "/"
    return None


def _with_architect_memory_store():
    return sync_store_context()


def _write_architect_memory(file_path: str, content: str, *, append: bool = False) -> str:
    key = _architect_memory_key(file_path)
    if key is None:
        raise ValueError(f"not an Architect memory path: {file_path}")
    if key == "/":
        return "Error: /memories/ is a directory; provide a file path."
    try:
        with _with_architect_memory_store() as store:
            existing_content = ""
            created_at = None
            existing = store.get(_ARCHITECT_MEMORY_NAMESPACE, key)
            if existing is not None:
                created_at = existing.value.get("created_at")
            if append:
                if existing is not None:
                    raw_content = existing.value.get("content", "")
                    existing_content = raw_content if isinstance(raw_content, str) else ""
            final_content = f"{existing_content}{content}" if append else content
            now = datetime.now(timezone.utc).isoformat()
            store.put(
                _ARCHITECT_MEMORY_NAMESPACE,
                key,
                {
                    "content": final_content,
                    "encoding": "utf-8",
                    "created_at": created_at or now,
                    "modified_at": now,
                },
            )
        action = "Appended to" if append else "Written"
        return f"{action} Architect memory: {file_path} ({len(content)} chars)"
    except Exception as e:
        return f"Error writing Architect memory {file_path}: {e}"


def _read_architect_memory(file_path: str, max_lines: int) -> str:
    key = _architect_memory_key(file_path)
    if key is None:
        raise ValueError(f"not an Architect memory path: {file_path}")
    try:
        with _with_architect_memory_store() as store:
            if key == "/":
                items = store.search(_ARCHITECT_MEMORY_NAMESPACE, limit=100)
                if not items:
                    return "No Architect memories found."
                return "\n".join(sorted(str(item.key) for item in items))
            item = store.get(_ARCHITECT_MEMORY_NAMESPACE, key)
        if item is None:
            return f"Architect memory not found: {file_path}"
        raw_content = item.value.get("content", "")
        if not isinstance(raw_content, str):
            return f"Architect memory has non-text content: {file_path}"
        lines = raw_content.splitlines(keepends=True)
        content = "".join(lines[:max_lines])
        if len(lines) > max_lines:
            content += f"\n... ({len(lines) - max_lines} more lines)"
        return content
    except Exception as e:
        return f"Error reading Architect memory {file_path}: {e}"


def _memory_tokens(text: str) -> set[str]:
    stop_words = {
        "about",
        "after",
        "again",
        "architect",
        "atlas",
        "before",
        "from",
        "have",
        "long",
        "memory",
        "remember",
        "sessions",
        "that",
        "this",
        "what",
        "when",
        "with",
    }
    return {
        token.lower()
        for token in _MEMORY_TOKEN_RE.findall(text)
        if token.lower() not in stop_words
    }


def _memory_excerpt(content: str, query_tokens: set[str], max_chars: int = 420) -> str:
    compact = " ".join(content.split())
    if len(compact) <= max_chars:
        return compact
    lower = compact.lower()
    match_positions = [
        lower.find(token)
        for token in query_tokens
        if token and lower.find(token) >= 0
    ]
    start = max(0, min(match_positions) - 120) if match_positions else 0
    end = min(len(compact), start + max_chars)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(compact) else ""
    return f"{prefix}{compact[start:end]}{suffix}"


@tool
def search_architect_memories(query: str, limit: int = 5) -> str:
    """Search Atlas Architect's durable long-term memories by topic.

    Use this when prior Atlas operational knowledge may be relevant but the
    exact /memories/ path is not known. This searches the Redis-backed
    LangGraph Store namespace exposed as /memories/.
    """
    q = query.strip()
    if not q:
        return "Query must not be empty."
    query_tokens = _memory_tokens(q)
    if not query_tokens:
        return "Query must include at least one searchable term."

    try:
        with _with_architect_memory_store() as store:
            items = store.search(_ARCHITECT_MEMORY_NAMESPACE, limit=250)
    except Exception as e:
        return f"Error searching Architect memories: {e}"

    scored: list[tuple[int, str, str, dict[str, object]]] = []
    for item in items:
        raw_content = item.value.get("content", "") if isinstance(item.value, dict) else ""
        if not isinstance(raw_content, str) or not raw_content.strip():
            continue
        key = str(item.key)
        key_tokens = _memory_tokens(key)
        content_tokens = _memory_tokens(raw_content)
        title_line = next(
            (line.strip("# ").strip() for line in raw_content.splitlines() if line.strip()),
            key,
        )
        title_tokens = _memory_tokens(title_line)
        score = 0
        score += 6 * len(query_tokens & key_tokens)
        score += 4 * len(query_tokens & title_tokens)
        score += len(query_tokens & content_tokens)
        if score <= 0:
            continue
        scored.append((score, key, raw_content, item.value))

    if not scored:
        return f'No Architect memories matched "{q}".'

    scored.sort(key=lambda entry: (-entry[0], entry[1]))
    lines = [f'Architect memory search for "{q}":']
    for index, (score, key, content, value) in enumerate(scored[: max(1, min(limit, 10))], start=1):
        path = f"/memories{key}" if key.startswith("/") else f"/memories/{key}"
        modified_at = value.get("modified_at") if isinstance(value, dict) else None
        excerpt = _memory_excerpt(content, query_tokens)
        metadata = f"score {score}"
        if modified_at:
            metadata += f", modified {modified_at}"
        lines.append(f"{index}. {path} ({metadata})\n   {excerpt}")
    return "\n".join(lines)


@tool
async def shell(
    command: str,
    working_directory: str = settings.atlas_root,
    *,
    config: RunnableConfig,
) -> str:
    """Execute a shell command on the VM. The agent owns the VM — full access.
    Commands run in a per-thread agent PTY so they appear in the dashboard terminal for that chat.
    Tool return is one block after the command finishes (streaming is for the human UI).
    Long commands (e.g. npm install) use `shell_command_timeout_sec` (default 1 h).
    Very large output may be written to a file under .atlas/shell-artifacts with a preview here;
    use read_file_anywhere, head, tail, or grep on that path as needed.
    Do not use shell for /memories/ paths; they are virtual Redis-backed Architect memory."""
    if "/memories" in command:
        return (
            "Error: /memories/ is Architect's virtual Redis-backed memory route, "
            "not a Linux directory. Use read_file_anywhere, write_file_anywhere, "
            "append_file, grep, or glob with /memories/ paths instead of shell."
        )
    try:
        from src.terminal.manager import get_terminal_manager

        mgr = get_terminal_manager()
        cfg = config.get("configurable") or {}
        raw_tid = cfg.get("thread_id")
        thread_id = str(raw_tid) if raw_tid is not None else None
        # Run blocking PTY I/O off the asyncio loop so WebSocket terminal viewers
        # can process incremental PTY bytes while the shell runs.
        return await asyncio.to_thread(
            mgr.run_agent_shell_command, command, working_directory, thread_id
        )
    except RuntimeError:
        pass
    except Exception as e:
        return f"Error: {e}"
    try:
        return await asyncio.to_thread(
            _shell_subprocess_fallback, command, working_directory
        )
    except subprocess.TimeoutExpired:
        return (
            f"Error: command timed out after {int(settings.shell_command_timeout_sec)} seconds"
        )
    except Exception as e:
        return f"Error: {e}"


@tool
def write_file_anywhere(file_path: str, content: str) -> str:
    """Write content to any file on the VM. Creates parent directories if needed.
    Use absolute paths. Paths under /memories/ write to Architect's Redis-backed long-term memory."""
    if _architect_memory_key(file_path) is not None:
        return _write_architect_memory(file_path, content)
    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Written: {file_path} ({len(content)} chars)"
    except Exception as e:
        return f"Error writing {file_path}: {e}"


@tool
def read_file_anywhere(file_path: str, max_lines: int = 200) -> str:
    """Read any file on the VM. Returns up to max_lines lines.
    Use absolute paths. Paths under /memories/ read Architect's Redis-backed long-term memory."""
    if _architect_memory_key(file_path) is not None:
        return _read_architect_memory(file_path, max_lines)
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        total = len(lines)
        content = "".join(lines[:max_lines])
        if total > max_lines:
            content += f"\n... ({total - max_lines} more lines)"
        return content
    except Exception as e:
        return f"Error reading {file_path}: {e}"


@tool
def append_file(file_path: str, content: str) -> str:
    """Append content to a file on the VM. Creates the file if it doesn't exist.
    Use absolute paths. /memories/ paths append to Architect's Redis-backed long-term memory.
    """
    if _architect_memory_key(file_path) is not None:
        return _write_architect_memory(file_path, content, append=True)
    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "a", encoding="utf-8") as f:
            f.write(content)
        return f"Appended to: {file_path} ({len(content)} chars)"
    except Exception as e:
        return f"Error appending to {file_path}: {e}"


ATLAS_TOOLS = [
    list_documents,
    preview_csv,
    query_neon,
    execute_neon,
    shell,
    search_architect_memories,
    write_file_anywhere,
    read_file_anywhere,
    append_file,
    *CUSTOM_TOOLS,
]
