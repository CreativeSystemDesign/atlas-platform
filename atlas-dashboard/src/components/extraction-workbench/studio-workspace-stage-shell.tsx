"use client";

import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  ReactNode,
  RefObject,
  MutableRefObject,
  KeyboardEvent,
  WheelEvent,
} from "react";

import { stageCursorClass } from "./annotation-styles";
import type { AnnotationMode } from "./studio-types";
import type { StudioTool } from "./studio-types";
import type { HoverStackTarget } from "./overlay-label-layout";

type PointerPoint = {
  x: number;
  y: number;
};

export type WorkspaceStageShellProps = {
  tool: StudioTool;
  activeMode: AnnotationMode;
  stageRef: RefObject<HTMLDivElement | null>;
  onPointerDownCapture?: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  setCursorPx: (cursor: PointerPoint | null) => void;
  setHoverStack: (target: HoverStackTarget[]) => void;
  hoverStackCyclingRef: MutableRefObject<boolean>;
  hoverStackIndexRef: MutableRefObject<number>;
  children: ReactNode;
};

export function StudioWorkspaceStageShell({
  tool,
  activeMode,
  stageRef,
  onPointerDownCapture,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onWheel,
  onKeyDown,
  onContextMenu,
  setCursorPx,
  setHoverStack,
  hoverStackCyclingRef,
  hoverStackIndexRef,
  children,
}: WorkspaceStageShellProps) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-border/70 bg-background/55">
      <div
        ref={stageRef}
        data-testid="extraction-stage"
        className={`${stageCursorClass(tool, activeMode)} h-full w-full touch-none select-none`}
        onPointerDownCapture={onPointerDownCapture}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => {
          setCursorPx(null);
          setHoverStack([]);
          hoverStackCyclingRef.current = false;
          hoverStackIndexRef.current = -1;
        }}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
