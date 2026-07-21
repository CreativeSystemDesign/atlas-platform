"""LangGraph Redis checkpointer for Atlas runtime state."""

from __future__ import annotations

import importlib.metadata as importlib_metadata
import json

from langgraph.checkpoint.redis.aio import AsyncRedisSaver

from src.config import settings

_saver: AsyncRedisSaver | None = None


def assert_pinned_redis_package() -> None:
    """Fail fast if the Redis checkpoint/store package is not the pinned fork."""
    expected_commit = settings.redis_checkpoint_required_commit.strip()
    if not expected_commit:
        return

    distribution = importlib_metadata.distribution("langgraph-checkpoint-redis")
    direct_url = distribution.read_text("direct_url.json")
    if not direct_url:
        raise RuntimeError(
            "langgraph-checkpoint-redis is not installed from the pinned fork; "
            f"expected commit {expected_commit}"
        )
    payload = json.loads(direct_url)
    commit_id = payload.get("vcs_info", {}).get("commit_id")
    if commit_id != expected_commit:
        raise RuntimeError(
            "langgraph-checkpoint-redis commit mismatch; "
            f"expected {expected_commit}, found {commit_id or 'unknown'}"
        )


async def get_checkpointer() -> AsyncRedisSaver:
    """Return the singleton Redis-backed LangGraph checkpointer."""
    global _saver
    if _saver is None:
        assert_pinned_redis_package()
        saver = AsyncRedisSaver(
            redis_url=settings.redis_uri,
            checkpoint_prefix=settings.redis_checkpoint_prefix,
            checkpoint_write_prefix=settings.redis_checkpoint_write_prefix,
        )
        try:
            await saver.asetup()
        except Exception:
            await saver.__aexit__(None, None, None)
            raise
        _saver = saver
    return _saver


async def close_checkpointer() -> None:
    """Close Redis checkpointer connections on application shutdown."""
    global _saver
    if _saver is not None:
        await _saver.__aexit__(None, None, None)
        _saver = None
