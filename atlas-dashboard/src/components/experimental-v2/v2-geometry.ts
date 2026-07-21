// Pure geometry + stroke-classification helpers for the Experimental v2
// Logic-First CAD overlay. No React here — keep this module side-effect free so
// it stays unit-testable and reusable by the drawing hook, the smart wire tool,
// and the freehand classifier.

import type { V2Node, V2Port } from "./experimental-v2-types";
import { PAGE_WIDTH_PX } from "../extraction-workbench/studio-types.ts";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

// --- Page-relative thresholds -------------------------------------------------
// The page render space is PAGE_WIDTH_PX wide (currently 2481px). The original
// implementation hardcoded thresholds calibrated for a dead 1000px assumption,
// which made terminal/component recognition misfire badly on the real page.
// Express everything as a fraction of page width so it stays correct regardless
// of render resolution.
const px = (fraction: number) => Math.round(PAGE_WIDTH_PX * fraction);

export const CLOSED_STROKE_THRESHOLD = px(0.015); // ~37px: endpoints this close => closed loop
export const COMPONENT_MIN_SIZE = px(0.02); // ~50px: smallest box that counts as a component
export const TERMINAL_MAX_SIZE = px(0.012); // ~30px: largest blob that counts as a terminal dot
export const PORT_SNAP_DISTANCE = px(0.014); // ~35px: snap a wire endpoint to an existing port
export const COMPONENT_ATTACH_DISTANCE = px(0.045); // ~110px: attach a terminal to a nearby component
const COMPONENT_ASPECT_RATIO_TOLERANCE = 0.4; // aspect ratio between 0.4 and 2.5

// --- Basic vector math --------------------------------------------------------
export function distance(p1: Point, p2: Point): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

export function centroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  return { x: sumX / points.length, y: sumY / points.length };
}

export function boundsOf(points: Point[]): Rect {
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Nearest point on the perimeter of a rectangle (used for terminal snapping).
export function getNearestPointOnRect(point: Point, rect: Rect): Point {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;

  const clampedX = Math.max(left, Math.min(right, point.x));
  const clampedY = Math.max(top, Math.min(bottom, point.y));

  const isInside =
    point.x > left && point.x < right && point.y > top && point.y < bottom;

  if (!isInside) {
    return { x: clampedX, y: clampedY };
  }

  // Inside: snap to the closest of the 4 edges.
  const dl = Math.abs(point.x - left);
  const dr = Math.abs(point.x - right);
  const dt = Math.abs(point.y - top);
  const db = Math.abs(point.y - bottom);
  const min = Math.min(dl, dr, dt, db);

  if (min === dl) return { x: left, y: clampedY };
  if (min === dr) return { x: right, y: clampedY };
  if (min === dt) return { x: clampedX, y: top };
  return { x: clampedX, y: bottom };
}

// Distance from a point to a rectangle (0 if the point is inside).
export function distanceToRect(point: Point, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

// Distance from a point to a rectangle's PERIMETER (0 exactly on the border;
// interior points measure to the nearest edge).
export function distanceToRectBorder(point: Point, rect: Rect): number {
  return distance(point, getNearestPointOnRect(point, rect));
}

// Mate detection (Shane, 2026-07-09): the components whose printed-box BORDERS
// pass within `tol` px of the point — a point on TWO flush borders is a MATING
// interface (connection by abutment, e.g. CON20 plug ⇔ INV1 socket) and mints
// ONE mate terminal owned by both. Sorted nearest-border-first; capped at 2
// (a mate is a pair; a third abutting part is a modeling question, not a mate).
export function mateParentsAt(
  point: Point,
  nodes: { id: string; bbox: Rect }[],
  tol = 6
): string[] {
  return nodes
    .map((n) => ({ id: n.id, d: distanceToRectBorder(point, n.bbox) }))
    .filter((e) => e.d <= tol)
    .sort((a, b) => a.d - b.d)
    .slice(0, 2)
    .map((e) => e.id);
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

// --- Nearest-element queries --------------------------------------------------
export function findNearestPort(
  point: Point,
  ports: V2Port[],
  maxDistance: number = PORT_SNAP_DISTANCE
): V2Port | null {
  let nearest: V2Port | null = null;
  let minDist = Infinity;
  for (const port of ports) {
    const d = distance(point, port.point);
    if (d <= maxDistance && d < minDist) {
      minDist = d;
      nearest = port;
    }
  }
  return nearest;
}

// Find the component a point belongs to: prefer a box that contains the point,
// otherwise the nearest box within maxDistance (measured edge-to-point, not
// center-to-point, so large components are handled correctly).
export function findOwningNode(
  point: Point,
  nodes: V2Node[],
  maxDistance: number = COMPONENT_ATTACH_DISTANCE
): V2Node | null {
  let nearest: V2Node | null = null;
  let minDist = Infinity;
  for (const node of nodes) {
    if (pointInRect(point, node.bbox)) return node;
    const d = distanceToRect(point, node.bbox);
    if (d <= maxDistance && d < minDist) {
      minDist = d;
      nearest = node;
    }
  }
  return nearest;
}

// Snap a freeform point onto the perimeter of the component it belongs to.
// Returns the owning node plus the snapped perimeter point, or null when the
// point is not near any component (caller can then make a floating terminal).
export function snapToComponentEdge(
  point: Point,
  nodes: V2Node[],
  maxDistance: number = COMPONENT_ATTACH_DISTANCE
): { node: V2Node; point: Point } | null {
  const node = findOwningNode(point, nodes, maxDistance);
  if (!node) return null;
  return { node, point: getNearestPointOnRect(point, node.bbox) };
}

// --- Stroke classification ----------------------------------------------------
export type StrokeClassification =
  | { type: "component"; bbox: Rect }
  | { type: "terminal"; point: Point }
  | { type: "wire"; points: Point[] };

export function classifyStroke(points: Point[]): StrokeClassification {
  if (points.length < 2) {
    return { type: "terminal", point: points[0] ?? { x: 0, y: 0 } };
  }

  const bounds = boundsOf(points);
  const { width, height } = bounds;
  const closedDistance = distance(points[0], points[points.length - 1]);

  // Terminal: a small, compact blob.
  if (width <= TERMINAL_MAX_SIZE && height <= TERMINAL_MAX_SIZE) {
    return { type: "terminal", point: centroid(points) };
  }

  // Component: a closed stroke of reasonable size and aspect ratio.
  const aspect = height === 0 ? Infinity : width / height;
  if (
    closedDistance < CLOSED_STROKE_THRESHOLD &&
    width >= COMPONENT_MIN_SIZE &&
    height >= COMPONENT_MIN_SIZE &&
    aspect >= COMPONENT_ASPECT_RATIO_TOLERANCE &&
    aspect <= 1 / COMPONENT_ASPECT_RATIO_TOLERANCE
  ) {
    return { type: "component", bbox: bounds };
  }

  // Otherwise it's a wire trace — keep the raw path.
  return { type: "wire", points: [...points] };
}
