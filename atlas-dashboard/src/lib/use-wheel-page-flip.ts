"use client";

// Wheel-to-flip paging (Shane's ask): scrolling within an overflowing page
// behaves normally; pushing past the top/bottom edge flips to the previous/
// next page. An accumulator + cooldown makes one wheel gesture = one page,
// never a skid through five.

import { useCallback, useRef } from "react";

const THRESHOLD = 80;   // accumulated deltaY at the edge before a flip
const COOLDOWN_MS = 350;

export function useWheelPageFlip(
  scrollerRef: React.RefObject<HTMLElement | null>,
  opts: { page: number; pageCount: number | null; onFlip: (next: number) => void }
) {
  const state = useRef({ acc: 0, lastFlip: 0 });
  const optsRef = useRef(opts);
  optsRef.current = opts;

  return useCallback(
    (e: React.WheelEvent) => {
      const el = scrollerRef.current;
      const { page, pageCount, onFlip } = optsRef.current;
      if (!el || !pageCount) return;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      const atTop = el.scrollTop <= 2;
      const now = Date.now();
      if (now - state.current.lastFlip < COOLDOWN_MS) return;

      const down = e.deltaY > 0;
      const atEdge = down ? atBottom : atTop;
      if (!atEdge) {
        state.current.acc = 0; // mid-page scrolling resets the intent
        return;
      }
      // direction change resets the accumulator
      if ((down && state.current.acc < 0) || (!down && state.current.acc > 0)) {
        state.current.acc = 0;
      }
      state.current.acc += e.deltaY;
      if (Math.abs(state.current.acc) < THRESHOLD) return;
      const next = down ? page + 1 : page - 1;
      if (next < 1 || next > pageCount) return;
      state.current.acc = 0;
      state.current.lastFlip = now;
      onFlip(next);
      el.scrollTop = 0;
    },
    [scrollerRef]
  );
}
