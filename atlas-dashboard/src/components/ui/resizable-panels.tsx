"use client";

export { Group, Panel, Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";

/** Vertical drag handle between columns */
export const resizeHandleColClass = cn(
  "w-1.5 shrink-0 bg-border hover:bg-muted data-[panel-group-direction=horizontal]:cursor-col-resize",
);
