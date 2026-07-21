---
name: custom-tools
description: How Atlas registers LangChain tools, when to add a new tool, and how to extend CUSTOM_TOOLS and skills. Use when designing new agent capabilities, refactoring repeated bash into a tool, or wiring domain-specific actions.
---

# Custom tools & skills (Architect toolset)

## Two different “extensions”

| Mechanism | What it is | Best for |
|-----------|------------|----------|
| **Skills** (`src/graphs/skills/*/SKILL.md`) | Markdown loaded by Deep Agents | Procedures, checklists, naming, *how* to do something |
| **Tools** (Python `@tool` in `tools.py` + `custom_tools.py`) | Callable functions the model invokes with arguments | Typed actions, DB/API wrappers, repeatable logic with clear boundaries |

Skills **teach**; tools **do**. When the same bash or reasoning pattern repeats, consider a **tool**; when you need conventions and steps, add a **skill**.

## How tools work in this codebase

1. **Built-in tools** live in `agent_server/src/graphs/tools.py` (`list_documents`, `query_neon`, `shell`, …).
2. **Your custom tools** go in `agent_server/src/graphs/custom_tools.py`:
   - Import `from langchain.tools import tool`.
   - Define `def my_tool(arg: str) -> str:` with a **`"""docstring"""`** — the LLM sees this as the tool description.
   - Append the function to the **`CUSTOM_TOOLS`** list at the bottom of that file.
3. **`tools.py`** merges them: `ATLAS_TOOLS = [ ..., *CUSTOM_TOOLS ]`.
4. **`architect.py`** passes `tools=ATLAS_TOOLS` into `create_deep_agent(...)`.

**VM policy:** This machine is the Architect’s dedicated sandbox (`agent_server/AGENTS.md`).
Extend tools freely; prefer in-process reload when available, otherwise:

```bash
systemctl --user restart atlas-server.service
```

## When to add a custom tool

- The same **multi-step shell** keeps appearing — wrap it in one tool with validated args.
- You need **structured inputs** (machine id, schema version) and clear errors.
- You want **guardrails** (path checks, SQL only via existing helpers, rate limits).
- You are integrating a **small Python library** already in `pyproject.toml`.

## When *not* to add a tool

- One-off exploration → use **`shell`**.
- Ad-hoc SQL → **`query_neon`** / **`execute_neon`**.
- Teaching the model *how* to think → add a **skill** markdown file under `skills/`.

## Adding a skill (not a Python tool)

Create `src/graphs/skills/<name>/SKILL.md` with YAML frontmatter:

```yaml
---
name: my-skill
description: One line — when the agent should load this skill.
---
```

Body is Markdown. The Architect’s `skills=[SKILLS_DIR]` picks up all skill folders next to `architect.py`. No server restart required for **skill-only** changes (next graph build may still cache — restart if needed).

## Checklist for a new Python tool

1. Implement `@tool` in `custom_tools.py` with a precise docstring.
2. Append function to `CUSTOM_TOOLS`.
3. Run `ruff` / quick import test: `cd agent_server && PYTHONPATH=src .venv/bin/python -c "from src.graphs.tools import ATLAS_TOOLS; print(len(ATLAS_TOOLS))"`.
4. Restart `atlas-server`.
5. Smoke-test in chat (Activity panel should show tool name + output).

## Production extraction tools

For document extraction tools intended to become production behavior, follow the
standard in `docs/production-extraction-contracts.md`.

The short version:

1. The deterministic tool owns defaults, output normalization, artifact writing, and fail-fast errors.
2. Architect should not receive the extraction-heavy tool directly.
3. Expose the tool only to the owning extraction worker.
4. Teach the owning worker which tool and default output contract to prefer.
5. Add or update the named contract in `NAMED_PRODUCTION_EXTRACTION_CONTRACTS` when the extraction has tool-owned outputs or must override generic document-family behavior.
6. Update `data-extraction-workflow/SKILL.md` so the runtime agents know the named contract.
7. Add tests for tool exposure, workflow brief behavior, path/output guardrails, and one focused extraction fixture when available.
8. Validate through the normal UI/operator path before treating the workflow as production-ready.

## Safety

- Never `eval` user input.
- Avoid shelling out from tools unless necessary; prefer `query_neon` for DB.
- Do not commit secrets — use env via `src.config.settings`.
