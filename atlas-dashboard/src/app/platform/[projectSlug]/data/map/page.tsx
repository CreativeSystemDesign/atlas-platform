"use client";

// The Data Map (né Relations, remodeled 2026-07-20) — the room where the
// digital twin's stitching gets ruled. Cards are REAL Neon tables derived
// live; drawn edges are ruled join contracts (the twin compiler's stitch
// instructions); the Proving Bench below is the QBE surface that proves a
// contract on sight before it becomes law.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { PT, PT_PANEL_FROST } from "@/lib/platform-theme";
import { ExperimentalV2CopilotPanel } from "@/components/experimental-v2/experimental-v2-copilot-panel";

import { useProject } from "../../layout";
import { DataMapBoard } from "./data-map-board";
import { DataMapTray } from "./data-map-tray";
import { CARD_W } from "./data-map-types";
import { ProvingBench } from "./proving-bench";
import { useDataMap } from "./use-data-map";

export default function DataMapScreen() {
  const project = useProject();
  const projectId = project?.project_id ?? null;
  const {
    sources, cards, relations, error, setError,
    boards, board, boardId, setBoardId, createBoard, deleteBoard,
    addCard, patchCard, removeCard,
    createRelation, patchRelation, deleteRelation, surveyRelation,
    benchPicks, benchResult, benchLoading, benchError, toggleBenchPick, clearBench,
    replaceBenchPicks, loadCards, loadRelations,
  } = useDataMap(projectId);

  const [showDismissed, setShowDismissed] = useState(false);
  const [namingBoard, setNamingBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [arcOpen, setArcOpen] = useState(true);

  // ---- tray drag-drop (Shane's ruling: the old tray, ported) --------------
  // Pointer-based: the tray row starts it, the ghost chip follows the
  // cursor, releasing over the board lands the card at the drop point.
  // A sub-threshold press stays a CLICK (cascade placement via onPlace).
  const boardPointRef = useRef<((cx: number, cy: number) => { x: number; y: number } | null) | null>(null);
  const [dragGhost, setDragGhost] = useState<{ name: string; x: number; y: number } | null>(null);
  const dragRef = useRef<{ name: string; startX: number; startY: number; active: boolean } | null>(null);
  const swallowClickRef = useRef(false);

  const startTrayDrag = useCallback((name: string, e: React.PointerEvent) => {
    dragRef.current = { name, startX: e.clientX, startY: e.clientY, active: false };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 5) return;
        d.active = true;
      }
      setDragGhost({ name: d.name, x: ev.clientX, y: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = dragRef.current;
      dragRef.current = null;
      setDragGhost(null);
      if (!d?.active) return; // plain click — the row's onClick handles it
      swallowClickRef.current = true; // the click after a real drag is noise
      window.setTimeout(() => { swallowClickRef.current = false; }, 0);
      const pt = boardPointRef.current?.(ev.clientX, ev.clientY);
      if (pt) void addCard(d.name, { x: Math.round(pt.x - CARD_W / 2), y: Math.round(pt.y - 20) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [addCard]);

  const placeByClick = useCallback((name: string) => {
    if (swallowClickRef.current) return;
    const n = cards?.length ?? 0;
    void addCard(name, { x: 60 + (n % 4) * (CARD_W + 52), y: 60 + Math.floor(n / 4) * 380 });
  }, [addCard, cards]);

  // Arc's toast — a transient cyan notice (its own state, not the error
  // chip; review 2026-07-20: a silently-dropped toast told Arc it landed)
  const [arcToast, setArcToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showArcToast = useCallback((text: string) => {
    setArcToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setArcToast(null), 4500);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  // Arc's seat (phase 2) — the SAME resident session as the canvas, seated
  // at the Data Map (per-turn binding). The seat context is a compact world
  // summary; data_map_overview carries the full detail on demand.
  const seat = useMemo(() => ({
    area: "data-map",
    context: () => ({
      project_id: projectId,
      board_id: boardId,
      board_name: board?.name ?? null,
      cards: (cards ?? []).map((c) => c.table_name),
      contracts: {
        drawn: (relations ?? []).filter((r) => r.status === "drawn").length,
        proposed: (relations ?? []).filter((r) => r.status === "proposed").length,
      },
      bench_picks: benchPicks,
    }),
    // Arc's bench_command down-channel. Commands are BOARD-STAMPED (review
    // 2026-07-20): one aimed at another board — or another seat's command
    // (document_bench stamps document_id, no board_id) — is ignored here.
    onCommand: (cmd: { action?: string; board_id?: string;
                       columns?: { table: string; column: string }[];
                       text?: string }) => {
      if (cmd?.board_id && cmd.board_id !== boardId) return;
      if (cmd?.action === "bench_pick" && Array.isArray(cmd.columns)) {
        replaceBenchPicks(cmd.columns);
      } else if (cmd?.action === "bench_clear") {
        clearBench();
      } else if (cmd?.action === "toast" && cmd.board_id && cmd.text) {
        showArcToast(cmd.text);
      } else if (cmd?.action === "map_refresh") {
        loadCards();
        loadRelations();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [projectId, boardId, board?.name, cards, relations, benchPicks,
       replaceBenchPicks, clearBench, showArcToast, loadCards, loadRelations]);

  // Bench height: default for BOTH server and first client render (they
  // MUST agree or hydration mismatches — the lazy-init lesson, Shane's
  // console 2026-07-18). The saved value is restored post-mount.
  const BENCH_KEY = "atlas.datamap.bench";
  const [benchHeight, setBenchHeight] = useState<number>(240);
  const benchHeightRef = useRef(benchHeight);
  useEffect(() => { benchHeightRef.current = benchHeight; }, [benchHeight]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BENCH_KEY);
      if (raw) { const s = JSON.parse(raw); if (typeof s.h === "number") setBenchHeight(s.h); }
    } catch { /* defaults */ }
  }, []);
  const startBenchDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startVal = benchHeightRef.current;
    const move = (ev: PointerEvent) => {
      setBenchHeight(Math.min(560, Math.max(96, startVal + (startY - ev.clientY))));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBenchHeight((prev) => {
        try { window.localStorage.setItem(BENCH_KEY, JSON.stringify({ h: prev })); } catch { /* session-only */ }
        return prev;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const submitNewBoard = useCallback(async () => {
    const name = newBoardName.trim();
    if (!name) return;
    const row = await createBoard(name);
    if (row) {
      setBoardId(row.board_id);
      setNamingBoard(false);
      setNewBoardName("");
    }
  }, [newBoardName, createBoard, setBoardId]);

  return (
    <div className="flex min-h-0 flex-col" style={{ height: "calc(100vh - 100px)" }}>
      {/* header strip: board switcher + toggles */}
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5"
           style={{ borderColor: PT.line, background: PT_PANEL_FROST }}>
        <span className="text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: PT.textFaint }}>
          board
        </span>
        <select
          value={boardId ?? ""}
          onChange={(e) => setBoardId(e.target.value)}
          className="cursor-pointer rounded-md border px-2 py-1 text-[11px] outline-none"
          style={{ borderColor: PT.lineStrong, background: "rgba(3,8,18,.6)", color: PT.text }}
        >
          {(boards ?? []).map((b) => (
            <option key={b.board_id} value={b.board_id}>
              {b.name}{b.is_default ? " (main)" : ""}
            </option>
          ))}
        </select>
        {!namingBoard ? (
          <button
            type="button"
            onClick={() => setNamingBoard(true)}
            className="flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold"
            style={{ borderColor: PT.lineStrong, color: PT.textDim, background: "transparent" }}
          >
            <Plus className="h-3 w-3" /> board
          </button>
        ) : (
          <input
            autoFocus
            value={newBoardName}
            onChange={(e) => setNewBoardName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitNewBoard();
              if (e.key === "Escape") { setNamingBoard(false); setNewBoardName(""); }
            }}
            onBlur={() => { if (!newBoardName.trim()) setNamingBoard(false); }}
            placeholder="new board name ⏎"
            className="w-[160px] rounded-md px-2 py-1 text-[11px] outline-none"
            style={{ background: PT.well, border: `1px solid ${PT.lineStrong}`, color: PT.text }}
          />
        )}
        {board && !board.is_default && (
          <button
            type="button"
            onClick={() => void deleteBoard(board.board_id)}
            className="flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold"
            style={{ borderColor: "rgba(248,113,113,.4)", color: "#f87171", background: "transparent" }}
            title="delete this board (its placements + contracts go with it; tables are untouched)"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
        <div className="min-w-0 flex-1" />
        {arcToast && (
          <span className="max-w-[380px] truncate rounded-md border px-2 py-0.5 text-[10px] font-semibold"
                style={{ borderColor: "rgba(34,211,238,.45)", color: PT.cyanText, background: "rgba(34,211,238,.07)" }}
                title={arcToast}>
            Arc: {arcToast}
          </span>
        )}
        {error && (
          <button
            type="button"
            onClick={() => setError(null)}
            className="max-w-[380px] cursor-pointer truncate rounded-md border px-2 py-0.5 text-[10px]"
            style={{ borderColor: "rgba(248,113,113,.45)", color: "#f87171", background: "rgba(248,113,113,.07)" }}
            title={`${error} — click to dismiss`}
          >
            {error}
          </button>
        )}
      </div>

      {/* tray LEFT (the old relations tray, ported — Shane's ruling), board
          CENTER, Arc RIGHT; the Proving Bench spans below. The board mounts
          only once the project + board are known, so its per-board
          localStorage view init never races hydration */}
      <div className="flex min-h-0 flex-1">
        <DataMapTray
          sources={sources}
          placedNames={new Set((cards ?? []).map((c) => c.table_name))}
          busy={cards === null}
          onPlace={placeByClick}
          onStartDrag={startTrayDrag}
          showDismissed={showDismissed}
          dismissedCount={(relations ?? []).filter((r) => r.status === "dismissed").length}
          onToggleDismissed={() => setShowDismissed((v) => !v)}
        />
        {projectId && boardId && cards !== null && relations !== null ? (
          <DataMapBoard
            key={boardId}
            projectId={projectId}
            cards={cards}
            sources={sources}
            relations={relations}
            benchPicks={benchPicks}
            patchCard={patchCard}
            removeCard={removeCard}
            addCard={addCard}
            createRelation={createRelation}
            patchRelation={patchRelation}
            deleteRelation={deleteRelation}
            surveyRelation={surveyRelation}
            onToggleBenchPick={toggleBenchPick}
            showDismissed={showDismissed}
            viewStorageKey={`atlas.datamap.view.${boardId}`}
            boardPointRef={boardPointRef}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center text-[11px]"
               style={{ color: PT.textMute }}>
            loading the map…
          </div>
        )}

        {arcOpen ? (
          <ExperimentalV2CopilotPanel
            open
            onClose={() => setArcOpen(false)}
            seat={seat}
            title="Arc · Data Map"
            composerPlaceholder="Ask Arc about the board, a seam, a survey…"
            kickoff={board ? `Data Map opened — board "${board.name}".` : undefined}
          />
        ) : (
          <button
            type="button"
            onClick={() => setArcOpen(true)}
            className="w-[26px] shrink-0 cursor-pointer border-0 text-[10px] font-bold uppercase tracking-[.14em]"
            style={{ background: "rgba(3,8,18,.55)", color: PT.cyanText, writingMode: "vertical-rl" }}
            title="Open Arc"
          >
            Arc
          </button>
        )}
      </div>

      <div
        onPointerDown={startBenchDrag}
        className="h-[5px] shrink-0 cursor-row-resize"
        style={{ background: PT.line }}
        title="drag to resize the Proving Bench"
      />
      <div className="shrink-0" style={{ height: benchHeight, background: "rgba(3,8,18,.5)" }}>
        <ProvingBench
          picks={benchPicks}
          result={benchResult}
          loading={benchLoading}
          error={benchError}
          cards={cards ?? []}
          onRemovePick={toggleBenchPick}
          onClear={clearBench}
        />
      </div>

      {/* the tray-drag ghost — follows the cursor; releasing over the board
          lands the card at the drop point */}
      {dragGhost && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border px-2 py-1 text-[10.5px] font-bold shadow-xl"
          style={{ left: dragGhost.x + 10, top: dragGhost.y + 8,
                   borderColor: PT.lineStrong, background: "rgba(6,12,24,.95)", color: PT.text }}
        >
          {dragGhost.name}
        </div>
      )}
    </div>
  );
}
