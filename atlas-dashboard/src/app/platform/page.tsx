"use client";

// Atlas-Platform Overview — the honest-gap surface (Overview Data Contract).
// Law: every figure is a LIVE feed (named source) or a NAMED PENDING feed
// rendered as a first-class gap chip — never a fake zero, never asserted
// completeness. Offline (R17): the last-fetched fleet snapshot is cached
// user-keyed and NEVER renders without its age under a visible banner.

import { useEffect, useState } from "react";
import Link from "next/link";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { PT, PT_PANEL_FROST, PT_STATUS } from "@/lib/platform-theme";

type FleetDoc = { document_id: string; pages_indexed: number; pages_sealed: number; last_sealed_at: string | null };
type FleetProject = {
  project_id: string; machine_id: string; display_name: string; slug: string; status: string;
  documents_total: number; pages_indexed: number; pages_sealed: number;
  pages_canvas_routed: number | null;
  last_sealed_at: string | null; documents: FleetDoc[];
};

const SNAPSHOT_KEY = "atlas.platform.fleetSnapshot";

function Chip({ kind, children }: { kind: keyof typeof PT_STATUS; children: React.ReactNode }) {
  const s = PT_STATUS[kind];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-semibold tracking-[.02em]"
      style={{ color: s.fg, background: s.bg }}
    >
      {children}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-2xl border p-5 backdrop-blur-2xl"
      style={{ borderColor: PT.line, background: PT_PANEL_FROST, boxShadow: "rgba(0,0,0,.35) 0 8px 24px" }}
    >
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: PT.textMute }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Figure({ label, value, feed }: { label: string; value: React.ReactNode; feed: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[22px] font-bold leading-none" style={{ color: PT.text }}>
        {value}
      </div>
      <div className="text-[11px]" style={{ color: PT.textDim }}>
        {label}
      </div>
      <div className="text-[9.5px]" style={{ color: PT.textGhost }}>
        {feed}
      </div>
    </div>
  );
}

export default function PlatformOverview() {
  const [fleet, setFleet] = useState<FleetProject[] | null>(null);
  const [snapshotAge, setSnapshotAge] = useState<string | null>(null); // non-null = offline render

  useEffect(() => {
    fetch(`${agentBaseUrl()}/overview/fleet`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setFleet(d.projects ?? []);
        setSnapshotAge(null);
        try {
          window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ at: Date.now(), projects: d.projects }));
        } catch {
          /* cache-only */
        }
      })
      .catch(() => {
        // Offline / feed unreachable: render the cached snapshot UNDER ITS AGE
        // (R17 — freshness is part of honesty), or an honest gap if none.
        try {
          const raw = window.localStorage.getItem(SNAPSHOT_KEY);
          if (raw) {
            const snap = JSON.parse(raw) as { at: number; projects: FleetProject[] };
            setFleet(snap.projects);
            setSnapshotAge(new Date(snap.at).toLocaleString());
            return;
          }
        } catch {
          /* fall through to the gap state */
        }
        setFleet([]);
        setSnapshotAge("no snapshot");
      });
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-6 py-8">
      {snapshotAge && (
        <div
          className="rounded-xl border px-4 py-2.5 text-[12px] font-semibold"
          style={{ borderColor: "rgba(245,158,11,.4)", background: "rgba(245,158,11,.10)", color: PT.amberText }}
        >
          ⚠ offline — {snapshotAge === "no snapshot" ? "feed unreachable and no cached snapshot exists" : `showing cached snapshot as of ${snapshotAge}`}
        </div>
      )}

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[20px] font-bold tracking-[.01em]" style={{ color: PT.text }}>
            Fleet Overview
          </h1>
        </div>
        <Link
          href="/platform/new"
          className="rounded-lg px-4 py-2 text-[12px] font-bold"
          style={{
            background: `linear-gradient(180deg, ${PT.cyanBright}, ${PT.cyanDeep})`,
            color: "#062430",
            boxShadow: "rgba(34,211,238,0.4) 0px 2px 8px",
          }}
        >
          + New machine
        </Link>
      </div>

      {fleet === null && (
        <Card title="fleet">
          <div className="text-[12px]" style={{ color: PT.textMute }}>loading…</div>
        </Card>
      )}

      {fleet?.map((p) => (
        <Card
          key={p.project_id}
          // Say the machine's name ONCE; only append the serial-plate id
          // when it actually differs ("Machine A · machine A-1 · project
          // A-1" was three ways to say the same thing).
          title={p.machine_id !== p.display_name ? `${p.display_name} · ${p.machine_id}` : p.display_name}
        >
          <div className="mb-4">
            <Link
              href={`/platform/${p.slug}/library`}
              className="text-[12px] font-bold"
              style={{ color: PT.cyanText }}
            >
              enter project → Library
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Figure label="documents" value={p.documents_total} feed={<>live · /overview/fleet (sheet index)</>} />
            <Figure label="pages indexed" value={p.pages_indexed} feed={<>live · schematic_sheet_index</>} />
            <Figure
              label="pages certified"
              value={
                <span>
                  {p.pages_sealed}
                  <span className="text-[13px] font-semibold" style={{ color: PT.textMute }}>
                    {" "}
                    / {p.pages_indexed}
                  </span>
                </span>
              }
              feed={
                <>
                  live · gold_sealed_annotations
                  {p.last_sealed_at ? ` · last seal ${new Date(p.last_sealed_at).toLocaleString()}` : ""}
                </>
              }
            />
            <Figure
              label="open disagreements"
              value={<Chip kind="pending">feed pending</Chip>}
              feed={<>join_reconciliation_findings ships with the workbench (R13)</>}
            />
          </div>

          <div className="mt-5 border-t pt-4" style={{ borderColor: PT.line }}>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: PT.textFaint }}>
              per-lane coverage — tuples, never one percent (R17)
            </div>
            <div className="flex flex-wrap gap-2">
              {p.pages_canvas_routed !== null ? (
                <Chip kind="working">
                  schematic: {p.pages_sealed} sealed / {p.pages_canvas_routed} canvas-routed · live (routing map, R11)
                </Chip>
              ) : (
                <Chip kind="gap">schematic: no routing map yet — denominator unknown</Chip>
              )}
              <Chip kind="pending">tables · toc: reconciled / expected — workbench lane</Chip>
              <Chip kind="pending">legend: mined families / routed pages</Chip>
            </div>
          </div>

          <div className="mt-4 border-t pt-4" style={{ borderColor: PT.line }}>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: PT.textFaint }}>
              Arc trust register (R0) — earned per domain, granted only by Shane
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip kind="ok">schematic canvas — GRADUATED 2026-07-13 · evidence: 8 certified pages incl. first autonomous seal</Chip>
              <Chip kind="pending">every extraction lane — ungraduated by default (register table ships with workbench)</Chip>
            </div>
            <div className="mt-2 text-[9.5px]" style={{ color: PT.textGhost }}>
              ruled state shown from the plan (R0); the live register becomes Neon data in phase 4
            </div>
          </div>
        </Card>
      ))}

    </div>
  );
}
