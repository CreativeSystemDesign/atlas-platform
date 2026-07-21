// Density-aware label -> element assignment.
//
// A fixed search radius makes each element independently grab its nearest text,
// so on dense pages two terminals can claim the same number, or a label is
// pulled to the wrong neighbor. Instead we do a global one-to-one assignment:
// gather all (element, label) pairs within a generous cap, sort by distance,
// and bind greedily so each label and each element is used at most once. The
// closest pairs lock first — density-adaptive — and unmatched labels stay
// unassigned (no false data).

import { type Point, distance } from "./v2-geometry.ts";

export type LabelToken = { text: string; center: Point };

// Returns a map from element index -> assigned label text.
export function assignLabels(
  elements: Point[],
  tokens: LabelToken[],
  maxPx: number
): Map<number, string> {
  type Pair = { e: number; t: number; d: number };
  const pairs: Pair[] = [];
  for (let e = 0; e < elements.length; e++) {
    for (let t = 0; t < tokens.length; t++) {
      const d = distance(elements[e], tokens[t].center);
      if (d <= maxPx) pairs.push({ e, t, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  const out = new Map<number, string>();
  const usedE = new Set<number>();
  const usedT = new Set<number>();
  for (const p of pairs) {
    if (usedE.has(p.e) || usedT.has(p.t)) continue;
    out.set(p.e, tokens[p.t].text);
    usedE.add(p.e);
    usedT.add(p.t);
  }
  return out;
}
