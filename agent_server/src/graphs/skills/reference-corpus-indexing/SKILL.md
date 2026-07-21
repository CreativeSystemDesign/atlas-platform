---
name: reference-corpus-indexing
description: How to create or refresh a canonical reference corpus in Neon and its derived Qdrant index. Use when setting up local docs retrieval, vector stores, or reusable framework knowledge bases.
---

# Reference corpus indexing

## Goal

When Architect needs a reusable documentation corpus, it should set it up in a repeatable way:

1. Canonical rows in the backend database from `agent_server/.env`
2. Derived vector index in Qdrant
3. Retrieval tool(s) that query the derived index
4. Operator-readable verification of files, chunks, and collection counts

## Policy

- Do not treat Qdrant as the only copy of the corpus.
- Do not hardcode API keys or ad hoc connection strings in scripts.
- Prefer env-backed settings from `agent_server/.env`.
- Before creating a new corpus, inspect whether a canonical table, sync script, or collection already exists.

## Current LangChain docs corpus

- Local docs root: `/home/eshanegross/az_vm/atlas_platform/docs/langchain`
- Canonical table: `langchain_docs`
- Derived Qdrant collection: configured by env / settings
- Sync script: `/home/eshanegross/az_vm/atlas_platform/scripts/sync_langchain_reference_corpus.py`
- Retrieval tool: `search_langchain_docs`

## Expected workflow

1. Verify the local docs corpus exists on disk.
2. Verify `agent_server/.env` contains the needed backend and embedding configuration.
3. Run the sync script to refresh canonical rows and rebuild the Qdrant index.
4. Verify:
   - chunk count in PostgreSQL
   - distinct file count in PostgreSQL
   - point count in Qdrant
5. Use `search_langchain_docs` for framework research instead of guessing from memory.

## Reporting

After a refresh, report:

- which corpus was refreshed
- canonical table name
- vector collection name
- total files indexed
- total chunks indexed
- whether Architect can query it immediately
