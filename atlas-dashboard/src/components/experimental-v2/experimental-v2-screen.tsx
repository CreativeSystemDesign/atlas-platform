"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Bot, EyeOff } from "lucide-react";
import { InfoTipProvider } from "./smart-canvas-infotip";
import { SmartCanvasHeader, type SmartCanvasMode } from "./smart-canvas-header";
import { SmartCanvasToolRail } from "./smart-canvas-tool-rail";
import { SmartCanvasGallery, type WorkBeacon } from "./smart-canvas-gallery";
import { SmartCanvasCursorGlow } from "./smart-canvas-cursor-glow";
import { SmartCanvasIssuesTab } from "./smart-canvas-issues-tab";
import { SmartCanvasCanvasBar } from "./smart-canvas-canvas-bar";
import { SmartCanvasStatusBar } from "./smart-canvas-status-bar";
import { V2YoloLayer } from "./v2-yolo-layer";
import { useV2Yolo } from "./use-v2-yolo";
import { useV2UndoHistory } from "./use-v2-undo-history";
import { useV2SheetIndex } from "./use-v2-sheet-index";
import { MG, MG_SCREEN_BG } from "./smart-canvas-theme";
import { ExperimentalV2Canvas } from "./experimental-v2-canvas";
import { ExperimentalV2Svg } from "./experimental-v2-svg";
import { ExperimentalV2Inspector } from "./experimental-v2-inspector";
import { SmartCanvasJoinCard, type JoinHover } from "./smart-canvas-join-card";
import { ExperimentalV2SettingsPanel } from "./experimental-v2-settings-panel";
import { useV2Drawing } from "./use-v2-drawing";
import { copyContinuationTo, deleteElement, findElementAnchor, moveTerminal, renameElement, resizeBoxWithTerminals } from "./v2-graph-ops";
import { v2StorageKey, useV2NeonGraph } from "./use-v2-persistence";
import { useV2Geometry } from "./use-v2-geometry";
import { useV2Nets } from "./use-v2-nets";
import { type JunctionOverride } from "./v2-nets";
import { useV2SymbolBank } from "./use-v2-symbol-bank";
import { useV2WireLabelBank } from "./use-v2-wire-label-bank";
import { useV2CableUi } from "./use-v2-cable-ui";
import { useV2ContinuationUi } from "./use-v2-continuation-ui";
import { useV2SelectionKeyboard } from "./use-v2-selection-keyboard";
import { useV2FlagTriage } from "./use-v2-flag-triage";
import { useV2MarkTools } from "./use-v2-mark-tools";
import { useV2AnnotateDelivery } from "./use-v2-annotate-delivery";
import { isNetToken } from "./v2-intent";
import { resolveComponent } from "./v2-component-label";
import {
  type V2Settings,
  loadSettings,
  saveSettings,
  detectOptionsFrom,
  DEFAULT_V2_SETTINGS,
} from "./v2-settings";
import { PROJECT_ID, DOCUMENT_ID, PAGE_WIDTH_PX, PAGE_HEIGHT_PX } from "../extraction-workbench/studio-types";
import { type V2Graph, type V2Tool, EMPTY_V2_GRAPH } from "./experimental-v2-types";
import { ExperimentalV2CopilotPanel } from "./experimental-v2-copilot-panel";
import { ExperimentalV2BridgeOverlay } from "./experimental-v2-bridge-overlay";
import { SmartCanvasMarkComposer } from "./smart-canvas-mark-composer";
import { SmartCanvasBlessComposer } from "./smart-canvas-bless-composer";
import { useV2LiveBridge, type ScreenBridgeDeps } from "./use-v2-live-bridge";
import { attachTextToComponent, findAttachment, removeAttachment } from "./v2-attachments";
import { resolvePenTarget } from "./v2-bridge-target";
import { groundClusterAtPoint, nearestText } from "./v2-snapping";
import { groundBorderTerminals } from "./v2-intent";
import { mintConnectorPair } from "./v2-connector";
import { useV2PageSeal } from "./use-v2-page-seal";
import { type BridgeEvent, type Point as BridgePoint } from "./v2-bridge-types";
import { clampToFit } from "./v2-zoom";

// HUD hint copy per tool (the tool rail owns the tool buttons + their
// instructional tooltips; this drives the bottom status bar's one-liner).
const TOOL_HINTS: Record<V2Tool, string> = {
  select: "Click an element to rename or delete it. With a component selected, Ctrl-click its printed part number/spec to attach evidence — identity derives from the parts list.",
  component: "Drag a box around a part — it labels itself from the print. Enclose a printed pin table and it auto-classifies as a TERMINAL STRIP with row-named terminals.",
  freehand: "Draw a loop around a part; it snaps tight to the artwork and labels itself.",
  wire: "Trace along a wire; it straightens to the real line, terminals + wire number are captured.",
  terminal: "Tap a connection circle to place a terminal.",
  continuation: "Tap a boxed cross-reference to mark an off-page continuation.",
  ground: "Tap a ground/earth symbol — a snug box snaps to the glyph and its conductor gets a border terminal. Tap an existing ground to re-snap it.",
  cable: "Trace along a printed cable bundle — it names itself from the print (CAB21). Same name on any page = the same cable, one shared conductor roster.",
  connector: "Drag to place the connector box — then Ctrl+click each INPUT pin: terminal + opposite-side mate + internal conduction mint as one pair.",
  ask: "Tap anything to point it out to Arc — nothing is drawn or renamed.",
  bless: "Tap excellent work and say what makes it excellent — it becomes a playbook exemplar future sessions retrieve and imitate.",
  lasso: "Draw a loop around an area — the region enters the conversation; then tell Arc what to do there. Esc clears.",
  pen: "Draw freehand ink on the print — it anchors to the nearest element and opens the conversation there. Esc clears.",
  arrow: "Drag an arrow to point Arc at something specific — the head anchors to the nearest element. Esc clears.",
  box: "Drag a rectangle over a region to discuss it — the box enters the conversation like a lasso. Esc clears.",
  text: "Tap to drop a text callout pinned to the page — your words become the note AND the message. Esc clears.",
};

export function ExperimentalV2Screen({ onExitWorkspace }: { onExitWorkspace?: () => void } = {}) {
  const [zoom, setZoom] = useState(1.2);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Fit-relative zoom (Shane's pinned spec): fit-to-screen = 100%, max 400%.
  // The canvas measures + reports fit before first paint; the view snaps to it
  // once on open (and the header's % display re-bases on it thereafter).
  const [fitZoom, setFitZoom] = useState<number | null>(null);
  const fitInitRef = useRef(false);
  const handleFitZoom = useCallback((fit: number) => {
    setFitZoom(fit);
    if (!fitInitRef.current) {
      fitInitRef.current = true;
      setZoom(fit);
      setPan({ x: 0, y: 0 });
    } else {
      // Window resized: keep the user's view but re-clamp into the new range.
      setZoom((z) => clampToFit(z, fit));
    }
  }, []);
  const [pageNum, setPageNum] = useState(7);
  const [tool, setTool] = useState<V2Tool>("wire");
  // Smart Canvas mode: Annotate is the shipped workspace; Fingerprint is gated
  // until the phase-3 backend (the header disables it). Palm guard is a
  // touchscreen input policy — state here, honored by the canvas pointer layer.
  const [mode, setMode] = useState<SmartCanvasMode>("annotate");
  const [palmGuard, setPalmGuard] = useState(true);
  // Canonical per-page record (titles from each page's own PDF vector title
  // block; TOC fallback). Feeds the header title + ⌘K jump-by-title corpus.
  const sheetIndex = useV2SheetIndex();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [graph, setGraph] = useState<V2Graph>(EMPTY_V2_GRAPH);
  // Hover join card: the settled-pointer mark the SVG reports. A tool
  // change ends any hover — the rect's pointer events go inert without a
  // mouseleave, which would otherwise strand the card on screen.
  const [joinHover, setJoinHover] = useState<JoinHover | null>(null);
  useEffect(() => { setJoinHover(null); }, [tool, pageNum]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [junctionOverrides, setJunctionOverrides] = useState<Map<string, JunctionOverride>>(new Map());

  const [settings, setSettings] = useState<V2Settings>(DEFAULT_V2_SETTINGS);
  useEffect(() => { setSettings(loadSettings(DOCUMENT_ID)); }, []);
  const updateSettings = useCallback((next: V2Settings) => {
    setSettings(next);
    saveSettings(DOCUMENT_ID, next);
  }, []);

  // Gold-master seal (Shane, 2026-07-08): a sealed page refuses EVERY edit —
  // his own tools and the copilot's ops alike — until unsealed from the header.
  // sealedRef mirrors the hook for the gates below (synced in an effect per the
  // no-refs-during-render rule); sealBlockTick defers the toast until the
  // bridge's showToast exists.
  const pageSeal = useV2PageSeal(pageNum);
  // Early-effect toast access (the auto-link effect mounts above the bridge
  // hook that provides showToast) — synced below once the bridge exists.
  const showToastRef = useRef<((msg: string) => void) | null>(null);
  // Same deal for reportEvent — the mark-tools hook mounts above the bridge
  // (the snapshot consumes its marks) and reports marks/blesses through this
  // ref, synced alongside showToastRef once the bridge exists.
  const reportEventRef = useRef<((event: BridgeEvent) => void) | null>(null);
  const sealedRef = useRef(false);
  useEffect(() => { sealedRef.current = pageSeal.sealed; }, [pageSeal.sealed]);
  const [sealBlockTick, setSealBlockTick] = useState(0);

  // Banks load early: deleteSelected/attach callbacks below depend on them.
  const symbolBank = useV2SymbolBank(settings.snapEnabled);
  const graphRef = useRef<V2Graph>(graph);
  useEffect(() => { graphRef.current = graph; }, [graph]);
  const wireLabelBank = useV2WireLabelBank(settings.snapEnabled);

  // Last canvas-space cursor — Ctrl+V pastes a copied continuation there (the
  // selection-keyboard hook reads it; the pointer-move handler writes it).
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // PDF vector geometry (Neon-derived, cached offline). Drives the smart canvas.
  // Detection rebuilds instantly when the detection settings change.
  const detectOpts = useMemo(() => detectOptionsFrom(settings), [settings.detection]);
  const { geometry, rawMeta, source: geometrySource, derivedAt: geometryDerivedAt } =
    useV2Geometry(pageNum, settings.snapEnabled, detectOpts);

  // Per-page persistence: Neon is the source of truth (schematic_v2_graph), with
  // a localStorage offline cache. A page with no v2 graph yet is seeded from the
  // legacy digital-twin annotations. See use-v2-persistence.
  const storageKey = v2StorageKey(PROJECT_ID, DOCUMENT_ID, pageNum);
  // Per-page persistent undo (v4 contract: history is per page and survives
  // reloads) — keyed by the same identity as the offline graph cache.
  const history = useV2UndoHistory(storageKey);
  const { seededFromLegacy, ready: graphReady, sheetRef } = useV2NeonGraph({
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    page: pageNum,
    storageKey,
    graph,
    setGraph,
  });
  // Cable UI: the document-level registry (name -> conductor roster), the
  // touch-to-link auto-adopt effect, and every roster mutation (rekey /
  // adopt-from-strip / row removal) — see use-v2-cable-ui. Sits BELOW
  // useV2NeonGraph because its auto-link effect gates on the page-keyed
  // graphReady; still above the live bridge, so its toasts ride showToastRef.
  const { cableRegistry, updateRegistry, rekeyCableRegistry, adoptStripIntoCable, removeCableConductor } =
    useV2CableUi({ projectId: PROJECT_ID, documentId: DOCUMENT_ID, graph, graphReady, pageNum, graphRef, showToastRef });

  const updateGraph = useCallback(
    (updater: (draft: V2Graph) => void) => {
      if (sealedRef.current) { setSealBlockTick((t) => t + 1); return; }
      history.push(graph);
      setGraph((prev) => {
        const next = JSON.parse(JSON.stringify(prev));
        updater(next);
        return next;
      });
    },
    [graph]
  );

  const undo = useCallback(() => {
    if (sealedRef.current) { setSealBlockTick((t) => t + 1); return; }
    const restored = history.undo(graph);
    if (restored) setGraph(restored);
  }, [graph, history]);

  const redo = useCallback(() => {
    if (sealedRef.current) { setSealBlockTick((t) => t + 1); return; }
    const restored = history.redo(graph);
    if (restored) setGraph(restored);
  }, [graph, history]);

  const deleteSelected = useCallback(
    (id: string | null) => {
      if (!id) return;
      if (findAttachment(graphRef.current, id)) {
        updateGraph((draft) => {
          removeAttachment(draft, id, symbolBank);
        });
      } else {
        updateGraph((draft) => deleteElement(draft, id));
      }
      setSelectedId(null);
      // a removed rect fires no mouseleave — don't leave the join card
      // describing a component that no longer exists (review 2026-07-14)
      setJoinHover(null);
    },
    [updateGraph, symbolBank]
  );

  const renameSelected = useCallback(
    (id: string, label: string) => {
      const cable = (graphRef.current.cables ?? []).find((c) => c.id === id);
      const oldLabel = cable?.label;
      updateGraph((draft) => renameElement(draft, id, label));
      if (cable && oldLabel) rekeyCableRegistry(oldLabel, label);
    },
    [updateGraph, rekeyCableRegistry]
  );

  // Continuation UI: registry sightings push, cross-page statuses (symbol-chip
  // detection + continuationStatuses), the wormhole jump handlers, and the
  // chip copy/move/edit handlers — see use-v2-continuation-ui. ORDER: stays
  // above the page-change reset effect below (its pending-select effect must
  // fire before the reset nulls selection).
  const { contStatuses, jumpToCounterpart, jumpToPage, onContinuationCopy, onContinuationMove, updateContinuationRef } =
    useV2ContinuationUi({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      graph,
      graphReady,
      sheetRef,
      pageNum,
      setPageNum,
      setSelectedId,
      geometry,
      cableRegistry,
      updateGraph,
      contSnapPx: settings.contSnapPx,
      settingsRef,
      graphRef,
      showToastRef,
    });
  useEffect(() => {
    setSelectedId(null);
    setJunctionOverrides(new Map());
    // Annotates queued for the previous page must never drain onto this one —
    // drop them unacked; the copilot's annotate tool reports them not-applied.
    pendingAnnotatesRef.current = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Keyboard: delete / undo / redo / continuation clipboard / tool hotkeys —
  // see use-v2-selection-keyboard (owns the continuation clipboard ref).
  useV2SelectionKeyboard({ selectedId, setSelectedId, setTool, deleteSelected, undo, redo, updateGraph, graphRef, settingsRef, cursorRef, showToastRef });

  // Net coloring (read-only continuity check). Memoized — only computes when the
  // net color mode is on; paints each electrically-connected net a distinct hue.
  // junctionOverrides let the operator break/restore an ambiguous merge.
  const netColoring = useV2Nets(geometry, settings.netColorMode, junctionOverrides, graph.nodes);
  // Detector evidence layer (v4 layer pills) — precomputed sidecar, fetch-on-toggle.
  const yoloDetections = useV2Yolo(pageNum, settings.showYolo);
  const toggleJunction = useCallback((key: string) => {
    setJunctionOverrides((prev) => {
      const next = new Map(prev);
      if (next.get(key) === "isolate") next.delete(key);
      else next.set(key, "isolate");
      return next;
    });
  }, []);

  // Symbol bank (known component marks) for bank-backed component labeling.

  const resolveComponentFn = useCallback(
    (box: { x: number; y: number; width: number; height: number }) =>
      resolveComponent(box, rawMeta, symbolBank),
    [rawMeta, symbolBank]
  );

  const drawing = useV2Drawing(graph, updateGraph, tool, { geometry, settings, resolveComponent: resolveComponentFn });

  // --- Live bridge: copilot sees this screen and can drive it -------------------
  const [copilotOpen, setCopilotOpen] = useState(true);
  // Viewport edge tab (v4): awaiting-shane count reported up by the panel;
  // clicking the tab opens the rail + forces the Table open via the signal.
  const [issueCount, setIssueCount] = useState(0);
  const [issuesSignal, setIssuesSignal] = useState(0);
  const openIssuesTable = useCallback(() => {
    setCopilotOpen(true);
    setIssuesSignal((s) => s + 1);
  }, []);
  // Mark tools (ask/lasso/pen/arrow/box/text) + the bless flow — state, the
  // page-change and Esc clears, gesture branches, composer send/cancel, and
  // bless handlers — see use-v2-mark-tools. Mounted above the live bridge (the
  // snapshot below consumes askMarks/lassoRegions/penMarks); its copilot calls
  // ride reportEventRef/showToastRef.
  const {
    askMarks, lassoRegions, lassoStroke, penMarks, penStroke,
    arrowMarks, arrowStroke, boxMarks, boxStroke, textCallouts,
    pendingMark, sendPendingMark, cancelPendingMark,
    pendingBless, blessSubject, onBlessPick, sendPendingBless, cancelPendingBless,
    clearAskMarks, handleMarkPointerDown, handleMarkPointerMove, handleMarkPointerUp,
  } = useV2MarkTools({ pageNum, tool, geometry, netColoring, graph, reportEventRef, showToastRef });

  const bridgeSnapshot = useMemo(
    () => ({
      page: pageNum,
      zoom,
      pan,
      tool,
      selected_id: selectedId,
      net_color_mode: settings.netColorMode,
      nets: netColoring
        ? { count: netColoring.nets.length, merge_nodes: netColoring.mergeNodes.length }
        : null,
      graph_stats: {
        components: graph.nodes.length,
        terminals: graph.ports.length,
        wires: graph.edges.length,
        continuations: graph.continuations.length,
        grounds: (graph.grounds ?? []).length,
        cables: (graph.cables ?? []).length,
      },
      grounds: (graph.grounds ?? []).map((g) => ({ id: g.id, label: g.label, bbox: g.bbox })),
      // Cables (2026-07-10): never conduct; roster lives in the document
      // registry — the snapshot carries the summary so the copilot knows
      // what each cable is and what it already carries.
      cables: (graph.cables ?? []).map((c) => {
        const entry = cableRegistry[c.label];
        return {
          id: c.id,
          label: c.label,
          bbox: c.bbox,
          conductor_count: entry?.conductors.length ?? 0,
          part_number: entry?.partNumber ?? null,
          drawn_on_pages: entry?.pages ?? [],
        };
      }),
      // Node geometry so the copilot can render/reason about component boxes
      // server-side (capture tool) and target them by id for resize/delete.
      // Strips (2026-07-10) carry their parsed rows: pin | signal name |
      // wired port ids — the copilot names/verifies strip terminals BY ROW.
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        bbox: n.bbox,
        ...(n.kind === "strip" && n.rows
          ? { kind: "strip", rows: n.rows.map((r) => ({ pin: r.pin, name: r.name ?? null, portIds: r.portIds })) }
          : {}),
      })),
      // Ports too: ids for rename/delete, coords + parent so the copilot can
      // reason about connection points and avoid minting duplicates. `type`
      // lets captures draw junction dots differently from terminals; mates
      // carry parentId2 (dual-parent conduction — Shane, 2026-07-09).
      ports: graph.ports.map((p) => ({ id: p.id, label: p.label, parentId: p.parentId, ...(p.parentId2 ? { parentId2: p.parentId2 } : {}), point: p.point, type: p.type })),
      // Page-level metadata (title block, drawing number, circuit descriptions).
      meta: graph.meta ?? null,
      // Edges: ids + endpoints for connectivity, plus the FULL path geometry —
      // captures must draw the same polyline Shane's screen renders, or the
      // copilot verifies wire work against images that cannot show wires.
      edges: graph.edges.map((e) => ({
        id: e.id,
        label: e.label,
        sourcePortId: e.sourcePortId,
        targetPortId: e.targetPortId,
        path: e.path,
      })),
      // Continuations: ids + refs so the copilot can audit/dedupe off-page
      // markers (the legacy import minted its own; overlaps must be findable).
      // status = the cross-page state Shane sees as the chip color (resolved/
      // waiting/mismatch/unanchored/unlabeled/device/symbol) + the why in
      // words — the copilot reads the DATA, not the pixels.
      continuations: graph.continuations.map((c) => {
        const st = contStatuses.get(c.id);
        return {
          id: c.id,
          point: c.point,
          sheet: c.sheet,
          zone: c.zone,
          rawRef: c.rawRef,
          target: c.target ?? null,
          status: st
            ? {
                state: st.state,
                detail: st.detail,
                ...(st.link ? { counterpart_page: st.link.page } : {}),
                ...(st.destPage != null ? { dest_page: st.destPage } : {}),
              }
            : null,
        };
      }),
      ask_marks: askMarks,
      // Lasso regions scoping the copilot's attention (bbox is what the backend
      // frames a capture around — same as ask-mark framing).
      lasso_regions: lassoRegions.map((r) => ({ n: r.n, bbox: r.bbox, points: r.points })),
      // Pen ink marks — bbox frames the capture; anchor names the element the
      // copilot should reason about.
      pen_marks: penMarks.map((m) => ({ n: m.n, bbox: m.bbox, anchor: m.anchor ?? null })),
    }),
    [pageNum, zoom, pan, tool, selectedId, settings.netColorMode, netColoring, graph, cableRegistry, contStatuses, askMarks, lassoRegions, penMarks]
  );

  const bridgeDepsRef = useRef<ScreenBridgeDeps | null>(null);

  const { highlights, toasts, connected: bridgeConnected, reportEvent, showToast, addHighlight, removeHighlight } = useV2LiveBridge(
    bridgeSnapshot,
    bridgeDepsRef
  );
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);
  useEffect(() => { reportEventRef.current = reportEvent; }, [reportEvent]);

  // Sealed-page edit refusals surface as a toast (deferred here because the
  // gates above are defined before the bridge's showToast exists).
  useEffect(() => {
    if (sealBlockTick > 0) showToast("Page sealed — certified. Unseal from the header to edit.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sealBlockTick]);

  // Drift tripwire (2026-07-08): a sealed page whose live graph no longer
  // matches its gold snapshot is an ALARM — announce once per detection.
  const driftAnnouncedRef = useRef(false);
  useEffect(() => {
    if (pageSeal.drift === true && !driftAnnouncedRef.current) {
      driftAnnouncedRef.current = true;
      showToast(`⚠ CERTIFIED-SNAPSHOT DRIFT on page ${pageNum} — live graph differs from snapshot v${pageSeal.goldVersion ?? "?"}. Investigate.`);
    }
    if (pageSeal.drift !== true) driftAnnouncedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSeal.drift, pageSeal.goldVersion, pageNum]);

  // Flag-pill triage: hide (mute) + check (false-positive dispose), the
  // hidden-set persistence, and the visible/hidden derivations — see
  // use-v2-flag-triage.
  const { visibleHighlights, hiddenFlagCount, hideFlag, unhideAllFlags, disposeFlag } =
    useV2FlagTriage({ documentId: DOCUMENT_ID, pageNum, highlights, showToast, addHighlight, removeHighlight });

  // Ambient work-beacons (Midnight Gallery): the background atmosphere thickens
  // and glows over unresolved attention on the page. Data-driven from what the
  // screen actually knows RIGHT NOW — Shane's numbered Ask marks and the
  // copilot's active highlights — mapped page-px → normalized viewport [0,1].
  // (Cross-page open issues will feed this too once the issues store is lifted
  // to the screen; for now it reflects live, on-page attention.)
  const galleryBeacons = useMemo<WorkBeacon[]>(() => {
    const out: WorkBeacon[] = [];
    for (const m of askMarks) {
      out.push({ x: m.x / PAGE_WIDTH_PX, y: m.y / PAGE_HEIGHT_PX, kind: "issue" });
    }
    for (const h of highlights) {
      if (h.point) out.push({ x: h.point.x / PAGE_WIDTH_PX, y: h.point.y / PAGE_HEIGHT_PX, kind: h.note === "issue" ? "issue" : "gap" });
    }
    return out.slice(0, 24);
  }, [askMarks, highlights]);

  // Issues-drawer click-to-locate (Shane, 2026-07-07): light the element up
  // on the schematic and pan to it — the same overlay the copilot points with.
  const doFocus = useCallback(
    (elementId: string) => {
      const anchor = findElementAnchor(graphRef.current, elementId);
      if (!anchor) {
        showToast("That element isn't in this page's graph — it may be from a wiped experiment leg");
        return;
      }
      addHighlight({
        elementId,
        point: anchor.kind === "continuation" ? { x: anchor.x, y: anchor.y } : undefined,
        color: "#f59e0b",
        note: "issue",
        expiresAt: Date.now() + 6000,
      });
      // Focus depth capped by the fit-relative range so a small viewport
      // can't be zoomed past its own maximum.
      const nextZoom = clampToFit(Math.max(zoom, 1.4), fitZoom);
      setZoom(nextZoom);
      setPan({
        x: -(anchor.x - PAGE_WIDTH_PX / 2) * nextZoom,
        y: -(anchor.y - PAGE_HEIGHT_PX / 2) * nextZoom,
      });
    },
    [addHighlight, showToast, zoom, fitZoom]
  );

  // Cross-page locate: an issue on another page flips the canvas there first;
  // the highlight fires once that page's graph has loaded.
  const pendingFocusRef = useRef<{ id: string; page: number } | null>(null);
  const focusElement = useCallback(
    (elementId: string, page?: number | null) => {
      if (page != null && page !== pageNum) {
        pendingFocusRef.current = { id: elementId, page };
        showToast(`Flipping to page ${page}…`);
        setPageNum(page);
        return;
      }
      doFocus(elementId);
    },
    [pageNum, doFocus, showToast]
  );
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!graphReady || !pending || pending.page !== pageNum) return;
    pendingFocusRef.current = null;
    // Deferred a beat so the freshly loaded page paints before the pan lands.
    const t = window.setTimeout(() => doFocus(pending.id), 120);
    return () => window.clearTimeout(t);
  }, [graphReady, pageNum, doFocus]);

  // --- annotate delivery: receipts, resend-dedupe, queue-until-loaded -----------
  // See use-v2-annotate-delivery. ORDER (verified 2026-07-11): this call sits
  // AFTER the bridge hook (its ack-flush effect keeps registering after the
  // bridge, unchanged) and after the page-change reset effect + sealedRef sync
  // far above — both MUST register before the drain effect inside the hook.
  const { applyAnnotateNow, pendingAnnotatesRef } = useV2AnnotateDelivery({
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
    resizeRideTerminals: settings.resizeRideTerminals,
    contSnapPx: settings.contSnapPx,
  });

  useEffect(() => {
    bridgeDepsRef.current = {
      setPage: (p) => setPageNum(Math.max(1, p)),
      setTool: (t) => {
        if (["select", "component", "freehand", "wire", "terminal", "continuation", "ground", "connector", "ask", "bless", "lasso", "pen", "arrow", "box", "text"].includes(t)) setTool(t as V2Tool);
      },
      setZoom: (z) => setZoom(clampToFit(z, fitZoom)),
      centerOn: (point, z) => {
        const nextZoom = z !== undefined ? clampToFit(z, fitZoom) : zoom;
        if (z !== undefined) setZoom(nextZoom);
        setPan({
          x: -(point.x - PAGE_WIDTH_PX / 2) * nextZoom,
          y: -(point.y - PAGE_HEIGHT_PX / 2) * nextZoom,
        });
      },
      setNetColorMode: (enabled) => updateSettings({ ...settings, netColorMode: enabled }),
      select: (id) => setSelectedId(id),
      clearAskMarks,
      applyOps: (ops, reason, meta) => {
        if (!graphReady) {
          pendingAnnotatesRef.current.push({ ops, reason, meta });
          return;
        }
        applyAnnotateNow(ops, reason, meta);
      },
    };
  });

  // Digital-twin gesture: with a component selected, Ctrl-click printed text
  // to attach it as typed evidence; identity derives via the symbol bank.
  const handleCtrlAttach = useCallback(
    (point: BridgePoint) => {
      // Continuation fan-out (Shane, 2026-07-11): with a chip ACTIVE,
      // Ctrl+click everything it continues — each click mints a bound copy
      // (wire end > cable box > component box), the original stays selected
      // so the next Ctrl+click keeps fanning out.
      const srcCont = graph.continuations.find((c) => c.id === selectedId);
      if (srcCont) {
        const id = `cont-${crypto.randomUUID()}`;
        updateGraph((draft) => { copyContinuationTo(draft, srcCont.id, point, id, settings.contSnapPx); });
        const ref = srcCont.rawRef ?? `${srcCont.sheet ?? "?"}/${srcCont.zone ?? "?"}`;
        const hitNode = graph.nodes.find((n) =>
          point.x >= n.bbox.x - 4 && point.x <= n.bbox.x + n.bbox.width + 4 &&
          point.y >= n.bbox.y - 4 && point.y <= n.bbox.y + n.bbox.height + 4);
        showToast(`${ref} → bound copy${hitNode ? ` on ${hitNode.label}` : ""} — Ctrl+click the next element it continues`);
        return;
      }
      const node = graph.nodes.find((n) => n.id === selectedId);
      const cable = !node ? (graph.cables ?? []).find((c) => c.id === selectedId) : undefined;
      if (!node && !cable) {
        showToast("Select a component first, then Ctrl-click its printed part number/spec");
        return;
      }
      const texts = geometry?.texts ?? [];
      const hit =
        texts.find(
          (t) =>
            point.x >= t.bbox.x - 6 &&
            point.x <= t.bbox.x + t.bbox.width + 6 &&
            point.y >= t.bbox.y - 6 &&
            point.y <= t.bbox.y + t.bbox.height + 6
        ) ??
        texts
          .map((t) => ({ t, d: Math.hypot(t.center.x - point.x, t.center.y - point.y) }))
          .filter((x) => x.d <= 30)
          .sort((a, b) => a.d - b.d)[0]?.t;
      if (!hit) {
        showToast("No printed text there");
        return;
      }
      if (cable) {
        // Cable Ctrl-attach classifies the printed token (Shane's catch,
        // 2026-07-10: a part number landed in the roster): NET-shaped text
        // joins the conductor roster; anything else is cable METADATA —
        // the part number, captured on the registry entry.
        const tok = hit.text.trim().toUpperCase();
        if (isNetToken(tok)) {
          updateRegistry((reg) => {
            const entry = (reg[cable.label] ??= { conductors: [], pages: [] });
            if (!entry.pages.includes(pageNum)) entry.pages.push(pageNum);
            if (!entry.conductors.some((c) => c.net === tok)) {
              entry.conductors.push({ net: tok, source: "ctrl_click" });
            }
          });
          showToast(`Conductor ${tok} attached to ${cable.label}`);
        } else {
          updateRegistry((reg) => {
            const entry = (reg[cable.label] ??= { conductors: [], pages: [] });
            if (!entry.pages.includes(pageNum)) entry.pages.push(pageNum);
            entry.partNumber = hit.text.trim();
          });
          showToast(`P/N ${hit.text.trim()} captured for ${cable.label}`);
        }
        return;
      }
      if (!node) return; // cable-branch returns above; guard for TS and safety
      let result: ReturnType<typeof attachTextToComponent> | null = null;
      updateGraph((draft) => {
        result = attachTextToComponent(draft, node.id, { text: hit.text, bbox: hit.bbox }, symbolBank, undefined, wireLabelBank);
      });
      // TS flow analysis can't see the synchronous closure assignment above —
      // rebind through an explicitly-typed local (StrictMode note: updater runs
      // twice on separate drafts; the LAST assignment is the committed one).
      const attach = result as ReturnType<typeof attachTextToComponent> | null;
      if (!attach) return;
      if (!attach.ok) showToast(attach.note);
      else {
        const idNote =
          attach.identity === "parts_match"
            ? " · parts-list match ✓"
            : attach.identity === "schematic_only"
              ? " · no parts-list match (schematic evidence)"
              : "";
        showToast(attach.note + idNote);
      }
    },
    [graph.nodes, graph.cables, graph.continuations, selectedId, geometry, symbolBank, wireLabelBank, updateGraph, updateRegistry, pageNum, showToast, settings.contSnapPx]
  );

  const reportPen = useCallback(
    (phase: "down" | "up", coords: BridgePoint) => {
      reportEvent({
        kind: "pen",
        phase,
        page: pageNum,
        x: Math.round(coords.x),
        y: Math.round(coords.y),
        pointer: "pen",
        tool,
        target: resolvePenTarget(coords, geometry, netColoring, graph),
      });
    },
    [reportEvent, pageNum, tool, geometry, netColoring, graph]
  );

  const onPointerDownBridged = useCallback(
    (coords: BridgePoint) => {
      // Mark tools capture the gesture here (lasso/pen/arrow/box strokes) —
      // nothing touches the graph; see use-v2-mark-tools.
      if (handleMarkPointerDown(tool, coords)) return;
      reportPen("down", coords);
      drawing.handlePointerDown(coords);
    },
    [tool, handleMarkPointerDown, reportPen, drawing.handlePointerDown]
  );
  const onPointerMoveBridged = useCallback(
    (coords: BridgePoint) => {
      // Last canvas-space cursor — Ctrl+V pastes a copied continuation here.
      cursorRef.current = { x: coords.x, y: coords.y };
      // An in-flight mark stroke consumes the move — see use-v2-mark-tools.
      if (handleMarkPointerMove(coords)) return;
      drawing.handlePointerMove(coords);
    },
    [handleMarkPointerMove, drawing.handlePointerMove]
  );
  const onPointerUpBridged = useCallback(
    (coords: BridgePoint) => {
      // Mark tools commit here (lasso/pen/arrow/box/text/ask — conversational
      // turns; nothing touches the graph) — see use-v2-mark-tools.
      if (handleMarkPointerUp(tool, coords)) return;
      if (tool === "ground") {
        // Tap a ground/earth glyph → snap a snug box to just that glyph's
        // vector cluster and record it as a first-class ground reference.
        const bbox = groundClusterAtPoint(geometry, coords);
        if (!bbox) {
          showToast("No ground glyph under that tap — click directly on the symbol");
          return;
        }
        // Prefer a printed ground label near the glyph (G/FG/PE/E/EARTH), else GND.
        const near = nearestText({ x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 }, geometry, 60);
        const token = (near?.text ?? "").trim().toUpperCase();
        const label = /^(G|FG|SG|PE|E|EARTH|GND|GROUND)\b/.test(token) ? token : "GND";
        // Re-snap, never duplicate (Shane 2026-07-10: "making it snap to the
        // symbol again"): a tap over a ground that already covers this glyph
        // re-fits that ground to the print — snap IS a ground's geometry
        // editor now that grounds have no resize grips.
        const overlaps = (a: typeof bbox, b: typeof bbox) =>
          a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        const existing = (graphRef.current.grounds ?? []).find(
          (g) => overlaps(g.bbox, bbox) ||
            (coords.x >= g.bbox.x && coords.x <= g.bbox.x + g.bbox.width &&
             coords.y >= g.bbox.y && coords.y <= g.bbox.y + g.bbox.height)
        );
        const gid = existing?.id ?? `ground-${crypto.randomUUID()}`;
        updateGraph((draft) => {
          if (!draft.grounds) draft.grounds = [];
          const g = draft.grounds.find((x) => x.id === gid);
          if (g) {
            g.bbox = bbox;
            g.label = label;
          } else {
            draft.grounds.push({ id: gid, type: "ground", bbox, label });
          }
          // Border terminals (Shane 2026-07-10): the conductor entering the
          // glyph earns a terminal ON the ground border — the component-box
          // crossing engine on the snug box. Existing pins within reach are
          // kept, and riding keeps them on the border across re-snaps.
          for (const spec of groundBorderTerminals(bbox, label, geometry, settings.netLabelWalkPx)) {
            if (draft.ports.some((p) => Math.hypot(p.point.x - spec.point.x, p.point.y - spec.point.y) <= 12)) continue;
            draft.ports.push({
              id: `port-${crypto.randomUUID()}`,
              parentId: gid,
              type: "terminal",
              point: { ...spec.point },
              label: spec.label,
            });
          }
        });
        setSelectedId(gid);
        showToast(existing ? `Ground "${label}" re-snapped to the glyph` : `Ground "${label}" placed (Delete to remove)`);
        return;
      }
      // Connector mode: plain click/drag falls through to the drawing engine —
      // the drag places the connector BOX (a component, "CON" prefix). Pins are
      // Ctrl+click, handled at pointer-DOWN in the SVG (onConnectorPin) so the
      // modifier key is known.
      // Bless is handled at pointer-DOWN (onBlessPick in the SVG) so Ctrl+click
      // multi-select works with the modifier key — nothing to do here on up.
      reportPen("up", coords);
      drawing.handlePointerUp(coords);
    },
    [tool, handleMarkPointerUp, reportPen, drawing.handlePointerUp, geometry, showToast, updateGraph, settings.netLabelWalkPx]
  );

  // Connector pin (Shane's interaction, 2026-07-09): Ctrl+click on a placed
  // connector's border mints the pair — input terminal at the click, the
  // opposite-border mate (adopting an aligned existing terminal), and the
  // internal conduction segment. Dry-run first so refusals (ambiguous
  // adoption) surface as toasts without touching the graph.
  const onConnectorPin = useCallback(
    (coords: BridgePoint) => {
      const probe = mintConnectorPair(JSON.parse(JSON.stringify(graphRef.current)), coords);
      if (!probe.ok) {
        showToast(probe.notes[probe.notes.length - 1] ?? "Connector pair refused");
        return;
      }
      updateGraph((draft) => { mintConnectorPair(draft, coords); });
      showToast(probe.notes[probe.notes.length - 2] ?? "Connector pair placed");
    },
    [updateGraph, showToast]
  );

  // Terminal drag (Shane 2026-07-09): the SVG previews the constrained slide;
  // the release commits ONE undo step here — through updateGraph so autosave
  // and the certification-seal gate both apply.
  const onTerminalMove = useCallback(
    (portId: string, point: BridgePoint) => {
      updateGraph((draft) => { moveTerminal(draft, portId, point); });
    },
    [updateGraph]
  );

  // Handle-resize (Shane's pinned resizable bboxes): ONE undo step; border
  // terminals ride the moved edge and wires follow by port id — unless the
  // "Terminals ride resized borders" setting turns riding off (shell only).
  const onBoxResize = useCallback(
    (id: string, bbox: { x: number; y: number; width: number; height: number }) => {
      updateGraph((draft) => { resizeBoxWithTerminals(draft, id, bbox, 6, settings.resizeRideTerminals); });
    },
    [updateGraph, settings.resizeRideTerminals]
  );

  useEffect(() => {
    reportEvent({ kind: "select", page: pageNum, element_id: selectedId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const activeHint = TOOL_HINTS[tool] ?? "";

  return (
    <InfoTipProvider>
    <div
      className="relative flex h-full w-full select-none flex-col overflow-hidden"
      style={{ background: MG_SCREEN_BG, color: MG.text }}
    >
      {/* Ambient Midnight Gallery layer — fixed, behind everything, no input.
          Degrades to the CSS radial background above under no-WebGL /
          reduced-motion. Beacons glow over live on-page attention. */}
      <SmartCanvasGallery mode={mode} beacons={galleryBeacons} />
      {/* Cursor aura + vignette — above the WebGL gallery, below all UI. */}
      <SmartCanvasCursorGlow />

      <SmartCanvasHeader
        mode={mode}
        onModeChange={setMode}
        fingerprintEnabled={false}
        onExitWorkspace={onExitWorkspace}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((o) => !o)}
        copilotOpen={copilotOpen}
        onToggleCopilot={() => setCopilotOpen((o) => !o)}
        bridgeConnected={bridgeConnected}
      />
      {/* Workspace */}
      <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden relative">
        {/* Gold-master glow (Shane, 2026-07-08): sealing is a milestone — a
            sealed page wears a slight gold glow along the viewport edges.
            Drift flips it red: the tripwire must be as visible as the honor. */}
        {pageSeal.sealed && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-40"
            style={{
              boxShadow: pageSeal.drift === true
                ? "inset 0 0 110px rgba(248,113,113,.20), inset 0 0 22px rgba(248,113,113,.12)"
                : "inset 0 0 110px rgba(251,191,36,.15), inset 0 0 22px rgba(251,191,36,.09)",
            }}
          />
        )}
        <SmartCanvasToolRail
          tool={tool}
          onToolChange={setTool}
          onUndo={undo}
          onRedo={redo}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
        />

        {/* The canvas CARD (containment ruling, 2026-07-09): a column that owns
            its own toolbar (page/seal/palm/layers/zoom), the sheet viewport,
            and a status footer — the workspace bar above carries only
            workspace concerns. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <SmartCanvasCanvasBar
            pageNum={pageNum}
            sheetIndex={sheetIndex}
            onPageChange={(p) => setPageNum(Math.max(1, p))}
            seal={pageSeal}
            onSeal={() => {
              void pageSeal
                .setSealed(true, "shane-header-seal — personally verified every annotated segment, 100% accurate: CERTIFIED")
                .then((res) => {
                  if (res?.ok) showToast(`Page ${pageNum} sealed — certified snapshot v${res.gold?.version ?? "?"} archived to Neon`);
                  else showToast(`Seal failed${res?.error ? ` — ${res.error}` : " — see server log"}`);
                });
            }}
            onUnseal={() => {
              void pageSeal.setSealed(false, "shane-header-unseal").then(() => {
                showToast(`Page ${pageNum} unsealed — editable again (certified snapshots stay archived)`);
              });
            }}
            palmGuard={palmGuard}
            onTogglePalmGuard={() => setPalmGuard((g) => !g)}
            zoom={zoom}
            fitZoom={fitZoom}
            onZoomIn={() => setZoom((z) => clampToFit(z + (fitZoom ?? 0.4) * 0.25, fitZoom))}
            onZoomOut={() => setZoom((z) => clampToFit(z - (fitZoom ?? 0.4) * 0.25, fitZoom))}
            onZoomReset={() => { setZoom(fitZoom ?? 1.2); setPan({ x: 0, y: 0 }); }}
            layerValues={{ showYolo: settings.showYolo, netColorMode: settings.netColorMode, showVectors: settings.showVectors }}
            onToggleLayer={(key, next) => updateSettings({ ...settings, [key]: next })}
          />

        {/* Viewport (overlay host). Palm guard (v4 spec): when ON, finger
            touches and resting palms do NOTHING ON THE CANVAS — not pan, not
            select, not pill buttons — while pen, mouse, and trackpad keep full
            function; the chrome (toolbar/footer) stays touchable. Enforced
            ONCE here in the capture phase so every surface inside (canvas
            gestures, SVG picking, flag pills) is covered without
            prop-threading. */}
        <div
          className="min-w-0 flex-1 min-h-0 relative"
          onPointerDownCapture={(e) => { if (palmGuard && e.pointerType === "touch") { e.stopPropagation(); e.preventDefault(); } }}
          onPointerMoveCapture={(e) => { if (palmGuard && e.pointerType === "touch") { e.stopPropagation(); } }}
          onPointerUpCapture={(e) => { if (palmGuard && e.pointerType === "touch") { e.stopPropagation(); } }}
        >
          <ExperimentalV2Canvas pageNum={pageNum} zoom={zoom} setZoom={setZoom} pan={pan} setPan={setPan} onFitZoom={handleFitZoom}>
            <ExperimentalV2Svg
              graph={graph}
              tool={tool}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              stroke={drawing.stroke}
              geometrySnap={drawing.geometrySnap}
              geometry={geometry}
              settings={settings}
              netColoring={netColoring}
              onToggleJunction={toggleJunction}
              handlePointerDown={onPointerDownBridged}
              handlePointerMove={onPointerMoveBridged}
              handlePointerUp={onPointerUpBridged}
              onCtrlAttach={handleCtrlAttach}
              onConnectorPin={onConnectorPin}
              onTerminalMove={onTerminalMove}
              onContinuationMove={onContinuationMove}
              onContinuationCopy={onContinuationCopy}
              contSnapPx={settings.contSnapPx}
              contStatuses={contStatuses}
              onBoxResize={onBoxResize}
              resolveComponentLabel={(b) => (settings.autoLabelComponents ? resolveComponentFn(b)?.label ?? null : null)}
              onBlessPick={onBlessPick}
              blessIds={pendingBless ? new Set(pendingBless.targets.map((t) => t.id)) : undefined}
              onComponentHover={setJoinHover}
            />
            {settings.showYolo && <V2YoloLayer detections={yoloDetections} />}
            <ExperimentalV2BridgeOverlay
              highlights={visibleHighlights}
              askMarks={askMarks}
              lassoRegions={lassoRegions}
              lassoStroke={lassoStroke}
              penMarks={penMarks}
              penStroke={penStroke}
              arrowMarks={arrowMarks}
              arrowStroke={arrowStroke}
              boxMarks={boxMarks}
              boxStroke={boxStroke}
              textCallouts={textCallouts}
              geometry={geometry}
              netColoring={netColoring}
              graph={graph}
              onDisposeFlag={disposeFlag}
              onHideFlag={hideFlag}
            />
          </ExperimentalV2Canvas>

          {/* Mark composer — a drawn pen/lasso mark asks what Shane needs here;
              the scoped-ask turn fires on send, and the copilot confirms first. */}
          {pendingMark && (
            <SmartCanvasMarkComposer
              key={`${pendingMark.kind}-${pendingMark.n}`}
              pending={pendingMark}
              onSend={sendPendingMark}
              onCancel={cancelPendingMark}
            />
          )}

          {/* Bless composer — tapping excellent work with the Bless tool asks
              WHY in-app (amber), then mints the playbook card on send. */}
          {pendingBless && (
            <SmartCanvasBlessComposer
              key={`bless-${pendingBless.sessionId}`}
              pending={{ subject: blessSubject(pendingBless.targets) }}
              onSend={sendPendingBless}
              onCancel={cancelPendingBless}
            />
          )}

          {/* Issues queue edge tab — amber, viewport right edge, count > 0 only. */}
          <SmartCanvasIssuesTab count={issueCount} onOpen={openIssuesTable} />

          {/* Hidden-flags chip: one click restores every muted flag on this page. */}
          {hiddenFlagCount > 0 && (
            <button
              type="button"
              onClick={unhideAllFlags}
              className="absolute bottom-4 left-4 z-30 flex items-center gap-1.5 rounded-full border border-slate-600/60 bg-slate-950/85 px-3 py-1.5 text-[11px] text-slate-300 shadow-xl backdrop-blur transition hover:border-slate-400 hover:text-white"
              title="Show the flags you hid on this page"
            >
              <EyeOff className="h-3 w-3" />
              {hiddenFlagCount} hidden flag{hiddenFlagCount === 1 ? "" : "s"} — show
            </button>
          )}

          {/* Copilot toasts */}
          {toasts.length > 0 && (
            <div className="absolute top-4 left-1/2 z-30 -translate-x-1/2 space-y-1.5">
              {toasts.map((t) => (
                <div
                  key={t.key}
                  className="rounded-xl border border-primary/40 bg-slate-950/90 px-3 py-1.5 text-[11px] text-foreground shadow-xl backdrop-blur"
                >
                  <Bot className="mr-1.5 inline h-3 w-3 text-primary" />
                  {t.message}
                </div>
              ))}
            </div>
          )}

          <ExperimentalV2Inspector graph={graph} selectedId={selectedId} onRename={renameSelected} onUpdateContinuation={updateContinuationRef} onDelete={deleteSelected} cableRegistry={cableRegistry} onAdoptStrip={adoptStripIntoCable} onRemoveConductor={removeCableConductor} contStatus={selectedId ? contStatuses.get(selectedId) ?? null : null} onJumpToCounterpart={jumpToCounterpart} onJumpToPage={jumpToPage} />

          {/* Hover join card — dwell on a component, the join contracts answer */}
          <SmartCanvasJoinCard hover={joinHover} />

          <ExperimentalV2SettingsPanel open={settingsOpen} settings={settings} onChange={updateSettings} onClose={() => setSettingsOpen(false)} />

          {/* Per-mode HUD (Midnight Gallery) — tool name + hint on the left,
              the pen-only reminder on the right, matching the v4 layout. */}
          <div className="pointer-events-none absolute bottom-4 left-5 right-5 z-20 flex justify-between gap-3">
            <div
              className="max-w-lg rounded-[11px] px-3.5 py-[7px] text-[10px] font-medium backdrop-blur-md"
              style={{ border: `1px solid ${MG.line}`, background: "rgba(6,11,22,.88)", color: MG.textMute, boxShadow: "0 6px 20px rgba(0,0,0,.4)" }}
            >
              <span className="mr-2 font-extrabold uppercase tracking-[.08em]" style={{ color: MG.cyan }}>{tool}</span>
              {activeHint}
            </div>
            <div
              className="hidden shrink-0 items-center rounded-[11px] px-3.5 py-[7px] text-[10px] backdrop-blur-md md:flex"
              style={{ border: `1px solid ${MG.line}`, background: "rgba(6,11,22,.88)", color: MG.textFaint, boxShadow: "0 6px 20px rgba(0,0,0,.4)" }}
            >
              {palmGuard ? "screen = pen only" : "finger touch on"} · trackpad &amp; mouse unchanged ·{" "}
              <span className="ml-1 rounded border-b-2 px-1 font-mono text-[9px]" style={{ border: `1px solid ${MG.lineStrong}` }}>⌃Z</span>
              <span className="ml-1">undo</span>
            </div>
          </div>
        </div>

          <SmartCanvasStatusBar
            pageNum={pageNum}
            pageCount={129}
            graph={graph}
            bridgeConnected={bridgeConnected}
            offlineCache={settings.snapEnabled && geometrySource === "cache"}
            seededFromLegacy={seededFromLegacy}
            sealed={pageSeal.sealed}
          />
        </div>

        {/* Copilot panel (currentPage scopes the blocked-issues drawer) */}
        <ExperimentalV2CopilotPanel
          open={copilotOpen}
          onClose={() => setCopilotOpen(false)}
          currentPage={pageNum}
          onFocusElement={focusElement}
          onIssuesBadge={setIssueCount}
          issuesOpenSignal={issuesSignal}
        />
      </div>
    </div>
    </InfoTipProvider>
  );
}
