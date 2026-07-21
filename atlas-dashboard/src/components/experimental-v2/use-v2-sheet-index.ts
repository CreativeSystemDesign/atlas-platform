"use client";

// The canonical per-page record (schematic_sheet_index) — the single door for
// a page's identity (Shane's directive, 2026-07-08). Titles come from each
// page's own PDF vector title block (primary) with the drawing's table of
// contents as fallback. The whole index is small (one row per sheet) and
// rarely changes, so we fetch it ONCE, cache in-module + localStorage for
// offline use, and derive both the header title and the ⌘K jump corpus from it.

import { useEffect, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { DOCUMENT_ID } from "../extraction-workbench/studio-types";

export type SheetRecord = {
  pageNum: number;
  title: { en: string | null; ja: string | null };
  section: string | null;
  sheetRef: string | null;
  drawingNumber: string | null;
  scale: number | null;
  pdfWidth: number | null;
  pdfHeight: number | null;
  titleSource: string;
};

export type SheetIndex = {
  byPage: Map<number, SheetRecord>;
  list: SheetRecord[];
};

const CACHE_KEY = `atlas.v2.sheetIndex.${DOCUMENT_ID}`;
let memo: SheetIndex | null = null;
let inflight: Promise<SheetIndex | null> | null = null;

function sheetsUrl(): string {
  return `${agentBaseUrl()}/workbench/documents/${DOCUMENT_ID}/sheets`;
}

function toIndex(list: SheetRecord[]): SheetIndex {
  return { list, byPage: new Map(list.map((s) => [s.pageNum, s])) };
}

function loadDisk(): SheetIndex | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SheetRecord[];
    if (!Array.isArray(parsed)) return null;
    return toIndex(parsed);
  } catch {
    return null;
  }
}

function saveDisk(list: SheetRecord[]): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode — offline cache is best-effort */
  }
}

async function fetchSheetIndex(): Promise<SheetIndex | null> {
  if (memo) return memo;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(sheetsUrl());
      if (!res.ok) throw new Error(`sheets ${res.status}`);
      const json = (await res.json()) as { sheets?: SheetRecord[] };
      const list = Array.isArray(json.sheets) ? json.sheets : [];
      if (list.length === 0) throw new Error("empty sheet index");
      memo = toIndex(list);
      saveDisk(list);
      return memo;
    } catch {
      const disk = loadDisk(); // offline fallback
      if (disk) memo = disk;
      return disk;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Sheet title for one page, from the canonical record. `en` is the display
 *  title; falls back to ja, then to a plain "Page N". */
export function sheetTitleOf(rec: SheetRecord | undefined): string {
  if (!rec) return "";
  return (rec.title.en || rec.title.ja || "").trim();
}

export function useV2SheetIndex(): SheetIndex | null {
  const [index, setIndex] = useState<SheetIndex | null>(memo);
  useEffect(() => {
    // Memo hit is already served by the lazy useState init; fetchSheetIndex
    // resolves instantly from memo otherwise, so setIndex only ever runs
    // async in the .then — never synchronously in the effect body.
    let cancelled = false;
    fetchSheetIndex().then((idx) => {
      if (!cancelled) setIndex(idx);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return index;
}
