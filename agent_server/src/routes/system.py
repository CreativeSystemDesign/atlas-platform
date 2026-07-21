"""System endpoints - health, info, stats, settings."""

import asyncio
import os
import shutil
import socket
import time
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from src.config import settings
from src.graphs.model_resolution import (
    PREFERRED_ARCHITECT_MODEL_KEY,
    PREFERRED_CODE_MODEL_KEY,
    PREFERRED_CODE_UI_MODEL_KEY,
    PREFERRED_CODE_WORKER_MODEL_KEY,
    PREFERRED_CODEX_COMPONENT_MODEL_KEY,
    PREFERRED_CODEX_LAYOUT_MODEL_KEY,
    PREFERRED_CODEX_TRANSCRIPTION_MODEL_KEY,
)
from src.graphs.registry import get_graph_topology, invalidate_graph, list_graph_ids
from src.persistence.database import get_pool
from src.persistence.memory_backup import snapshot_architect_memories_to_neon
from src.persistence.settings import get_setting, get_system_prompt, set_setting
from src.runtime_event_bus import get_runtime_event_bus, require_redis_ready
from src.terminal.manager import get_terminal_manager

router = APIRouter(tags=["System"])
REPO_ROOT = Path(__file__).resolve().parents[3]
LANGCHAIN_DOCS_ROOT = REPO_ROOT / "docs" / "langchain"
LANGCHAIN_INDEX_SCRIPT = "process_langchain_docs_nvidia.py"
BENCHMARK_ROOT = REPO_ROOT / ".atlas" / "benchmarks"

_LAST_DISK_SAMPLE: dict[str, int | float] | None = None
_LAST_NET_SAMPLE: dict[str, int | float] | None = None
_LAST_DISK_BENCH: dict[str, object] | None = None
_LAST_MEMORY_BENCH: dict[str, object] | None = None
_LAST_DISK_BENCH_AT = 0.0
_LAST_MEMORY_BENCH_AT = 0.0
_DISK_BENCH_RUNNING = False
_MEMORY_BENCH_RUNNING = False


async def _list_process_matches(script_name: str) -> list[dict[str, str | int]]:
    return await _list_process_matches_any([script_name])


async def _list_process_matches_any(script_names: list[str]) -> list[dict[str, str | int]]:
    proc = await asyncio.create_subprocess_exec(
        "ps",
        "-eo",
        "pid=,etime=,%cpu=,%mem=,command=",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _stderr = await proc.communicate()
    matches: list[dict[str, str | int]] = []

    for raw_line in stdout.decode("utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not any(script_name in line for script_name in script_names):
            continue
        parts = line.split(maxsplit=4)
        if len(parts) < 5:
            continue
        pid, elapsed, cpu, mem, command = parts
        try:
            pid_value = int(pid)
        except ValueError:
            continue
        matches.append(
            {
                "pid": pid_value,
                "elapsed": elapsed,
                "cpu": cpu,
                "mem": mem,
                "command": command,
            }
        )

    return matches


def _failed_benchmark_state(name: str, error: Exception) -> dict[str, object]:
    return {
        "name": name,
        "status": "failed",
        "updated_at": None,
        "payload": {},
        "error": str(error),
    }


async def _get_redis_benchmark_states() -> dict[str, dict[str, object]]:
    try:
        return {
            "disk": await get_runtime_event_bus().get_benchmark_state("disk"),
            "memory": await get_runtime_event_bus().get_benchmark_state("memory"),
        }
    except Exception as exc:
        return {
            "disk": _failed_benchmark_state("disk", exc),
            "memory": _failed_benchmark_state("memory", exc),
        }


async def _get_memory_backup_state() -> dict[str, object]:
    try:
        return await get_runtime_event_bus().get_memory_backup_state()
    except Exception as exc:
        return {
            "status": "failed",
            "source": None,
            "count": 0,
            "updated_at": None,
            "error": str(exc),
        }


def _read_meminfo() -> dict[str, int]:
    values: dict[str, int] = {}
    try:
        lines = Path("/proc/meminfo").read_text(encoding="utf-8").splitlines()
    except OSError:
        return values
    for line in lines:
        key, raw = line.split(":", 1)
        parts = raw.strip().split()
        if parts and parts[0].isdigit():
            values[key] = int(parts[0]) * 1024
    return values


def _read_load() -> dict[str, float | int]:
    try:
        one, five, fifteen, *_rest = Path("/proc/loadavg").read_text(
            encoding="utf-8"
        ).split()
    except OSError:
        one = five = fifteen = "0"
    cores = os.cpu_count() or 1
    one_value = float(one)
    return {
        "one": one_value,
        "five": float(five),
        "fifteen": float(fifteen),
        "cores": cores,
        "one_percent": round((one_value / cores) * 100, 1),
    }


def _root_block_device() -> str | None:
    try:
        lines = Path("/proc/self/mountinfo").read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for line in lines:
        fields = line.split()
        if len(fields) > 9 and fields[4] == "/":
            source = fields[-2]
            if source.startswith("/dev/"):
                return Path(source).name
    return None


def _read_diskstats(device: str | None) -> dict[str, int] | None:
    if not device:
        return None
    try:
        lines = Path("/proc/diskstats").read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for line in lines:
        parts = line.split()
        if len(parts) < 14 or parts[2] != device:
            continue
        return {
            "read_ios": int(parts[3]),
            "read_bytes": int(parts[5]) * 512,
            "write_ios": int(parts[7]),
            "write_bytes": int(parts[9]) * 512,
            "io_ms": int(parts[12]),
        }
    return None


def _disk_live_metrics() -> dict[str, object]:
    global _LAST_DISK_SAMPLE

    device = _root_block_device()
    now = time.monotonic()
    stats = _read_diskstats(device)
    result: dict[str, object] = {
        "device": device or "unknown",
        "read_mbps": 0.0,
        "write_mbps": 0.0,
        "read_iops": 0.0,
        "write_iops": 0.0,
        "util_percent": 0.0,
    }
    if not stats:
        return result
    if _LAST_DISK_SAMPLE:
        elapsed = max(0.001, now - float(_LAST_DISK_SAMPLE["sampled_at"]))
        result.update(
            {
                "read_mbps": round(
                    (stats["read_bytes"] - int(_LAST_DISK_SAMPLE["read_bytes"]))
                    / elapsed
                    / 1_000_000,
                    1,
                ),
                "write_mbps": round(
                    (stats["write_bytes"] - int(_LAST_DISK_SAMPLE["write_bytes"]))
                    / elapsed
                    / 1_000_000,
                    1,
                ),
                "read_iops": round(
                    (stats["read_ios"] - int(_LAST_DISK_SAMPLE["read_ios"])) / elapsed,
                    1,
                ),
                "write_iops": round(
                    (stats["write_ios"] - int(_LAST_DISK_SAMPLE["write_ios"])) / elapsed,
                    1,
                ),
                "util_percent": round(
                    min(
                        100.0,
                        (stats["io_ms"] - int(_LAST_DISK_SAMPLE["io_ms"]))
                        / (elapsed * 10),
                    ),
                    1,
                ),
            }
        )
    _LAST_DISK_SAMPLE = {"sampled_at": now, **stats}
    return result


def _network_live_metrics() -> dict[str, float]:
    global _LAST_NET_SAMPLE

    now = time.monotonic()
    rx = 0
    tx = 0
    try:
        lines = Path("/proc/net/dev").read_text(encoding="utf-8").splitlines()[2:]
    except OSError:
        return {"rx_mbps": 0.0, "tx_mbps": 0.0}
    for line in lines:
        name, raw = line.split(":", 1)
        if name.strip() == "lo":
            continue
        parts = raw.split()
        rx += int(parts[0])
        tx += int(parts[8])
    result = {"rx_mbps": 0.0, "tx_mbps": 0.0}
    if _LAST_NET_SAMPLE:
        elapsed = max(0.001, now - float(_LAST_NET_SAMPLE["sampled_at"]))
        result = {
            "rx_mbps": round((rx - int(_LAST_NET_SAMPLE["rx"])) / elapsed / 1_000_000, 2),
            "tx_mbps": round((tx - int(_LAST_NET_SAMPLE["tx"])) / elapsed / 1_000_000, 2),
        }
    _LAST_NET_SAMPLE = {"sampled_at": now, "rx": rx, "tx": tx}
    return result


def _tone(value: float, warn: float, danger: float, inverse: bool = False) -> str:
    if inverse:
        if value <= danger:
            return "critical"
        if value <= warn:
            return "warning"
        return "ok"
    if value >= danger:
        return "critical"
    if value >= warn:
        return "warning"
    return "ok"


def _disk_benchmark(trigger: str) -> dict[str, object]:
    BENCHMARK_ROOT.mkdir(parents=True, exist_ok=True)
    path = BENCHMARK_ROOT / "disk_probe.bin"
    size = 8 * 1024 * 1024
    block = os.urandom(1024 * 1024)

    start = time.perf_counter()
    with path.open("wb") as handle:
        for _ in range(size // len(block)):
            handle.write(block)
        handle.flush()
        os.fsync(handle.fileno())
    write_seconds = max(0.001, time.perf_counter() - start)

    start = time.perf_counter()
    with path.open("rb") as handle:
        while handle.read(1024 * 1024):
            pass
    read_seconds = max(0.001, time.perf_counter() - start)
    try:
        path.unlink()
    except OSError:
        pass

    return {
        "trigger": trigger,
        "read_mbps": round(size / read_seconds / 1_000_000, 1),
        "write_mbps": round(size / write_seconds / 1_000_000, 1),
        "sampled_at": time.time(),
    }


def _memory_benchmark(trigger: str) -> dict[str, object]:
    size = 32 * 1024 * 1024
    source = bytearray(os.urandom(size))
    start = time.perf_counter()
    target = bytearray(source)
    target[0] = source[-1]
    seconds = max(0.001, time.perf_counter() - start)
    return {
        "trigger": trigger,
        "copy_gbps": round(size / seconds / 1_000_000_000, 2),
        "sampled_at": time.time(),
    }


async def _maybe_refresh_benchmarks(load: dict[str, float | int], disk: dict[str, object]) -> None:
    global _DISK_BENCH_RUNNING
    global _LAST_DISK_BENCH
    global _LAST_DISK_BENCH_AT
    global _LAST_MEMORY_BENCH
    global _LAST_MEMORY_BENCH_AT
    global _MEMORY_BENCH_RUNNING

    now = time.monotonic()
    high_load = float(load["one_percent"]) >= 75 or float(disk["util_percent"]) >= 65
    idle = float(load["one_percent"]) <= 25 and float(disk["util_percent"]) <= 15
    trigger = "under load" if high_load else "idle baseline" if idle else None

    if trigger and not _DISK_BENCH_RUNNING:
        cooldown = 300 if high_load else 60
        if now - _LAST_DISK_BENCH_AT >= cooldown:
            try:
                _DISK_BENCH_RUNNING = True
                await get_runtime_event_bus().set_benchmark_state(
                    name="disk",
                    status="running",
                    payload={"trigger": trigger, "queued_at": time.time()},
                )
                _LAST_DISK_BENCH = _disk_benchmark(trigger)
                await get_runtime_event_bus().set_benchmark_state(
                    name="disk",
                    status="completed",
                    payload=_LAST_DISK_BENCH,
                )
                _LAST_DISK_BENCH_AT = now
            except Exception as exc:
                await get_runtime_event_bus().set_benchmark_state(
                    name="disk",
                    status="failed",
                    error=str(exc),
                )
                raise
            finally:
                _DISK_BENCH_RUNNING = False

    if idle and not _MEMORY_BENCH_RUNNING and now - _LAST_MEMORY_BENCH_AT >= 60:
        try:
            _MEMORY_BENCH_RUNNING = True
            await get_runtime_event_bus().set_benchmark_state(
                name="memory",
                status="running",
                payload={"trigger": "idle baseline", "queued_at": time.time()},
            )
            _LAST_MEMORY_BENCH = _memory_benchmark("idle baseline")
            await get_runtime_event_bus().set_benchmark_state(
                name="memory",
                status="completed",
                payload=_LAST_MEMORY_BENCH,
            )
            _LAST_MEMORY_BENCH_AT = now
        except Exception as exc:
            await get_runtime_event_bus().set_benchmark_state(
                name="memory",
                status="failed",
                error=str(exc),
            )
            raise
        finally:
            _MEMORY_BENCH_RUNNING = False


async def _tcp_latency(host: str, port: int, timeout: float = 0.35) -> dict[str, object]:
    start = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            pass
        return {"ok": True, "latency_ms": round((time.perf_counter() - start) * 1000, 1)}
    except OSError as exc:
        return {"ok": False, "error": str(exc), "latency_ms": None}


def _redis_host_port() -> tuple[str, int]:
    parsed = urlparse(settings.redis_uri)
    return parsed.hostname or "127.0.0.1", parsed.port or 6379


@router.get("/ok")
async def health_check():
    return {"ok": True}


@router.get("/healthz")
async def healthz():
    """Lightweight readiness probe for the live Architect stack.

    This endpoint intentionally avoids Neon. Database availability should surface
    on the actual save/load/query operation that needs Neon, with the original
    database error preserved for the operator.
    """
    checks: dict[str, str] = {}

    try:
        tm = get_terminal_manager()
        if not tm.primary_agent_id:
            raise RuntimeError("primary agent terminal missing")
        checks["terminal_manager"] = "ok"
    except Exception as exc:
        checks["terminal_manager"] = f"error: {exc}"

    try:
        await require_redis_ready()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {exc}"

    ready = all(v == "ok" for v in checks.values())
    payload = {
        "ok": ready,
        "service": "atlas-agent-server",
        "port": settings.port,
        "checks": checks,
    }
    if not ready:
        raise HTTPException(status_code=503, detail=payload)
    return payload


@router.get("/info")
async def server_info():
    pool = await get_pool()
    async with pool.connection() as conn:
        threads = await conn.execute("SELECT COUNT(*) FROM threads")
        thread_count = (await threads.fetchone())[0]
        runs_result = await conn.execute("SELECT COUNT(*) FROM runs")
        run_count = (await runs_result.fetchone())[0]
        active_runs = await conn.execute("SELECT COUNT(*) FROM runs WHERE status IN ('pending', 'running')")
        active_count = (await active_runs.fetchone())[0]
        assistants = await conn.execute("SELECT COUNT(*) FROM assistants")
        assistant_count = (await assistants.fetchone())[0]

    system_prompt = await get_system_prompt()
    pref_raw = await get_setting(PREFERRED_ARCHITECT_MODEL_KEY, "")
    preferred = pref_raw.strip() or None
    code_pref_raw = await get_setting(PREFERRED_CODE_MODEL_KEY, "")
    preferred_code = code_pref_raw.strip() or None
    code_worker_pref_raw = await get_setting(PREFERRED_CODE_WORKER_MODEL_KEY, "")
    preferred_code_worker = code_worker_pref_raw.strip() or None
    code_ui_pref_raw = await get_setting(PREFERRED_CODE_UI_MODEL_KEY, "")
    preferred_code_ui = code_ui_pref_raw.strip() or None
    codex_layout_pref_raw = await get_setting(PREFERRED_CODEX_LAYOUT_MODEL_KEY, "")
    preferred_codex_layout = codex_layout_pref_raw.strip() or None
    codex_component_pref_raw = await get_setting(PREFERRED_CODEX_COMPONENT_MODEL_KEY, "")
    preferred_codex_component = codex_component_pref_raw.strip() or None
    codex_transcription_pref_raw = await get_setting(
        PREFERRED_CODEX_TRANSCRIPTION_MODEL_KEY,
        "",
    )
    preferred_codex_transcription = codex_transcription_pref_raw.strip() or None

    return {
        "version": "0.1.0",
        "server": "atlas-agent-server",
        "graphs": list_graph_ids(),
        "config": {
            "architect_model": settings.architect_model,
            "preferred_architect_model": preferred,
            "code_model": settings.code_model,
            "preferred_code_model": preferred_code,
            "worker_model": settings.worker_model,
            "code_worker_model": settings.code_worker_model,
            "preferred_code_worker_model": preferred_code_worker,
            "code_ui_model": settings.code_ui_model,
            "preferred_code_ui_model": preferred_code_ui,
            "codex_layout_model": settings.codex_layout_model,
            "preferred_codex_layout_model": preferred_codex_layout,
            "codex_component_model": settings.codex_component_model,
            "preferred_codex_component_model": preferred_codex_component,
            "codex_transcription_model": settings.codex_transcription_model,
            "preferred_codex_transcription_model": preferred_codex_transcription,
            "database": "Neon PostgreSQL",
            "redis": settings.redis_uri,
            "port": settings.port,
        },
        "stats": {
            "threads": thread_count,
            "runs_total": run_count,
            "runs_active": active_count,
            "assistants": assistant_count,
            "workers_active": 0,
            "workers_max": 10,
            "documents": 0,
            "digital_twins": 0,
        },
        "system_prompt": system_prompt,
    }


@router.get("/graphs/{graph_id}/topology")
async def graph_topology(graph_id: str):
    if graph_id not in list_graph_ids():
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found")
    return {"graph_id": graph_id, **get_graph_topology(graph_id)}


@router.get("/operator/progress")
async def operator_progress():
    total_source_files = (
        sum(1 for _ in LANGCHAIN_DOCS_ROOT.rglob("*.md"))
        if LANGCHAIN_DOCS_ROOT.exists()
        else 0
    )
    total_rows = 0
    files_indexed = 0
    table_exists = False

    pool = await get_pool()
    async with pool.connection() as conn:
        exists_result = await conn.execute(
            "SELECT to_regclass('public.langchain_docs') IS NOT NULL"
        )
        exists_row = await exists_result.fetchone()
        table_exists = bool(exists_row[0]) if exists_row else False

        if table_exists:
            rows_result = await conn.execute("SELECT COUNT(*) FROM langchain_docs")
            total_rows = int((await rows_result.fetchone())[0])

            files_result = await conn.execute(
                "SELECT COUNT(DISTINCT file_path) FROM langchain_docs"
            )
            files_indexed = int((await files_result.fetchone())[0])

    processes = await _list_process_matches(LANGCHAIN_INDEX_SCRIPT)
    duplicate_source_files = max(0, total_source_files - files_indexed)
    effective_total_files = (
        files_indexed
        if table_exists and total_rows > 0 and not processes
        else total_source_files
    )
    percent_files = (
        round((files_indexed / effective_total_files) * 100, 1)
        if effective_total_files
        else 0.0
    )

    workloads = []
    has_meaningful_progress = files_indexed > 0 or total_rows > 0
    if processes or has_meaningful_progress:
        status = "running" if processes else "idle"
        if duplicate_source_files and not processes:
            summary = (
                f"{files_indexed} unique files indexed from {total_source_files} source files "
                f"({duplicate_source_files} mirrored duplicates skipped), "
                f"{total_rows} chunks stored"
            )
        elif effective_total_files:
            summary = (
                f"{files_indexed} of {effective_total_files} files indexed, "
                f"{total_rows} chunks stored"
            )
        else:
            summary = f"{total_rows} chunks stored"
        workloads.append(
            {
                "id": "langchain-docs-index",
                "label": "LangChain docs indexing",
                "status": status,
                "summary": summary,
                "percent": percent_files,
                "metrics": {
                    "files_indexed": files_indexed,
                    "total_files": effective_total_files,
                    "source_files": total_source_files,
                    "duplicate_source_files": duplicate_source_files,
                    "chunks_stored": total_rows,
                },
                "processes": processes,
            }
        )

    return {"ok": True, "workloads": workloads}


@router.post("/operator/memory/backup")
async def operator_memory_backup():
    return await snapshot_architect_memories_to_neon("manual")


@router.get("/operator/runtime/events")
async def operator_runtime_events(
    limit: int = Query(100, ge=1, le=500),
    run_id: str | None = None,
    thread_id: str | None = None,
    source: str | None = None,
    event_type: str | None = None,
    newest_first: bool = True,
):
    return await get_runtime_event_bus().list_runtime_events(
        limit=limit,
        run_id=run_id,
        thread_id=thread_id,
        source=source,
        event_type=event_type,
        newest_first=newest_first,
    )


@router.get("/operator/runtime/transcript")
async def operator_runtime_transcript(
    limit: int = Query(100, ge=1, le=500),
    run_id: str | None = None,
    thread_id: str | None = None,
    source: str | None = None,
    newest_first: bool = True,
):
    return await get_runtime_event_bus().list_runtime_transcript(
        limit=limit,
        run_id=run_id,
        thread_id=thread_id,
        source=source,
        newest_first=newest_first,
    )


@router.get("/operator/overview")
async def operator_overview():
    load = _read_load()
    disk_live = _disk_live_metrics()
    await _maybe_refresh_benchmarks(load, disk_live)

    meminfo = _read_meminfo()
    total_mem = meminfo.get("MemTotal", 0)
    available_mem = meminfo.get("MemAvailable", 0)
    used_mem = max(0, total_mem - available_mem)
    swap_total = meminfo.get("SwapTotal", 0)
    swap_free = meminfo.get("SwapFree", 0)
    swap_used = max(0, swap_total - swap_free)
    disk_usage = shutil.disk_usage("/")
    network = _network_live_metrics()

    neon_latency_ms: float | None = None
    neon_error: str | None = None
    neon_ok = False
    thread_count = 0
    run_count = 0
    active_runs = 0
    vector_chunks = 0
    vector_files = 0
    assistants = 0

    start = time.perf_counter()
    try:
        pool = await get_pool()
        async with pool.connection() as conn:
            await conn.execute("SELECT 1")
            neon_latency_ms = round((time.perf_counter() - start) * 1000, 1)
            neon_ok = True

            threads = await conn.execute("SELECT COUNT(*) FROM threads")
            thread_count = int((await threads.fetchone())[0])
            runs = await conn.execute("SELECT COUNT(*) FROM runs")
            run_count = int((await runs.fetchone())[0])
            active = await conn.execute(
                "SELECT COUNT(*) FROM runs WHERE status IN ('pending', 'running')"
            )
            active_runs = int((await active.fetchone())[0])
            assistants_result = await conn.execute("SELECT COUNT(*) FROM assistants")
            assistants = int((await assistants_result.fetchone())[0])
            exists_result = await conn.execute(
                "SELECT to_regclass('public.langchain_docs') IS NOT NULL"
            )
            exists_row = await exists_result.fetchone()
            if exists_row and exists_row[0]:
                vector_rows = await conn.execute(
                    "SELECT COUNT(*), COUNT(DISTINCT file_path) FROM langchain_docs"
                )
                vector_chunks, vector_files = [int(value) for value in await vector_rows.fetchone()]
    except Exception as exc:
        neon_latency_ms = None
        neon_error = str(exc)
        neon_ok = False

    redis_host, redis_port = _redis_host_port()
    redis = await _tcp_latency(redis_host, redis_port)
    redis_benchmarks = await _get_redis_benchmark_states()
    redis_memory_backup = await _get_memory_backup_state()
    qdrant = await _tcp_latency(settings.qdrant_host, int(settings.qdrant_port))
    dashboard = await _tcp_latency("127.0.0.1", 3002)
    agent_processes = await _list_process_matches("uvicorn src.main:app")
    dashboard_processes = await _list_process_matches_any(
        ["next dev -p 3002", "next start -p 3002", "next-server", "node-server"]
    )
    qdrant_processes = await _list_process_matches("qdrant")
    indexing_processes = await _list_process_matches(LANGCHAIN_INDEX_SCRIPT)

    terminal_sessions = []
    try:
        terminal_sessions = get_terminal_manager().list_sessions()
    except Exception:
        terminal_sessions = []

    memory_percent = round((used_mem / total_mem) * 100, 1) if total_mem else 0.0
    swap_percent = round((swap_used / swap_total) * 100, 1) if swap_total else 0.0
    disk_percent = round((disk_usage.used / disk_usage.total) * 100, 1)

    return {
        "ok": True,
        "sampled_at": time.time(),
        "vm": {
            "load": load,
            "memory": {
                "total_bytes": total_mem,
                "used_bytes": used_mem,
                "available_bytes": available_mem,
                "used_percent": memory_percent,
                "swap_total_bytes": swap_total,
                "swap_used_bytes": swap_used,
                "swap_used_percent": swap_percent,
                "tone": _tone(memory_percent, 75, 90),
            },
            "disk": {
                "root_total_bytes": disk_usage.total,
                "root_used_bytes": disk_usage.used,
                "root_free_bytes": disk_usage.free,
                "root_used_percent": disk_percent,
                "live": disk_live,
                "benchmark": redis_benchmarks["disk"],
                "tone": _tone(
                    max(float(disk_live["util_percent"]), disk_percent),
                    70,
                    90,
                ),
            },
            "network": network,
            "benchmarks": {
                "disk": redis_benchmarks["disk"],
                "memory": redis_benchmarks["memory"],
            },
            "processes": {
                "agent_server": agent_processes,
                "dashboard": dashboard_processes,
                "qdrant": qdrant_processes,
                "indexing": indexing_processes,
            },
            "uptime_seconds": time.monotonic(),
        },
        "framework": {
            "agent_server": {
                "ok": bool(agent_processes),
                "port": settings.port,
                "process_count": len(agent_processes),
            },
            "dashboard": {
                **dashboard,
                "port": 3002,
                "process_count": len(dashboard_processes),
            },
            "neon": {"ok": neon_ok, "latency_ms": neon_latency_ms, "error": neon_error},
            "redis": {
                **redis,
                "required": settings.redis_required,
                "stream_key": settings.redis_runtime_stream_key,
                "stream_maxlen": settings.redis_runtime_stream_maxlen,
            },
            "qdrant": qdrant,
            "model": {
                "architect": settings.architect_model,
                "worker": settings.worker_model,
                "code": settings.code_model,
                "code_worker": settings.code_worker_model,
                "code_ui": settings.code_ui_model,
                "data_extraction": settings.data_extraction_model,
            },
            "threads": {"count": thread_count},
            "runs": {"total": run_count, "active": active_runs},
            "assistants": {"count": assistants},
            "workers": {
                "sessions": len(terminal_sessions),
                "active": active_runs,
            },
            "memory_backup": redis_memory_backup,
            "vector_index": {
                "chunks": vector_chunks,
                "files": vector_files,
                "status": "indexing" if indexing_processes else "idle",
            },
        },
    }


class SystemPromptUpdate(BaseModel):
    system_prompt: str


@router.get("/settings/system-prompt")
async def get_prompt():
    return {"system_prompt": await get_system_prompt()}


@router.put("/settings/system-prompt")
async def update_prompt(body: SystemPromptUpdate):
    await set_setting("system_prompt", body.system_prompt)
    invalidate_graph("atlas-architect")
    return {"ok": True, "system_prompt": body.system_prompt}


class PreferredArchitectModelBody(BaseModel):
    """Set to null or empty string to fall back to ARCHITECT_MODEL in .env."""

    model_id: str | None = None


class PreferredCodeModelBody(BaseModel):
    """Set to null or empty string to fall back to the matching .env default."""

    model_id: str | None = None


async def _get_preferred_model(key: str, default_from_env: str) -> dict[str, str | None]:
    raw = await get_setting(key, "")
    value = raw.strip()
    return {
        "model_id": value if value else None,
        "default_from_env": default_from_env,
    }


async def _put_preferred_code_model(
    key: str,
    body: PreferredCodeModelBody,
) -> dict[str, str | bool | None]:
    if body.model_id is None or not str(body.model_id).strip():
        await set_setting(key, "")
        saved = None
    else:
        saved = str(body.model_id).strip()
        await set_setting(key, saved)
    invalidate_graph("atlas-code")
    return {"ok": True, "model_id": saved}


@router.get("/settings/preferred-architect-model")
async def get_preferred_architect_model():
    raw = await get_setting(PREFERRED_ARCHITECT_MODEL_KEY, "")
    return {
        "model_id": raw.strip() if raw.strip() else None,
        "default_from_env": settings.architect_model,
    }


@router.put("/settings/preferred-architect-model")
async def put_preferred_architect_model(body: PreferredArchitectModelBody):
    if body.model_id is None or not str(body.model_id).strip():
        await set_setting(PREFERRED_ARCHITECT_MODEL_KEY, "")
        saved = None
    else:
        saved = str(body.model_id).strip()
        await set_setting(PREFERRED_ARCHITECT_MODEL_KEY, saved)
    return {"ok": True, "model_id": saved}


@router.get("/settings/preferred-code-model")
async def get_preferred_code_model():
    return await _get_preferred_model(PREFERRED_CODE_MODEL_KEY, settings.code_model)


@router.put("/settings/preferred-code-model")
async def put_preferred_code_model(body: PreferredCodeModelBody):
    return await _put_preferred_code_model(PREFERRED_CODE_MODEL_KEY, body)


@router.get("/settings/preferred-code-worker-model")
async def get_preferred_code_worker_model():
    return await _get_preferred_model(
        PREFERRED_CODE_WORKER_MODEL_KEY,
        settings.code_worker_model,
    )


@router.put("/settings/preferred-code-worker-model")
async def put_preferred_code_worker_model(body: PreferredCodeModelBody):
    return await _put_preferred_code_model(PREFERRED_CODE_WORKER_MODEL_KEY, body)


@router.get("/settings/preferred-code-ui-model")
async def get_preferred_code_ui_model():
    return await _get_preferred_model(PREFERRED_CODE_UI_MODEL_KEY, settings.code_ui_model)


@router.put("/settings/preferred-code-ui-model")
async def put_preferred_code_ui_model(body: PreferredCodeModelBody):
    return await _put_preferred_code_model(PREFERRED_CODE_UI_MODEL_KEY, body)


@router.get("/settings/preferred-codex-layout-model")
async def get_preferred_codex_layout_model():
    return await _get_preferred_model(
        PREFERRED_CODEX_LAYOUT_MODEL_KEY,
        settings.codex_layout_model,
    )


@router.put("/settings/preferred-codex-layout-model")
async def put_preferred_codex_layout_model(body: PreferredCodeModelBody):
    return await _put_preferred_code_model(PREFERRED_CODEX_LAYOUT_MODEL_KEY, body)


@router.get("/settings/preferred-codex-component-model")
async def get_preferred_codex_component_model():
    return await _get_preferred_model(
        PREFERRED_CODEX_COMPONENT_MODEL_KEY,
        settings.codex_component_model,
    )


@router.put("/settings/preferred-codex-component-model")
async def put_preferred_codex_component_model(body: PreferredCodeModelBody):
    return await _put_preferred_code_model(PREFERRED_CODEX_COMPONENT_MODEL_KEY, body)


@router.get("/settings/preferred-codex-transcription-model")
async def get_preferred_codex_transcription_model():
    return await _get_preferred_model(
        PREFERRED_CODEX_TRANSCRIPTION_MODEL_KEY,
        settings.codex_transcription_model,
    )


@router.put("/settings/preferred-codex-transcription-model")
async def put_preferred_codex_transcription_model(body: PreferredCodeModelBody):
    return await _put_preferred_code_model(PREFERRED_CODEX_TRANSCRIPTION_MODEL_KEY, body)

