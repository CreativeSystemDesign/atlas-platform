# Arc — The Resident Engineer, and How It Was Educated

**Training without training.** Arc — the resident AI industrial engineer — has never been fine-tuned. Its expertise lives in *files*: readable, auditable, seat-scoped lessons distilled from hundreds of supervised working sessions and certified into law by a human. Nothing a machine's documentation teaches Arc ever enters a model's weights.

**And to be clear about who does the teaching: we do.** This education happened — and continues — at Atlas-Platform, under our own expert, on real industrial documents. **Arc arrives educated.** A customer never runs a training project, labels a dataset, or supervises an apprenticeship; they get the graduate. The education is also provable in a way model training never is: the knowledge files themselves are the audit trail, and every lesson quotes the human ruling that created it.

One distinction before the mechanics, because it's the entire point: **Arc is not a persona.** A system prompt that says "you are an expert electrical engineer" changes how a model *talks*, not what it *knows*. Arc's expertise is acquired: it learned through supervised work, the way apprentices learn, and it retains that learning as files in its memory — knowledge that exists outside the base model, survives every session, accumulates across years, and can be opened and read by a human. A persona is a costume. An education is a curriculum with an audit trail.

This is the platform's deepest differentiator, so it deserves a full accounting.

## The loop: Teach → Mine → Attack → Certify → Enforce

### 1. Teach
Every supervised session is a lesson in the raw. Our expert — a maintenance engineer with twenty-plus years on the plant floor — works a real document next to Arc: correcting a wrong box, explaining that a right-margin note describes the circuit to its *left*, ruling that a crossed-out row is supersession rather than deletion. Those rulings land in the session stream as ordinary conversation. The expert never writes doctrine; they just work, and the working *is* the teaching.

### 2. Mine
A deterministic distiller sweeps the session streams and separates the expert's **verbatim words** from machine-generated noise — the single most important rule of the pipeline. Each session becomes a compact run card: what the human actually said, what Arc did before and after each ruling, what was already codified live. Then finder agents fan out, one per run card, extracting candidates in three shapes:

- **Doctrine** — a ruling not yet codified, with the expert's quoted sentence attached
- **Anti-pattern** — a mistake the human caught, distilled to "never do X"
- **Exemplar** — a move worth preserving as a pattern

A candidate without a real quote behind it is invalid by construction. A paraphrase is rejected outright. The education is sourced testimony, never model invention.

### 3. Attack
Every candidate faces an adversarial skeptic whose only job is refutation: *Is this grounded in the stream — real quote, real context? Is it doctrine-worthy, or a one-off?* **Default: reject on doubt.** Only survivors proceed, and survivors are then deduplicated against everything already law — the same lesson rediscovered across many sessions is evidence of importance, not a new entry. A completeness critic closes each sweep by asking what the pipeline missed; the gaps seed the next one.

This is the same epistemic architecture the platform applies to data — propose, attack, verify — applied to knowledge itself.

### 4. Certify
The pipeline ends at a slate, and a human walks it. **Nothing self-promotes to law.** Every lesson in Arc's head was deliberately certified by the expert whose words it quotes — the exact discipline the platform applies to extracted data, applied to the AI's own mind. One trust vocabulary governs both: data is Certified against the print; lessons are Certified against the expert.

### 5. Enforce
The platform's own controlled experiment found that **prose decays, mechanism holds** — instructions written as paragraphs stop being followed; rules wired into machinery don't. So certified lessons are routed into homes with teeth:

- **Audit rules** — deterministic page checks. New rules are *born as warnings* and promoted to blocking errors only after calibration against human-certified pages at **zero false positives**. A rule earns its authority.
- **Seat-scoped doctrine** — a lesson about reading cable lists loads at the extraction seat and never leaks into the annotation seat. Each of Arc's working contexts carries exactly the law that applies there.
- **Live injection** — a certified correction changes Arc's behavior the very next session, with zero deployment.

## The rails: why imperfection is fuel

Arc is not sold as infallible — it's built so that *being wrong is productive*:

- The **audit engine** checks every page mechanically; unresolved findings block the work from being called done.
- A **done-gate** refuses completion claims while open issues remain — "finished" is a server-side verdict, not the model's opinion.
- After every edit, Arc must judge the result **from fresh pixels** — a screenshot taken after the change, never from its own belief that the change worked. Delivered is not the same as correct.
- And whatever slips past the rails is caught at **human certification** — where it becomes the next lesson, mined, attacked, certified, enforced.

Mistakes are ore, not waste. That's the flywheel.

## The measurable arc

- **First attempt ever** at annotating a schematic page: three boxes, roughly half right.
- **Hundreds of supervised sessions later**: 260+ certified lessons on the books — print grammar, blank-cell semantics, continuation conventions, bilingual-header traps, join-key discipline.
- **Today**: Arc annotates entire schematic pages and extracts whole documents autonomously, with correctness and completeness at or near **100% where it's actually measured — the human seal**. Recent pages have passed certification without a single correction.
- **And the curriculum is less than a tenth complete.** The lessons certified so far cover a fraction of the planned training material; the performance above is what a tenth of the education buys.

The lever gets longer with every session — and the expert's role moves up, from laborer to authority.

## The curriculum

What the education covers today, from the working corpus:

- **JIS / JEM electrical drafting** — JIS C 0617 symbol conventions (including the older forms decades-old prints still carry), JEM 1115 device designations (MC, CR, TR, THR, ELB, MCB, SOL, LS, PB, SS, PL…)
- **The Japanese sequence-diagram format** (developed connection diagrams) — a-contact/b-contact notation, line-number grids, page-encoded device numbering, page/line continuation references
- **Mitsubishi MELSEC-Q PLC programs** — GX-format ladder, device comments, special relays, intelligent-module buffer addressing, network configuration logic
- **Omron SYSMAC CJ-series PLC programs** — CX-format sections, CIO word.bit addressing, and cross-reference listings tying every input to every rung that reads it
- **FL-net (OPCN-2) multi-vendor networking** — the open FA standard that bridges PLC brands, including the interface lists that map one vendor's addresses to the other's
- **IEC 61131-3 ladder** (JIS B 3503) in both vendors' dialects
- **Bilingual (English/Japanese) industrial documentation** — including the mistranslated-header traps
- **Vendor compliance ecosystems** — reading UL / CSA / cULus / CE / NK / Lloyd's certification tables off component datasheets
- **JIS technical-drawing practice** — zone-grid sheets, bilingual title blocks, revision tables, Munsell color notation on panel specifications
- **The unwritten print grammar no standard documents** — ditto marks, continuation rows, strike-through supersession, revision clouds, route-encoding cable callouts, blank-cell semantics

The curriculum grows the way it always has: a new document family arrives, the expert teaches by working, and the pipeline turns the sessions into certified law.

## Why publish the method?

Because the method isn't the moat — the *education* is. The pipeline without an expert's twenty years and hundreds of supervised sessions is an empty flywheel. And the form the education takes matters for trust: lessons are files, not weights — auditable, portable, deletable, and never entangled with any customer's data. We publish the method for the same reason we publish the certification machinery: a platform whose premise is auditability should be auditable about how its AI comes to know what it knows.

---

*See also: [TRUST-MODEL.md](TRUST-MODEL.md) for the tiers and seals the lessons enforce, and [ARCHITECTURE.md](ARCHITECTURE.md) for the seat system they load into.*
