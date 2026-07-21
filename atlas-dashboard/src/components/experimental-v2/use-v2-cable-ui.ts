"use client";

// Cable UI for the Experimental v2 screen (extracted from
// experimental-v2-screen in the 2026-07-11 modularity pass): owns the
// document-level cable registry plus every screen-side roster mutation —
// the touch-to-link auto-adopt effect, rename re-keying, adopt-from-strip,
// and roster row removal. Logic is verbatim from the screen; toasts go
// through the shared early-effect ref because this hook mounts above the
// live bridge that provides showToast.

import { useCallback, useEffect } from "react";
import { useV2CableRegistry } from "./use-v2-cable-registry";
import { stripsTouchingBox, adoptionEntries, portsTouchingBox } from "./v2-strip";
import type { V2Graph } from "./experimental-v2-types";

export function useV2CableUi({
  projectId,
  documentId,
  graph,
  graphReady,
  pageNum,
  graphRef,
  showToastRef,
}: {
  projectId: string;
  documentId: string;
  graph: V2Graph;
  graphReady: boolean;
  pageNum: number;
  graphRef: { current: V2Graph };
  showToastRef: { current: ((msg: string) => void) | null };
}) {
  // Document-level cable registry (Shane's design, 2026-07-10): cable name ->
  // conductor roster; same name on any page is the same cable.
  const { registry: cableRegistry, updateRegistry } = useV2CableRegistry(projectId, documentId);

  // Keep the registry's page index true to the drawn instances: every cable
  // on this page has an entry listing this page (idempotent; also covers
  // copilot-minted cables).
  useEffect(() => {
    // Only a settled, Neon-loaded graph may speak for the page — same gate as
    // the continuation sightings push. graphReady is keyed to the page, so the
    // flip commit (old cables + new pageNum) can never append the new page to
    // a cable that only exists on the old one (stale-flip bug, 2026-07-11).
    if (!graphReady) return;
    const cables = graph.cables ?? [];
    if (cables.length === 0) return;
    // Touch-to-link (Shane, 2026-07-10: "when it touches it links all
    // conductors"): the SAME test the drag's chain-link ghost previews.
    // Effect-driven so drawing, grip-resizes, and copilot add_cable all
    // link identically; adoptionEntries dedupes by core, so re-touching
    // is a no-op, never a duplicate.
    const plans: { label: string; adds: { net: string; core?: string; signal?: string; source: "adopt" }[]; strip: string }[] = [];
    let pagesMissing = false;
    const stripIds = new Set(graph.nodes.filter((n) => n.kind === "strip").map((n) => n.id));
    for (const cab of cables) {
      const entry = cableRegistry[cab.label];
      if (!entry || !entry.pages.includes(pageNum)) pagesMissing = true;
      const existing = new Set((entry?.conductors ?? []).map((c) => c.core).filter((c): c is string => !!c));
      const existingNets = new Set((entry?.conductors ?? []).map((c) => c.net).filter((c): c is string => !!c));
      for (const strip of stripsTouchingBox(graph.nodes, cab.bbox)) {
        const adds = adoptionEntries(strip, graph.ports, existing);
        if (adds.length > 0) {
          plans.push({ label: cab.label, adds, strip: strip.label });
          for (const a of adds) { existing.add(a.core); existingNets.add(a.net); }
        }
      }
      // Component-side landing (Shane, 2026-07-10: cables attach through a
      // CONNECTOR terminal on the component): convention-named terminals
      // inside the cable's box link on touch — proximity, never the whole
      // component's pinout.
      const touching = portsTouchingBox(graph.ports, cab.bbox).filter((tp) => !stripIds.has(tp.parentId));
      const portAdds: { net: string; core?: string; signal?: string; source: "adopt" }[] = [];
      for (const tp of touching) {
        // Self-referential guard (Shane's catch, 2026-07-10): a terminal
        // whose net reads the cable's OWN name is the cable's landing, not
        // a core — "CAB21 rides in CAB21" says nothing. The landing is
        // recorded by geometry (the touch itself) and the pages list.
        if (tp.net === cab.label) continue;
        if (tp.core ? existing.has(tp.core) : existingNets.has(tp.net)) continue;
        portAdds.push({ net: tp.net, core: tp.core, source: "adopt" });
        if (tp.core) existing.add(tp.core);
        existingNets.add(tp.net);
      }
      if (portAdds.length > 0) {
        const owners = [...new Set(touching.map((tp) => graph.nodes.find((n) => n.id === tp.parentId)?.label).filter(Boolean))];
        plans.push({ label: cab.label, adds: portAdds, strip: owners.join(", ") || "terminals" });
      }
    }
    // Purge previously minted self-referential entries (net == cable name).
    const purges = cables.filter((cab) => (cableRegistry[cab.label]?.conductors ?? []).some((c) => c.net === cab.label));
    if (!pagesMissing && plans.length === 0 && purges.length === 0) return;
    updateRegistry((reg) => {
      for (const cab of purges) {
        const entry = reg[cab.label];
        if (entry) entry.conductors = entry.conductors.filter((c) => c.net !== cab.label);
      }
      for (const cab of cables) {
        const entry = (reg[cab.label] ??= { conductors: [], pages: [] });
        if (!entry.pages.includes(pageNum)) entry.pages.push(pageNum);
      }
      for (const plan of plans) {
        const entry = reg[plan.label]!;
        for (const a of plan.adds) {
          // Conductor identity mirrors the plan-time filter above: a core is
          // the identity when printed; a core-less landing is its NET. Bare
          // `c.core === a.core` let any core-less conductor (every ctrl-click
          // entry) block every core-less adoption — silently, while the
          // adopted toast still fired.
          if (!entry.conductors.some((c) => (a.core ? c.core === a.core : c.net === a.net))) entry.conductors.push(a);
        }
      }
    });
    for (const plan of plans) {
      showToastRef.current?.(`${plan.label} linked ${plan.strip}: ${plan.adds.length} conductor(s) adopted`);
    }
    for (const cab of purges) {
      showToastRef.current?.(`${cab.label}: removed self-referential roster entry (a landing, not a core)`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphReady, graph.cables, graph.nodes, graph.ports, pageNum]);

  // Re-key a cable's registry entry to a new name — renaming onto an
  // existing cable name MERGES (same name IS the same cable, by design).
  // Shared by the hand rename and the copilot's rename op.
  const rekeyCableRegistry = useCallback(
    (from: string, to: string) => {
      const next = to.trim();
      if (!next || from === next) return;
      updateRegistry((reg) => {
        const src = reg[from];
        if (!src) return;
        const dst = reg[next];
        if (!dst) {
          reg[next] = src;
        } else {
          for (const p of src.pages) if (!dst.pages.includes(p)) dst.pages.push(p);
          for (const c of src.conductors) {
            if (!dst.conductors.some((d) => d.net === c.net && d.core === c.core)) dst.conductors.push(c);
          }
          if (!dst.partNumber && src.partNumber) dst.partNumber = src.partNumber;
        }
        delete reg[from];
      });
    },
    [updateRegistry]
  );

  // Adopt-from-strip (Shane's design): pull the strip's row triples
  // {core=pin, signal, net} into the cable's document-level roster in one
  // tap. Unwired rows ride as SPARE — the cable list enumerates those cores
  // too, and the table join wants them.
  const adoptStripIntoCable = useCallback(
    (cableId: string, stripId: string) => {
      const g = graphRef.current;
      const cable = (g.cables ?? []).find((c) => c.id === cableId);
      const strip = g.nodes.find((n) => n.id === stripId);
      if (!cable || strip?.kind !== "strip" || !strip.rows) return;
      let added = 0;
      updateRegistry((reg) => {
        const entry = (reg[cable.label] ??= { conductors: [], pages: [] });
        if (!entry.pages.includes(pageNum)) entry.pages.push(pageNum);
        for (const row of strip.rows!) {
          if (entry.conductors.some((c) => c.core === row.pin)) continue;
          const port = row.portIds.map((pid) => g.ports.find((p) => p.id === pid)).find(Boolean);
          const net = port ? port.label.split("~").pop() ?? "SPARE" : "SPARE";
          entry.conductors.push({ net, core: row.pin, signal: row.name, source: "adopt" });
          added += 1;
        }
      });
      showToastRef.current?.(`Adopted ${added} conductor(s) from ${strip.label} into ${cable.label}`);
    },
    [updateRegistry, pageNum, graphRef, showToastRef]
  );

  // Roster row removal (Shane, 2026-07-10: the inspector needed an eraser
  // once a misclassified entry existed) — registry-level, like all roster ops.
  const removeCableConductor = useCallback(
    (cableLabel: string, index: number) => {
      updateRegistry((reg) => {
        reg[cableLabel]?.conductors.splice(index, 1);
      });
    },
    [updateRegistry]
  );

  return { cableRegistry, updateRegistry, rekeyCableRegistry, adoptStripIntoCable, removeCableConductor };
}
