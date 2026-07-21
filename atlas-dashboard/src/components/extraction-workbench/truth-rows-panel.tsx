"use client";

import {
  relationshipPathColor,
} from "./relationship-highlight";
import type { RelationshipTruthRow } from "./relationship-truth-rows";
import {
  truthRowItemStyle,
  truthRowPathStyle,
} from "./relationship-visuals";

export function TruthRowsPanel({ rows }: { rows: RelationshipTruthRow[] }) {
  return (
    <div className="rounded-2xl border border-cyan-200/25 bg-cyan-300/8 p-3 shadow-[0_0_24px_rgba(34,211,238,0.06)]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-100">
          Truth
        </div>
        <span className="rounded-full border border-cyan-200/30 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-cyan-100/80">
          {rows.length}
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {rows.slice(0, 10).map((row) => {
          const pathColor = relationshipPathColor(row.pathNumber);
          return (
            <div
              key={row.id}
              className="rounded-xl border px-2.5 py-2"
              style={truthRowPathStyle(pathColor)}
            >
              <div className="flex items-center justify-between gap-2">
                <div
                  className="text-[9px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: pathColor.text }}
                >
                  Path {row.pathNumber}
                </div>
                <div className="text-[8px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {row.status ?? "descriptor member"}
                </div>
              </div>
              <div className="mt-1.5 space-y-1">
                {row.items.map((item) => (
                  <div
                    key={item.ref}
                    className="grid grid-cols-[34px_1fr] gap-2 rounded-lg border px-2 py-1 text-[10px] leading-4"
                    style={truthRowItemStyle(pathColor)}
                  >
                    <span
                      className="font-semibold tabular-nums"
                      style={{ color: pathColor.text }}
                    >
                      {item.ref}
                    </span>
                    <span className="text-foreground">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {rows.length > 10 ? (
          <div className="text-[9px] text-cyan-100/70">
            {rows.length - 10} more links hidden.
          </div>
        ) : null}
      </div>
    </div>
  );
}
