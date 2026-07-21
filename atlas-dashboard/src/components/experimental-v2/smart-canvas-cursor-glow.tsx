"use client";

// Midnight Gallery cursor glow + vignette (v4 mockup port).
// A soft cyan aura trails the pointer over the whole workspace and a static
// vignette deepens the edges — the "exhibit lighting" that makes the dark
// theme read as a gallery rather than a void. Pointer-transparent, mounted
// between the WebGL gallery and the UI chrome.
//
// Performance contract: the glow position is written straight to the DOM node
// (transform on a ref) from a window pointermove listener — no React state,
// no re-render per move. Skipped entirely under prefers-reduced-motion and on
// coarse-pointer-only devices (no hover cursor to follow).

import React, { useEffect, useRef } from "react";

const GLOW_SIZE = 320;

export function SmartCanvasCursorGlow() {
  const glowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = glowRef.current;
    if (!el) return;
    if (typeof window.matchMedia === "function") {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const noHover = window.matchMedia("(hover: none)").matches;
      if (reduced || noHover) {
        el.style.display = "none";
        return;
      }
    }
    const onMove = (e: PointerEvent) => {
      el.style.transform = `translate(${e.clientX - GLOW_SIZE / 2}px, ${e.clientY - GLOW_SIZE / 2}px)`;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <>
      {/* Cursor aura — additive screen blend so it lights, never paints. */}
      <div
        ref={glowRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[5]"
        style={{
          width: GLOW_SIZE,
          height: GLOW_SIZE,
          background: "radial-gradient(circle, rgba(34,211,238,.10), transparent 65%)",
          mixBlendMode: "screen",
          willChange: "transform",
          transform: `translate(-${GLOW_SIZE}px, -${GLOW_SIZE}px)`, // offscreen until first move
        }}
      />
      {/* Static vignette — deepens the frame edges toward the gallery dark. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[5]"
        style={{
          background:
            "radial-gradient(120% 120% at 50% 45%, transparent 55%, rgba(3,6,14,.55) 100%)",
        }}
      />
    </>
  );
}
