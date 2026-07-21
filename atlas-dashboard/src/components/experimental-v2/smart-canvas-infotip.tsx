"use client";

// InfoTip — the Smart Canvas v4 instructional tooltip (design target:
// docs/vault/Smart Canvas v2 Design Target.md → v4 addendum). Every control
// carries a delayed (≈500ms) rich tooltip: an UPPERCASE cyan title over a
// readable body. The body copy IS product spec — it is carried verbatim from
// the ratified v4 mockup (data-tiptitle / data-tip), so the shipped UI states
// the same contracts the design does.
//
// Built on the app's base-ui tooltip primitive but restyled to the Midnight
// Gallery identity and given the title+body shape the mockup uses. One shared
// Provider (delay 500) so call sites stay flat: <InfoTip title body>…</InfoTip>.

import React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

/** Delay before an instructional tip appears, matching the v4 mockup. Applied
 *  on the shared provider so adjacent tips group (once one shows, neighbors
 *  open instantly) — the right feel for a dense control surface. */
export const INFOTIP_DELAY_MS = 500;

/** Mount ONE of these high in the Smart Canvas tree so all InfoTips share a
 *  delay + grouping. InfoTip itself renders only Root/Trigger/Portal. */
export function InfoTipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delay={INFOTIP_DELAY_MS} closeDelay={80}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function InfoTip({
  title,
  body,
  side = "bottom",
  children,
  disabled,
  className,
}: {
  title: string;
  body: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactElement;
  disabled?: boolean;
  className?: string;
}) {
  if (disabled || (!title && !body)) return children;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger data-slot="infotip-trigger" render={children} />
      <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner
            side={side}
            sideOffset={8}
            align="center"
            className="isolate z-[60]"
          >
            <TooltipPrimitive.Popup
              data-slot="infotip-content"
              className={cn(
                "z-[60] max-w-[272px] rounded-[11px] px-3 py-2.5",
                "border border-[#22d3ee]/35 shadow-[0_16px_44px_rgba(0,0,0,.6),0_1px_0_rgba(255,255,255,.06)_inset]",
                "backdrop-blur-md",
                "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95",
                "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
                "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
                className
              )}
              style={{
                background:
                  "linear-gradient(180deg, rgba(14,22,38,.98), rgba(9,14,26,.98))",
              }}
            >
              {title && (
                <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[.1em] text-[#67e8f9]">
                  {title}
                </div>
              )}
              <div className="text-[11.5px] leading-[1.5] text-[#dbeafe]">{body}</div>
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
