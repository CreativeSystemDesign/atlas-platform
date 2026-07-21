"use client";

// The board itself — pan/zoom plane, derived cards, contract edges, and the
// drawing gesture (drag from a column dot, drop on a column row, pick
// semantics). The Access Relationships window rebuilt over REAL tables,
// with live match badges. Right-click the background to place a table;
// click a column to put it on the Proving Bench below.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PT } from "@/lib/platform-theme";

import { DataMapCard } from "./data-map-card";
import { computeEdges, DataMapEdges } from "./data-map-edges";
import { DataMapInspector } from "./data-map-inspector";
import { FieldPeekPopover, type FieldPeek } from "./field-peek-popover";
import {
  CARD_W, fieldAnchor, kindColor, SEMANTICS_LABEL,
  type Card, type Relation, type Source,
} from "./data-map-types";

type View = { x: number; y: number; zoom: number };
type Draft = {
  from: { card: Card; field: string };
  cursor: { x: number; y: number };
  drop?: { card: Card; field: string };
};

export function DataMapBoard({
  projectId,
  cards,
  sources,
  relations,
  benchPicks,
  patchCard,
  removeCard,
  addCard,
  boardPointRef,
  createRelation,
  patchRelation,
  deleteRelation,
  surveyRelation,
  onToggleBenchPick,
  showDismissed,
  viewStorageKey,
}: {
  projectId: string | null;
  cards: Card[];
  /** null = not loaded (initial or unreachable) — the place menu must not
      read that as "everything is placed" (review 2026-07-20) */
  sources: Source[] | null;
  relations: Relation[];
  benchPicks: { table: string; column: string }[];
  patchCard: (tableName: string, patch: Partial<Pick<Card, "x" | "y" | "collapsed">>) => void;
  removeCard: (tableName: string) => void;
  /** right-click place (the create-schema popover's successor): put a real
      table on the board at the spot Shane pointed at */
  addCard: (tableName: string, pos: { x: number; y: number }) => void;
  createRelation: (draft: Pick<Relation, "from_table" | "from_field" |
    "to_table" | "to_field" | "semantics">) => Promise<Relation | null>;
  patchRelation: (id: string, patch: Partial<Pick<Relation, "semantics" | "status" | "notes">>) => void;
  deleteRelation: (id: string) => void;
  surveyRelation: (id: string) => void;
  onToggleBenchPick: (table: string, column: string) => void;
  showDismissed: boolean;
  /** localStorage key for pan/zoom — per board (the page remounts this
      component keyed by board; it mounts client-side only, after the
      project fetch, so the lazy init cannot desync hydration) */
  viewStorageKey: string;
  /** filled by the board for the tray's drag-drop: client coords -> board
      coords, or null when outside the board host (the page owns the drag) */
  boardPointRef?: React.MutableRefObject<((cx: number, cy: number) => { x: number; y: number } | null) | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => {
    try {
      const raw = window.localStorage.getItem(viewStorageKey);
      if (raw) return JSON.parse(raw);
    } catch { /* default */ }
    return { x: 60, y: 40, zoom: 1 };
  });
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
    try { window.localStorage.setItem(viewStorageKey, JSON.stringify(view)); } catch { /* fine */ }
  }, [view, viewStorageKey]);

  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  // right-click "place a table" popover — host-relative anchor for the UI,
  // board-space point for where the card will land
  const [placeMenu, setPlaceMenu] = useState<{
    hostX: number; hostY: number;
    board: { x: number; y: number };
  } | null>(null);
  const [placeFilter, setPlaceFilter] = useState("");

  // right-click a column row → preview its real values
  const [peek, setPeek] = useState<FieldPeek | null>(null);
  const openPeek = useCallback((card: Card, field: string, e: React.MouseEvent) => {
    if (!projectId) return;
    const rect = hostRef.current!.getBoundingClientRect();
    setDraft(null);
    setSelectedEdge(null);
    setPlaceMenu(null);
    setPeek({
      projectId,
      documentId: card.document_id,
      table: card.table_name,
      column: field,
      hostX: Math.min(e.clientX - rect.left + 6, rect.width - 244),
      hostY: Math.min(e.clientY - rect.top + 6, rect.height - 180),
    });
  }, [projectId]);

  // local drag state for cards (board-space); commit to Neon on release
  const [dragPos, setDragPos] = useState<Record<string, { x: number; y: number }>>({});
  const cardDrag = useRef<{ tableName: string; startBoard: { x: number; y: number };
    startPos: { x: number; y: number };
    lastPos?: { x: number; y: number } } | null>(null);
  const panDrag = useRef<{ startClient: { x: number; y: number }; startView: View } | null>(null);

  const collapsedNames = useMemo(() => {
    const s = new Set<string>();
    for (const c of cards) if (c.collapsed) s.add(c.table_name);
    return s;
  }, [cards]);

  const benchByTable = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const p of benchPicks) {
      if (!m.has(p.table)) m.set(p.table, new Set());
      m.get(p.table)!.add(p.column);
    }
    return m;
  }, [benchPicks]);

  const unplaced = useMemo(() => {
    if (sources === null) return null;
    const placed = new Set(cards.map((c) => c.table_name));
    const f = placeFilter.trim().toLowerCase();
    return sources
      .filter((s) => !placed.has(s.table_name))
      .filter((s) => !f || s.table_name.toLowerCase().includes(f));
  }, [sources, cards, placeFilter]);

  const posOf = useCallback((c: Card): { x: number; y: number } => {
    return dragPos[c.table_name] ?? { x: c.x, y: c.y };
  }, [dragPos]);

  const toBoard = useCallback((clientX: number, clientY: number) => {
    const rect = hostRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom };
  }, []);

  // tray drag-drop support: hand the page a client->board converter that
  // answers null outside the host, so a drop elsewhere is a no-op
  useEffect(() => {
    if (!boardPointRef) return;
    boardPointRef.current = (cx: number, cy: number) => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect || cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) return null;
      return toBoard(cx, cy);
    };
    return () => { boardPointRef.current = null; };
  }, [boardPointRef, toBoard]);

  // cards with live drag positions folded in, so edges track while dragging
  const cardsForEdges = useMemo(
    () => cards.map((c) => ({ ...c, pos: posOf(c) })),
    [cards, posOf]
  );
  const edges = useMemo(
    () => computeEdges(relations, cardsForEdges, collapsedNames, showDismissed),
    [relations, cardsForEdges, collapsedNames, showDismissed]
  );

  // ---- wheel zoom at cursor (native non-passive: preventDefault) ----------
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0012);
      setView((v) => {
        const zoom = Math.min(2.5, Math.max(0.25, v.zoom * factor));
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        const ratio = zoom / v.zoom;
        return { zoom, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- global pointer handlers for pan / card drag / ghost line ----------
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (panDrag.current) {
        const { startClient, startView } = panDrag.current;
        setView({ ...startView, x: startView.x + (e.clientX - startClient.x), y: startView.y + (e.clientY - startClient.y) });
        return;
      }
      if (cardDrag.current) {
        const { tableName, startBoard, startPos } = cardDrag.current;
        const b = toBoard(e.clientX, e.clientY);
        const next = {
          x: Math.round(startPos.x + b.x - startBoard.x),
          y: Math.round(startPos.y + b.y - startBoard.y),
        };
        // stashed on the ref so onUp can commit WITHOUT reading state from
        // inside a state updater (setState-in-render class, 2026-07-15)
        cardDrag.current.lastPos = next;
        setDragPos((p) => ({ ...p, [tableName]: next }));
        return;
      }
      if (draftRef.current) {
        // once a drop target is chosen the semantics picker is up — mouse
        // travel toward it must NOT clear the drop (Shane, 2026-07-15)
        if (draftRef.current.drop) return;
        const b = toBoard(e.clientX, e.clientY);
        setDraft((d) => (d ? { ...d, cursor: b, drop: undefined } : d));
      }
    };
    const onUp = () => {
      if (panDrag.current) panDrag.current = null;
      if (cardDrag.current) {
        const { tableName, lastPos } = cardDrag.current;
        cardDrag.current = null;
        if (lastPos) patchCard(tableName, { x: lastPos.x, y: lastPos.y });
        setDragPos((p) => {
          const { [tableName]: _done, ...rest } = p;
          return rest;
        });
      }
      // draft resolution happens in the column-row onPointerUp (capture drop
      // first); a release anywhere else cancels after a tick. The row-click
      // suppression clears here too, so a drag that ends off-card cannot
      // swallow the NEXT genuine column click.
      window.setTimeout(() => {
        if (draftRef.current && !draftRef.current.drop) setDraft(null);
        suppressRowClick.current = false;
      }, 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [patchCard, toBoard]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDraft(null);
      setSelectedEdge(null);
      setPlaceMenu(null);
      setPeek(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- drawing ------------------------------------------------------------
  // A dot gesture synthesizes a click on its parent column row when the
  // pointer releases in place — which would toggle the column onto the
  // bench as a side effect of drawing (review 2026-07-20). The ref
  // suppresses exactly the next row click after a dot pointerdown.
  const suppressRowClick = useRef(false);
  const startDraw = useCallback((card: Card, field: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    suppressRowClick.current = true;
    const b = toBoard(e.clientX, e.clientY);
    setDraft({ from: { card, field }, cursor: b });
  }, [toBoard]);

  const handleFieldClick = useCallback((table: string, field: string) => {
    if (suppressRowClick.current) {
      suppressRowClick.current = false;
      return;
    }
    onToggleBenchPick(table, field);
  }, [onToggleBenchPick]);

  const dropOnField = useCallback((card: Card, field: string) => {
    const d = draftRef.current;
    if (!d) return;
    if (d.from.card.table_name === card.table_name && d.from.field === field) {
      setDraft(null);
      return;
    }
    setDraft({ ...d, drop: { card, field } });
  }, []);

  const confirmDraw = useCallback(async (semantics: Relation["semantics"]) => {
    const d = draftRef.current;
    if (!d?.drop) return;
    setDraft(null);
    const row = await createRelation({
      from_table: d.from.card.table_name,
      from_field: d.from.field,
      to_table: d.drop.card.table_name,
      to_field: d.drop.field,
      semantics,
    });
    if (row) setSelectedEdge(row.relation_id);
  }, [createRelation]);

  const ghost = useMemo(() => {
    if (!draft) return null;
    const c = draft.from.card;
    const pos = dragPos[c.table_name] ?? { x: c.x, y: c.y };
    const idx = c.columns.indexOf(draft.from.field);
    if (idx === -1) return null;
    const side = draft.cursor.x >= pos.x + CARD_W / 2 ? "right" : "left";
    const a = fieldAnchor(pos, idx, collapsedNames.has(c.table_name), side);
    return { a, b: draft.cursor };
  }, [draft, dragPos, collapsedNames]);

  const selected = relations.find((r) => r.relation_id === selectedEdge) ?? null;

  return (
    <div
      ref={hostRef}
      className="relative min-w-0 flex-1 overflow-hidden"
      style={{
        background:
          "radial-gradient(1200px 600px at 30% 0%, rgba(34,211,238,.05), transparent), " +
          "radial-gradient(circle, rgba(148,163,184,.13) 1px, transparent 1px)",
        backgroundSize: "auto, 28px 28px",
        cursor: panDrag.current ? "grabbing" : "default",
      }}
      onPointerDown={(e) => {
        // left button only — a right-click must never arm the pan (2026-07-15)
        if (e.button !== 0) return;
        if (e.target !== e.currentTarget
            && (e.target as HTMLElement).closest("[data-card],[data-board-menu]")) return;
        panDrag.current = { startClient: { x: e.clientX, y: e.clientY }, startView: viewRef.current };
        setSelectedEdge(null);
        setPlaceMenu(null);
        setPeek(null);
      }}
      onContextMenu={(e) => {
        // background right-click = place a table HERE; cards keep the browser
        // menu off their column rows (peek) but the board owns its own.
        if ((e.target as HTMLElement).closest("[data-card],[data-board-menu]")) return;
        e.preventDefault();
        const rect = hostRef.current!.getBoundingClientRect();
        setDraft(null);
        setSelectedEdge(null);
        setPeek(null);
        setPlaceFilter("");
        setPlaceMenu({
          hostX: Math.min(e.clientX - rect.left, rect.width - 300),
          hostY: Math.min(e.clientY - rect.top, rect.height - 320),
          board: toBoard(e.clientX, e.clientY),
        });
      }}
    >
      {/* placement lives in the LEFT TRAY now (Shane's ruling 2026-07-20 —
          the old relations tray's design, ported); right-click keeps the
          in-place picker as the power path */}
      <div
        className="absolute left-0 top-0"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: "0 0" }}
      >
        <DataMapEdges edges={edges} selectedId={selectedEdge} onSelect={setSelectedEdge} ghost={ghost} />
        {cards.map((c) => {
          const pos = posOf(c);
          return (
            <div key={c.table_name} data-card>
              <DataMapCard
                card={c}
                pos={pos}
                collapsed={collapsedNames.has(c.table_name)}
                highlightField={draft?.drop?.card.table_name === c.table_name ? draft.drop.field : null}
                benchPicked={benchByTable.get(c.table_name) ?? new Set()}
                onHeaderPointerDown={(e) => {
                  e.preventDefault();
                  const b = toBoard(e.clientX, e.clientY);
                  cardDrag.current = { tableName: c.table_name, startBoard: b, startPos: pos };
                }}
                onToggleCollapse={() => patchCard(c.table_name, { collapsed: !c.collapsed })}
                onRemove={() => removeCard(c.table_name)}
                onFieldDotDown={(field, _side, e) => startDraw(c, field, e)}
                onFieldDrop={(field) => dropOnField(c, field)}
                onFieldClick={(field) => handleFieldClick(c.table_name, field)}
                onFieldContextMenu={(field, e) => openPeek(c, field, e)}
              />
            </div>
          );
        })}
      </div>

      {/* semantics quick-pick when a draft has a drop target */}
      {draft?.drop && (
        <div
          className="absolute z-40 rounded-xl border p-2 shadow-2xl backdrop-blur-xl"
          style={{
            left: Math.min(draft.cursor.x * view.zoom + view.x + 12, (hostRef.current?.clientWidth ?? 600) - 300),
            top: Math.min(draft.cursor.y * view.zoom + view.y + 12, (hostRef.current?.clientHeight ?? 400) - 140),
            borderColor: PT.lineStrong, background: "rgba(6,12,24,.96)",
          }}
        >
          <div className="mb-1 text-[9px] font-bold uppercase tracking-[.12em]" style={{ color: PT.textFaint }}>
            how do these values match?
          </div>
          {(Object.keys(SEMANTICS_LABEL) as Relation["semantics"][]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void confirmDraw(s)}
              className="mb-1 block w-full cursor-pointer rounded-md border px-2 py-1 text-left text-[10.5px]"
              style={{ borderColor: PT.lineStrong, color: PT.text, background: "transparent" }}
            >
              {SEMANTICS_LABEL[s]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="block w-full cursor-pointer rounded-md border-0 bg-transparent px-2 py-0.5 text-left text-[9.5px]"
            style={{ color: PT.textGhost }}
          >
            cancel (Esc)
          </button>
        </div>
      )}

      {/* right-click: place a real table where Shane pointed */}
      {placeMenu && (
        <div
          data-board-menu
          className="absolute z-40 w-[280px] rounded-xl border p-1.5 shadow-2xl backdrop-blur-xl"
          style={{
            left: Math.max(8, placeMenu.hostX),
            top: Math.max(8, placeMenu.hostY),
            borderColor: PT.lineStrong, background: "rgba(6,12,24,.96)",
          }}
        >
          <div className="px-1.5 pb-1 pt-0.5 text-[9px] font-bold uppercase tracking-[.12em]"
               style={{ color: PT.textFaint }}>
            place a table here
          </div>
          <input
            autoFocus
            value={placeFilter}
            onChange={(e) => setPlaceFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.stopPropagation(); setPlaceMenu(null); }
              if (e.key === "Enter" && unplaced?.length === 1) {
                addCard(unplaced[0].table_name, placeMenu.board);
                setPlaceMenu(null);
              }
            }}
            placeholder="filter tables…"
            className="mb-1 w-full rounded-md px-2 py-1 text-[11px] outline-none"
            style={{ background: PT.well, border: `1px solid ${PT.lineStrong}`, color: PT.text }}
          />
          <div className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto">
            {unplaced === null && (
              <div className="px-1.5 py-1 text-[10px]" style={{ color: "#fbbf24" }}>
                table list not loaded — backend unreachable or still starting
              </div>
            )}
            {unplaced?.length === 0 && (
              <div className="px-1.5 py-1 text-[10px]" style={{ color: PT.textMute }}>
                every matching table is already on the board
              </div>
            )}
            {(unplaced ?? []).map((s) => (
              <button
                key={s.table_name}
                type="button"
                onClick={() => {
                  addCard(s.table_name, placeMenu.board);
                  setPlaceMenu(null);
                }}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-left"
                title={`${s.columns.length} columns · ${s.row_count} rows`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: kindColor(s.kind) }} />
                <span className="min-w-0 flex-1 truncate text-[10.5px]" style={{ color: PT.text }}>
                  {s.table_name}
                </span>
                <span className="shrink-0 text-[8.5px]" style={{ color: PT.textGhost }}>
                  {s.row_count >= 10000 ? `${Math.round(s.row_count / 1000)}k` : s.row_count}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {peek && <FieldPeekPopover peek={peek} onClose={() => setPeek(null)} />}

      {selected && (
        <DataMapInspector
          key={selected.relation_id} // remount per selection — notes state must never leak across edges
          relation={selected}
          onPatch={(patch) => patchRelation(selected.relation_id, patch)}
          onDelete={() => { deleteRelation(selected.relation_id); setSelectedEdge(null); }}
          onSurvey={() => surveyRelation(selected.relation_id)}
          onClose={() => setSelectedEdge(null)}
        />
      )}

      {cards.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center text-[12px]" style={{ color: PT.textMute }}>
            The board is empty — right-click anywhere to place a table.<br />
            <span className="text-[10.5px]" style={{ color: PT.textGhost }}>
              Cards are your real Neon tables, live. Drag between column dots to draw a join;
              click a column to prove it on the bench below.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
