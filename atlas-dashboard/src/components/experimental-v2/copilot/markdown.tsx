"use client";

// Assistant prose was whitespace-pre-wrap plain text until 2026-07-07 —
// react-markdown with tight panel-scale styles (code, tables, lists).

import React, { memo } from "react";
import ReactMarkdown from "react-markdown";

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="copilot-md text-[12px] leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_h1]:text-[13px] [&_h1]:font-bold [&_h2]:text-[13px] [&_h2]:font-bold [&_h3]:text-[12px] [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_a]:underline [&_hr]:my-2 [&_table]:my-1 [&_table]:text-[11px] [&_th]:border [&_th]:border-border/60 [&_th]:px-1.5 [&_th]:py-0.5 [&_td]:border [&_td]:border-border/60 [&_td]:px-1.5 [&_td]:py-0.5">
      <ReactMarkdown
        components={{
          code({ className, children, ...props }) {
            const isBlock = String(className ?? "").includes("language-");
            if (isBlock) {
              return (
                <code
                  className="block overflow-x-auto rounded-md bg-slate-900/80 px-2 py-1.5 font-mono text-[11px] text-slate-100"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-muted/70 px-1 py-px font-mono text-[11px]" {...props}>
                {children}
              </code>
            );
          },
          pre({ children }) {
            return <pre className="my-1.5">{children}</pre>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
