import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
} from "react";

import {
  clampZoom,
  pagePointFromClient,
  visiblePageBox as viewportVisiblePageBox,
  zoomAtClientPoint,
} from "./studio-viewport";
import { snapComponentBoxToShapes } from "./component-snap";
import type { ComponentSnapResult } from "./component-snap";
import {
  clampBoxToPage,
  normalizeBoxFromPoints,
  type BBoxPx,
} from "./studio-geometry";
import {
  annotationStackAtPoint,
  hoverStackSignature,
  type HoverStackTarget,
} from "./overlay-label-layout";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
  SNAP_PADDING_PDF,
  type AnnotationBox,
  type PageMetadata,
  type SnapStrength,
} from "./studio-types";

const STUDIO_PAGE_SIZE = {
  width: PAGE_WIDTH_PX,
  height: PAGE_HEIGHT_PX,
};

type ClientPoint = {
  clientX: number;
  clientY: number;
};

export type UseStudioViewportOptions = {
  stageRef: MutableRefObject<HTMLDivElement | null>;
  pageMetadata: PageMetadata | null;
  pan: { x: number; y: number };
  zoom: number;
  snapStrength: SnapStrength;
  boxesForPage: AnnotationBox[];
  hoverStackCyclingRef: MutableRefObject<boolean>;
  hoverStackIndexRef: MutableRefObject<number>;
  setPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
  setZoom: Dispatch<SetStateAction<number>>;
  setCursorPx: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setHoverStack: Dispatch<SetStateAction<HoverStackTarget[]>>;
};

export function useStudioViewport({
  stageRef,
  pageMetadata,
  pan,
  zoom,
  snapStrength,
  boxesForPage,
  hoverStackCyclingRef,
  hoverStackIndexRef,
  setPan,
  setZoom,
  setCursorPx,
  setHoverStack,
}: UseStudioViewportOptions) {
  const setBoundedZoom = useCallback((nextZoom: number) => {
    setZoom(clampZoom(nextZoom, MIN_ZOOM, MAX_ZOOM));
  }, [setZoom]);

  const setZoomAtClientPoint = useCallback(
    (nextZoom: number, clientPoint: ClientPoint) => {
      const stage = stageRef.current;
      if (!stage) {
        setZoom(clampZoom(nextZoom, MIN_ZOOM, MAX_ZOOM));
        return;
      }
      const next = zoomAtClientPoint({
        stageRect: stage.getBoundingClientRect(),
        pageSize: STUDIO_PAGE_SIZE,
        pan,
        zoom,
        nextZoom,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        clientPoint,
      });
      setZoom(next.zoom);
      setPan(next.pan);
    },
    [pan, setPan, setZoom, stageRef, zoom]
  );

  const resetView = useCallback(() => {
    setPan({ x: 0, y: 0 });
    setZoom(MIN_ZOOM);
  }, [setPan, setZoom]);

  const getPagePoint = useCallback(
    (event: ClientPoint, options: { clampToPage?: boolean } = {}) => {
      const stage = stageRef.current;
      if (!stage) return null;
      return pagePointFromClient({
        stageRect: stage.getBoundingClientRect(),
        pageSize: STUDIO_PAGE_SIZE,
        pan,
        zoom,
        clientPoint: event,
        clampToPage: options.clampToPage,
      });
    },
    [pan, stageRef, zoom]
  );

  const getVisiblePageBox = useCallback((): BBoxPx | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    return viewportVisiblePageBox({
      stageRect: stage.getBoundingClientRect(),
      pageSize: STUDIO_PAGE_SIZE,
      pan,
      zoom,
    });
  }, [pan, stageRef, zoom]);

  const updateCursorPosition = useCallback(
    (event: ClientPoint) => {
      const point = getPagePoint(event);
      setCursorPx(point ? { x: Math.round(point.x), y: Math.round(point.y) } : null);
      const nextStack = point ? annotationStackAtPoint(boxesForPage, point) : [];
      setHoverStack((current) => {
        if (hoverStackSignature(current) === hoverStackSignature(nextStack)) {
          return current;
        }
        hoverStackCyclingRef.current = false;
        hoverStackIndexRef.current = -1;
        return nextStack;
      });
      return;
    },
    [boxesForPage, getPagePoint, hoverStackCyclingRef, hoverStackIndexRef, setCursorPx, setHoverStack]
  );

  const clampBox = useCallback(
    (box: BBoxPx): BBoxPx => clampBoxToPage(box, STUDIO_PAGE_SIZE),
    []
  );

  const normalizeBox = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }): BBoxPx =>
      normalizeBoxFromPoints(start, end, STUDIO_PAGE_SIZE),
    []
  );

  const snapComponentBox = useCallback(
    (
      roughBox: BBoxPx,
      options: {
        requireEnclosedComponent?: boolean;
        snapPaddingPdf?: number;
      } = {}
    ): ComponentSnapResult => {
      return snapComponentBoxToShapes({
        roughBox,
        scale: pageMetadata?.scale,
        shapes: pageMetadata?.shapes ?? [],
        pageSize: STUDIO_PAGE_SIZE,
        snapPaddingPdf: options.snapPaddingPdf ?? SNAP_PADDING_PDF,
        snapStrength,
        requireEnclosedComponent: options.requireEnclosedComponent,
      });
    },
    [pageMetadata, snapStrength]
  );

  return {
    setBoundedZoom,
    setZoomAtClientPoint,
    resetView,
    getPagePoint,
    getVisiblePageBox,
    updateCursorPosition,
    clampBox,
    normalizeBox,
    snapComponentBox,
  };
}
