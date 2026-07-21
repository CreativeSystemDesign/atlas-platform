"use client";

import type { BBoxPx } from "./studio-geometry";
import { ConnectionPointInlineEditor } from "./connection-point-inline-editor";

type StudioWorkspaceConnectionPointOverlayProps = {
  connectionPointEditorValue: string;
  connectionPointBbox: BBoxPx;
  zoom: number;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
};

export function StudioWorkspaceConnectionPointOverlay({
  connectionPointEditorValue,
  connectionPointBbox,
  zoom,
  onChange,
  onCommit,
  onCancel,
}: StudioWorkspaceConnectionPointOverlayProps) {
  return (
    <ConnectionPointInlineEditor
      bbox={connectionPointBbox}
      zoom={zoom}
      value={connectionPointEditorValue}
      onChange={onChange}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  );
}
