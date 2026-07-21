"use client";

import { Cable, X } from "lucide-react";
import { motion } from "framer-motion";

export function ConnectorTerminalPrompt({
  value,
  onChange,
  onConfirm,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div
        className="absolute inset-0 z-[94] bg-black/20 backdrop-blur-[1px]"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onCancel();
        }}
      />
      <motion.form
        data-testid="connector-terminal-prompt"
        className="absolute left-1/2 top-1/2 z-[95] w-[260px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-orange-200/45 bg-black/88 p-3 text-slate-100 shadow-[0_22px_70px_rgba(0,0,0,0.68),0_0_34px_rgba(251,146,60,0.24)] backdrop-blur-xl"
        initial={{ opacity: 0, scale: 0.92, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 390, damping: 32 }}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-orange-200/35 bg-orange-300/14 text-orange-100 shadow-[0_0_18px_rgba(251,146,60,0.25)]">
              <Cable className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-orange-100">
                Connector
              </div>
              <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-200">
                Terminal pairs
              </div>
            </div>
          </div>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition hover:border-orange-200/45 hover:bg-orange-300/12 hover:text-white"
            onClick={onCancel}
            title="Cancel connector"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            autoFocus
            type="number"
            min={1}
            max={64}
            step={1}
            value={value}
            className="h-10 min-w-0 flex-1 rounded-xl border border-orange-200/30 bg-white/8 px-3 text-[15px] font-semibold text-white outline-none transition placeholder:text-white/35 focus:border-orange-100/70 focus:bg-orange-200/10"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
          />
          <button
            type="submit"
            className="h-10 rounded-xl border border-orange-200/45 bg-orange-300/16 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-50 transition hover:border-orange-100/80 hover:bg-orange-300/24"
          >
            Create
          </button>
        </div>
      </motion.form>
    </>
  );
}
