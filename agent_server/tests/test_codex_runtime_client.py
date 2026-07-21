from __future__ import annotations

import asyncio
from typing import Any

from src.codex_runtime.client import CodexAppServerClient


class FakeTransport:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.incoming: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self.started = False
        self.closed = False

    async def start(self) -> None:
        self.started = True

    async def send(self, message: dict[str, Any]) -> None:
        self.sent.append(message)
        if message.get("method") == "initialize":
            await self.incoming.put(
                {
                    "id": message["id"],
                    "result": {
                        "codexHome": "/home/eshanegross/.codex",
                        "platformFamily": "unix",
                        "platformOs": "linux",
                        "userAgent": "atlas-code-test",
                    },
                }
            )

    async def receive(self) -> dict[str, Any] | None:
        return await self.incoming.get()

    async def close(self) -> None:
        self.closed = True
        await self.incoming.put(None)


def test_codex_client_initializes_and_sends_initialized_notification() -> None:
    async def run() -> FakeTransport:
        transport = FakeTransport()
        client = CodexAppServerClient(transport=transport)
        await client.start()
        await client.close()
        return transport

    transport = asyncio.run(run())

    assert transport.started
    assert transport.sent[0]["method"] == "initialize"
    assert transport.sent[0]["params"]["clientInfo"]["name"] == "atlas_code"
    assert transport.sent[0]["params"]["capabilities"]["experimentalApi"] is True
    assert transport.sent[1] == {"method": "initialized"}
    assert transport.closed


def test_codex_client_routes_model_list_response() -> None:
    async def run() -> tuple[FakeTransport, dict[str, Any]]:
        transport = FakeTransport()
        client = CodexAppServerClient(transport=transport)
        await client.start()
        request_task = asyncio.create_task(
            client.request("model/list", {"includeHidden": False})
        )
        await asyncio.sleep(0)
        model_request = transport.sent[-1]
        await transport.incoming.put(
            {
                "id": model_request["id"],
                "result": {
                    "data": [
                        {
                            "id": "gpt-5.4",
                            "model": "gpt-5.4",
                            "displayName": "GPT-5.4",
                            "description": "Coding model",
                            "hidden": False,
                            "isDefault": True,
                            "defaultReasoningEffort": "xhigh",
                            "supportedReasoningEfforts": [],
                        }
                    ]
                },
            }
        )
        result = await request_task
        await client.close()
        return transport, result

    transport, result = asyncio.run(run())

    assert transport.sent[-1]["method"] == "model/list"
    assert result["data"][0]["id"] == "gpt-5.4"


def test_codex_client_declines_command_approval_requests_by_default() -> None:
    async def run() -> FakeTransport:
        transport = FakeTransport()
        client = CodexAppServerClient(transport=transport)
        await client.start()
        await transport.incoming.put(
            {
                "id": 99,
                "method": "item/commandExecution/requestApproval",
                "params": {
                    "threadId": "thr_1",
                    "turnId": "turn_1",
                    "itemId": "item_1",
                    "command": "rm -rf /",
                    "cwd": "/",
                },
            }
        )
        notification = await client.next_notification(timeout=1)
        await asyncio.sleep(0)
        await client.close()
        assert notification["method"] == "item/commandExecution/requestApproval"
        return transport

    transport = asyncio.run(run())

    assert transport.sent[-1] == {"id": 99, "result": {"decision": "decline"}}
