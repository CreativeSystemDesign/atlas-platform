"use client";

// OBJECT-IN-HAND scene (Shane, 2026-07-11): the viewer is STATIONARY — a
// fixed camera — and the controls move the SCHEMATIC (rotate / slide /
// scale its model matrix). Linked counterpart sheets ride the same pose as
// one rigid assembly; resolved continuations arc between them.
// Labels have two modes (Shane): billboard (always facing — investigating)
// and printed-on-surface (fixed to block faces — navigating). Toggle: L.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import type { DeckGLRef } from "@deck.gl/react";
import { AmbientLight, DirectionalLight, LightingEffect, OrbitView } from "@deck.gl/core";
import type { Layer, OrbitViewState, PickingInfo } from "@deck.gl/core";
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { Matrix4 } from "@math.gl/core";
import {
  graphBounds,
  type Mg3dBounds,
  type Mg3dContinuation,
  type Mg3dEdge,
  type Mg3dGraph,
  type Mg3dGround,
  type Mg3dNode,
  type Mg3dPort,
} from "./use-mg3d-graph";
import type { ContArc, LinkedSheet } from "./use-mg3d-links";
import type { Rect } from "./mg3d-route";
import { routeLinks, type Conductor } from "./mg3d-bundle";
import { familyOf, familyStyle, type FamilyStyle } from "./mg3d-family";
import { classifyNet, terminalNet, terminalPin, NET_ROLE_RGB } from "./net-class";

// Page coords are y-down; world flips y so the sheet reads upright.
type WorldPoint = [number, number, number];
const toWorld = (x: number, y: number, z = 0): WorldPoint => [x, -y, z];

// Components extrude as solid blocks over a TRANSPARENT sheet; wires run as
// traces at ground level, terminals sit at the block walls. Heights in page px.
const GROUND_H = 26;
const WIRE_Z = 2;
const TERM_Z = 3;
const CHIP_Z = 3;
const WIRE_LABEL_Z = 8;
// Extended runs live ON the trace level (Shane, 2026-07-11: same level and
// brightness as every other wire) — a crossing reads like any schematic
// crossing: no dot, no junction.
const LINK_OBSTACLE_MARGIN = 26;

// Bigger footprint -> taller block (Shane's ruling): height tracks sqrt(area)
// so volume grows with visual importance without skyscrapering the big gear.
function componentHeight(bbox: { width: number; height: number }, scale = 1): number {
  const h = (26 + Math.sqrt(Math.max(0, bbox.width * bbox.height)) * 0.16) * scale;
  return Math.min(220, h);
}

// Family identity accessors (Shane, 2026-07-11: every component class wears
// the same signature on every page — edge color, tinted body, silhouette,
// height character, nameplate).
function nodeStyle(d: Mg3dNode): FamilyStyle {
  return familyStyle(familyOf(d.label, d.family));
}

function tintFill(rgb: readonly number[], dim: boolean): [number, number, number, number] {
  const base = dim ? [24, 31, 45] : [30, 39, 56];
  return [
    Math.round(base[0] * 0.84 + rgb[0] * 0.16),
    Math.round(base[1] * 0.84 + rgb[1] * 0.16),
    Math.round(base[2] * 0.84 + rgb[2] * 0.16),
    255,
  ];
}

function nameplateColor(rgb: readonly number[], dim: boolean): [number, number, number, number] {
  return [
    Math.round(rgb[0] * 0.22 + 8),
    Math.round(rgb[1] * 0.22 + 8),
    Math.round(rgb[2] * 0.22 + 10),
    dim ? 170 : 235,
  ];
}

const LIGHTING = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 1.15 }),
  key: new DirectionalLight({ color: [255, 255, 255], intensity: 1.0, direction: [-0.6, -0.4, -1] }),
});

const BLOCK_MATERIAL = { ambient: 0.5, diffuse: 0.55, shininess: 30, specularColor: [70, 80, 100] as [number, number, number] };

type Size = { width: number; height: number };

const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const TOOLTIP_STYLE: Record<string, string> = {
  background: "#0d1420f0",
  color: "#cbd5e1",
  fontSize: "12px",
  padding: "6px 8px",
  borderRadius: "6px",
};

const DEG = Math.PI / 180;

// Wall orientations for printed-on labels: v_world = RotZ(phi) * RotX(90deg)
// * v_local stands the glyph plane against the wall whose outward normal is
// S = world -y (page bottom edge), N = +y (page top), L = -x, R = +x.
// Text "up" lands on world +z.
const WALL_ROT: Record<string, { rot: Matrix4; inv: Matrix4; nx: number; ny: number }> = (() => {
  const make = (phi: number, nx: number, ny: number) => {
    const rot = new Matrix4().rotateZ(phi).rotateX(Math.PI / 2);
    return { rot, inv: new Matrix4(rot).invert(), nx, ny };
  };
  return {
    S: make(0, 0, -1),
    N: make(Math.PI, 0, 1),
    L: make(-Math.PI / 2, -1, 0),
    R: make(Math.PI / 2, 1, 0),
  };
})();

function withAlpha(rgb: readonly number[], alpha: number): [number, number, number, number] {
  return [rgb[0], rgb[1], rgb[2], alpha];
}

function bboxPolygon(bbox: { x: number; y: number; width: number; height: number }): WorldPoint[] {
  const { x, y, width, height } = bbox;
  return [
    toWorld(x, y),
    toWorld(x + width, y),
    toWorld(x + width, y + height),
    toWorld(x, y + height),
    toWorld(x, y),
  ];
}

// Family silhouette: chamfered corners turn the box into the class's shape.
function familyPolygon(bbox: { x: number; y: number; width: number; height: number }, chamfer: number): WorldPoint[] {
  if (chamfer <= 0) return bboxPolygon(bbox);
  const { x, y, width, height } = bbox;
  const c = Math.min(chamfer, width / 3, height / 3);
  return [
    toWorld(x + c, y),
    toWorld(x + width - c, y),
    toWorld(x + width, y + c),
    toWorld(x + width, y + height - c),
    toWorld(x + width - c, y + height),
    toWorld(x + c, y + height),
    toWorld(x, y + height - c),
    toWorld(x, y + c),
    toWorld(x + c, y),
  ];
}

type WallMarker = {
  text: string;
  point: { x: number; y: number };
  z: number;
  wall: string;
  color: [number, number, number, number];
  size: number;
};

function buildWallMarkers(graph: Mg3dGraph): WallMarker[] {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: WallMarker[] = [];
  for (const port of graph.ports) {
    const parent = port.parentId ? nodeById.get(port.parentId) : undefined;
    if (!parent) continue;
    const b = parent.bbox;
    const p = port.point;
    const walls = [
      { d: Math.abs(p.x - b.x), wall: "L" },
      { d: Math.abs(b.x + b.width - p.x), wall: "R" },
      { d: Math.abs(p.y - b.y), wall: "N" }, // page top edge -> world +y
      { d: Math.abs(b.y + b.height - p.y), wall: "S" },
    ];
    const wall = walls.reduce((a, w) => (w.d < a.d ? w : a)).wall;
    const pin = terminalPin(port.label);
    const role = NET_ROLE_RGB[classifyNet(terminalNet(port.label))];
    out.push({
      text: pin ?? "T",
      point: p,
      z: componentHeight(b, nodeStyle(parent).heightScale) * 0.55,
      wall,
      color: pin ? [role[0], role[1], role[2], 255] : [148, 163, 184, 200],
      size: pin ? 20 : 14,
    });
  }
  return out;
}

// One sheet's constellation. `dim` renders counterpart sheets quieter; the
// full treatment (terminals, wall markers, wire labels) stays on the primary.
function sheetLayers(opts: {
  graph: Mg3dGraph;
  prefix: string;
  matrix: Matrix4;
  dim: boolean;
  surfaceLabels: boolean;
  selected?: boolean;
  caption?: { text: string; bounds: Mg3dBounds };
}): Layer[] {
  const { graph, prefix, matrix, dim, surfaceLabels, selected, caption } = opts;
  const labeledEdges = graph.edges.filter((e) => e.label !== "");
  const wireWidth = (e: Mg3dEdge) => {
    const role: string = classifyNet(e.label);
    return role === "phase" || role === "dc-rail" ? 5 : 3;
  };
  const layers: Layer[] = [
    new PolygonLayer<Mg3dNode>({
      id: `${prefix}-components`,
      data: graph.nodes,
      getPolygon: (d) => familyPolygon(d.bbox, nodeStyle(d).chamfer),
      extruded: true,
      wireframe: true,
      getElevation: (d) => componentHeight(d.bbox, nodeStyle(d).heightScale),
      getFillColor: (d) => tintFill(nodeStyle(d).rgb, dim),
      getLineColor: (d) =>
        selected ? [94, 234, 212, 220] : withAlpha(nodeStyle(d).rgb, dim ? 95 : 190),
      material: BLOCK_MATERIAL,
      modelMatrix: matrix,
      pickable: true,
      autoHighlight: !dim,
      highlightColor: [255, 255, 255, 36],
    }),
    new PolygonLayer<Mg3dGround>({
      id: `${prefix}-grounds`,
      data: graph.grounds,
      getPolygon: (d) => bboxPolygon(d.bbox),
      extruded: true,
      wireframe: true,
      getElevation: GROUND_H,
      getFillColor: dim ? [14, 30, 23, 255] : [18, 42, 31, 255],
      getLineColor: [74, 222, 128, dim ? 80 : 150],
      material: BLOCK_MATERIAL,
      modelMatrix: matrix,
      pickable: !dim,
    }),
    new PathLayer<Mg3dEdge>({
      id: `${prefix}-wires`,
      data: graph.edges,
      getPath: (d) => d.path.map((p) => toWorld(p.x, p.y, WIRE_Z)),
      getColor: (d) => withAlpha(NET_ROLE_RGB[classifyNet(d.label)], dim ? 110 : 235),
      getWidth: wireWidth,
      widthUnits: "common",
      widthMinPixels: dim ? 0.8 : 1.2,
      jointRounded: true,
      capRounded: true,
      modelMatrix: matrix,
      pickable: true,
    }),
    new TextLayer<Mg3dNode>({
      id: `${prefix}-component-labels`,
      data: graph.nodes,
      getText: (d) => d.label,
      getPosition: (d) =>
        toWorld(
          d.bbox.x + d.bbox.width / 2,
          d.bbox.y + d.bbox.height / 2,
          componentHeight(d.bbox, nodeStyle(d).heightScale) + 2
        ),
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      sizeUnits: "common",
      getSize: surfaceLabels ? 40 : 34,
      getColor: [241, 245, 249, dim ? 150 : 245],
      background: true,
      getBackgroundColor: (d) => nameplateColor(nodeStyle(d).rgb, dim),
      backgroundPadding: [6, 3],
      fontFamily: MONO_FONT,
      characterSet: "auto",
      billboard: !surfaceLabels,
      modelMatrix: matrix,
    }),
    new ScatterplotLayer<Mg3dContinuation>({
      id: `${prefix}-continuations`,
      data: graph.continuations,
      getPosition: (d) => toWorld(d.point.x, d.point.y, CHIP_Z),
      radiusUnits: "common",
      getRadius: 11,
      getFillColor: (d) => (d.target ? [236, 72, 153, dim ? 150 : 235] : [244, 63, 94, dim ? 80 : 120]),
      getLineColor: [236, 72, 153, dim ? 150 : 255],
      stroked: true,
      lineWidthMinPixels: 1,
      modelMatrix: matrix,
      pickable: !dim,
    }),
  ];

  if (!dim) {
    layers.push(
      new ScatterplotLayer<Mg3dPort>({
        id: `${prefix}-terminals`,
        data: graph.ports,
        getPosition: (d) => toWorld(d.point.x, d.point.y, TERM_Z),
        radiusUnits: "common",
        getRadius: 8,
        radiusMinPixels: 1.5,
        getFillColor: (d) => withAlpha(NET_ROLE_RGB[classifyNet(terminalNet(d.label))], 255),
        modelMatrix: matrix,
        pickable: true,
      }),
      new TextLayer<Mg3dEdge>({
        id: `${prefix}-wire-labels`,
        data: labeledEdges,
        getText: (d) => d.label,
        getPosition: (d) => {
          const mid = d.path[Math.floor(d.path.length / 2)];
          return toWorld(mid.x, mid.y, WIRE_LABEL_Z);
        },
        sizeUnits: "common",
        getSize: 22,
        getColor: (d) => withAlpha(NET_ROLE_RGB[classifyNet(d.label)], 255),
        background: true,
        getBackgroundColor: [10, 14, 22, 200],
        backgroundPadding: [4, 2],
        fontFamily: MONO_FONT,
        characterSet: "auto",
        modelMatrix: matrix,
        pickable: false,
      }),
      new TextLayer<Mg3dContinuation>({
        id: `${prefix}-continuation-refs`,
        data: graph.continuations,
        getText: (d) => d.rawRef,
        getPosition: (d) => toWorld(d.point.x, d.point.y, CHIP_Z),
        getPixelOffset: [14, -12],
        sizeUnits: "pixels",
        getSize: 13,
        getColor: [244, 114, 182, 235],
        background: true,
        getBackgroundColor: [10, 14, 22, 190],
        fontFamily: MONO_FONT,
        characterSet: "auto",
        modelMatrix: matrix,
      })
    );

    const markers = buildWallMarkers(graph);
    if (!surfaceLabels) {
      layers.push(
        new TextLayer<WallMarker>({
          id: `${prefix}-terminal-wall-markers`,
          data: markers,
          getText: (d) => d.text,
          getPosition: (d) => {
            const w = WALL_ROT[d.wall];
            return toWorld(d.point.x + w.nx * 10, d.point.y - w.ny * 10, d.z);
          },
          getColor: (d) => d.color,
          getSize: (d) => d.size,
          sizeUnits: "common",
          sizeMinPixels: 9,
          background: true,
          getBackgroundColor: [13, 18, 28, 230],
          backgroundPadding: [3, 2],
          fontFamily: MONO_FONT,
          characterSet: "auto",
          modelMatrix: matrix,
        })
      );
    } else {
      // Printed-on mode: one layer per wall orientation. The layer's model
      // matrix stands the glyph plane against that wall; positions are the
      // world rest positions pulled back through the inverse rotation.
      for (const wall of ["S", "N", "L", "R"]) {
        const w = WALL_ROT[wall];
        const data = markers.filter((m) => m.wall === wall);
        if (data.length === 0) continue;
        layers.push(
          new TextLayer<WallMarker>({
            id: `${prefix}-terminal-wall-markers-${wall}`,
            data,
            getText: (d) => d.text,
            getPosition: (d) => {
              const p = toWorld(d.point.x + w.nx * 2, d.point.y - w.ny * 2, d.z);
              return w.inv.transformAsPoint(p) as WorldPoint;
            },
            getColor: (d) => d.color,
            getSize: (d) => d.size,
            sizeUnits: "common",
            background: true,
            getBackgroundColor: [13, 18, 28, 230],
            backgroundPadding: [3, 2],
            fontFamily: MONO_FONT,
            characterSet: "auto",
            billboard: false,
            modelMatrix: new Matrix4(matrix).multiplyRight(w.rot),
          })
        );
      }
    }
  }

  if (caption) {
    layers.push(
      new TextLayer<{ text: string }>({
        id: `${prefix}-caption`,
        data: [{ text: caption.text }],
        getText: (d) => d.text,
        getPosition: () => toWorld(caption.bounds.minX, caption.bounds.maxY + 110, 0),
        getTextAnchor: "start",
        sizeUnits: "common",
        getSize: 44,
        getColor: selected ? [94, 234, 212, 235] : [100, 116, 139, 200],
        fontFamily: MONO_FONT,
        characterSet: "auto",
        modelMatrix: matrix,
      })
    );
  }

  return layers;
}

// The schematic's pose in the fixed world. Angles in degrees.
type Pose = { yaw: number; pitch: number; x: number; y: number; s: number };
const INITIAL_POSE: Pose = { yaw: -18, pitch: 0, x: 0, y: 0, s: 1 };

// Per-sheet user pose (assembly-space), on top of the initial layout: slide
// AND turn (Shane, 2026-07-11: with a page selected, the same controls that
// turn the whole assembly turn only that page — organize sheet by sheet).
type SheetPose = { x: number; yW: number; yaw: number; pitch: number };
const ZERO_SHEET_POSE: SheetPose = { x: 0, yW: 0, yaw: 0, pitch: 0 };

function pageFromLayerId(layerId: string | undefined, primaryPage: number): number | null {
  if (!layerId) return null;
  if (layerId.startsWith("mg3d-primary-")) return primaryPage;
  const m = layerId.match(/^mg3d-linked-(\d+)-/);
  return m ? Number(m[1]) : null;
}

export function MachineGraph3dScene({
  graph,
  sheetRef: _sheetRef,
  pageNum,
  surfaceLabels,
  linkedSheets,
  arcs,
}: {
  graph: Mg3dGraph;
  sheetRef: string | null;
  pageNum: number;
  surfaceLabels: boolean;
  linkedSheets: LinkedSheet[];
  arcs: ContArc[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<DeckGLRef>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [pose, setPose] = useState<Pose>(INITIAL_POSE);
  // Shane, 2026-07-11: "click each page and move it to where it connects" —
  // grabbing a sheet drags THAT sheet in the assembly plane; grabbing the
  // void rotates/pans the whole assembly.
  const [sheetPose, setSheetPose] = useState<Record<number, SheetPose>>({});
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const dragRef = useRef<{ px: number; py: number; pan: boolean; sheetPage: number | null } | null>(null);

  useEffect(() => {
    setSheetPose({});
    setSelectedPage(null);
  }, [pageNum]);

  // Assembly extent: primary sheet plus every linked sheet at its offset.
  const bounds = useMemo<Mg3dBounds>(() => {
    const b = { ...graphBounds(graph) };
    for (const sheet of linkedSheets) {
      const sb = graphBounds(sheet.graph);
      b.minX = Math.min(b.minX, sb.minX + sheet.offsetX);
      b.maxX = Math.max(b.maxX, sb.maxX + sheet.offsetX);
      b.minY = Math.min(b.minY, sb.minY);
      b.maxY = Math.max(b.maxY, sb.maxY);
    }
    return b;
  }, [graph, linkedSheets]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // FIXED camera: computed from the assembly extent, never changed by input.
  const camera = useMemo<OrbitViewState | null>(() => {
    if (!size || size.width <= 0 || size.height <= 0) return null;
    const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
    const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
    const fitted = Math.log2(1.05 * Math.min(size.width / boundsWidth, size.height / boundsHeight));
    return {
      target: [(bounds.minX + bounds.maxX) / 2, -(bounds.minY + bounds.maxY) / 2, 0],
      rotationX: 26,
      rotationOrbit: 0,
      zoom: fitted,
    };
  }, [bounds, size]);

  const worldPerPixel = camera ? 2 ** -camera.zoom : 1;

  // Object transform: rotate/scale about the assembly's center, then slide.
  const modelMatrix = useMemo(() => {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cyW = -(bounds.minY + bounds.maxY) / 2;
    return new Matrix4()
      .translate([pose.x, pose.y, 0])
      .translate([cx, cyW, 0])
      .rotateX(pose.pitch * DEG)
      .rotateZ(pose.yaw * DEG)
      .scale(pose.s)
      .translate([-cx, -cyW, 0]);
  }, [bounds, pose]);

  // --- input: the controls move the SCHEMATIC, never the viewer ------------

  // Screen drag -> assembly-space delta: undo the pose's rotation/scale so a
  // grabbed sheet tracks the cursor in its own plane.
  const poseLinearInv = useMemo(
    () =>
      new Matrix4()
        .rotateX(pose.pitch * DEG)
        .rotateZ(pose.yaw * DEG)
        .scale(pose.s)
        .invert(),
    [pose]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      let sheetPage: number | null = null;
      if (!e.shiftKey && e.button === 0 && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const info = deckRef.current?.pickObject?.({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          radius: 4,
        });
        sheetPage = pageFromLayerId(info?.layer?.id, pageNum);
        setSelectedPage(sheetPage);
      }
      dragRef.current = {
        px: e.clientX,
        py: e.clientY,
        pan: e.shiftKey || e.button !== 0,
        sheetPage,
      };
    },
    [pageNum]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.px;
      const dy = e.clientY - drag.py;
      drag.px = e.clientX;
      drag.py = e.clientY;
      if (drag.sheetPage != null && !drag.pan) {
        const v = poseLinearInv.transformAsPoint([dx * worldPerPixel, -dy * worldPerPixel, 0]) as number[];
        const page = drag.sheetPage;
        setSheetPose((s) => {
          const cur = s[page] ?? ZERO_SHEET_POSE;
          return { ...s, [page]: { ...cur, x: cur.x + v[0], yW: cur.yW + v[1] } };
        });
        return;
      }
      setPose((p) =>
        drag.pan
          ? { ...p, x: p.x + dx * worldPerPixel, y: p.y - dy * worldPerPixel }
          : {
              ...p,
              yaw: p.yaw + dx * 0.3,
              pitch: Math.max(-15, Math.min(70, p.pitch + dy * 0.3)),
            }
      );
    },
    [worldPerPixel, poseLinearInv]
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Wheel scales the schematic (native listener: React's is passive).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setPose((p) => ({ ...p, s: Math.max(0.2, Math.min(8, p.s * Math.exp(-e.deltaY * 0.0012))) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Arrows slide; Ctrl+arrows turn; 0 rests the pose. With a page SELECTED
  // the same controls act on that page alone (Shane's per-sheet organizing).
  useEffect(() => {
    const step = 80 * worldPerPixel;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "0"].includes(k)) return;
      e.preventDefault();
      if (selectedPage != null) {
        const page = selectedPage;
        setSheetPose((s) => {
          if (k === "0") {
            const { [page]: _drop, ...rest } = s;
            return rest;
          }
          const cur = s[page] ?? ZERO_SHEET_POSE;
          if (e.ctrlKey) {
            if (k === "ArrowLeft") return { ...s, [page]: { ...cur, yaw: cur.yaw - 4 } };
            if (k === "ArrowRight") return { ...s, [page]: { ...cur, yaw: cur.yaw + 4 } };
            if (k === "ArrowUp") return { ...s, [page]: { ...cur, pitch: Math.max(-85, cur.pitch - 4) } };
            return { ...s, [page]: { ...cur, pitch: Math.min(85, cur.pitch + 4) } };
          }
          if (k === "ArrowLeft") return { ...s, [page]: { ...cur, x: cur.x - step } };
          if (k === "ArrowRight") return { ...s, [page]: { ...cur, x: cur.x + step } };
          if (k === "ArrowUp") return { ...s, [page]: { ...cur, yW: cur.yW + step } };
          return { ...s, [page]: { ...cur, yW: cur.yW - step } };
        });
        return;
      }
      setPose((p) => {
        if (k === "0") return INITIAL_POSE;
        if (e.ctrlKey) {
          if (k === "ArrowLeft") return { ...p, yaw: p.yaw - 4 };
          if (k === "ArrowRight") return { ...p, yaw: p.yaw + 4 };
          if (k === "ArrowUp") return { ...p, pitch: Math.max(-15, p.pitch - 4) };
          return { ...p, pitch: Math.min(70, p.pitch + 4) };
        }
        if (k === "ArrowLeft") return { ...p, x: p.x - step };
        if (k === "ArrowRight") return { ...p, x: p.x + step };
        if (k === "ArrowUp") return { ...p, y: p.y + step };
        return { ...p, y: p.y - step };
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [worldPerPixel, selectedPage]);

  const view = useMemo(() => new OrbitView({ id: "mg3d-orbit", orthographic: false, fovy: 45 }), []);

  const layers = useMemo(() => {
    const graphOf = (page: number): Mg3dGraph | null =>
      page === pageNum ? graph : linkedSheets.find((s) => s.pageNum === page)?.graph ?? null;
    // Each page's local transform in assembly space: initial layout offset,
    // Shane's slide, and Shane's turn about the sheet's own center.
    const localOf = (page: number): Matrix4 => {
      const g = graphOf(page);
      const base = page === pageNum ? 0 : linkedSheets.find((s) => s.pageNum === page)?.offsetX ?? 0;
      const p = sheetPose[page] ?? ZERO_SHEET_POSE;
      const m = new Matrix4().translate([base + p.x, p.yW, 0]);
      if (g && (p.yaw !== 0 || p.pitch !== 0)) {
        const b = graphBounds(g);
        const cx = (b.minX + b.maxX) / 2;
        const cyW = -(b.minY + b.maxY) / 2;
        m.translate([cx, cyW, 0])
          .rotateX(p.pitch * DEG)
          .rotateZ(p.yaw * DEG)
          .translate([-cx, -cyW, 0]);
      }
      return m;
    };
    const locals = new Map<number, Matrix4>([[pageNum, localOf(pageNum)]]);
    for (const sheet of linkedSheets) locals.set(sheet.pageNum, localOf(sheet.pageNum));

    const out: Layer[] = sheetLayers({
      graph,
      prefix: "mg3d-primary",
      matrix: new Matrix4(modelMatrix).multiplyRight(locals.get(pageNum)!),
      dim: false,
      surfaceLabels,
      selected: selectedPage === pageNum,
      caption:
        linkedSheets.length > 0
          ? { text: `sheet ${_sheetRef ?? "?"} · page ${pageNum}`, bounds: graphBounds(graph) }
          : undefined,
    });
    for (const sheet of linkedSheets) {
      out.push(
        ...sheetLayers({
          graph: sheet.graph,
          prefix: `mg3d-linked-${sheet.pageNum}`,
          matrix: new Matrix4(modelMatrix).multiplyRight(locals.get(sheet.pageNum)!),
          dim: true,
          surfaceLabels,
          selected: selectedPage === sheet.pageNum,
          caption: {
            text: `sheet ${sheet.sheetRef ?? "?"} · page ${sheet.pageNum}`,
            bounds: graphBounds(sheet.graph),
          },
        })
      );
    }
    if (arcs.length > 0) {
      // Link wires route like a HARNESS (Shane, 2026-07-11: wires to the
      // same place travel together; none may cut through a page): each wire
      // escapes its sheet around that sheet's own blocks, then the GROUP
      // rides one spine through the void (whole sheets are obstacles),
      // members offset in parallel, fanning out at each end.
      const aabbOf = (g: Mg3dGraph, local: Matrix4, margin: number): Rect => {
        const b = graphBounds(g);
        const corners: WorldPoint[] = [
          toWorld(b.minX, b.minY),
          toWorld(b.maxX, b.minY),
          toWorld(b.maxX, b.maxY),
          toWorld(b.minX, b.maxY),
        ];
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const c of corners) {
          const t = local.transformAsPoint(c) as number[];
          if (t[0] < x0) x0 = t[0];
          if (t[0] > x1) x1 = t[0];
          if (t[1] < y0) y0 = t[1];
          if (t[1] > y1) y1 = t[1];
        }
        return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };
      };
      const pages = [pageNum, ...linkedSheets.map((s) => s.pageNum)];
      const sheetAabb = new Map<number, Rect>();
      for (const page of pages) {
        sheetAabb.set(page, aabbOf(graphOf(page)!, locals.get(page)!, 0));
      }
      const SHEET_CLEAR = 40; // whole sheets are no-fly zones for cross-links
      const sheetObstacles: Rect[] = pages.map((p) => {
        const r = sheetAabb.get(p)!;
        return { x0: r.x0 - SHEET_CLEAR, y0: r.y0 - SHEET_CLEAR, x1: r.x1 + SHEET_CLEAR, y1: r.y1 + SHEET_CLEAR };
      });
      // Bundle a group's conductors, then route each group as a rigid flat
      // RIBBON via the pure, tested mg3d-bundle module (Shane, 2026-07-11:
      // the ribbon holds the page's own spacing through every right-angle
      // turn and can never collapse — that logic lives in tests now, not
      // inline where the night's regressions kept hiding).
      type Member = ContArc & { sp: number[]; ep: number[] };
      const groups = new Map<string, Member[]>();
      for (const d of arcs) {
        const fromLocal = locals.get(d.fromPage);
        const toLocal = locals.get(d.toPage);
        if (!fromLocal || !toLocal) continue;
        const sp = fromLocal.transformAsPoint(toWorld(d.from.x, d.from.y, CHIP_Z)) as number[];
        const ep = toLocal.transformAsPoint(toWorld(d.to.x, d.to.y, CHIP_Z)) as number[];
        const key = `${d.fromPage}->${d.toPage}`;
        const list = groups.get(key) ?? [];
        list.push({ ...d, sp, ep });
        groups.set(key, list);
      }

      const linkPaths: Array<ContArc & { path: WorldPoint[] }> = [];
      for (const members of groups.values()) {
        const conductors: Conductor[] = members.map((m) => ({
          s: { x: m.sp[0], y: m.sp[1] },
          d: { x: m.ep[0], y: m.ep[1] },
        }));
        // cluster: chips within 120px at BOTH ends ride one ribbon (covers the
        // widest printed pitch seen ~40px with headroom); scattered chips are
        // hundreds of px apart and route as their own wires — the wedge guard.
        const rails = routeLinks(conductors, sheetObstacles, { launch: 90, cluster: 120 });
        members.forEach((m, i) => {
          const plan = rails[i];
          // plan starts at the chip's (x,y) and ends at the counterpart's; the
          // 3D chip points add a short vertical drop from chip level to the
          // trace plane at each end (a right angle for tilted sheets).
          const path: WorldPoint[] = [
            [m.sp[0], m.sp[1], m.sp[2]],
            ...plan.map((p): WorldPoint => [p.x, p.y, WIRE_Z]),
            [m.ep[0], m.ep[1], m.ep[2]],
          ];
          linkPaths.push({ ...m, path });
        });
      }
      // The extension IS the wire (Shane, 2026-07-11: "we're not changing
      // the schematic... all we're doing is extending them"): rendered
      // exactly like the in-sheet traces — same role color, same widths —
      // never a special "link" look.
      out.push(
        new PathLayer<ContArc & { path: WorldPoint[] }>({
          id: "mg3d-continuation-links",
          data: linkPaths,
          getPath: (d) => d.path,
          getColor: (d) => withAlpha(NET_ROLE_RGB[classifyNet(d.net)], 235),
          getWidth: (d) => {
            const role: string = classifyNet(d.net);
            return role === "phase" || role === "dc-rail" ? 5 : 3;
          },
          widthUnits: "common",
          widthMinPixels: 1.2,
          jointRounded: true,
          capRounded: true,
          modelMatrix,
          pickable: true,
        })
      );
    }
    return out;
  }, [graph, linkedSheets, arcs, modelMatrix, surfaceLabels, sheetPose, selectedPage, pageNum, _sheetRef]);

  const getTooltip = useCallback((info: PickingInfo) => {
    const layerId = info.layer?.id ?? "";
    const obj = info.object;
    if (!layerId || !obj) return null;
    if (layerId.endsWith("-components") || layerId.endsWith("-grounds")) {
      return { text: (obj as Mg3dNode | Mg3dGround).label, style: TOOLTIP_STYLE };
    }
    if (layerId.endsWith("-terminals")) {
      const port = obj as Mg3dPort;
      return { text: `${port.label} · ${classifyNet(terminalNet(port.label))}`, style: TOOLTIP_STYLE };
    }
    if (layerId.endsWith("-wires")) {
      const edge = obj as Mg3dEdge;
      return {
        text: `${edge.label || "unlabeled wire"} · ${classifyNet(edge.label)}`,
        style: TOOLTIP_STYLE,
      };
    }
    if (layerId.endsWith("-continuations")) {
      const cont = obj as Mg3dContinuation;
      return { text: `${cont.rawRef} · ${cont.target ? "linked" : "unanchored"}`, style: TOOLTIP_STYLE };
    }
    if (layerId === "mg3d-continuation-links") {
      const arc = obj as ContArc;
      return { text: `${arc.net} continues · ${arc.ref} → sheet ${arc.destSheet}`, style: TOOLTIP_STYLE };
    }
    return null;
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {camera && (
        <DeckGL
          ref={deckRef}
          views={view}
          viewState={camera}
          controller={false}
          layers={layers}
          effects={[LIGHTING]}
          getTooltip={getTooltip}
          style={{ position: "absolute", top: "0", left: "0", width: "100%", height: "100%", background: "transparent" }}
        />
      )}
    </div>
  );
}
