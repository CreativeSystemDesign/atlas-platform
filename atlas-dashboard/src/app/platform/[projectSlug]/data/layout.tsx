"use client";

// The Data area (remodeled 2026-07-20): the Data Map visualizes the real
// Neon tables and rules the join contracts between them (cards derive live
// — the Schema-Builder's describe-by-hand job is retired); Document
// Extraction produces those tables one certified document at a time.

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { PT } from "@/lib/platform-theme";

export default function DataLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ projectSlug: string }>();
  const pathname = usePathname();
  const base = `/platform/${params.projectSlug}`;
  const tabs = [
    { href: `${base}/data/map`, label: "Data Map" },
    { href: `${base}/extract`, label: "Document Extraction" },
  ];
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b px-6 pt-3" style={{ borderColor: PT.line }}>
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.label}
              href={t.href}
              className="rounded-t-lg px-3.5 py-2 text-[12px] font-semibold"
              style={
                active
                  ? {
                      color: PT.cyanText,
                      background: "rgba(34,211,238,.07)",
                      borderBottom: `2px solid ${PT.cyanBright}`,
                    }
                  : { color: PT.textDim }
              }
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
