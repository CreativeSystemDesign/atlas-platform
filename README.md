# Atlas-Platform

**Turn industrial machine documentation into Certified, queryable data — a digital twin of the documentation, and through it, the machine.**

This is the source of a working platform, published for review. Not a framework, not a demo scaffold — the actual code that ingests decades-old machine PDFs (schematics, cable lists, terminal-box drawings, parts catalogs, PLC references) and turns them into a relational + graph twin where every fact carries the coordinates of the printed ink it came from.

**The live page:** [atlas-platform.cloud](https://atlas-platform.cloud) · **This repo, rendered:** the same page is served from [`/docs`](docs/) via GitHub Pages.

> **Status:** pre-launch, in active development, proven end to end against a complete real-world industrial corpus (60+ documents, 2,700+ pages, bilingual, scanned and vector). Early access is open — [get on the list](https://atlas-platform.cloud/#contact).

---

## Why publish the source?

Because the entire premise of this platform is **auditability** — every extracted fact traceable to the printed mark it came from — and a company selling auditability should let you audit the software itself. Marketing pages make claims. Source code keeps them.

## The laws, kept in code

The platform's AI works under laws that hold it to the print. On the marketing page they're prose; here they're checkable:

| Law | Where the code enforces it |
|---|---|
| **AI drafts. A person seals.** Certified data seals read-only; the platform refuses every mutation — from the AI or anyone else — until a human deliberately unseals. | [`agent_server/src/certification.py`](agent_server/src/certification.py) — append-only, checksummed seal snapshots with drift verification · [`agent_server/src/extraction_data.py`](agent_server/src/extraction_data.py) — certified tables refuse writes (HTTP 409), including the AI's own write tools |
| **The platform can never claim what isn't its own.** Extractions are mechanically barred from adopting or altering foreign tables. | [`agent_server/src/extraction_data.py`](agent_server/src/extraction_data.py) (`assert_claimable`) + the shared denylist in [`agent_server/src/data_sources.py`](agent_server/src/data_sources.py) |
| **Detection never gates.** Vision-model detections are evidence with a hard ceiling — they inform, and are structurally barred from blocking or gating any result. | [`agent_server/src/canvas_copilot/audit.py`](agent_server/src/canvas_copilot/audit.py) — detector-fed audit rules are capped at INFO severity |
| **Joins are proposed with proof, ruled by a person.** The AI measures a relationship against live data and proposes; it cannot draw, accept, or dismiss. | [`agent_server/src/canvas_copilot/data_map_tools.py`](agent_server/src/canvas_copilot/data_map_tools.py) — the propose-only seat contract |
| **Same matching truth everywhere.** The SQL matching engine and its Python reference implementation are locked in parity by test. | [`agent_server/tests/test_norm_parity.py`](agent_server/tests/test_norm_parity.py) |

*(A historical note you'll find in the schema: the certification tables carry the legacy identifier `gold_sealed_annotations` — the trust tier was renamed "Certified" but stored identifiers keep their names, because renaming an append-only archive would be exactly the kind of history rewriting this platform exists to refuse.)*

## What's in here

```
agent_server/       FastAPI backend — extraction pipeline, certification machinery,
                    the audit engine, and the seat-based AI copilot (Arc)
atlas-dashboard/    Next.js frontend — Smart Canvas (schematic annotation over the
                    original print), 3D machine graph, Data Map + Proving Bench,
                    document extraction surfaces
docs/               The public marketing page (served by GitHub Pages from this repo)
```

## What's deliberately not in here

- **The proving corpus.** The platform was proven against a real machine's private documentation. That corpus belongs to its owner and never enters a public surface — a rule this project enforces on itself the way it enforces its laws on its AI.
- **The extraction doctrine.** The platform's AI is educated by hundreds of codified extraction lessons mined from real supervised sessions — how to read ditto marks, fold continuation rows, treat blank cells, survive mistranslated bilingual headers. That education is the product's accumulated judgment and ships with the product, not the source. What you're reviewing here is the machinery; the judgment stays home.
- Credentials, run logs, and internal working notes.

## Can I run it?

The license below permits local evaluation. Fair warning: v1 of this repo is published for **review** — the backend expects a PostgreSQL instance and environment configuration that isn't packaged yet. A self-contained evaluation build (docker-compose, local Postgres, bring-your-own-PDF) is the next milestone for this repo.

## License

Source-available under a **Review & Evaluation License** — you may read this code and run it locally to evaluate it. No production use, no derivative works, no use in competing products. See [LICENSE](LICENSE). If you want to *use* the platform: [request early access](https://atlas-platform.cloud/#contact).

---

*Built by a maintenance engineer with 20+ years on the plant floor, for the 2 AM breakdown where the hunt — which breaker, which wire, which page — takes the hour, and the fix takes minutes.*
