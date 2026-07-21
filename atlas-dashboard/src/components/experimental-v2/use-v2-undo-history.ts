"use client";

// Per-page persistent undo history (v4 port). The rail tooltips have promised
// "history is per page" and reload-survival since the mockup — this makes the
// promise true. Keyed by the same storage key as the offline graph cache, so
// history follows the (document, page) identity everywhere.
//
// Semantics preserved exactly from the screen's original stacks: push snapshots
// the pre-mutation graph and clears redo; undo/redo shuttle between stacks.
// Persistence is write-through from the event handlers (never effects), capped
// to a bounded window so localStorage stays comfortable; quota failures degrade
// gracefully to in-memory-only history.

import { useCallback, useState } from "react";
import { type V2Graph } from "./experimental-v2-types";

const MAX_ENTRIES = 12; // deep enough to recover, bounded enough to persist

type Stacks = { undo: V2Graph[]; redo: V2Graph[] };

function storageKeyFor(base: string) {
  return `${base}:history`;
}

function load(base: string): Stacks {
  if (typeof window === "undefined") return { undo: [], redo: [] };
  try {
    const raw = window.localStorage.getItem(storageKeyFor(base));
    if (!raw) return { undo: [], redo: [] };
    const parsed = JSON.parse(raw);
    return {
      undo: Array.isArray(parsed?.undo) ? parsed.undo : [],
      redo: Array.isArray(parsed?.redo) ? parsed.redo : [],
    };
  } catch {
    return { undo: [], redo: [] };
  }
}

function save(base: string, stacks: Stacks) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKeyFor(base), JSON.stringify(stacks));
  } catch {
    // Quota / storage disabled: history lives on in memory for this session.
    // Trim the persisted copy so a later, smaller write can succeed.
    try {
      window.localStorage.removeItem(storageKeyFor(base));
    } catch {
      /* nothing left to do */
    }
  }
}

const cap = (arr: V2Graph[]) => (arr.length > MAX_ENTRIES ? arr.slice(arr.length - MAX_ENTRIES) : arr);

export function useV2UndoHistory(storageKey: string) {
  const [stacks, setStacks] = useState<Stacks>(() => load(storageKey));
  // Page/document switch: reload that page's own history (derived-state-during-
  // render — the React Compiler-sanctioned replacement for setState-in-effect).
  const [prevKey, setPrevKey] = useState(storageKey);
  if (storageKey !== prevKey) {
    setPrevKey(storageKey);
    setStacks(load(storageKey));
  }

  /** Snapshot the pre-mutation graph; a new change always clears redo. */
  const push = useCallback((graph: V2Graph) => {
    const next = { undo: cap([...stacks.undo, JSON.parse(JSON.stringify(graph)) as V2Graph]), redo: [] };
    setStacks(next);
    save(storageKey, next);
  }, [stacks, storageKey]);

  /** Returns the graph to restore, or null when history is empty. */
  const undo = useCallback((currentGraph: V2Graph): V2Graph | null => {
    if (stacks.undo.length === 0) return null;
    const restored = stacks.undo[stacks.undo.length - 1];
    const next = { undo: stacks.undo.slice(0, -1), redo: cap([...stacks.redo, currentGraph]) };
    setStacks(next);
    save(storageKey, next);
    return restored;
  }, [stacks, storageKey]);

  /** Returns the graph to restore, or null when nothing was undone. */
  const redo = useCallback((currentGraph: V2Graph): V2Graph | null => {
    if (stacks.redo.length === 0) return null;
    const restored = stacks.redo[stacks.redo.length - 1];
    const next = { undo: cap([...stacks.undo, currentGraph]), redo: stacks.redo.slice(0, -1) };
    setStacks(next);
    save(storageKey, next);
    return restored;
  }, [stacks, storageKey]);

  return { push, undo, redo, canUndo: stacks.undo.length > 0, canRedo: stacks.redo.length > 0 };
}
