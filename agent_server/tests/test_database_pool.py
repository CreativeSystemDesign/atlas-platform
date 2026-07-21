from __future__ import annotations

import asyncio

from src.persistence import database


def test_get_pool_checks_connections_before_checkout(monkeypatch):
    created_pools: list[FakeAsyncConnectionPool] = []

    class FakeAsyncConnectionPool:
        check_connection = object()

        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.opened = False
            created_pools.append(self)

        async def open(self):
            self.opened = True

    monkeypatch.setattr(database, "AsyncConnectionPool", FakeAsyncConnectionPool)
    database._pool = None
    database._schema_ready = False

    try:
        pool = asyncio.run(database.get_pool(ensure_schema=False))
    finally:
        database._pool = None
        database._schema_ready = False

    assert pool is created_pools[0]
    assert pool.opened is True
    assert pool.kwargs["check"] is FakeAsyncConnectionPool.check_connection

