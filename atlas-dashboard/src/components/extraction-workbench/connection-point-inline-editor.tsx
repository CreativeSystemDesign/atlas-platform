"use client";

import {
  useEffect,
  useRef,
} from "react";
import { motion } from "framer-motion";

import type { BBoxPx } from "./studio-geometry";

export function ConnectionPointInlineEditor({
  bbox,
  zoom,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  bbox: BBoxPx;
  zoom: number;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  return (
    <motion.form
      className="pointer-events-auto absolute z-[95] flex min-w-[148px] items-center gap-1 rounded-2xl border border-cyan-200/50 bg-black/88 p-1.5 shadow-[0_18px_55px_rgba(0,0,0,0.6),0_0_32px_rgba(34,211,238,0.28)] backdrop-blur-xl"
      style={{
        left: bbox.x + bbox.width + 10 / zoom,
        top: bbox.y - 8 / zoom,
        transformOrigin: "left top",
      }}
      initial={{ opacity: 0, scale: 0.86 / zoom, y: -4 / zoom }}
      animate={{ opacity: 1, scale: 1 / zoom, y: 0 }}
      exit={{ opacity: 0, scale: 0.86 / zoom, y: -4 / zoom }}
      transition={{ type: "spring", stiffness: 420, damping: 31 }}
      onSubmit={(event) => {
        event.preventDefault();
        onCommit();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <span className="rounded-full border border-cyan-200/30 bg-cyan-300/12 px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
        point
      </span>
      <input
        ref={inputRef}
        value={value}
        placeholder="schematic label"
        className="h-8 w-[126px] rounded-xl border border-white/12 bg-white/8 px-2.5 text-[12px] font-semibold text-white outline-none transition placeholder:text-white/36 focus:border-cyan-200/70 focus:bg-cyan-200/10"
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
    </motion.form>
  );
}
