"use client";

import React, { useRef, useState, useEffect, useLayoutEffect, type CSSProperties, type ReactNode } from "react";
import { studioImageSrc } from "../extraction-workbench/studio-derived-state";
import { PROJECT_ID, DOCUMENT_ID, PAGE_WIDTH_PX, PAGE_HEIGHT_PX } from "../extraction-workbench/studio-types";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { FALLBACK_FIT, clampToFit, computeFitZoom } from "./v2-zoom";

type PanOffset = {
  x: number;
  y: number;
};

// Fit-relative zoom (Shane's pinned spec, 2026-07-09): the page opens framed
// whole — THAT is 100% — and zooms in from there. Range logic lives in
// v2-zoom.ts (single source of truth for every clamp site).

type ExperimentalV2CanvasProps = {
  pageNum: number;
  zoom: number;
  setZoom: (zoom: number) => void;
  pan: PanOffset;
  setPan: (pan: PanOffset | ((prev: PanOffset) => PanOffset)) => void;
  // Reports the measured fit-to-screen zoom (100%) on mount and every resize,
  // so the screen can initialize the view and re-base the header's % display.
  onFitZoom?: (fit: number) => void;
  children?: ReactNode;
};

export function ExperimentalV2Canvas({
  pageNum,
  zoom,
  setZoom,
  pan,
  setPan,
  onFitZoom,
  children,
}: ExperimentalV2CanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fitZoomRef = useRef(FALLBACK_FIT);
  const clampZoom = (z: number) => clampToFit(z, fitZoomRef.current);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [spacePressed, setSpacePressed] = useState(false);

  // Two-finger gesture state (touch pointers only — pen/mouse never enter here).
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{ startAvgY: number; startZoom: number; anchor: { x: number; y: number } } | null>(null);

  // Latest transform for native listeners (wheel) without re-binding.
  const viewRef = useRef({ zoom, pan });
  viewRef.current = { zoom, pan };

  // Measure the fit-to-screen zoom (100%) before first paint and on resize.
  // Reported upward so the screen initializes the view at fit and the header
  // shows fit-relative percentages; the clamp above keeps every zoom path
  // (wheel, buttons, gestures, copilot view commands) inside 100%–400%.
  const onFitZoomRef = useRef(onFitZoom);
  onFitZoomRef.current = onFitZoom;
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return;
      const fit = computeFitZoom(r.width, r.height, PAGE_WIDTH_PX, PAGE_HEIGHT_PX);
      if (Math.abs(fit - fitZoomRef.current) < 0.0005) return;
      fitZoomRef.current = fit;
      onFitZoomRef.current?.(fit);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const imageSrc = studioImageSrc(agentBaseUrl(), PROJECT_ID, DOCUMENT_ID, pageNum);

  // Zoom keeping the viewport point `anchor` (client coords) visually fixed.
  const zoomAround = (nextZoomRaw: number, anchor: { x: number; y: number }) => {
    const { zoom: z, pan: p } = viewRef.current;
    const nextZoom = clampZoom(nextZoomRaw);
    if (nextZoom === z) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      setZoom(nextZoom);
      return;
    }
    const sx = anchor.x - (rect.left + rect.width / 2);
    const sy = anchor.y - (rect.top + rect.height / 2);
    setZoom(nextZoom);
    setPan({
      x: sx - ((sx - p.x) / z) * nextZoom,
      y: sy - ((sy - p.y) / z) * nextZoom,
    });
  };

  // Monitor Space key for drag-to-pan shortcut
  useEffect(() => {
    const inEditable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      // Never swallow Space typed into an input (copilot panel, rename fields).
      if (e.code === "Space" && !inEditable(e.target)) {
        setSpacePressed(true);
        // Prevent default spacebar scrolling
        e.preventDefault();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Wheel zoom (zoom-to-cursor). Native listener: React's onWheel can't reliably
  // preventDefault (passive), and we must stop the page from scrolling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const raw = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY; // lines -> px
      const factor = Math.exp(-raw * 0.0015);
      zoomAround(viewRef.current.zoom * factor, { x: e.clientX, y: e.clientY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    // Two-finger touch gestures: fingers navigate, the pen draws.
    if (e.pointerType === "touch") {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Guarded like every release: synthetic pointers (tests/automation
      // drive the canvas) name no active pointer and would throw.
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
      if (touchesRef.current.size === 2) {
        const [a, b] = [...touchesRef.current.values()];
        gestureRef.current = {
          startAvgY: (a.y + b.y) / 2,
          startZoom: viewRef.current.zoom,
          anchor: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
      }
      return;
    }
    // Pan drag: Space+drag, middle-click, or right-click drag.
    if (spacePressed || e.button === 1 || e.button === 2) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
      e.preventDefault();
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      if (!touchesRef.current.has(e.pointerId)) return;
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gestureRef.current;
      if (g && touchesRef.current.size === 2) {
        const [a, b] = [...touchesRef.current.values()];
        const avgY = (a.y + b.y) / 2;
        // Two-finger swipe up = zoom in, down = zoom out.
        const factor = Math.exp((g.startAvgY - avgY) * 0.005);
        zoomAround(g.startZoom * factor, g.anchor);
      }
      return;
    }
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      touchesRef.current.delete(e.pointerId);
      if (touchesRef.current.size < 2) gestureRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
      return;
    }
    if (isDragging) {
      setIsDragging(false);
      // A synthetic pointerup can arrive while a REAL pan is in flight (and
      // vice versa) — releasing a pointer id that was never captured throws.
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    }
  };

  return (
    <div
      ref={containerRef}
      // Frosted viewport (Shane, 2026-07-09): the Midnight Gallery nebula
      // glows through the areas around the sheet as if through frosty glass —
      // same language as the panels but a much lighter wash, so the page
      // floats in the exhibit space (the load-time wow). Zoomed in, the page
      // fills the frame and the gallery naturally recedes out of view.
      className={`relative flex-1 w-full h-full overflow-hidden select-none backdrop-blur-md ${
        spacePressed || isDragging ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      }`}
      style={{
        touchAction: "none",
        background: "linear-gradient(180deg, rgba(9,15,28,.26), rgba(5,9,19,.32))",
      } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Centered panning/zooming canvas container */}
      <div
        className="absolute left-1/2 top-1/2 rounded bg-white shadow-[0_22px_70px_-34px_rgba(0,0,0,0.95)] overflow-hidden transition-shadow"
        style={{
          width: PAGE_WIDTH_PX,
          height: PAGE_HEIGHT_PX,
          transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
          transformOrigin: "center",
        } as CSSProperties}
      >
        {/* locked pre-rendered PDF page background image */}
        <img
          key={imageSrc}
          src={imageSrc}
          alt={`CAD Overlay page ${pageNum}`}
          className="w-full h-full select-none object-contain pointer-events-none"
          draggable={false}
        />

        {/* SVG/Interaction overlay layer strictly for drawing CAD items */}
        <div className="absolute inset-0 z-10">
          {children}
        </div>
      </div>
    </div>
  );
}
