"use client";

import {
  BoxSelect,
  ChevronLeft,
  ChevronRight,
  Fingerprint,
  Move,
  RotateCcw,
  Save,
  ScanSearch,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";

const DOCUMENT_ID = "schematic_<drawing-no>";
const PROJECT_ID = "00000000-0000-4000-8000-000000001650";
const DEFAULT_PAGE = 7;
const PAGE_COUNT = 129;
const PAGE_WIDTH_PX = 2481;
const PAGE_HEIGHT_PX = 3509;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 5;
const MIN_BOX_SIZE = 8;
const POSITIONAL_POINT_TARGET = 499;
const MASK_BRUSH_RADIUS = 3;
const MASK_STORAGE_KEY = "atlas:fingerprint:masks";

type BBoxPx = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type ToolboxMode = "mask" | "signature";
type MaskPanelItem = "bbox" | "draw";

type InteractionSession =
  | {
      type: "draw-bbox";
      pointerId: number;
      start: { x: number; y: number };
      current: { x: number; y: number };
    }
  | {
      type: "move-bbox";
      pointerId: number;
      startX: number;
      startY: number;
      original: BBoxPx;
    }
  | {
      type: "resize-bbox";
      pointerId: number;
      handle: ResizeHandle;
      startX: number;
      startY: number;
      original: BBoxPx;
    }
  | {
      type: "paint-mask";
      pointerId: number;
      erase: boolean;
      lastPoint: { x: number; y: number };
    }
  | {
      type: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      type: "move-panel";
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    };

type SignaturePoint = {
  x: number;
  y: number;
  segmentId: number;
};

type SegmentMetadata = {
  id: number;
  pixelCount: number;
  pointCount: number;
  bbox: BBoxPx;
  centroid: { x: number; y: number };
};

type FingerprintSignature = {
  name: string | null;
  pageNum: number;
  bbox: BBoxPx;
  maskPixelCount: number;
  anchor: { x: number; y: number };
  pointCount: number;
  points: SignaturePoint[];
  radialSignature: number[];
  segmentCoverage: SegmentMetadata[];
};

export function FingerprintWorkbench() {
  const [pageNum, setPageNum] = useState(DEFAULT_PAGE);
  const [zoom, setZoom] = useState(0.22);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [activeToolbox, setActiveToolbox] = useState<ToolboxMode>("mask");
  const [maskPanelOpen, setMaskPanelOpen] = useState(false);
  const [maskPanelItem, setMaskPanelItem] = useState<MaskPanelItem>("draw");
  const [maskPanelPosition, setMaskPanelPosition] = useState({ x: 420, y: 160 });
  const [bbox, setBbox] = useState<BBoxPx | null>(null);
  const [draftBbox, setDraftBbox] = useState<BBoxPx | null>(null);
  const [bboxSelected, setBboxSelected] = useState(false);
  const [bboxSaved, setBboxSaved] = useState(false);
  const [savedMaskName, setSavedMaskName] = useState<string | null>(null);
  const [maskVersion, setMaskVersion] = useState(0);
  const [maskPixelCount, setMaskPixelCount] = useState(0);
  const [imageStatus, setImageStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [signature, setSignature] = useState<FingerprintSignature | null>(null);
  const [status, setStatus] = useState("Mask ready");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const interactionRef = useRef<InteractionSession | null>(null);
  const maskPixelsRef = useRef<Set<number>>(new Set());

  const imageSrc = useMemo(
    () =>
      `${agentBaseUrl()}/workbench/projects/${PROJECT_ID}/documents/${DOCUMENT_ID}/pages/${pageNum}/image`,
    [pageNum]
  );

  const openMaskPanel = useCallback(() => {
    setActiveToolbox("mask");
    setMaskPanelOpen(true);
    setContextMenu(null);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect) {
      setMaskPanelPosition({
        x: Math.max(16, rect.width / 2 - 120),
        y: Math.max(70, rect.height / 2 - 90),
      });
    }
  }, []);

  const redrawMaskCanvas = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PAGE_WIDTH_PX, PAGE_HEIGHT_PX);
    ctx.fillStyle = "rgba(255, 0, 255, 0.82)";
    for (const key of maskPixelsRef.current) {
      const x = key % PAGE_WIDTH_PX;
      const y = Math.floor(key / PAGE_WIDTH_PX);
      ctx.fillRect(x, y, 1, 1);
    }
  }, []);

  useEffect(() => {
    redrawMaskCanvas();
  }, [maskVersion, redrawMaskCanvas]);

  const clampBox = useCallback((box: BBoxPx): BBoxPx => {
    const width = Math.max(MIN_BOX_SIZE, Math.min(PAGE_WIDTH_PX, box.width));
    const height = Math.max(MIN_BOX_SIZE, Math.min(PAGE_HEIGHT_PX, box.height));
    return {
      x: Math.max(0, Math.min(PAGE_WIDTH_PX - width, box.x)),
      y: Math.max(0, Math.min(PAGE_HEIGHT_PX - height, box.y)),
      width,
      height,
    };
  }, []);

  const rawBox = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }): BBoxPx => ({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    }),
    []
  );

  const getPagePoint = useCallback(
    (
      event: { clientX: number; clientY: number },
      options: { clampToPage?: boolean } = {}
    ) => {
      const viewport = viewportRef.current;
      if (!viewport) return null;
      const rect = viewport.getBoundingClientRect();
      const viewportX = event.clientX - rect.left;
      const viewportY = event.clientY - rect.top;
      const pageLeft = rect.width / 2 + pan.x - (PAGE_WIDTH_PX * zoom) / 2;
      const pageTop = rect.height / 2 + pan.y - (PAGE_HEIGHT_PX * zoom) / 2;
      let x = (viewportX - pageLeft) / zoom;
      let y = (viewportY - pageTop) / zoom;
      if (options.clampToPage) {
        x = Math.max(0, Math.min(PAGE_WIDTH_PX, x));
        y = Math.max(0, Math.min(PAGE_HEIGHT_PX, y));
      }
      if (x < 0 || y < 0 || x > PAGE_WIDTH_PX || y > PAGE_HEIGHT_PX) {
        return null;
      }
      return { x, y };
    },
    [pan.x, pan.y, zoom]
  );

  const setZoomAtClientPoint = useCallback(
    (nextZoom: number, clientPoint: { clientX: number; clientY: number }) => {
      const viewport = viewportRef.current;
      const boundedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
      if (!viewport) {
        setZoom(boundedZoom);
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const viewportX = clientPoint.clientX - rect.left;
      const viewportY = clientPoint.clientY - rect.top;
      const pageLeft = rect.width / 2 + pan.x - (PAGE_WIDTH_PX * zoom) / 2;
      const pageTop = rect.height / 2 + pan.y - (PAGE_HEIGHT_PX * zoom) / 2;
      const pageX = (viewportX - pageLeft) / zoom;
      const pageY = (viewportY - pageTop) / zoom;
      const nextPageLeft = viewportX - pageX * boundedZoom;
      const nextPageTop = viewportY - pageY * boundedZoom;
      setZoom(boundedZoom);
      setPan({
        x:
          nextPageLeft -
          rect.width / 2 +
          (PAGE_WIDTH_PX * boundedZoom) / 2,
        y:
          nextPageTop -
          rect.height / 2 +
          (PAGE_HEIGHT_PX * boundedZoom) / 2,
      });
    },
    [pan.x, pan.y, zoom]
  );

  const paintPixel = useCallback(
    (x: number, y: number, erase: boolean) => {
      const maskCanvas = maskCanvasRef.current;
      const maskCtx = maskCanvas?.getContext("2d");
      if (!maskCtx) return false;
      const key = y * PAGE_WIDTH_PX + x;
      if (erase) {
        if (!maskPixelsRef.current.has(key)) return false;
        maskPixelsRef.current.delete(key);
        maskCtx.clearRect(x, y, 1, 1);
        return true;
      }
      if (!isForegroundPixel(sourceCanvasRef.current, x, y)) return false;
      if (maskPixelsRef.current.has(key)) return false;
      maskPixelsRef.current.add(key);
      maskCtx.fillStyle = "rgba(255, 0, 255, 0.82)";
      maskCtx.fillRect(x, y, 1, 1);
      return true;
    },
    []
  );

  const paintAtPoint = useCallback(
    (point: { x: number; y: number }, erase: boolean) => {
      if (!bbox) return;
      let changed = false;
      const px = Math.round(point.x);
      const py = Math.round(point.y);
      const x0 = Math.max(Math.floor(bbox.x), px - MASK_BRUSH_RADIUS);
      const y0 = Math.max(Math.floor(bbox.y), py - MASK_BRUSH_RADIUS);
      const x1 = Math.min(
        Math.ceil(bbox.x + bbox.width),
        px + MASK_BRUSH_RADIUS
      );
      const y1 = Math.min(
        Math.ceil(bbox.y + bbox.height),
        py + MASK_BRUSH_RADIUS
      );
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          if (Math.hypot(x - px, y - py) > MASK_BRUSH_RADIUS) continue;
          changed = paintPixel(x, y, erase) || changed;
        }
      }
      if (changed) {
        setMaskPixelCount(maskPixelsRef.current.size);
        setMaskVersion((version) => version + 1);
        setSignature(null);
        setStatus(erase ? "Mask edited" : "Mask painted");
      }
    },
    [bbox, paintPixel]
  );

  const paintLine = useCallback(
    (
      from: { x: number; y: number },
      to: { x: number; y: number },
      erase: boolean
    ) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
      for (let index = 0; index <= steps; index += 1) {
        const t = index / steps;
        paintAtPoint(
          {
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t,
          },
          erase
        );
      }
    },
    [paintAtPoint]
  );

  const pruneMaskToBBox = useCallback(
    (nextBox: BBoxPx) => {
      let changed = false;
      for (const key of maskPixelsRef.current) {
        const x = key % PAGE_WIDTH_PX;
        const y = Math.floor(key / PAGE_WIDTH_PX);
        if (!pointInBox({ x, y }, nextBox)) {
          maskPixelsRef.current.delete(key);
          changed = true;
        }
      }
      if (changed) {
        setMaskPixelCount(maskPixelsRef.current.size);
        setMaskVersion((version) => version + 1);
      }
    },
    []
  );

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const canvas = sourceCanvasRef.current;
      const ctx = canvas?.getContext("2d", { willReadFrequently: true });
      if (!canvas || !ctx) return;
      canvas.width = PAGE_WIDTH_PX;
      canvas.height = PAGE_HEIGHT_PX;
      ctx.clearRect(0, 0, PAGE_WIDTH_PX, PAGE_HEIGHT_PX);
      ctx.drawImage(event.currentTarget, 0, 0, PAGE_WIDTH_PX, PAGE_HEIGHT_PX);
      setImageStatus("ready");
    },
    []
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      setContextMenu(null);
      const point = getPagePoint(event, { clampToPage: true });
      const shouldPan = event.button === 1 || event.altKey;
      if (shouldPan) {
        event.currentTarget.setPointerCapture(event.pointerId);
        interactionRef.current = {
          type: "pan",
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: pan.x,
          originY: pan.y,
        };
        return;
      }
      if (event.button !== 0) return;

      if (!point) {
        if (bboxSelected && bbox) {
          setBboxSelected(false);
          setBboxSaved(true);
          setStatus("BBox saved");
        }
        return;
      }

      if (activeToolbox !== "mask") return;

      if (maskPanelItem === "bbox") {
        if (!bbox) {
          event.currentTarget.setPointerCapture(event.pointerId);
          interactionRef.current = {
            type: "draw-bbox",
            pointerId: event.pointerId,
            start: point,
            current: point,
          };
          setDraftBbox(rawBox(point, point));
          return;
        }
        if (pointInBox(point, bbox)) {
          event.currentTarget.setPointerCapture(event.pointerId);
          setBboxSelected(true);
          interactionRef.current = {
            type: "move-bbox",
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            original: bbox,
          };
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        setBboxSelected(false);
        setBboxSaved(true);
        interactionRef.current = {
          type: "draw-bbox",
          pointerId: event.pointerId,
          start: point,
          current: point,
        };
        setDraftBbox(rawBox(point, point));
        return;
      }

      if (!bbox) {
        event.currentTarget.setPointerCapture(event.pointerId);
        interactionRef.current = {
          type: "draw-bbox",
          pointerId: event.pointerId,
          start: point,
          current: point,
        };
        setDraftBbox(rawBox(point, point));
        return;
      }

      if (!pointInBox(point, bbox)) {
        event.currentTarget.setPointerCapture(event.pointerId);
        setBboxSelected(false);
        setBboxSaved(true);
        interactionRef.current = {
          type: "draw-bbox",
          pointerId: event.pointerId,
          start: point,
          current: point,
        };
        setDraftBbox(rawBox(point, point));
        return;
      }

      if (bboxSaved && !bboxSelected) {
        setBboxSelected(true);
        setBboxSaved(false);
        setStatus("BBox ready");
        return;
      }

      viewportRef.current?.setPointerCapture(event.pointerId);
      const erase = event.shiftKey;
      interactionRef.current = {
        type: "paint-mask",
        pointerId: event.pointerId,
        erase,
        lastPoint: point,
      };
      paintAtPoint(point, erase);
    },
    [
      activeToolbox,
      bbox,
      bboxSaved,
      bboxSelected,
      getPagePoint,
      maskPanelItem,
      paintAtPoint,
      pan.x,
      pan.y,
      rawBox,
    ]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const session = interactionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;

      if (session.type === "move-panel") {
        setMaskPanelPosition({
          x: session.originX + event.clientX - session.startX,
          y: session.originY + event.clientY - session.startY,
        });
        return;
      }

      if (session.type === "pan") {
        setPan({
          x: session.originX + event.clientX - session.startX,
          y: session.originY + event.clientY - session.startY,
        });
        return;
      }

      const point = getPagePoint(event, { clampToPage: true });
      if (!point) return;

      if (session.type === "draw-bbox") {
        interactionRef.current = { ...session, current: point };
        setDraftBbox(rawBox(session.start, point));
        return;
      }

      if (session.type === "move-bbox") {
        const dx = (event.clientX - session.startX) / zoom;
        const dy = (event.clientY - session.startY) / zoom;
        const nextBox = clampBox({
          ...session.original,
          x: session.original.x + dx,
          y: session.original.y + dy,
        });
        setBbox(nextBox);
        setBboxSaved(false);
        pruneMaskToBBox(nextBox);
        return;
      }

      if (session.type === "resize-bbox") {
        const dx = (event.clientX - session.startX) / zoom;
        const dy = (event.clientY - session.startY) / zoom;
        const nextBox = resizeBox(session.original, session.handle, dx, dy, clampBox);
        setBbox(nextBox);
        setBboxSaved(false);
        pruneMaskToBBox(nextBox);
        return;
      }

      if (session.type === "paint-mask") {
        paintLine(session.lastPoint, point, session.erase || event.shiftKey);
        interactionRef.current = { ...session, lastPoint: point };
      }
    },
    [clampBox, getPagePoint, paintLine, pruneMaskToBBox, rawBox, zoom]
  );

  const finishInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const session = interactionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;

      if (session.type === "draw-bbox") {
        const roughBox = rawBox(session.start, session.current);
        setDraftBbox(null);
        if (roughBox.width >= MIN_BOX_SIZE && roughBox.height >= MIN_BOX_SIZE) {
          const nextBox = clampBox(roughBox);
          setBbox(nextBox);
          setBboxSelected(true);
          setBboxSaved(false);
          pruneMaskToBBox(nextBox);
          setStatus("BBox ready");
        } else if (bbox) {
          setBboxSelected(false);
          setBboxSaved(true);
          setStatus("BBox saved");
        } else {
          setBboxSelected(false);
          setBboxSaved(false);
          setStatus("Draw a bbox");
        }
      }
      if (session.type === "move-bbox" || session.type === "resize-bbox") {
        setBboxSelected(true);
        setStatus("BBox ready");
      }
      if (session.type === "paint-mask") {
        setStatus(session.erase ? "Mask edited" : "Mask painted");
      }
      interactionRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture can already be released after context changes.
      }
    },
    [bbox, clampBox, pruneMaskToBBox, rawBox]
  );

  const handleBboxHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
      if (!bbox) return;
      event.preventDefault();
      event.stopPropagation();
      setBboxSelected(true);
      viewportRef.current?.setPointerCapture(event.pointerId);
      interactionRef.current = {
        type: "resize-bbox",
        pointerId: event.pointerId,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        original: bbox,
      };
    },
    [bbox]
  );

  const handlePanelPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      viewportRef.current?.setPointerCapture(event.pointerId);
      interactionRef.current = {
        type: "move-panel",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: maskPanelPosition.x,
        originY: maskPanelPosition.y,
      };
    },
    [maskPanelPosition.x, maskPanelPosition.y]
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const direction = event.deltaY < 0 ? 1 : -1;
        setZoomAtClientPoint(zoom + direction * 0.18, event);
        return;
      }
      setPan((current) => ({
        x: current.x - event.deltaX,
        y: current.y - event.deltaY,
      }));
    },
    [setZoomAtClientPoint, zoom]
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const point = getPagePoint(event);
      if (!bbox || !point || !pointInBox(point, bbox)) return;
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    [bbox, getPagePoint]
  );

  const saveMask = useCallback(() => {
    if (!bbox || maskPixelsRef.current.size === 0) {
      setStatus("No mask pixels");
      setContextMenu(null);
      return;
    }
    const name = window.prompt("Mask name", savedMaskName ?? "ELB")?.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const entry = {
      id: `mask-${crypto.randomUUID()}`,
      name,
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      pageNum,
      pageSizePx: { width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX },
      bbox,
      maskPixels: Array.from(maskPixelsRef.current).sort((a, b) => a - b),
      createdAt: now,
    };
    const existing = readStoredMasks();
    window.localStorage.setItem(
      MASK_STORAGE_KEY,
      JSON.stringify([...existing, entry])
    );
    setSavedMaskName(name);
    setBboxSaved(true);
    setContextMenu(null);
    setStatus(`Saved ${name}`);
  }, [bbox, pageNum, savedMaskName]);

  const generateSignature = useCallback(() => {
    if (!bbox || maskPixelsRef.current.size === 0) {
      setStatus("No saved mask");
      setActiveToolbox("signature");
      return;
    }
    const nextSignature = buildFingerprintSignature({
      name: savedMaskName,
      pageNum,
      bbox,
      pixels: maskPixelsRef.current,
    });
    setSignature(nextSignature);
    setActiveToolbox("signature");
    setMaskPanelOpen(false);
    setStatus("Signature calculated");
  }, [bbox, pageNum, savedMaskName]);

  const resetView = useCallback(() => {
    setZoom(0.22);
    setPan({ x: 0, y: 0 });
  }, []);

  const resetPageState = useCallback(() => {
    setImageStatus("loading");
    setPan({ x: 0, y: 0 });
    setBbox(null);
    setDraftBbox(null);
    setBboxSelected(false);
    setBboxSaved(false);
    setSavedMaskName(null);
    setSignature(null);
    setContextMenu(null);
    maskPixelsRef.current = new Set();
    setMaskPixelCount(0);
    setMaskVersion((version) => version + 1);
  }, []);

  const changePage = useCallback(
    (delta: number) => {
      const nextPage = Math.max(1, Math.min(PAGE_COUNT, pageNum + delta));
      if (nextPage === pageNum) return;
      resetPageState();
      setPageNum(nextPage);
    },
    [pageNum, resetPageState]
  );

  const displayBox = draftBbox ?? bbox;

  return (
    <section className="relative flex h-full min-h-0 overflow-hidden rounded-3xl border border-border/70 bg-[radial-gradient(circle_at_18%_12%,rgba(89,129,255,0.14),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.012)_42%,rgba(0,0,0,0.2))] shadow-[0_24px_80px_-40px_rgba(0,0,0,0.88)]">
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-background/45 px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-[0.24em] text-primary">
              Fingerprint
            </div>
            <h2 className="mt-1 text-[17px] font-semibold text-foreground">
              Mask and signature workbench
            </h2>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => changePage(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-card/70 text-muted-foreground hover:text-foreground"
              title="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="rounded-xl border border-border/70 bg-card/70 px-3 py-1.5 text-foreground">
              Page {pageNum}
            </div>
            <button
              type="button"
              onClick={() => changePage(1)}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-card/70 text-muted-foreground hover:text-foreground"
              title="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - 0.18))}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-card/70 text-muted-foreground hover:text-foreground"
              title="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <div className="min-w-16 rounded-xl border border-border/70 bg-card/70 px-3 py-1.5 text-center text-foreground">
              {Math.round(zoom * 100)}%
            </div>
            <button
              type="button"
              onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + 0.18))}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-card/70 text-muted-foreground hover:text-foreground"
              title="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(MAX_ZOOM)}
              className="h-8 rounded-xl border border-primary/30 bg-primary/10 px-3 text-[10px] font-semibold text-primary hover:bg-primary/15"
            >
              500%
            </button>
            <button
              type="button"
              onClick={resetView}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-card/70 text-muted-foreground hover:text-foreground"
              title="Reset view"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden p-3">
          <div
            ref={viewportRef}
            className="relative h-full min-h-0 overflow-hidden rounded-3xl border border-border/70 bg-background/55 touch-none select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishInteraction}
            onPointerCancel={finishInteraction}
            onWheel={handleWheel}
            onContextMenu={handleContextMenu}
          >
            <div
              className="absolute left-3 top-3 z-30 flex overflow-hidden rounded-2xl border border-border/70 bg-card/90 p-1 shadow-[0_18px_48px_-30px_rgba(0,0,0,0.85)] backdrop-blur"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={openMaskPanel}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold transition ${
                  activeToolbox === "mask"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-white/[0.045] hover:text-foreground"
                }`}
              >
                <BoxSelect className="h-4 w-4" />
                Mask
              </button>
              <button
                type="button"
                onClick={generateSignature}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold transition ${
                  activeToolbox === "signature"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-white/[0.045] hover:text-foreground"
                }`}
              >
                <Fingerprint className="h-4 w-4" />
                Signature
              </button>
            </div>

            <div
              className="absolute right-3 top-3 z-30 rounded-2xl border border-border/70 bg-card/90 px-3 py-2 text-[11px] text-muted-foreground shadow-[0_18px_48px_-30px_rgba(0,0,0,0.85)] backdrop-blur"
              onPointerDown={(event) => event.stopPropagation()}
            >
              {status}
            </div>

            <div
              className="absolute left-1/2 top-1/2 rounded-sm bg-white shadow-[0_22px_70px_-34px_rgba(0,0,0,0.95)]"
              style={{
                width: PAGE_WIDTH_PX,
                height: PAGE_HEIGHT_PX,
                transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
                transformOrigin: "center",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={imageSrc}
                src={imageSrc}
                alt={`reference schematic page ${pageNum}`}
                className="h-full w-full select-none object-contain"
                draggable={false}
                onLoad={handleImageLoad}
                onError={() => setImageStatus("error")}
              />
              <canvas
                ref={maskCanvasRef}
                width={PAGE_WIDTH_PX}
                height={PAGE_HEIGHT_PX}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${PAGE_WIDTH_PX} ${PAGE_HEIGHT_PX}`}
              >
                {displayBox ? (
                  <MaskBoxOverlay
                    bbox={displayBox}
                    selected={bboxSelected || Boolean(draftBbox)}
                    saved={bboxSaved}
                    zoom={zoom}
                    onHandlePointerDown={handleBboxHandlePointerDown}
                  />
                ) : null}
                {signature ? (
                  <SignatureOverlay signature={signature} zoom={zoom} />
                ) : null}
              </svg>
            </div>

            {maskPanelOpen && activeToolbox === "mask" ? (
              <FloatingMaskPanel
                position={maskPanelPosition}
                activeItem={maskPanelItem}
                bbox={bbox}
                maskPixelCount={maskPixelCount}
                savedMaskName={savedMaskName}
                onMovePointerDown={handlePanelPointerDown}
                onItemChange={(item) => {
                  setMaskPanelItem(item);
                  setActiveToolbox("mask");
                  setContextMenu(null);
                }}
              />
            ) : null}

            {activeToolbox === "signature" && signature ? (
              <SignaturePanel signature={signature} />
            ) : null}

            {contextMenu ? (
              <div
                className="fixed z-50 min-w-36 rounded-2xl border border-border/70 bg-card/95 p-1 shadow-[0_20px_56px_-24px_rgba(0,0,0,0.9)] backdrop-blur"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={saveMask}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-semibold text-foreground hover:bg-white/[0.045]"
                >
                  <Save className="h-4 w-4" />
                  Save mask
                </button>
              </div>
            ) : null}

            {imageStatus !== "ready" ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/45 backdrop-blur-sm">
                <div className="rounded-3xl border border-border/70 bg-card/80 px-5 py-4 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
                    {imageStatus === "loading" ? "Loading page" : "Page unavailable"}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <canvas ref={sourceCanvasRef} className="hidden" />
    </section>
  );
}

function FloatingMaskPanel({
  position,
  activeItem,
  bbox,
  maskPixelCount,
  savedMaskName,
  onMovePointerDown,
  onItemChange,
}: {
  position: { x: number; y: number };
  activeItem: MaskPanelItem;
  bbox: BBoxPx | null;
  maskPixelCount: number;
  savedMaskName: string | null;
  onMovePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onItemChange: (item: MaskPanelItem) => void;
}) {
  return (
    <div
      className="absolute z-40 w-60 overflow-hidden rounded-3xl border border-border/70 bg-card/95 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.95)] backdrop-blur"
      style={{ left: position.x, top: position.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="flex cursor-move items-center justify-between border-b border-border/70 px-3 py-2"
        onPointerDown={onMovePointerDown}
      >
        <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
          <Move className="h-3.5 w-3.5 text-primary" />
          Mask
        </div>
        <div className="text-[10px] text-muted-foreground">
          {savedMaskName ?? "unnamed"}
        </div>
      </div>
      <div className="grid gap-1.5 p-2">
        <button
          type="button"
          onClick={() => onItemChange("bbox")}
          className={`rounded-2xl px-3 py-2 text-left text-[12px] font-semibold transition ${
            activeItem === "bbox"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-white/[0.045] hover:text-foreground"
          }`}
        >
          bbox
        </button>
        <button
          type="button"
          onClick={() => onItemChange("draw")}
          className={`rounded-2xl px-3 py-2 text-left text-[12px] font-semibold transition ${
            activeItem === "draw"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-white/[0.045] hover:text-foreground"
          }`}
        >
          draw
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 border-t border-border/70 p-2 text-[10px] text-muted-foreground">
        <div className="rounded-2xl border border-border/70 bg-background/45 px-2 py-1.5">
          <div>bbox</div>
          <strong className="text-foreground">{bbox ? "set" : "empty"}</strong>
        </div>
        <div className="rounded-2xl border border-border/70 bg-background/45 px-2 py-1.5">
          <div>mask</div>
          <strong className="text-foreground">{maskPixelCount}</strong>
        </div>
      </div>
    </div>
  );
}

function MaskBoxOverlay({
  bbox,
  selected,
  saved,
  zoom,
  onHandlePointerDown,
}: {
  bbox: BBoxPx;
  selected: boolean;
  saved: boolean;
  zoom: number;
  onHandlePointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    handle: ResizeHandle
  ) => void;
}) {
  const strokeWidth = Math.max(0.6, 2 / zoom);
  const handleSize = Math.max(3, 10 / zoom);
  return (
    <g>
      <rect
        x={bbox.x}
        y={bbox.y}
        width={bbox.width}
        height={bbox.height}
        fill="rgba(255,0,255,0.06)"
        stroke={saved ? "#22c55e" : "#ff00ff"}
        strokeWidth={strokeWidth}
        strokeDasharray={saved ? undefined : `${8 / zoom} ${6 / zoom}`}
      />
      {selected
        ? RESIZE_HANDLES.map((handle) => {
            const point = handlePoint(bbox, handle);
            return (
              <foreignObject
                key={handle}
                x={point.x - handleSize / 2}
                y={point.y - handleSize / 2}
                width={handleSize}
                height={handleSize}
                className="pointer-events-auto overflow-visible"
              >
                <button
                  type="button"
                  className="h-full w-full rounded-sm border border-white/80 bg-fuchsia-500 p-0"
                  onPointerDown={(event) => onHandlePointerDown(event, handle)}
                  aria-label={`resize ${handle}`}
                />
              </foreignObject>
            );
          })
        : null}
    </g>
  );
}

function SignatureOverlay({
  signature,
  zoom,
}: {
  signature: FingerprintSignature;
  zoom: number;
}) {
  const anchorRadius = Math.max(1.6, 7 / zoom);
  const pointRadius = Math.max(0.8, 3 / zoom);
  return (
    <g>
      <circle
        cx={signature.anchor.x}
        cy={signature.anchor.y}
        r={anchorRadius}
        fill="#22d3ee"
        stroke="#082f49"
        strokeWidth={Math.max(0.4, 1.5 / zoom)}
      />
      {signature.points.map((point, index) => (
        <circle
          key={`${point.segmentId}-${index}`}
          cx={point.x}
          cy={point.y}
          r={pointRadius}
          fill="#facc15"
          opacity={0.82}
        />
      ))}
    </g>
  );
}

function SignaturePanel({ signature }: { signature: FingerprintSignature }) {
  return (
    <div className="absolute bottom-3 right-3 z-40 w-[420px] rounded-3xl border border-border/70 bg-card/95 p-3 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.95)] backdrop-blur">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
        <ScanSearch className="h-4 w-4 text-primary" />
        Signature
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-[10px] text-muted-foreground">
        <Metric label="mask" value={signature.maskPixelCount} />
        <Metric label="points" value={signature.pointCount} />
        <Metric label="segments" value={signature.segmentCoverage.length} />
        <Metric label="page" value={signature.pageNum} />
      </div>
      <textarea
        readOnly
        value={JSON.stringify(
          {
            name: signature.name,
            anchor: signature.anchor,
            points: signature.points,
            radial_signature: signature.radialSignature,
            segment_coverage: signature.segmentCoverage,
          },
          null,
          2
        )}
        className="mt-3 h-52 w-full resize-none rounded-2xl border border-border/70 bg-background/70 p-3 font-mono text-[10px] leading-4 text-foreground outline-none"
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/45 px-2 py-1.5">
      <div>{label}</div>
      <strong className="text-foreground">{value}</strong>
    </div>
  );
}

const RESIZE_HANDLES: ResizeHandle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

function handlePoint(box: BBoxPx, handle: ResizeHandle) {
  const x =
    handle.includes("w") ? box.x : handle.includes("e") ? box.x + box.width : box.x + box.width / 2;
  const y =
    handle.includes("n") ? box.y : handle.includes("s") ? box.y + box.height : box.y + box.height / 2;
  return { x, y };
}

function pointInBox(point: { x: number; y: number }, box: BBoxPx) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

function resizeBox(
  original: BBoxPx,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  clampBox: (box: BBoxPx) => BBoxPx
) {
  let { x, y, width, height } = original;
  if (handle.includes("w")) {
    x = original.x + dx;
    width = original.width - dx;
  }
  if (handle.includes("e")) {
    width = original.width + dx;
  }
  if (handle.includes("n")) {
    y = original.y + dy;
    height = original.height - dy;
  }
  if (handle.includes("s")) {
    height = original.height + dy;
  }
  if (width < MIN_BOX_SIZE) {
    x = original.x + original.width - MIN_BOX_SIZE;
    width = MIN_BOX_SIZE;
  }
  if (height < MIN_BOX_SIZE) {
    y = original.y + original.height - MIN_BOX_SIZE;
    height = MIN_BOX_SIZE;
  }
  return clampBox({ x, y, width, height });
}

function isForegroundPixel(canvas: HTMLCanvasElement | null, x: number, y: number) {
  const ctx = canvas?.getContext("2d", { willReadFrequently: true });
  if (!ctx || x < 0 || y < 0 || x >= PAGE_WIDTH_PX || y >= PAGE_HEIGHT_PX) {
    return false;
  }
  try {
    const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return a > 20 && luminance < 150;
  } catch {
    return false;
  }
}

function readStoredMasks() {
  try {
    const raw = window.localStorage.getItem(MASK_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildFingerprintSignature({
  name,
  pageNum,
  bbox,
  pixels,
}: {
  name: string | null;
  pageNum: number;
  bbox: BBoxPx;
  pixels: Set<number>;
}): FingerprintSignature {
  const points = Array.from(pixels)
    .sort((a, b) => a - b)
    .map((key) => ({
      x: key % PAGE_WIDTH_PX,
      y: Math.floor(key / PAGE_WIDTH_PX),
    }));
  const centroid = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 }
  );
  centroid.x /= points.length;
  centroid.y /= points.length;
  const anchor = [...points].sort((left, right) => {
    const distanceDelta =
      Math.hypot(right.x - centroid.x, right.y - centroid.y) -
      Math.hypot(left.x - centroid.x, left.y - centroid.y);
    if (Math.abs(distanceDelta) > 0.0001) return distanceDelta;
    if (left.y !== right.y) return left.y - right.y;
    return left.x - right.x;
  })[0];
  const segments = connectedSegments(pixels);
  const sampledPoints = allocateSignaturePoints(segments);
  const scale = Math.max(1, Math.hypot(bbox.width, bbox.height));
  const radialSignature = sampledPoints
    .map((point) => Number((Math.hypot(point.x - anchor.x, point.y - anchor.y) / scale).toFixed(6)))
    .sort((left, right) => left - right);
  return {
    name,
    pageNum,
    bbox,
    maskPixelCount: pixels.size,
    anchor,
    pointCount: sampledPoints.length,
    points: sampledPoints,
    radialSignature,
    segmentCoverage: segments.map((segment) => ({
      id: segment.id,
      pixelCount: segment.points.length,
      pointCount: sampledPoints.filter((point) => point.segmentId === segment.id).length,
      bbox: segment.bbox,
      centroid: segment.centroid,
    })),
  };
}

function connectedSegments(pixels: Set<number>) {
  const remaining = new Set(pixels);
  const segments: Array<{
    id: number;
    points: SignaturePoint[];
    bbox: BBoxPx;
    centroid: { x: number; y: number };
  }> = [];
  let id = 0;
  for (const startKey of pixels) {
    if (!remaining.has(startKey)) continue;
    const queue = [startKey];
    remaining.delete(startKey);
    const points: SignaturePoint[] = [];
    while (queue.length > 0) {
      const key = queue.pop();
      if (key === undefined) continue;
      const x = key % PAGE_WIDTH_PX;
      const y = Math.floor(key / PAGE_WIDTH_PX);
      points.push({ x, y, segmentId: id });
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= PAGE_WIDTH_PX || ny >= PAGE_HEIGHT_PX) {
            continue;
          }
          const neighborKey = ny * PAGE_WIDTH_PX + nx;
          if (!remaining.has(neighborKey)) continue;
          remaining.delete(neighborKey);
          queue.push(neighborKey);
        }
      }
    }
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const sum = points.reduce(
      (current, point) => ({ x: current.x + point.x, y: current.y + point.y }),
      { x: 0, y: 0 }
    );
    segments.push({
      id,
      points: points.sort((left, right) => left.y - right.y || left.x - right.x),
      bbox: {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs) + 1,
        height: Math.max(...ys) - Math.min(...ys) + 1,
      },
      centroid: {
        x: Number((sum.x / points.length).toFixed(3)),
        y: Number((sum.y / points.length).toFixed(3)),
      },
    });
    id += 1;
  }
  return segments;
}

function allocateSignaturePoints(
  segments: Array<{
    id: number;
    points: SignaturePoint[];
    bbox: BBoxPx;
    centroid: { x: number; y: number };
  }>
) {
  if (segments.length === 0) return [];
  const totalPixels = segments.reduce((sum, segment) => sum + segment.points.length, 0);
  const allocations = segments.map((segment) => {
    const exact = (segment.points.length / totalPixels) * POSITIONAL_POINT_TARGET;
    return {
      segment,
      exact,
      count: Math.max(1, Math.floor(exact)),
      remainder: exact - Math.floor(exact),
    };
  });
  let allocated = allocations.reduce((sum, allocation) => sum + allocation.count, 0);
  while (allocated > POSITIONAL_POINT_TARGET) {
    const candidate = allocations
      .filter((allocation) => allocation.count > 1)
      .sort((left, right) => left.remainder - right.remainder)[0];
    if (!candidate) break;
    candidate.count -= 1;
    allocated -= 1;
  }
  while (allocated < POSITIONAL_POINT_TARGET) {
    const candidate = allocations
      .sort((left, right) => right.remainder - left.remainder)[0];
    candidate.count += 1;
    allocated += 1;
  }
  return allocations.flatMap(({ segment, count }) =>
    sampleEvenly(segment.points, Math.min(count, segment.points.length)).map((point) => ({
      ...point,
      segmentId: segment.id,
    }))
  );
}

function sampleEvenly(points: SignaturePoint[], count: number) {
  if (count <= 0) return [];
  if (count >= points.length) return points;
  if (count === 1) return [points[Math.floor(points.length / 2)]];
  return Array.from({ length: count }, (_, index) => {
    const pointIndex = Math.round((index / (count - 1)) * (points.length - 1));
    return points[pointIndex];
  });
}
