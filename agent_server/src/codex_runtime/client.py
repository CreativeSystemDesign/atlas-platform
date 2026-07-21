from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Protocol

JsonObject = dict[str, Any]
CODEX_APP_SERVER_STDIO_LIMIT_BYTES = 16 * 1024 * 1024


class CodexRuntimeError(RuntimeError):
    """Base error for native Codex runtime failures."""


class CodexJsonRpcError(CodexRuntimeError):
    def __init__(self, error: JsonObject) -> None:
        self.error = error
        super().__init__(str(error.get("message") or error))


class CodexTransport(Protocol):
    async def start(self) -> None: ...

    async def send(self, message: JsonObject) -> None: ...

    async def receive(self) -> JsonObject | None: ...

    async def close(self) -> None: ...


@dataclass(frozen=True)
class CodexLaunchConfig:
    codex_bin: str = "codex"
    cwd: str | None = None
    env: dict[str, str] | None = None
    client_name: str = "atlas_code"
    client_title: str = "Atlas Code"
    client_version: str = "0.1.0"
    experimental_api: bool = True


class ProcessJsonRpcTransport:
    """Line-delimited JSON-RPC transport for `codex app-server --listen stdio://`."""

    def __init__(self, config: CodexLaunchConfig) -> None:
        self.config = config
        self._process: asyncio.subprocess.Process | None = None
        self._stderr_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._process:
            return
        env = os.environ.copy()
        if self.config.env:
            env.update(self.config.env)
        self._process = await asyncio.create_subprocess_exec(
            self.config.codex_bin,
            "app-server",
            "--listen",
            "stdio://",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.config.cwd,
            env=env,
            limit=CODEX_APP_SERVER_STDIO_LIMIT_BYTES,
        )
        self._stderr_task = asyncio.create_task(
            self._drain_stderr(),
            name="atlas-code-codex-stderr",
        )

    async def send(self, message: JsonObject) -> None:
        process = self._require_process()
        if not process.stdin:
            raise CodexRuntimeError("Codex app-server stdin is not available")
        payload = json.dumps(message, separators=(",", ":")).encode("utf-8") + b"\n"
        process.stdin.write(payload)
        await process.stdin.drain()

    async def receive(self) -> JsonObject | None:
        process = self._require_process()
        if not process.stdout:
            raise CodexRuntimeError("Codex app-server stdout is not available")
        line = await process.stdout.readline()
        if not line:
            return None
        try:
            return json.loads(line.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise CodexRuntimeError(f"Invalid Codex JSON-RPC frame: {line!r}") from exc

    async def close(self) -> None:
        process = self._process
        self._process = None
        if not process:
            return
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=3)
            except TimeoutError:
                process.kill()
                await process.wait()
        if self._stderr_task:
            self._stderr_task.cancel()
            try:
                await self._stderr_task
            except asyncio.CancelledError:
                pass
            self._stderr_task = None

    def _require_process(self) -> asyncio.subprocess.Process:
        if not self._process:
            raise CodexRuntimeError("Codex app-server process is not started")
        return self._process

    async def _drain_stderr(self) -> None:
        process = self._require_process()
        if not process.stderr:
            return
        while await process.stderr.readline():
            pass


class CodexAppServerClient:
    """Small async client for the official Codex app-server protocol.

    This is intentionally a protocol proof layer. It keeps native Codex messages intact
    instead of translating them into an Atlas-specific agent model.
    """

    def __init__(
        self,
        config: CodexLaunchConfig | None = None,
        *,
        transport: CodexTransport | None = None,
    ) -> None:
        self.config = config or CodexLaunchConfig()
        self._transport = transport or ProcessJsonRpcTransport(self.config)
        self._next_id = 1
        self._pending: dict[int, asyncio.Future[JsonObject]] = {}
        self._notifications: asyncio.Queue[JsonObject] = asyncio.Queue()
        self._reader_task: asyncio.Task[None] | None = None
        self._send_lock = asyncio.Lock()

    async def __aenter__(self) -> "CodexAppServerClient":
        await self.start()
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.close()

    async def start(self) -> None:
        await self._transport.start()
        self._reader_task = asyncio.create_task(
            self._reader_loop(),
            name="atlas-code-codex-reader",
        )
        await self.request(
            "initialize",
            {
                "clientInfo": {
                    "name": self.config.client_name,
                    "title": self.config.client_title,
                    "version": self.config.client_version,
                },
                "capabilities": {"experimentalApi": self.config.experimental_api},
            },
        )
        await self.notify("initialized")

    async def close(self) -> None:
        for pending in self._pending.values():
            if not pending.done():
                pending.cancel()
        self._pending.clear()
        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass
            self._reader_task = None
        await self._transport.close()

    async def request(
        self,
        method: str,
        params: JsonObject | None = None,
        *,
        timeout: float = 30.0,
    ) -> JsonObject:
        async with self._send_lock:
            request_id = self._next_id
            self._next_id += 1
            loop = asyncio.get_running_loop()
            future: asyncio.Future[JsonObject] = loop.create_future()
            self._pending[request_id] = future
            await self._transport.send(
                {
                    "id": request_id,
                    "method": method,
                    "params": params or {},
                }
            )
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        finally:
            self._pending.pop(request_id, None)

    async def notify(self, method: str, params: JsonObject | None = None) -> None:
        payload: JsonObject = {"method": method}
        if params is not None:
            payload["params"] = params
        async with self._send_lock:
            await self._transport.send(payload)

    async def notifications(self) -> AsyncIterator[JsonObject]:
        while True:
            yield await self._notifications.get()

    async def next_notification(self, *, timeout: float | None = None) -> JsonObject:
        if timeout is None:
            return await self._notifications.get()
        return await asyncio.wait_for(self._notifications.get(), timeout=timeout)

    async def _reader_loop(self) -> None:
        while True:
            message = await self._transport.receive()
            if message is None:
                self._fail_pending(CodexRuntimeError("Codex app-server closed stdout"))
                return
            if "id" in message and "method" not in message:
                self._resolve_response(message)
                continue
            if "id" in message and "method" in message:
                await self._handle_server_request(message)
                continue
            await self._notifications.put(message)

    def _resolve_response(self, message: JsonObject) -> None:
        request_id = message.get("id")
        if not isinstance(request_id, int):
            return
        future = self._pending.get(request_id)
        if not future or future.done():
            return
        if "error" in message:
            future.set_exception(CodexJsonRpcError(message["error"]))
        else:
            future.set_result(message.get("result") or {})

    async def _handle_server_request(self, message: JsonObject) -> None:
        await self._notifications.put(message)
        request_id = message.get("id")
        if not isinstance(request_id, int):
            return
        method = str(message.get("method") or "")
        result = _default_server_request_response(method)
        response: JsonObject
        if result is None:
            response = {
                "id": request_id,
                "error": {
                    "code": -32601,
                    "message": f"Atlas Code proof client cannot handle {method}",
                },
            }
        else:
            response = {"id": request_id, "result": result}
        async with self._send_lock:
            await self._transport.send(response)

    def _fail_pending(self, exc: BaseException) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(exc)


def _default_server_request_response(method: str) -> JsonObject | None:
    if method in {"item/commandExecution/requestApproval", "execCommandApproval"}:
        return {"decision": "decline"}
    if method in {"item/fileChange/requestApproval", "applyPatchApproval"}:
        return {"decision": "decline"}
    if method == "mcpServer/elicitation/request":
        return {"action": "decline", "content": None}
    if method == "item/tool/requestUserInput":
        return {"answers": {}}
    if method == "item/tool/call":
        return {
            "success": False,
            "contentItems": [
                {
                    "type": "inputText",
                    "text": "Atlas Code proof client does not execute dynamic client tools yet.",
                }
            ],
        }
    if method == "item/permissions/requestApproval":
        return {"permissions": {}, "scope": "turn"}
    return None
