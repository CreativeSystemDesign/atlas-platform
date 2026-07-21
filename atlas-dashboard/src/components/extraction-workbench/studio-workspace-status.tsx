"use client";

type WorkspaceStatusBarProps = {
  pageNum: number;
  boxesCount: number;
  cursorPx: { x: number; y: number } | null;
};

export function WorkspaceStatusBar({
  pageNum,
  boxesCount,
  cursorPx,
}: WorkspaceStatusBarProps) {
  return (
    <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 bg-card/85 px-3 py-2 text-[10px] text-muted-foreground backdrop-blur">
      <span>Document: reference schematic</span>
      <span>Page: {pageNum} / 129</span>
      <span>Boxes: {boxesCount}</span>
      <span>
        Cursor: {cursorPx ? `${cursorPx.x}, ${cursorPx.y}px` : "outside page"}
      </span>
    </div>
  );
}
