---
name: architect-runtime
description: Use when Architect needs to understand its own runtime, durable memory, backend routing, thread persistence, tool boundaries, or framework capabilities.
---

# Architect Runtime Reference

This skill is the operational reference for Atlas Architect's own runtime. Use it when the operator asks about memory, framework behavior, persistence, tool routing, or what Architect can do.

## Durable Memory

Architect has a file-shaped long-term memory namespace mounted at:

```text
/memories/
```

This is not a normal repository folder. In Atlas, `/memories/` is routed by `CompositeBackend` to Deep Agents `StoreBackend`, backed by the Redis LangGraph Store.

Operational rules:

- Save durable Architect memory as concise Markdown files under `/memories/`.
- Use `/memories/` when the operator says "remember this", "save this to memory", "update your memory", or asks to preserve operational knowledge for future sessions.
- Read, grep, or glob `/memories/` when prior Atlas operational knowledge is relevant.
- Never use `shell`, `sudo`, `ls`, `find`, `mkdir`, `cat`, or other OS commands for `/memories/`. It is a virtual store route, not a Linux directory.
- Do not use the repository `memory/` directory for Architect long-term memory unless the operator explicitly asks for a Git-tracked reference document.
- Do not treat `/store` HTTP API state as separate memory. It should point at the same Redis-backed LangGraph store.

Path mapping:

```text
Architect-visible path: /memories/schematic_spine_slice0.md
Store namespace:        ("atlas-architect", "memories")
Store key:              /schematic_spine_slice0.md
Store value shape:      {"content": "...", "encoding": "utf-8"}
```

## Backend Routing

Architect uses a `CompositeBackend`:

- default backend: real filesystem rooted at `ATLAS_ROOT`
- `/memories/`: durable LangGraph Store backend

The filesystem tools route paths by prefix. A read or write under `/memories/` is not a disk operation under the repo. It is a persistent store operation.

## Thread And Store Persistence

Atlas uses two different persistence concepts:

- Checkpoints: short-term thread state and run continuity.
- Store: cross-thread long-term memory.
- Neon memory snapshots: async recovery backups of Redis-backed `/memories/`.

Do not confuse thread recall with long-term memory. If knowledge must survive across unrelated future threads, write it under `/memories/`.

## Capability Surfacing

If the operator asks what Architect can do or how its runtime works:

1. Check current code and local docs first.
2. Use this skill for the runtime model.
3. Use official framework docs when implementation details may have changed.
4. Keep operator-facing answers concise and distinguish verified facts from inferences.

## Tool Boundaries

Tool availability is intentional:

- Architect coordinates work and delegates specialist missions.
- Extraction and validation work routes through `data-extraction-supervisor`.
- Specialist-only deterministic tools must be invoked by the owning specialist, not manually recreated by Architect.

For production extraction missions, follow the named-contract workflow and do not self-rescue outside the extraction chain.
