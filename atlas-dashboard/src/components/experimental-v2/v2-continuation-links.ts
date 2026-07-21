// Cross-page continuation resolution (Shane's green-chip design, 2026-07-11).
//
// A wire number is a machine-level identity — R502 on sheet 5 and sheet 6 is
// ONE conductor. Each page pushes SIGHTINGS (its anchored continuations:
// net + the sheet they point at) into a document-level registry, keyed by
// page so a canvas only ever writes its own entry. "Resolved" is DERIVED,
// never stored: two sightings that reciprocate (A points at B's sheet, B
// points back at A's, same wire number) are a linked pair — the chip turns
// green, and the pair is exactly a continuation arc of the 3D machine graph.
//
// Sheet matching is EXACT-STRING on the fraction numerator: this document's
// front matter runs its own zero-padded series ('01'..'05'), so '01' and '1'
// are DIFFERENT sheets — never int-normalize.

import type { V2Graph } from "./experimental-v2-types";

export type ContSighting = {
  contId: string;
  net: string;
  refSheet: string;
  refZone: string | null;
  rawRef: string | null;
};

export type ContRegistryPage = {
  sheet: string | null;
  sightings: ContSighting[];
  // Node labels drawn on the page (Shane, 2026-07-11): lets component-bound
  // chips resolve — "ELB50 also appears at sheet 32" is proven when sheet
  // 32's page lists ELB50. Also the substrate for 3D device threading.
  labels?: string[];
};
// key = page number as a string (JSONB object keys)
export type ContRegistry = Record<string, ContRegistryPage>;

export type ResolvedLink = { page: number; contId: string; net: string; sheet: string };

/** "5/207" | "5" -> "5" (the numerator is the sheet identity). */
export function sheetNumberOf(sheetRef: string | null | undefined): string | null {
  if (!sheetRef) return null;
  const head = String(sheetRef).split("/")[0]?.trim();
  return head || null;
}

/** The sheet a continuation POINTS AT — its sheet field, else rawRef's head
 * ("6/1" or "33-4" both lead with the sheet). */
export function refSheetOf(c: { sheet: string | null; rawRef: string | null }): string | null {
  if (c.sheet?.trim()) return c.sheet.trim();
  const raw = (c.rawRef ?? "").trim();
  const m = raw.match(/^(\d{1,3})\s*[/-]/);
  return m ? m[1] : null;
}

/** The page's component-label roster (deduped) for the registry entry. */
export function pageLabels(graph: V2Graph): string[] {
  return [...new Set(graph.nodes.map((n) => (n.label ?? "").trim()).filter(Boolean))];
}

/** This page's pushable sightings: anchored (port-target) continuations on a
 * LABELED wire, pointing at a parseable sheet. Unanchored chips can't sight —
 * the audit already flags them. */
export function pageSightings(graph: V2Graph): ContSighting[] {
  const out: ContSighting[] = [];
  for (const c of graph.continuations) {
    if (c.target?.kind !== "port") continue;
    const refSheet = refSheetOf(c);
    if (!refSheet) continue;
    const edge = graph.edges.find(
      (e) => e.sourcePortId === c.target!.id || e.targetPortId === c.target!.id
    );
    const net = edge?.label?.trim();
    if (!net) continue;
    out.push({
      contId: c.id,
      net,
      refSheet,
      refZone: c.zone ?? null,
      rawRef: c.rawRef ?? null,
    });
  }
  return out;
}

/** Pair this page's sightings against the registry: resolved = a sighting on
 * a page whose sheet is MY ref target, same wire number, pointing back at MY
 * sheet. Returns contId -> counterpart. */
export function resolveLinks(
  registry: ContRegistry,
  myPage: number,
  mySheetRef: string | null,
  mySightings: ContSighting[]
): Map<string, ResolvedLink> {
  const out = new Map<string, ResolvedLink>();
  const mySheet = sheetNumberOf(mySheetRef);
  if (!mySheet) return out;
  for (const s of mySightings) {
    for (const [pageKey, entry] of Object.entries(registry)) {
      const page = Number(pageKey);
      if (page === myPage) continue;
      const theirSheet = sheetNumberOf(entry.sheet);
      if (theirSheet !== s.refSheet) continue;
      const match = (entry.sightings ?? []).find(
        (t) => t.net === s.net && t.refSheet === mySheet
      );
      if (match) {
        out.set(s.contId, { page, contId: match.contId, net: s.net, sheet: theirSheet });
        break;
      }
    }
  }
  return out;
}

// Per-chip status taxonomy (Shane, 2026-07-11: "we need more than just two
// colors... visually we need to be able to tell not only if its connected
// but if not, why"). Every chip gets a state AND the reason in words:
//   resolved   — reciprocal proven on the destination sheet (green)
//   waiting    — anchored + sighted; destination sheet not annotated yet
//                (amber — the healthy in-progress state)
//   mismatch   — destination sheet IS annotated but nothing reciprocates:
//                someone is wrong on one side (violet — the actionable alarm)
//   unanchored — no wire-end target here; can't sight at all (rose)
//   unlabeled  — anchored, but the wire carries no number = no identity (slate)
//   device     — targets a component (device cross-ref, not a wire link; amber)
//   symbol     — sits ON the printed continuation symbol: it ANNOTATES the
//                print (training data), it makes no electrical claim, so it
//                carries no status color (Shane, 2026-07-11)
//   orphan     — a symbol chip whose ref has NO anchored link chip carrying
//                its electrical side: the inter-page edge is SEVERED — "that
//                can break the entire machine electrically" (Shane,
//                2026-07-11, the MS2 33/4). The loudest state.
export type ContState = "resolved" | "waiting" | "mismatch" | "unanchored" | "unlabeled" | "device" | "symbol" | "orphan";
export type ContStatus = {
  state: ContState;
  detail: string;
  link?: ResolvedLink; // resolved: the counterpart
  destPage?: number; // mismatch: the annotated page to go investigate
};

export function continuationStatuses(
  registry: ContRegistry,
  myPage: number,
  mySheetRef: string | null,
  graph: V2Graph,
  // Cable refs resolve through the CABLE registry (name identity), not
  // reciprocity: label -> { pages } is enough to prove the cable exists on
  // the destination sheet (Shane, 2026-07-11).
  cableReg?: Record<string, { pages?: number[] }>,
  // Unanchored chips sitting ON a printed ref (the caller detects this from
  // page geometry) are SYMBOL annotations — quiet, never alarmed.
  symbolChipIds?: Set<string>
): Map<string, ContStatus> {
  const out = new Map<string, ContStatus>();
  const mySheet = sheetNumberOf(mySheetRef);
  const sheetOfPage = (page: number): string | null =>
    sheetNumberOf(registry[String(page)]?.sheet ?? null);
  for (const c of graph.continuations) {
    const ref = c.rawRef ?? `${c.sheet ?? "?"}/${c.zone ?? "?"}`;
    if (c.target?.kind === "component") {
      // Component-bound chips (ELB50, THR2): resolution = the destination
      // sheet's page lists the SAME component label. No reciprocity needed —
      // presence proves the cross-ref.
      const node = graph.nodes.find((n) => n.id === c.target!.id);
      const label = node?.label?.trim();
      const refSheet = refSheetOf(c);
      if (!label || !refSheet) {
        out.set(c.id, { state: "device", detail: `device cross-ref (${ref}) — targets a component` });
        continue;
      }
      let destPage: number | null = null;
      let found = false;
      for (const [pageKey, entry] of Object.entries(registry)) {
        const page = Number(pageKey);
        if (page === myPage) continue;
        if (sheetNumberOf(entry.sheet) !== refSheet) continue;
        destPage = page;
        if (Array.isArray(entry.labels) && entry.labels.includes(label)) { found = true; break; }
        // labels roster missing (entry predates it): unknown, stay neutral
        if (!Array.isArray(entry.labels)) destPage = null;
      }
      if (found && destPage !== null) {
        out.set(c.id, {
          state: "resolved",
          detail: `${label} also appears on sheet ${refSheet} — component found there`,
          destPage,
        });
      } else if (destPage !== null) {
        out.set(c.id, {
          state: "mismatch",
          detail: `sheet ${refSheet} (page ${destPage}) is annotated but has no component ${label} — check the ref or the label over there`,
          destPage,
        });
      } else {
        out.set(c.id, { state: "waiting", detail: `${label} continues at sheet ${refSheet}, which isn't annotated yet` });
      }
      continue;
    }
    if (c.target?.kind === "cable") {
      const cab = (graph.cables ?? []).find((cb) => cb.id === c.target!.id);
      const label = cab?.label?.trim();
      const refSheet = refSheetOf(c);
      if (!label) {
        out.set(c.id, { state: "unlabeled", detail: "bound to a cable that has no name — name the cable" });
        continue;
      }
      if (!refSheet) {
        out.set(c.id, { state: "unlabeled", detail: `no sheet parses from the ref (${ref}) — set sheet/zone` });
        continue;
      }
      const pages = (cableReg?.[label]?.pages ?? []).filter((p) => p !== myPage);
      const destPage = pages.find((p) => sheetOfPage(p) === refSheet) ?? null;
      if (destPage !== null) {
        out.set(c.id, {
          state: "resolved",
          detail: `cable ${label} is drawn on sheet ${refSheet} — same name, same cable (registry)`,
          destPage,
        });
      } else {
        // Is ANY annotated page that sheet?
        const annotated = Object.keys(registry).some(
          (pk) => Number(pk) !== myPage && sheetOfPage(Number(pk)) === refSheet
        );
        out.set(c.id, annotated
          ? {
              state: "mismatch",
              detail: `sheet ${refSheet} is annotated but cable ${label} isn't drawn there — draw its box (same name) or check the ref`,
              destPage: Object.keys(registry).map(Number).find((p) => p !== myPage && sheetOfPage(p) === refSheet),
            }
          : { state: "waiting", detail: `cable ${label} continues at sheet ${refSheet}, which isn't annotated yet` });
      }
      continue;
    }
    if (c.target?.kind !== "port") {
      if (symbolChipIds?.has(c.id)) {
        // Orphan check (count-based, duplicate-ref safe): the page must
        // carry at least as many ANCHORED chips with this ref as symbol
        // chips with it — otherwise some printed symbol's electrical side
        // is missing and the machine graph is severed there.
        const key = (x: { sheet: string | null; rawRef: string | null; zone?: string | null }) =>
          `${refSheetOf(x) ?? "?"}/${(x.zone ?? "").trim() || (x.rawRef ?? "").split(/[/-]/)[1]?.trim() || "?"}`;
        const myKey = key(c);
        const symbols = graph.continuations.filter(
          (o) => !o.target && symbolChipIds.has(o.id) && key(o) === myKey
        ).length;
        const anchored = graph.continuations.filter(
          (o) => o.target && key(o) === myKey
        ).length;
        if (anchored >= symbols) {
          out.set(c.id, {
            state: "symbol",
            detail: "annotates the printed continuation symbol — its electrical side is carried by a linked chip",
          });
        } else {
          out.set(c.id, {
            state: "orphan",
            detail: `printed ${myKey} has no anchored link chip carrying its electrical side — the inter-page connection is SEVERED in the data. Ctrl+click (chip active) or Shift+drag a copy onto what it continues`,
          });
        }
        continue;
      }
      out.set(c.id, {
        state: "unanchored",
        detail: "anchored to nothing — drag it onto the wire endpoint it continues (or Ctrl+C/Ctrl+V an anchored copy)",
      });
      continue;
    }
    const edge = graph.edges.find(
      (e) => e.sourcePortId === c.target!.id || e.targetPortId === c.target!.id
    );
    const net = edge?.label?.trim();
    if (!net) {
      out.set(c.id, {
        state: "unlabeled",
        detail: "anchored, but the wire has no number — name the wire so the link has an identity",
      });
      continue;
    }
    const refSheet = refSheetOf(c);
    if (!refSheet) {
      out.set(c.id, { state: "unlabeled", detail: `no sheet parses from the ref (${ref}) — set sheet/zone` });
      continue;
    }
    // Sighted. Find annotated destination page(s) for that sheet.
    let destPage: number | null = null;
    let link: ResolvedLink | null = null;
    for (const [pageKey, entry] of Object.entries(registry)) {
      const page = Number(pageKey);
      if (page === myPage) continue;
      if (sheetNumberOf(entry.sheet) !== refSheet) continue;
      destPage = page;
      const match = mySheet
        ? (entry.sightings ?? []).find((t) => t.net === net && t.refSheet === mySheet)
        : undefined;
      if (match) {
        link = { page, contId: match.contId, net, sheet: refSheet };
        break;
      }
    }
    if (link) {
      out.set(c.id, { state: "resolved", detail: `${net} continues at sheet ${refSheet} — reciprocal confirmed`, link });
    } else if (destPage !== null) {
      out.set(c.id, {
        state: "mismatch",
        detail: `sheet ${refSheet} (page ${destPage}) is annotated but has no anchored ${net} chip pointing back at sheet ${mySheet ?? "?"} — check the wire number and anchoring on both sides`,
        destPage,
      });
    } else {
      out.set(c.id, {
        state: "waiting",
        detail: `sheet ${refSheet} isn't annotated yet — resolves when its page lands`,
      });
    }
  }
  return out;
}

// --- Reading a printed ref at a point (Shane, 2026-07-11: the Continuation
// tool grabbed ONE DIGIT of a stacked fraction). Printed refs come in three
// forms: a single token ("6/1", "33- 4"), or a CENTERED FRACTION whose digits
// are separate tokens ("3","2" over "9" = 32/9). Cluster digits into
// horizontal runs, then pair runs vertically by center — the same machinery
// the audit's rule 20 uses server-side.

type RefText = { text: string; center: { x: number; y: number } };

export function printedRefAt(
  texts: RefText[],
  point: { x: number; y: number },
  reachPx = 60
): { sheet: string | null; zone: string | null; rawRef: string | null } | null {
  const near = texts
    .map((t) => ({ s: t.text.trim(), x: t.center.x, y: t.center.y }))
    .filter((t) => t.s && Math.hypot(t.x - point.x, t.y - point.y) <= reachPx);
  if (!near.length) return null;
  // 1. A complete single-token ref wins (slash or dash form).
  const whole = near
    .map((t) => ({ ...t, m: t.s.match(/^(\d{1,3})\s*[/-]\s*(\d{1,3})$/) }))
    .filter((t) => t.m)
    .sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y))[0];
  if (whole?.m) return { sheet: whole.m[1], zone: whole.m[2], rawRef: `${whole.m[1]}/${whole.m[2]}` };
  // 2. Cluster loose digits into horizontal runs.
  const digits = near.filter((t) => /^\d{1,3}$/.test(t.s)).sort((a, b) => a.y - b.y || a.x - b.x);
  type Run = { s: string; x0: number; x1: number; y: number };
  const runs: Run[] = [];
  for (const d of digits) {
    const r = runs[runs.length - 1];
    if (r && Math.abs(r.y - d.y) <= 4 && d.x - r.x1 > 0 && d.x - r.x1 <= 16) {
      r.s += d.s;
      r.x1 = d.x;
    } else {
      runs.push({ s: d.s, x0: d.x, x1: d.x, y: d.y });
    }
  }
  const cx = (r: Run) => (r.x0 + r.x1) / 2;
  // 3. Pair runs vertically by center (sheet over zone); nearest pair to the
  //    click wins.
  let best: { sheet: string; zone: string; d: number } | null = null;
  for (let i = 0; i < runs.length; i++) {
    for (let j = 0; j < runs.length; j++) {
      if (i === j) continue;
      const top = runs[i], bot = runs[j];
      const dy = bot.y - top.y;
      if (dy < 14 || dy > 42) continue;
      if (Math.abs(cx(top) - cx(bot)) > 8) continue;
      const d = Math.hypot((cx(top) + cx(bot)) / 2 - point.x, (top.y + bot.y) / 2 - point.y);
      if (!best || d < best.d) best = { sheet: top.s, zone: bot.s, d };
    }
  }
  if (best) return { sheet: best.sheet, zone: best.zone, rawRef: `${best.sheet}/${best.zone}` };
  return null;
}
