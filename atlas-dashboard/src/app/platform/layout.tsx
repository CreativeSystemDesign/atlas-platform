"use client";

// Atlas-Platform app shell — the graduated application's frame.
// Lives at the parallel route /platform during the build (Platform
// Graduation R6b: existing routes untouched; the root swap happens last,
// after Shane's sign-off). Overview renders at /platform; project-scoped
// areas arrive as /{projectSlug}/{area} in phase 2 (R15).

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { PT, PT_GLASS, PT_SCREEN_BG } from "@/lib/platform-theme";

// Segments under /platform that are NOT project slugs.
const RESERVED = new Set(["canvas", "new"]);
const LAST_PROJECT_KEY = "atlas.platform.lastProject";

export default function PlatformLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Library and Document Extraction are project-scoped (R15); the top nav
  // routes them into the CURRENT machine — from the URL when inside one,
  // else the last machine visited (Shane's 2026-07-13 catch: standing inside
  // the Library while the top row called Library disabled read as broken).
  const urlSlug = (() => {
    const m = pathname.match(/^\/platform\/([^/]+)/);
    return m && !RESERVED.has(m[1]) ? m[1] : null;
  })();
  const [storedSlug, setStoredSlug] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (urlSlug) window.localStorage.setItem(LAST_PROJECT_KEY, urlSlug);
      else setStoredSlug(window.localStorage.getItem(LAST_PROJECT_KEY));
    } catch {
      /* nav fallback only */
    }
  }, [urlSlug]);
  const slug = urlSlug ?? storedSlug;

  // The machine chip (Shane's ruling: ONE nav bar — the machine context
  // lives here, not in a second bar). Click = back to the Fleet Overview,
  // which is the machine switcher.
  const [machineName, setMachineName] = useState<string | null>(null);
  useEffect(() => {
    if (!slug) return;
    fetch(`${agentBaseUrl()}/projects`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((list: { slug: string; display_name: string }[]) =>
        setMachineName(list.find((p) => p.slug === slug)?.display_name ?? slug))
      .catch(() => setMachineName(slug));
  }, [slug]);

  const nav = [
    { href: "/platform", label: "Overview", live: true },
    // Phase 3 first slice: the v2 canvas renders INSIDE the platform shell —
    // no more detour through the legacy deep-agent console at "/".
    { href: "/platform/canvas", label: "Smart Canvas", live: true },
    {
      // The Data area (Shane's EER vision, 2026-07-13): Schema-Builder +
      // Relations + the parked extraction page live under one roof.
      href: slug ? `/platform/${slug}/data` : "#",
      label: "Data",
      live: !!slug,
      note: "enter a machine first",
    },
    {
      href: slug ? `/platform/${slug}/library` : "#",
      label: "Library",
      live: !!slug,
      note: "enter a machine first",
    },
    { href: "/machine-graph", label: "Machine Graph", live: true },
    {
      // The AI Industrial Engineer's room (design: docs/vault/Arc Industrial
      // Engineer — Design.md). A trace is always a trace OF a machine.
      href: slug ? `/platform/${slug}/arc` : "#",
      label: "Arc",
      live: !!slug,
      note: "enter a machine first",
    },
  ];
  return (
    // The legacy root layout puts overflow-hidden on <body> (full-viewport
    // canvas app), so the platform shell owns its own scroll: fixed-height
    // frame, header pinned, <main> is the scroll container. Full-height
    // surfaces (the canvas) simply claim h-full and never scroll.
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: `${PT_SCREEN_BG}, ${PT.ink}`, color: PT.text }}
    >
      <header
        className="z-20 flex h-14 w-full shrink-0 items-center gap-5 border-b px-[18px] backdrop-blur-[14px]"
        style={{
          borderColor: PT.line,
          background: PT_GLASS,
          boxShadow: "rgba(255,255,255,0.04) 0px 1px 0px inset",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-[26px] w-[26px] items-center justify-center rounded-lg text-[12px] font-extrabold"
            style={{
              background: `linear-gradient(140deg, ${PT.cyan} 0%, ${PT.cyanDeep} 80%)`,
              color: "#062430",
              boxShadow: "rgba(34,211,238,0.35) 0px 2px 8px, rgba(255,255,255,0.25) 0px 1px 0px inset",
            }}
          >
            ◆
          </div>
          <div className="leading-tight">
            {/* The machine context reads as part of the title (Shane's
                call — it belongs, not a loud pill): Atlas-Platform · Machine
                the reference machine. Click = Fleet Overview, the machine switcher. */}
            <div className="text-[12.5px] font-bold tracking-[.02em]" style={{ color: PT.text }}>
              Atlas-Platform
              {slug && (
                <Link
                  href="/platform"
                  title={`Machine context: ${machineName ?? slug} — click for the Fleet Overview (switch machines there)`}
                  className="font-semibold hover:underline"
                  style={{ color: PT.cyanText }}
                >
                  {" "}· Machine {machineName ?? slug}
                </Link>
              )}
            </div>
            <div className="text-[9px] uppercase tracking-[.14em]" style={{ color: PT.textFaint }}>
              Document → Data · Extraction Studio
            </div>
          </div>
        </div>

        <nav className="ml-6 flex items-center gap-1.5">
          {nav.map((item) => {
            // Deeper routes keep their area lit (e.g. the document viewer
            // under /library); Overview stays exact-match only.
            const active =
              item.live &&
              (pathname === item.href ||
                (item.href !== "/platform" && pathname.startsWith(item.href + "/")));
            return (
              <Link
                // label, not href — projectless items share href "#" and
                // colliding keys duplicate nodes when the slug hydrates in
                key={item.label}
                href={item.live ? item.href : "#"}
                aria-disabled={!item.live}
                className="rounded-lg px-3.5 py-1.5 text-[12px] font-semibold tracking-[.01em] transition-colors duration-200"
                style={
                  active
                    ? {
                        background: `linear-gradient(180deg, ${PT.cyanBright}, ${PT.cyanDeep})`,
                        color: "#062430",
                        boxShadow: "rgba(34,211,238,0.4) 0px 2px 8px, rgba(255,255,255,0.35) 0px 1px 0px inset",
                      }
                    : {
                        color: item.live ? PT.textDim : PT.textGhost,
                        cursor: item.live ? "pointer" : "default",
                      }
                }
                title={item.live ? item.label : `${item.label} — ${item.note}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto text-[10px] uppercase tracking-[.14em]" style={{ color: PT.textGhost }}>
          build phase 1 · parallel route
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
