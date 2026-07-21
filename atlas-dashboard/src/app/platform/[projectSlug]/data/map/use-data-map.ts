"use client";

// Data Map data hook — boards, derived cards (live from the catalog),
// contracts (the edges), the source picker, and the Proving Bench preview.
// Cards store no schema: what this hook returns IS the database's word on
// columns/rows/status, plus the human overlay (position, prose).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { agentBaseUrl } from "@/lib/agent-base-url";

import type { BenchPick, BenchResult, Board, Card, Relation, Source } from "./data-map-types";

const BOARD_KEY = (projectId: string) => `atlas.datamap.board.${projectId}`;

export function useDataMap(projectId: string | null) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [relations, setRelations] = useState<Relation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Proving Bench state — declared up here because the board-switch effect
  // below clears the picks (state must exist before its first reference).
  const [benchPicks, setBenchPicks] = useState<BenchPick[]>([]);
  const [benchResult, setBenchResult] = useState<BenchResult | null>(null);
  const [benchLoading, setBenchLoading] = useState(false);
  const [benchError, setBenchError] = useState<string | null>(null);
  const benchSeq = useRef(0);

  const base = projectId ? `${agentBaseUrl()}/projects/${projectId}` : null;

  const loadSources = useCallback(() => {
    if (!base) return;
    fetch(`${base}/data-map/sources`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setSources(d.sources ?? []))
      // sources stay null on failure — the place-menu distinguishes
      // "loading/unreachable" from "everything is already placed"
      .catch(() => {
        setSources((prev) => prev ?? null);
        setError("backend unreachable — table list unavailable until it returns");
      });
  }, [base]);

  const loadCards = useCallback((board?: string | null) => {
    if (!base) return;
    const b = board ?? boardId;
    if (!b) return;
    fetch(`${base}/data-map/cards?board_id=${b}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setCards(d.cards ?? []))
      // a transient poll failure must NOT empty the board — cards would
      // unmount and drop drag state; keep the last known world
      .catch(() => setCards((prev) => prev ?? []));
  }, [base, boardId]);

  const loadBoards = useCallback(async (): Promise<void> => {
    if (!base) return;
    try {
      const r = await fetch(`${base}/boards`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      const list: Board[] = d.boards ?? [];
      setBoards(list);
      setBoardId((cur) => {
        if (cur && list.some((b) => b.board_id === cur)) return cur;
        let remembered: string | null = null;
        try { remembered = window.localStorage.getItem(BOARD_KEY(projectId!)); } catch { /* fine */ }
        if (remembered && list.some((b) => b.board_id === remembered)) return remembered;
        return d.default_board_id ?? list[0]?.board_id ?? null;
      });
    } catch {
      setBoards((prev) => prev ?? []);
      setError("backend unreachable — the board is read-only until it returns");
    }
  }, [base, projectId]);

  const loadRelations = useCallback((board?: string | null) => {
    if (!base) return;
    const b = board ?? boardId;
    if (!b) return;
    fetch(`${base}/relations?board_id=${b}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRelations(d.relations ?? []))
      .catch(() => {
        setRelations((prev) => prev ?? []);
        setError("backend unreachable — the board is read-only until it returns");
      });
  }, [base, boardId]);

  useEffect(() => {
    if (!base) return;
    loadSources();
    void loadBoards();
  }, [base, loadSources, loadBoards]);

  // Board switch (including the initial pick): remember it, load its world.
  // The bench clears too — picks reference the OLD board's cards, and a
  // stale preview under a new board's headers is a silent lie (review
  // 2026-07-20).
  useEffect(() => {
    if (!boardId || !projectId) return;
    try { window.localStorage.setItem(BOARD_KEY(projectId), boardId); } catch { /* fine */ }
    setCards(null);
    setRelations(null);
    setBenchPicks([]);
    loadCards(boardId);
    loadRelations(boardId);
  }, [boardId, projectId, loadCards, loadRelations]);

  const board = useMemo(
    () => (boards ?? []).find((b) => b.board_id === boardId) ?? null,
    [boards, boardId]);

  // ---- boards --------------------------------------------------------------

  const createBoard = useCallback(async (name: string): Promise<Board | null> => {
    if (!base) return null;
    try {
      const res = await fetch(`${base}/boards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body?.detail === "string" ? body.detail : `create failed (HTTP ${res.status})`);
        return null;
      }
      const row: Board = await res.json();
      setBoards((prev) => [...(prev ?? []), row]);
      return row;
    } catch {
      setError("backend unreachable");
      return null;
    }
  }, [base]);

  const deleteBoard = useCallback(async (id: string) => {
    if (!base) return;
    try {
      const res = await fetch(`${base}/boards/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body?.detail === "string" ? body.detail : `delete failed (HTTP ${res.status})`);
        return;
      }
      setBoards((prev) => {
        const rest = (prev ?? []).filter((b) => b.board_id !== id);
        setBoardId((cur) => (cur === id
          ? (rest.find((b) => b.is_default)?.board_id ?? rest[0]?.board_id ?? null)
          : cur));
        return rest;
      });
    } catch {
      setError("backend unreachable");
    }
  }, [base]);

  // ---- cards (placements of real tables) -----------------------------------

  const addCard = useCallback(async (tableName: string, pos: { x: number; y: number }) => {
    if (!base || !boardId) return;
    try {
      const res = await fetch(`${base}/data-map/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board_id: boardId, table_name: tableName, x: pos.x, y: pos.y }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body?.detail === "string" ? body.detail : `add failed (HTTP ${res.status})`);
        return;
      }
      loadCards();
    } catch {
      setError("backend unreachable");
    }
  }, [base, boardId, loadCards]);

  // optimistic, but never silently divergent: a failed write rolls the card
  // back and says so (review 2026-07-14).
  const patchCard = useCallback(
    (tableName: string, patch: Partial<Pick<Card, "x" | "y" | "collapsed" | "description" | "provenance">>) => {
      if (!base || !boardId) return;
      const previous = (cards ?? []).find((c) => c.table_name === tableName) ?? null;
      setCards((prev) => prev?.map((c) =>
        c.table_name === tableName ? { ...c, ...patch } : c) ?? prev);
      void fetch(`${base}/data-map/cards/${encodeURIComponent(tableName)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board_id: boardId, ...patch }),
      })
        .then((res) => { if (!res.ok) throw new Error(String(res.status)); })
        .catch(() => {
          setCards((prev) => prev?.map((c) =>
            c.table_name === tableName && previous ? previous : c) ?? prev);
          setError("card change didn't save — backend unreachable; rolled back");
        });
    },
    [base, boardId, cards]
  );

  // optimistic removal, but an HTTP failure restores from the backend —
  // fetch resolves on 4xx/5xx, so res.ok must be checked (review 2026-07-20)
  const removeCard = useCallback(async (tableName: string) => {
    if (!base || !boardId) return;
    setCards((prev) => prev?.filter((c) => c.table_name !== tableName) ?? prev);
    await fetch(`${base}/data-map/cards/${encodeURIComponent(tableName)}?board_id=${boardId}`,
      { method: "DELETE" })
      .then((res) => { if (!res.ok && res.status !== 404) throw new Error(String(res.status)); })
      .catch(() => {
        loadCards();
        setError("card removal didn't save — restored from the backend");
      });
  }, [base, boardId, loadCards]);

  // ---- relations (contracts, scoped to the current board) ------------------

  const createRelation = useCallback(
    async (draft: Pick<Relation, "from_table" | "from_field" |
      "to_table" | "to_field" | "semantics">): Promise<Relation | null> => {
      if (!base || !boardId) return null;
      try {
        const res = await fetch(`${base}/relations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...draft, board_id: boardId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(typeof body?.detail === "string" ? body.detail : `draw failed (HTTP ${res.status})`);
          return null;
        }
        const row: Relation = await res.json();
        setRelations((prev) => [...(prev ?? []), row]);
        return row;
      } catch {
        setError("backend unreachable");
        return null;
      }
    },
    [base, boardId]
  );

  const patchRelation = useCallback(
    async (relation_id: string, patch: Partial<Pick<Relation, "semantics" | "status" | "notes">>) => {
      if (!base) return;
      try {
        const res = await fetch(`${base}/relations/${relation_id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) return;
        const row: Relation = await res.json();
        setRelations((prev) => prev?.map((r) => (r.relation_id === relation_id ? row : r)) ?? prev);
      } catch { /* stays stale until reload */ }
    },
    [base]
  );

  const deleteRelation = useCallback(
    async (relation_id: string) => {
      if (!base) return;
      setRelations((prev) => prev?.filter((r) => r.relation_id !== relation_id) ?? prev);
      await fetch(`${base}/relations/${relation_id}`, { method: "DELETE" })
        .then((res) => { if (!res.ok && res.status !== 404) throw new Error(String(res.status)); })
        .catch(() => {
          loadRelations();
          setError("contract deletion didn't save — restored from the backend");
        });
    },
    [base, loadRelations]
  );

  const surveyRelation = useCallback(
    async (relation_id: string) => {
      if (!base) return;
      try {
        const res = await fetch(`${base}/relations/${relation_id}/survey`, { method: "POST" });
        if (!res.ok) return;
        const row: Relation = await res.json();
        setRelations((prev) => prev?.map((r) => (r.relation_id === relation_id ? row : r)) ?? prev);
      } catch { /* badge stays stale */ }
    },
    [base]
  );

  // ---- the Proving Bench ---------------------------------------------------

  const toggleBenchPick = useCallback((table: string, column: string) => {
    let capped = false;
    setBenchPicks((prev) => {
      const idx = prev.findIndex((p) => p.table === table && p.column === column);
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      if (prev.length >= 24) { capped = true; return prev; } // backend cap
      return [...prev, { table, column }];
    });
    // the cap must never be a silent no-op (review 2026-07-20)
    if (capped) setError("the bench is full — 24 columns max; remove a pick to add another");
  }, []);

  const clearBench = useCallback(() => setBenchPicks([]), []);

  // Arc's bench_pick command REPLACES the picks — "show, don't describe":
  // the seat drops evidence columns onto Shane's bench in one move.
  // Deduped: duplicate picks would collide as React keys on the bench.
  const replaceBenchPicks = useCallback((cols: BenchPick[]) => {
    const seen = new Set<string>();
    const out: BenchPick[] = [];
    for (const c of cols) {
      const k = `${c.table}.${c.column}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ table: c.table, column: c.column });
      if (out.length >= 24) break;
    }
    setBenchPicks(out);
  }, []);

  // Debounced live preview: picks or contracts change -> restitch. The
  // drawn-relations fingerprint makes "draw the join, watch the column
  // flood" happen without any explicit refresh.
  const drawnFingerprint = useMemo(
    () => (relations ?? [])
      .filter((r) => r.status === "drawn")
      .map((r) => `${r.from_table}.${r.from_field}>${r.to_table}.${r.to_field}:${r.semantics}`)
      .sort()
      .join("|"),
    [relations]);

  useEffect(() => {
    if (!base || !boardId || benchPicks.length === 0) {
      // bump the seq so an in-flight response for the PREVIOUS picks can't
      // land under an empty bench and resurrect stale rows (review 2026-07-20)
      benchSeq.current += 1;
      setBenchResult(null);
      setBenchLoading(false);
      setBenchError(null);
      return;
    }
    const seq = ++benchSeq.current;
    setBenchLoading(true);
    const t = window.setTimeout(() => {
      fetch(`${base}/data-map/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board_id: boardId, columns: benchPicks, limit: 100 }),
      })
        .then(async (r) => {
          if (r.ok) return r.json();
          // surface the backend's detail — a stale pick or a timed-out join
          // must say so, never render a dead-silent bench (review 2026-07-20)
          const body = await r.json().catch(() => ({}));
          throw new Error(typeof body?.detail === "string"
            ? body.detail : `preview failed (HTTP ${r.status})`);
        })
        .then((d: BenchResult) => {
          if (benchSeq.current === seq) {
            setBenchResult(d); setBenchLoading(false); setBenchError(null);
          }
        })
        .catch((e: Error) => {
          if (benchSeq.current === seq) {
            setBenchResult(null); setBenchLoading(false);
            setBenchError(e?.message || "preview failed — backend unreachable");
          }
        });
    }, 350);
    return () => window.clearTimeout(t);
  }, [base, boardId, benchPicks, drawnFingerprint]);

  return {
    sources, cards, relations, error, setError,
    boards, board, boardId, setBoardId, createBoard, deleteBoard,
    addCard, patchCard, removeCard,
    createRelation, patchRelation, deleteRelation, surveyRelation,
    loadCards, loadRelations, loadSources,
    benchPicks, benchResult, benchLoading, benchError, toggleBenchPick, clearBench,
    replaceBenchPicks,
  };
}
