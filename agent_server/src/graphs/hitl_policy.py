"""Human-in-the-loop tool policy from settings."""

from __future__ import annotations

from langchain.agents.middleware import InterruptOnConfig

from src.config import settings


def interrupt_on_policy() -> dict[str, bool | InterruptOnConfig] | None:
    """Parse `hitl_interrupt_tools` into `create_deep_agent(interrupt_on=...)`."""
    raw = settings.hitl_interrupt_tools.strip()
    if not raw:
        return None
    out: dict[str, bool | InterruptOnConfig] = {}
    for part in raw.split(","):
        name = part.strip()
        if name:
            out[name] = True
    return out or None
