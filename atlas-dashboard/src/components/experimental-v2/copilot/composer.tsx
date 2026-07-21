"use client";

// Composer (full-SDK, polish bar): auto-growing multiline input, IMAGE
// PASTE/attach (base64 content blocks), slash-command autocomplete with full
// keyboard navigation (↑↓ / Tab / Enter / Esc), animated attach previews,
// voice dictation (Web Speech API — pen-in-hand input, hidden if unsupported).

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ImagePlus, Mic, SendHorizonal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComposerImage } from "./use-copilot-ws";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // b64 payload cap per image

type Attached = ComposerImage & { name: string };

// An image pushed into the composer from outside (the DocumentViewer's capture
// tool). seq bumps per capture so the same image can be re-injected; the
// composer appends it to its attachments and focuses the input — Shane adds a
// line and hits Enter (which queues if Arc is busy).
export type ComposerInjection = { image: Attached; seq: number };

// Minimal structural type for SpeechRecognition — lib.dom doesn't ship one and
// Chrome only exposes the webkit-prefixed constructor.
type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Hydration-safe support probe: server snapshot says no, the post-hydration
// client snapshot flips it on where the API exists.
const subscribeNoop = () => () => {};
function useSpeechSupported(): boolean {
  return useSyncExternalStore(subscribeNoop, () => getSpeechCtor() !== null, () => false);
}

async function fileToImage(file: File): Promise<Attached | null> {
  if (!file.type.startsWith("image/")) return null;
  const buf = await file.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) return null;
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { media_type: file.type, data: btoa(binary), name: file.name || "pasted image" };
}

export function Composer({
  disabled,
  placeholder,
  slashCommands,
  onSend,
  injected,
}: {
  disabled: boolean;
  placeholder: string;
  slashCommands: string[];
  onSend: (text: string, images: ComposerImage[]) => void;
  /** A crop pushed in from the viewer's capture tool — appended on seq change. */
  injected?: ComposerInjection;
}) {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<Attached[]>([]);
  // Append an injected crop the moment its seq changes (setState-in-render, the
  // sanctioned signal pattern — same as the panel's issuesOpenSignal).
  const [seenInjectSeq, setSeenInjectSeq] = useState(injected?.seq ?? 0);
  if (injected && injected.seq !== seenInjectSeq) {
    setSeenInjectSeq(injected.seq);
    setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, injected.image]));
  }
  const [oversize, setOversize] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [listening, setListening] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const recRef = useRef<SpeechRec | null>(null);
  // Text present when dictation started — transcripts append after it.
  const dictBaseRef = useRef("");
  const speechSupported = useSpeechSupported();

  const slashMatches = useMemo(() => {
    if (!input.startsWith("/") || input.includes(" ") || input.includes("\n")) return [];
    const q = input.slice(1).toLowerCase();
    return slashCommands.filter((c) => c.toLowerCase().startsWith(q)).slice(0, 8);
  }, [input, slashCommands]);

  // Highlight index resets in onChange and clamps at render (no effect).
  const slashSel = Math.min(slashIdx, Math.max(0, slashMatches.length - 1));

  // Auto-grow with the content (44px floor, ~7 lines ceiling). Event-driven:
  // fires on every input mutation, no effect needed.
  const autoGrow = useCallback(() => {
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      el.style.height = "0px";
      el.style.height = `${Math.min(160, Math.max(44, el.scrollHeight))}px`;
    });
  }, []);

  const addFiles = useCallback(async (files: Iterable<File>) => {
    let tooBig = false;
    for (const f of files) {
      const img = await fileToImage(f);
      if (img === null && f.type.startsWith("image/")) tooBig = true;
      if (img) setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, img]));
    }
    setOversize(tooBig);
    if (tooBig) window.setTimeout(() => setOversize(false), 4000);
  }, []);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text && images.length === 0) return;
    recRef.current?.stop();
    onSend(text, images.map(({ media_type, data }) => ({ media_type, data })));
    setInput("");
    setImages([]);
    autoGrow();
  }, [input, images, onSend, autoGrow]);

  const toggleVoice = useCallback(() => {
    if (recRef.current) {
      recRef.current.stop(); // onend clears state
      return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    dictBaseRef.current = input.trim() ? `${input.replace(/\s+$/, "")} ` : "";
    rec.onresult = (e) => {
      // results accumulate across the session: finals + trailing interim.
      let heard = "";
      for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript;
      setInput(dictBaseRef.current + heard);
      autoGrow();
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      areaRef.current?.focus();
    };
    rec.onerror = () => rec.stop();
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, [input, autoGrow]);

  // Never leave the mic hot past unmount (panel close, page nav).
  useEffect(() => () => recRef.current?.stop(), []);

  // A fresh capture focuses the input so Shane can add a line and hit Enter.
  useEffect(() => {
    if (injected?.seq) areaRef.current?.focus();
  }, [injected?.seq]);

  const acceptSlash = useCallback((cmd: string) => {
    setInput(`/${cmd} `);
    areaRef.current?.focus();
    autoGrow();
  }, [autoGrow]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMatches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((slashSel + 1) % slashMatches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((slashSel - 1 + slashMatches.length) % slashMatches.length); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        acceptSlash(slashMatches[slashSel]);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setInput(input + " "); return; }
    }
    if (e.key === "Escape" && images.length > 0) { setImages([]); return; }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [slashMatches, slashSel, acceptSlash, images.length, input, send]);

  return (
    <div>
      {slashMatches.length > 0 && (
        <div role="listbox" aria-label="Slash commands"
          className="mb-1 overflow-hidden rounded-md border border-border/60 bg-background/95 py-0.5 shadow-lg animate-in fade-in slide-in-from-bottom-1 duration-150">
          {slashMatches.map((c, i) => (
            <button key={c} type="button" role="option" aria-selected={i === slashSel}
              className={cn("flex w-full items-center justify-between px-2 py-1 text-left font-mono text-[11px] transition-colors",
                i === slashSel ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}
              onMouseEnter={() => setSlashIdx(i)}
              onClick={() => acceptSlash(c)}>
              <span>/{c}</span>
              {i === slashSel && <kbd className="rounded bg-muted/70 px-1 text-[8px] uppercase text-muted-foreground">tab</kbd>}
            </button>
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {images.map((img, i) => (
            <div key={i} className="relative animate-in zoom-in-95 fade-in duration-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:${img.media_type};base64,${img.data}`} alt={img.name}
                className="h-12 w-12 rounded-md border border-border/60 object-cover shadow-sm" />
              <button type="button" aria-label={`Remove ${img.name}`}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-slate-800 p-0.5 text-white shadow transition-colors hover:bg-red-500"
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}>
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {oversize && (
        <div className="mb-1 text-[10px] text-red-400 animate-in fade-in duration-150">
          image too large (&gt;4MB) — resize and retry
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <textarea
          ref={areaRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setSlashIdx(0); autoGrow(); }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          rows={2}
          aria-label="Message Arc"
          placeholder={placeholder}
          className="min-h-[44px] flex-1 resize-none rounded-lg border border-border/70 bg-background/60 px-2.5 py-2 text-[12px] leading-snug outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-1 focus:ring-primary/25"
        />
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          title="Attach image (or paste one)" aria-label="Attach image"
          onClick={() => fileRef.current?.click()}>
          <ImagePlus className="h-4 w-4" />
        </Button>
        {speechSupported && (
          <Button size="icon" variant="ghost"
            className={cn("h-8 w-8 shrink-0 transition-colors",
              listening ? "animate-pulse bg-red-500/15 text-red-400 hover:text-red-300" : "text-muted-foreground hover:text-foreground")}
            title={listening ? "Stop dictation" : "Dictate instead of typing — handy when the pen is in your hand"}
            aria-label={listening ? "Stop dictation" : "Start dictation"} aria-pressed={listening}
            onClick={toggleVoice}>
            <Mic className="h-4 w-4" />
          </Button>
        )}
        <Button size="icon" className="h-8 w-8 shrink-0 transition-transform active:scale-95" onClick={send}
          disabled={disabled || (!input.trim() && images.length === 0)} title="Send (Enter)" aria-label="Send message">
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
