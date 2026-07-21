"use client";

// Annotate-op delivery for the Experimental v2 screen (extracted from
// experimental-v2-screen in the 2026-07-11 modularity pass, logic verbatim):
// receipts, resend-dedupe, queue-until-loaded. The copilot's annotate tool
// blocks on an "annotate_applied" receipt instead of firing blind; the bridge
// resends when a receipt goes missing, so the same idempotency key can arrive
// twice — apply once, ack both. Ops that land while the Neon load is still
// replacing the graph queue in pendingAnnotatesRef and drain when it settles.
//
// ORDER CONTRACT (verified 2026-07-11) — the screen calls this hook exactly
// where the moved block sat, and that placement is load-bearing:
//   • the screen's page-change reset effect (deps [storageKey]) clears
//     pendingAnnotatesRef and MUST register BEFORE this hook's drain effect
//     (it does: the reset effect sits far above this hook's call site);
//   • the screen's sealedRef sync MUST register BEFORE the drain effect
//     (same reason — never move this hook's call above either of them);
//   • this hook mounts AFTER useV2LiveBridge, so the ack-flush effect keeps
//     registering after the bridge — unchanged from the pre-extraction screen.

import { useCallback, useEffect, useRef } from "react";
import { applyAnnotateOps } from "./v2-bridge-ops";
import type { V2Graph } from "./experimental-v2-types";
import type { PageGeometry } from "./v2-snapping";
import type { SymbolBankEntry, WireLabelBankEntry } from "../extraction-workbench/studio-types";
import type { AnnotateOp, BridgeEvent } from "./v2-bridge-types";

export function useV2AnnotateDelivery({
  pageNum,
  graph,
  graphReady,
  sealedRef,
  updateGraph,
  symbolBank,
  wireLabelBank,
  geometry,
  reportEvent,
  rekeyCableRegistry,
  resizeRideTerminals,
  contSnapPx,
}: {
  pageNum: number;
  graph: V2Graph;
  graphReady: boolean;
  sealedRef: { current: boolean };
  updateGraph: (updater: (draft: V2Graph) => void) => void;
  symbolBank: SymbolBankEntry[];
  wireLabelBank: WireLabelBankEntry[];
  geometry: PageGeometry | null;
  reportEvent: (event: BridgeEvent) => void;
  rekeyCableRegistry: (from: string, to: string) => void;
  resizeRideTerminals: boolean;
  contSnapPx: number;
}) {
  const appliedKeysRef = useRef<Set<string>>(new Set());
  const pendingAnnotatesRef = useRef<
    {
      ops: AnnotateOp[];
      reason?: string | null;
      meta?: { commandId: number; idempotencyKey?: string; page?: number };
    }[]
  >([]);

  // Acks for applied batches are deferred to the post-commit effect below so
  // the receipt can carry the executor's notes (skips, dedupes, junction
  // minting) and minted ids — the copilot's ground truth about what happened.
  const pendingAcksRef = useRef<
    {
      result: import("./v2-bridge-ops").AnnotateApplyResult | null;
      send: (result: import("./v2-bridge-ops").AnnotateApplyResult | null) => void;
    }[]
  >([]);

  const applyAnnotateNow = useCallback(
    (
      ops: AnnotateOp[],
      reason?: string | null,
      meta?: { commandId: number; idempotencyKey?: string; page?: number }
    ) => {
      const key = meta?.idempotencyKey;
      const ack = (
        duplicate: boolean,
        result: import("./v2-bridge-ops").AnnotateApplyResult | null,
        refused?: string
      ) => {
        if (!meta) return;
        reportEvent({
          kind: "annotate_applied",
          command_id: meta.commandId,
          key,
          page: pageNum,
          ops: ops.length,
          ...(result && result.notes.length > 0 ? { notes: result.notes } : {}),
          ...(result && result.minted.some(Boolean) ? { minted: result.minted } : {}),
          ...(duplicate ? { duplicate: true } : {}),
          ...(refused ? { refused, stamped_page: meta.page } : {}),
        });
      };
      if (key && appliedKeysRef.current.has(key)) {
        ack(true, null); // resend of an already-applied command — ack it, apply nothing
        return;
      }
      // Page stamp (run-3 prep, 2026-07-06): a replayed/queued batch can drain
      // minutes after authoring, onto whatever page the canvas shows NOW —
      // run 2 landed on the right page by luck. A stamped batch on a
      // mismatched page is refused-and-acked: the ack stops server replays,
      // and nothing is drawn onto the wrong sheet. Checked HERE (apply time,
      // after the load-queue drain) rather than at delivery, because the page
      // can flip while a batch waits for graphReady.
      if (meta?.page !== undefined && meta.page !== pageNum) {
        ack(false, null, "page-mismatch");
        return;
      }
      // Sealed gold master (2026-07-08): the server refuses the copilot's
      // annotate up front, but a command already in flight when the seal lands
      // must be refused-and-ACKED here (like page-mismatch) so replays stop —
      // never applied to sealed gold.
      if (sealedRef.current) {
        ack(false, null, "page-sealed");
        return;
      }
      if (key) {
        appliedKeysRef.current.add(key);
        if (appliedKeysRef.current.size > 200) {
          appliedKeysRef.current = new Set([...appliedKeysRef.current].slice(-100));
        }
      }
      // Zero ops = pure delivery probe: ack without touching graph/undo.
      if (ops.length === 0) {
        ack(false, null);
        return;
      }
      // Assignment (not push) keeps a StrictMode double-invoked updater harmless.
      const pending: (typeof pendingAcksRef.current)[number] = {
        result: null,
        send: (r) => ack(false, r),
      };
      pendingAcksRef.current.push(pending);
      updateGraph((draft) => {
        pending.result = applyAnnotateOps(draft, ops, symbolBank, wireLabelBank, geometry, {
          resizeRideTerminals,
          contSnapPx,
        });
      });
      if (reason) console.info("[copilot annotate]", reason);
    },
    [updateGraph, symbolBank, wireLabelBank, reportEvent, pageNum, geometry, resizeRideTerminals, contSnapPx, rekeyCableRegistry]
  );

  // Flush annotate acks only after the graph state actually committed: the
  // receipt then proves both delivery AND what the apply did (notes + ids).
  useEffect(() => {
    if (pendingAcksRef.current.length === 0) return;
    const pending = pendingAcksRef.current;
    pendingAcksRef.current = [];
    for (const p of pending) {
      // Copilot cable renames re-key the document registry, same as by hand
      // (result exists only now — the apply ran inside the committed updater).
      for (const r of p.result?.cableRenames ?? []) rekeyCableRegistry(r.from, r.to);
      p.send(p.result);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Drain ops that arrived while the graph was still loading.
  useEffect(() => {
    if (!graphReady) return;
    const queued = pendingAnnotatesRef.current;
    if (queued.length === 0) return;
    pendingAnnotatesRef.current = [];
    for (const q of queued) applyAnnotateNow(q.ops, q.reason, q.meta);
  }, [graphReady, applyAnnotateNow]);

  return { applyAnnotateNow, pendingAnnotatesRef };
}
