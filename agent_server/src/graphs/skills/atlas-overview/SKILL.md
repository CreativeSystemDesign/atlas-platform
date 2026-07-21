---
name: atlas-overview
description: Overview of the Atlas Platform architecture, capabilities, and current state. Use when asked about what Atlas does, how it works, or what the current development status is.
---

# Atlas Platform Overview

## VM sandbox (canonical)

This **Azure VM is dedicated to Atlas Architect** — purchased so the agent has a
full workspace: use OS resources, bash, git, and the repo without acting like a
guest. Self-awareness only: don’t destroy live `agent_server` source or `.env`
while relying on them. See `agent_server/AGENTS.md` for the same policy in prose.

## What Atlas Does
Atlas Platform transforms industrial machine documentation (PDFs of wiring schematics, ladder diagrams, cable lists, PLC programs) into verified digital twins stored in PostgreSQL.

## Architecture
- **Architect Agent**: You. The orchestrator that plans, delegates, and verifies.
- **Worker Agents**: Parallel document processors that extract and structure data.
- **Agent Server**: Custom FastAPI server (API-compatible with LangGraph Agent Server).
- **Database**: Neon PostgreSQL — stores threads, checkpoints, digital twin data.
- **LLM Provider**: OpenRouter — multi-model strategy (Architect uses capable model, workers use fast/cheap models).

## Current Capabilities
- Chat-based interaction with the developer
- Task planning with write_todos
- File system access (read, write, list, search)
- Persistent conversation state across restarts (Neon PostgreSQL)
- Web dashboard with real-time monitoring

## What's Coming Next
- Document ingestion tools (OCR, vision, extraction)
- Subagent delegation for parallel document processing
- Quality verification and gap detection
- Digital twin schema population

## Key Directories
- `/home/eshanegross/az_vm/atlas_platform/` — project root
- `agent_server/` — FastAPI server + Deep Agent
- `atlas-dashboard/` — Next.js UI
- `documents/` — **canonical machine documentation library** (production PDFs, CSVs, PLC exports).  
  - `documents/the reference machine/the reference machine/` — full document set for **machine the reference machine-1** (one physical machine).
- `memory/` — archived knowledge from Arc experiment

## Runtime environment (for shell and DB work)

- **VM / OS work:** Prefer the **`shell` (bash) tool** for git, ripgrep, systemd, venv
  pip, npm, and general commands. The UI shows bash lines distinctly in Activity.
- **Postgres from the agent:** Use tools `query_neon` / `execute_neon` for SQL. They
  already use the server's Neon database.
- **Python:** Use `agent_server/.venv/bin/python` — not bare `python`.
- **Postgres driver in this repo:** `psycopg` v3 (in `pyproject.toml`), **not** `psycopg2`.
- **Connection string:** `DATABASE_URI` in `agent_server/.env` only. Do not mix in
  DSNs from other codenames or old experiments unless the user explicitly points you there.
