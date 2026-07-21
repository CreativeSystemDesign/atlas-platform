"""LangGraph Memory Store backed by Redis."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from langgraph.store.redis import RedisStore
from langgraph.store.redis.aio import AsyncRedisStore
from redis import Redis
from redisvl.redis.connection import RedisConnectionFactory

from src.config import settings
from src.persistence.checkpointer import assert_pinned_redis_package

_store: AsyncRedisStore | None = None
_sync_client: Redis | None = None
_sync_store: RedisStore | None = None


def _store_kwargs() -> dict[str, str]:
    return {
        "store_prefix": settings.redis_store_prefix,
        "vector_prefix": settings.redis_store_vector_prefix,
    }


async def get_store() -> AsyncRedisStore:
    """Return the singleton Redis-backed LangGraph Store."""
    global _store
    if _store is None:
        assert_pinned_redis_package()
        store = AsyncRedisStore(redis_url=settings.redis_uri, **_store_kwargs())
        try:
            await store.setup()
        except Exception:
            await store.__aexit__(None, None, None)
            raise
        _store = store
    return _store


def get_sync_store() -> RedisStore:
    """Return the singleton sync Redis Store for non-async call sites."""
    global _sync_client, _sync_store
    if _sync_store is None:
        assert_pinned_redis_package()
        client = RedisConnectionFactory.get_redis_connection(settings.redis_uri)
        store = RedisStore(client, **_store_kwargs())
        try:
            store.setup()
        except Exception:
            client.close()
            client.connection_pool.disconnect()
            raise
        _sync_client = client
        _sync_store = store
    return _sync_store


@contextmanager
def sync_store_context() -> Iterator[RedisStore]:
    """Yield the sync Redis Store for non-async tool and route handlers."""
    yield get_sync_store()


async def close_store() -> None:
    """Close Redis Store connections on application shutdown."""
    global _store, _sync_client, _sync_store
    if _store is not None:
        await _store.__aexit__(None, None, None)
        _store = None
    if _sync_client is not None:
        _sync_client.close()
        _sync_client.connection_pool.disconnect()
        _sync_client = None
        _sync_store = None
