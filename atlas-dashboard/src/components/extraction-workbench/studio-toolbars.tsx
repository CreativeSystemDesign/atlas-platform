"use client";

import { useState, type ReactNode } from "react";

import {
  Cable,
  Download,
  Eye,
  EyeOff,
  FileText,
  GitBranch,
  Hand,
  LocateFixed,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Save,
  ScanSearch,
  SlidersHorizontal,
  SquareDashedMousePointer,
  Tags,
  Trash2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  BBOX_STROKE_MAX,
  BBOX_STROKE_MIN,
  type BBoxStrokeTarget,
  type BBoxStrokeWidths,
} from "./bbox-display-controls";
import { CompactStatus } from "./studio-readouts";
import {
  ANNOTATION_MODES,
  SNAP_STRENGTH_OPTIONS,
  type AnnotationBox,
  type AnnotationMode,
  type AnnotationStatus,
  type AnnotationWorkspaceMode,
  type CableAuthoringMode,
  type ComponentAuthoringMode,
  type SnapStrength,
  type StudioTool,
  type WireAuthoringMode,
  type YoloTool,
  type Yolov26DetectSettings,
} from "./studio-types";

export function ViewportToolbar({
  annotationWorkspaceMode,
  pageNum,
  zoom,
  metadataStatus,
  activeSelectionLabel,
  relationNotice,
  overlayPillsVisible,
  yoloAnnotationsVisible,
  yoloHumanAnnotationsVisible,
  bboxStrokeTarget,
  bboxStrokeWidths,
  onPreviousPage,
  onNextPage,
  onZoomIn,
  onZoomOut,
  onResetView,
  onToggleOverlayPills,
  onToggleYoloAnnotations,
  onToggleYoloHumanAnnotations,
  onDetectYoloPage,
  onClearYoloPage,
  onBBoxStrokeTargetChange,
  onBBoxStrokeWidthChange,
}: {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  pageNum: number;
  zoom: number;
  metadataStatus: "loading" | "ready" | "error";
  activeSelectionLabel: string;
  relationNotice: string | null;
  overlayPillsVisible: boolean;
  yoloAnnotationsVisible: boolean;
  yoloHumanAnnotationsVisible: boolean;
  bboxStrokeTarget: BBoxStrokeTarget;
  bboxStrokeWidths: BBoxStrokeWidths;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onToggleOverlayPills: () => void;
  onToggleYoloAnnotations: () => void;
  onToggleYoloHumanAnnotations: () => void;
  onDetectYoloPage: () => void;
  onClearYoloPage: () => void;
  onBBoxStrokeTargetChange: (target: BBoxStrokeTarget) => void;
  onBBoxStrokeWidthChange: (value: number) => void;
}) {
  const activeStrokeWidth = bboxStrokeWidths[bboxStrokeTarget];
  const showBboxStrokeControls = annotationWorkspaceMode !== "yolo";

  return (
    <div className="absolute left-4 top-4 z-20 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-1 rounded-2xl border border-border/70 bg-card/85 p-1.5 shadow-[0_18px_48px_-34px_rgba(0,0,0,0.95)] backdrop-blur">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={onPreviousPage}
        disabled={pageNum <= 1}
        title="Previous page"
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <div className="min-w-[72px] px-2 text-center text-[10px] font-semibold text-foreground">
        Page {pageNum}
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={onNextPage}
        disabled={pageNum >= 129}
        title="Next page"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={onZoomOut}
        title="Zoom out"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <div className="min-w-[52px] px-1 text-center text-[10px] tabular-nums text-muted-foreground">
        {Math.round(zoom * 100)}%
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={onZoomIn}
        title="Zoom in"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={onResetView}
        title="Reset view"
      >
        <LocateFixed className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={`h-8 w-8 ${
          overlayPillsVisible ? "border-cyan-300/45 text-cyan-100" : ""
        }`}
        onClick={onToggleOverlayPills}
        title={overlayPillsVisible ? "Hide overlay pills" : "Show overlay pills"}
        aria-label={overlayPillsVisible ? "Hide overlay pills" : "Show overlay pills"}
      >
        {overlayPillsVisible ? (
          <Eye className="h-3.5 w-3.5" />
        ) : (
          <EyeOff className="h-3.5 w-3.5" />
        )}
      </Button>
      {annotationWorkspaceMode === "yolo" ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={`h-8 w-8 ${
            yoloAnnotationsVisible
              ? "border-red-300/45 text-red-100"
              : "border-emerald-300/45 text-emerald-100"
          }`}
          onClick={onToggleYoloAnnotations}
          title={yoloAnnotationsVisible ? "Hide YOLO annotations" : "Show YOLO annotations"}
          aria-label={yoloAnnotationsVisible ? "Hide YOLO annotations" : "Show YOLO annotations"}
        >
          {yoloAnnotationsVisible ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </Button>
      ) : null}
      {annotationWorkspaceMode === "yolo" ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={`h-8 w-8 ${
            yoloHumanAnnotationsVisible
              ? "border-red-300/45 text-red-100"
              : "border-emerald-300/45 text-emerald-100"
          }`}
          onClick={onToggleYoloHumanAnnotations}
          title={
            yoloHumanAnnotationsVisible
              ? "Hide human annotations"
              : "Show human annotations"
          }
          aria-label={
            yoloHumanAnnotationsVisible
              ? "Hide human annotations"
              : "Show human annotations"
          }
        >
          {yoloHumanAnnotationsVisible ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </Button>
      ) : null}
      {annotationWorkspaceMode === "yolo" ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 border-red-300/45 bg-red-500/10 text-red-100 hover:bg-red-500/20"
            onClick={onDetectYoloPage}
            title="Run YOLOv26 detection on this page"
            aria-label="Run YOLOv26 detection on this page"
          >
            <ScanSearch className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 border-rose-300/45 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
            onClick={onClearYoloPage}
            title="Remove all YOLO bboxes from this page"
            aria-label="Remove all YOLO bboxes from this page"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : null}
      {showBboxStrokeControls ? (
        <div
          className="flex h-8 items-center gap-1 rounded-xl border border-border/70 bg-background/45 px-1.5"
          title="BBox stroke thickness"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-100/80" />
          <select
            value={bboxStrokeTarget}
            aria-label="BBox stroke target"
            className="h-6 w-[92px] rounded-lg border border-white/10 bg-black/35 px-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-200 outline-none transition focus:border-cyan-200/60"
            onChange={(event) =>
              onBBoxStrokeTargetChange(event.target.value as BBoxStrokeTarget)
            }
          >
            <option value="root">Root</option>
            <option value="attachments">Attachments</option>
          </select>
          <input
            type="range"
            min={BBOX_STROKE_MIN}
            max={BBOX_STROKE_MAX}
            step={1}
            value={activeStrokeWidth}
            aria-label="BBox stroke thickness"
            className="h-1.5 w-20 accent-cyan-300"
            onChange={(event) =>
              onBBoxStrokeWidthChange(Number(event.target.value))
            }
          />
          <span className="w-4 text-center font-mono text-[9px] font-semibold text-cyan-100">
            {activeStrokeWidth}
          </span>
        </div>
      ) : null}
      <div className="mx-1 h-5 w-px bg-border" />
      <div
        className="flex items-center gap-1 rounded-full border border-border/70 bg-background/45 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
        title="Vector snap metadata status"
      >
        <ScanSearch
          className={`h-3 w-3 ${
            metadataStatus === "ready" ? "text-emerald-300" : "text-amber-300"
          }`}
        />
        {metadataStatus}
      </div>
      <div
        className="max-w-[220px] truncate rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-cyan-100"
        title={activeSelectionLabel}
      >
        {activeSelectionLabel}
      </div>
      {relationNotice ? (
        <div
          className="max-w-[300px] truncate rounded-full border border-amber-300/35 bg-amber-300/12 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-100"
          title={relationNotice}
        >
          {relationNotice}
        </div>
      ) : null}
    </div>
  );
}

export function StudioToolPanel({
  annotationWorkspaceMode,
  activeMode,
  componentAuthoringMode,
  wireAuthoringMode,
  cableAuthoringMode,
  tool,
  snapStrength,
  selectedBox,
  metadataStatus,
  symbolBankStatus,
  annotationStatus,
  exportYolov26Url,
  exportGoogleObjectDetectionUrl,
  exportQwen3vlColabDatasetUrl,
  readOnly,
  placement = "viewport",
  onModeChange,
  onComponentAuthoringModeChange,
  onWireAuthoringModeChange,
  onCableAuthoringModeChange,
  onToolChange,
  onSnapStrengthChange,
  onSnapSelected,
  onCycleLabelCandidate,
  onSavePage,
  onDetectYoloPage,
  yoloTool,
  onYoloToolChange,
  onYolov26DetectSettingsChange,
  yolov26DetectSettings,
  onClearYoloPage,
  onClearYoloAiPage,
  onClearYoloHumanPage,
}: {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  activeMode: AnnotationMode;
  componentAuthoringMode: ComponentAuthoringMode;
  wireAuthoringMode: WireAuthoringMode;
  cableAuthoringMode: CableAuthoringMode;
  tool: StudioTool;
  snapStrength: SnapStrength;
  selectedBox: AnnotationBox | null;
  metadataStatus: "loading" | "ready" | "error";
  symbolBankStatus: "loading" | "ready" | "error";
  annotationStatus: AnnotationStatus;
  exportYolov26Url: string;
  exportGoogleObjectDetectionUrl: string;
  exportQwen3vlColabDatasetUrl: string;
  readOnly: boolean;
  placement?: "viewport" | "rail";
  onModeChange: (mode: AnnotationMode) => void;
  onComponentAuthoringModeChange: (mode: ComponentAuthoringMode) => void;
  onWireAuthoringModeChange: (mode: WireAuthoringMode) => void;
  onCableAuthoringModeChange: (mode: CableAuthoringMode) => void;
  onToolChange: (tool: StudioTool) => void;
  onSnapStrengthChange: (strength: SnapStrength) => void;
  onSnapSelected: () => void;
  onCycleLabelCandidate: (direction: 1 | -1) => void;
  onSavePage: () => void;
  onDetectYoloPage: () => void;
  yoloTool: YoloTool;
  onYoloToolChange: (tool: YoloTool) => void;
  onYolov26DetectSettingsChange: (settings: Yolov26DetectSettings) => void;
  yolov26DetectSettings: Yolov26DetectSettings;
  onClearYoloPage: () => void;
  onClearYoloAiPage: () => void;
  onClearYoloHumanPage: () => void;
}) {
  if (annotationWorkspaceMode === "yolo") {
    return (
      <YoloToolPanel
        placement={placement}
        annotationStatus={annotationStatus}
        symbolBankStatus={symbolBankStatus}
        onDetectYoloPage={onDetectYoloPage}
        yoloTool={yoloTool}
        onYoloToolChange={onYoloToolChange}
        onYolov26DetectSettingsChange={onYolov26DetectSettingsChange}
        yolov26DetectSettings={yolov26DetectSettings}
        onClearYoloPage={onClearYoloPage}
        onClearYoloAiPage={onClearYoloAiPage}
        onClearYoloHumanPage={onClearYoloHumanPage}
      />
    );
  }

  const mode =
    ANNOTATION_MODES.find((candidate) => candidate.id === activeMode) ??
    ANNOTATION_MODES[0];
  const ActiveIcon = mode.icon;
  const candidateCount = selectedBox?.labelCandidates.length ?? 0;
  const railPlacement = placement === "rail";
  type AnnotationModeTool = (typeof ANNOTATION_MODES)[number] & {
    key: string;
    componentAuthoringMode?: ComponentAuthoringMode;
  };
  const annotationModeTools: AnnotationModeTool[] = [];
  for (const annotationMode of ANNOTATION_MODES) {
    if (
      annotationWorkspaceMode !== "training_dataset" ||
      annotationMode.id !== "component"
    ) {
      annotationModeTools.push({ ...annotationMode, key: annotationMode.id });
      continue;
    }
    annotationModeTools.push(
      { ...annotationMode, key: annotationMode.id },
      {
        ...annotationMode,
        key: "component_manual_label",
        label: "Typed Component",
        shortLabel: "TXT",
        description: "Component bbox with manually entered label text",
        icon: Tags,
        componentAuthoringMode: "component_manual_label" as ComponentAuthoringMode,
      }
    );
  }
  const openExport = (url: string) => {
    if (!url || typeof window === "undefined") return;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const componentAuthoringTools: Array<{
    id: ComponentAuthoringMode;
    label: string;
    shortLabel: string;
    icon: typeof SquareDashedMousePointer;
  }> = [
    {
      id: "component",
      label: "Component body",
      shortLabel: "BODY",
      icon: SquareDashedMousePointer,
    },
    {
      id: "connector",
      label: "Connector",
      shortLabel: "CONN",
      icon: Cable,
    },
  ];
  const componentTools = [
    {
      id: "select",
      label: "Select",
      icon: MousePointer2,
      active: tool === "select",
      disabled: false,
      action: () => onToolChange("select"),
    },
    {
      id: "box",
      label: "Draw",
      icon: SquareDashedMousePointer,
      active: tool === "box",
      disabled: false,
      action: () => onToolChange("box"),
    },
    {
      id: "pan",
      label: "Pan",
      icon: Hand,
      active: tool === "pan",
      disabled: false,
      action: () => onToolChange("pan"),
    },
    {
      id: "snap",
      label: "Snap",
      icon: WandSparkles,
      active: false,
      disabled: readOnly || !selectedBox || metadataStatus !== "ready",
      action: onSnapSelected,
    },
    {
      id: "label",
      label: "Label",
      icon: Tags,
      active: false,
      disabled: readOnly || !selectedBox || candidateCount < 2,
      action: () => onCycleLabelCandidate(1),
    },
  ];
  const cableTools: Array<{
    id: CableAuthoringMode;
    label: string;
    shortLabel: string;
    icon: typeof Cable;
  }> = [
    {
      id: "geometry",
      label: "Cable geometry",
      shortLabel: "GEO",
      icon: Cable,
    },
    {
      id: "reference",
      label: "Cable reference",
      shortLabel: "REF",
      icon: FileText,
    },
  ];
  const wireTools: Array<{
    id: WireAuthoringMode;
    label: string;
    shortLabel: string;
    icon: typeof ScanSearch;
  }> = [
    {
      id: "auto",
      label: "Auto wire snap",
      shortLabel: "AUTO",
      icon: ScanSearch,
    },
    {
      id: "manual",
      label: "Manual wire draw",
      shortLabel: "MAN",
      icon: SquareDashedMousePointer,
    },
  ];

  return (
    <section
      data-testid="studio-tool-panel"
      className={`z-40 flex select-none flex-col gap-2 rounded-2xl border border-cyan-300/20 bg-black/82 text-slate-100 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.95)] backdrop-blur-xl ${
        railPlacement
          ? "relative w-full min-w-0 gap-1.5 p-1.5"
          : "absolute left-3 top-16 w-[236px] max-w-[calc(100%-1.5rem)] p-2.5"
      }`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[8px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
            Tools
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <ActiveIcon className="h-3.5 w-3.5 shrink-0 text-cyan-100" />
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-100">
              {mode.label}
            </span>
          </div>
        </div>
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            annotationStatus === "dirty"
              ? "bg-amber-300"
              : annotationStatus === "error"
                ? "bg-rose-400"
                : "bg-emerald-300"
          }`}
          title={`Save state: ${annotationStatus}`}
        />
      </div>

      <div className={railPlacement ? "grid grid-cols-4 gap-1" : "grid grid-cols-3 gap-1.5"}>
        {annotationModeTools.map((annotationMode) => {
          const Icon = annotationMode.icon;
          const active =
            annotationMode.componentAuthoringMode === "component_manual_label"
              ? activeMode === "component" &&
                componentAuthoringMode === "component_manual_label"
              : annotationMode.id === activeMode &&
                !(
                  annotationMode.id === "component" &&
                  componentAuthoringMode === "component_manual_label"
                );
          return (
            <button
              key={annotationMode.key}
              type="button"
              data-testid={`annotation-mode-${annotationMode.key}`}
              onClick={() => {
                if (annotationMode.componentAuthoringMode) {
                  onComponentAuthoringModeChange(annotationMode.componentAuthoringMode);
                  onModeChange("component");
                  onToolChange("box");
                  return;
                }
                if (annotationMode.id === "component") {
                  onComponentAuthoringModeChange("component");
                }
                onModeChange(annotationMode.id);
              }}
              className={`flex min-w-0 items-center justify-center gap-1 rounded-lg border text-[8px] font-semibold uppercase tracking-[0.08em] transition ${
                railPlacement ? "h-8 px-1" : "h-10 px-1.5"
              } ${
                active
                  ? "border-cyan-200/70 bg-cyan-300/20 text-cyan-50"
                  : "border-white/10 bg-white/[0.045] text-slate-300 hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-50"
              }`}
              title={`${annotationMode.label}: ${annotationMode.description}`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className={railPlacement ? "sr-only" : "truncate"}>
                  {annotationMode.shortLabel}
                </span>
              </button>
          );
        })}
      </div>

      <div
        className={`grid items-center ${
          railPlacement
            ? "grid-cols-[34px_repeat(4,minmax(0,1fr))] gap-1"
            : "grid-cols-[44px_repeat(4,minmax(0,1fr))] gap-1.5"
        }`}
        role="group"
        aria-label="Snap strength"
      >
        <div className="text-[8px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Snap
        </div>
        {SNAP_STRENGTH_OPTIONS.map((option) => {
          const active = option.id === snapStrength;
          return (
            <button
              key={option.id}
              type="button"
              data-testid={`snap-strength-${option.id}`}
              aria-pressed={active}
              aria-label={`Snap strength: ${option.label}`}
              onClick={() => onSnapStrengthChange(option.id)}
              className={`flex min-w-0 items-center justify-center rounded-lg border px-1 text-[8px] font-semibold uppercase tracking-[0.06em] transition ${
                railPlacement ? "h-7" : "h-8"
              } ${
                active
                  ? "border-fuchsia-100/75 bg-fuchsia-300/20 text-fuchsia-50"
                  : "border-white/10 bg-white/[0.045] text-slate-300 hover:border-fuchsia-300/40 hover:bg-fuchsia-300/10 hover:text-fuchsia-50"
              }`}
              title={option.label}
            >
              <span className="truncate">{option.shortLabel}</span>
            </button>
          );
        })}
      </div>

      {activeMode === "component" ? (
        <>
          <div className={railPlacement ? "grid grid-cols-2 gap-1" : "grid grid-cols-2 gap-1.5"}>
            {componentAuthoringTools.map((componentAuthoringTool) => {
              const Icon = componentAuthoringTool.icon;
              const active = componentAuthoringTool.id === componentAuthoringMode;
              return (
                <button
                  key={componentAuthoringTool.id}
                  type="button"
                  data-testid={`component-authoring-${componentAuthoringTool.id}`}
                  onClick={() => {
                    onComponentAuthoringModeChange(componentAuthoringTool.id);
                    onToolChange("box");
                  }}
                  className={`flex items-center justify-center gap-1 rounded-lg border px-2 text-[8px] font-semibold uppercase tracking-[0.08em] transition ${
                    railPlacement ? "h-8" : "h-9"
                  } ${
                    active
                      ? "border-orange-100/75 bg-orange-300/20 text-orange-50"
                      : "border-white/10 bg-white/[0.045] text-slate-300 hover:border-orange-300/40 hover:bg-orange-300/10 hover:text-orange-50"
                  }`}
                  title={componentAuthoringTool.label}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{componentAuthoringTool.shortLabel}</span>
                </button>
              );
            })}
          </div>
          <div className={railPlacement ? "grid grid-cols-5 gap-1" : "grid grid-cols-5 gap-1.5"}>
            {componentTools.map((componentTool) => {
              const Icon = componentTool.icon;
              return (
                <button
                  key={componentTool.id}
                  type="button"
                  data-testid={`component-tool-${componentTool.id}`}
                  disabled={componentTool.disabled}
                  onClick={componentTool.action}
                  className={`flex items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    railPlacement ? "h-8" : "h-9"
                  } ${
                    componentTool.active
                      ? "border-amber-200/70 bg-amber-300/20 text-amber-50"
                      : "border-white/10 bg-white/[0.045] text-slate-300 hover:border-amber-300/40 hover:bg-amber-300/10 hover:text-amber-50"
                  }`}
                  title={componentTool.label}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="sr-only">{componentTool.label}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {activeMode === "wire" ? (
        <div className={railPlacement ? "grid grid-cols-2 gap-1" : "grid grid-cols-2 gap-1.5"}>
          {wireTools.map((wireTool) => {
            const Icon = wireTool.icon;
            const active = wireTool.id === wireAuthoringMode;
            return (
              <button
                key={wireTool.id}
                type="button"
                data-testid={`wire-tool-${wireTool.id}`}
                onClick={() => {
                  onWireAuthoringModeChange(wireTool.id);
                  onToolChange(wireTool.id === "manual" ? "box" : "select");
                }}
                className={`flex items-center justify-center gap-1 rounded-lg border px-2 text-[8px] font-semibold uppercase tracking-[0.08em] transition ${
                  railPlacement ? "h-8" : "h-9"
                } ${
                  active
                    ? "border-sky-100/75 bg-sky-300/22 text-sky-50"
                    : "border-white/10 bg-white/[0.045] text-slate-300 hover:border-sky-300/40 hover:bg-sky-300/10 hover:text-sky-50"
                }`}
                title={wireTool.label}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{wireTool.shortLabel}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {activeMode === "cable" ? (
        <div className={railPlacement ? "grid grid-cols-2 gap-1" : "grid grid-cols-2 gap-1.5"}>
          {cableTools.map((cableTool) => {
            const Icon = cableTool.icon;
            const active = cableTool.id === cableAuthoringMode;
            return (
              <button
                key={cableTool.id}
                type="button"
                data-testid={`cable-tool-${cableTool.id}`}
                onClick={() => {
                  onCableAuthoringModeChange(cableTool.id);
                  onToolChange("box");
                }}
                className={`flex items-center justify-center gap-1 rounded-lg border px-2 text-[8px] font-semibold uppercase tracking-[0.08em] transition ${
                  railPlacement ? "h-8" : "h-9"
                } ${
                  active
                    ? "border-teal-100/75 bg-teal-300/22 text-teal-50"
                    : "border-white/10 bg-white/[0.045] text-slate-300 hover:border-teal-300/40 hover:bg-teal-300/10 hover:text-teal-50"
                }`}
                title={cableTool.label}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{cableTool.shortLabel}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className={railPlacement ? "grid grid-cols-2 gap-1" : "grid grid-cols-2 gap-1.5"}>
        <CompactStatus label="bank" value={symbolBankStatus} />
        <CompactStatus label="save" value={annotationStatus} />
      </div>
      <div className={railPlacement ? "grid grid-cols-4 gap-1" : "grid grid-cols-4 gap-1.5"}>
        <button
          type="button"
          data-testid="component-tool-export-yolov26"
          onClick={() => openExport(exportYolov26Url)}
          className={`flex h-full w-full items-center justify-center rounded-xl border border-sky-300/25 bg-sky-300/10 text-sky-100 transition hover:border-sky-200/60 hover:bg-sky-300/18 disabled:cursor-not-allowed disabled:opacity-45 ${
            railPlacement ? "min-h-9" : "min-h-10"
          }`}
          title="Export YOLOv26 dataset"
          aria-label="Export YOLOv26 dataset"
          disabled={!exportYolov26Url}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          data-testid="component-tool-export-google-object-detection"
          onClick={() => openExport(exportGoogleObjectDetectionUrl)}
          className={`flex h-full w-full items-center justify-center rounded-xl border border-violet-300/25 bg-violet-300/10 text-violet-100 transition hover:border-violet-200/60 hover:bg-violet-300/18 disabled:cursor-not-allowed disabled:opacity-45 ${
            railPlacement ? "min-h-9" : "min-h-10"
          }`}
          title="Export Google object detection CSV"
          aria-label="Export Google object detection CSV"
          disabled={!exportGoogleObjectDetectionUrl}
        >
          <FileText className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          data-testid="component-tool-export-qwen3vl-colab"
          onClick={() => openExport(exportQwen3vlColabDatasetUrl)}
          className={`flex h-full w-full items-center justify-center rounded-xl border border-fuchsia-300/25 bg-fuchsia-300/10 text-fuchsia-100 transition hover:border-fuchsia-200/60 hover:bg-fuchsia-300/18 disabled:cursor-not-allowed disabled:opacity-45 ${
            railPlacement ? "min-h-9" : "min-h-10"
          }`}
          title="Export Qwen3-VL Colab dataset"
          aria-label="Export Qwen3-VL Colab dataset"
          disabled={!exportQwen3vlColabDatasetUrl}
        >
          <WandSparkles className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          data-testid="component-tool-save"
          disabled={
            readOnly || annotationStatus === "saving" || annotationStatus === "loading"
          }
          onClick={onSavePage}
          className={`flex h-full w-full items-center justify-center rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-100 transition hover:border-emerald-200/60 hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:opacity-45 ${
            railPlacement ? "min-h-9" : "min-h-10"
          }`}
          title={annotationStatus === "saving" ? "Saving" : "Save"}
        >
          <Save className="h-3.5 w-3.5" />
          <span className="sr-only">Save</span>
        </button>
      </div>
    </section>
  );
}

function YoloToolPanel({
  placement = "viewport",
  annotationStatus,
  symbolBankStatus,
  onDetectYoloPage,
  yoloTool,
  onYoloToolChange,
  onYolov26DetectSettingsChange,
  yolov26DetectSettings,
  onClearYoloPage,
  onClearYoloAiPage,
  onClearYoloHumanPage,
}: {
  placement?: "viewport" | "rail";
  annotationStatus: AnnotationStatus;
  symbolBankStatus: "loading" | "ready" | "error";
  onDetectYoloPage: () => void;
  yoloTool: YoloTool;
  onYoloToolChange: (tool: YoloTool) => void;
  onYolov26DetectSettingsChange: (settings: Yolov26DetectSettings) => void;
  yolov26DetectSettings: Yolov26DetectSettings;
  onClearYoloPage: () => void;
  onClearYoloAiPage: () => void;
  onClearYoloHumanPage: () => void;
}) {
  const railPlacement = placement === "rail";
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const updateYolov26Setting = (
    key: keyof Yolov26DetectSettings,
    value: number | boolean
  ) => {
    onYolov26DetectSettingsChange({
      ...yolov26DetectSettings,
      [key]: value,
    });
  };
  return (
    <>
      <section
        data-testid="yolo-tool-panel"
        className={`z-40 flex select-none flex-col gap-2 rounded-2xl border border-amber-300/25 bg-black/82 text-slate-100 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.95)] backdrop-blur-xl ${
          railPlacement
            ? "relative w-full min-w-0 gap-2 p-2"
            : "absolute left-3 top-16 w-[236px] max-w-[calc(100%-1.5rem)] p-2.5"
        }`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[8px] font-semibold uppercase tracking-[0.2em] text-amber-200">
              YOLO Toolbox
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <SquareDashedMousePointer className="h-3.5 w-3.5 shrink-0 text-amber-100" />
              <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-100">
                Component bbox
              </span>
            </div>
          </div>
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              annotationStatus === "dirty"
                ? "bg-amber-300"
                : annotationStatus === "error"
                  ? "bg-rose-400"
                  : "bg-emerald-300"
            }`}
            title={`Save state: ${annotationStatus}`}
          />
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          <YoloToolButton
            label="Detect"
            title="Open YOLOv26 page detection settings"
            icon={<ScanSearch className="h-3.5 w-3.5" />}
            onClick={() => setSettingsModalOpen(true)}
            disabled={annotationStatus === "loading" || annotationStatus === "saving"}
            active={settingsModalOpen}
            tone="red"
            testId="yolo-tool-detect-page"
          />
          <YoloToolButton
            label="Area"
            title="Select Area, then click-drag a blue focus box; YOLO runs inside that area"
            icon={<SquareDashedMousePointer className="h-3.5 w-3.5" />}
            onClick={() => {
              onYoloToolChange("detect_area");
              setSettingsModalOpen(true);
            }}
            active={yoloTool === "detect_area"}
            tone="cyan"
            testId="yolo-tool-detect-area"
          />
          <YoloToolButton
            label="Manual"
            title="Click and drag on the page to draw an exact human bbox"
            icon={<MousePointer2 className="h-3.5 w-3.5" />}
            onClick={() => {
              onYoloToolChange("manual_bbox");
              setSettingsModalOpen(false);
            }}
            active={yoloTool === "manual_bbox"}
            tone="amber"
            testId="yolo-tool-manual-bbox"
          />
          <YoloToolButton
            label="Cont"
            title="Continuation symbol: click H marker center. Shift-click a ground symbol to place a ground bbox."
            icon={<GitBranch className="h-3.5 w-3.5" />}
            onClick={() => {
              onYoloToolChange("continuation_symbol");
              setSettingsModalOpen(false);
            }}
            active={yoloTool === "continuation_symbol"}
            tone="cyan"
            testId="yolo-tool-continuation"
          />
          <YoloToolButton
            label="Expand"
            title="Draw over bboxes to activate them; ArrowUp expands and ArrowDown contracts by 1 px"
            icon={<Maximize2 className="h-3.5 w-3.5" />}
            onClick={() => {
              onYoloToolChange("bulk_expand");
              setSettingsModalOpen(false);
            }}
            active={yoloTool === "bulk_expand"}
            tone="green"
            testId="yolo-tool-bulk-expand"
          />
          <YoloToolButton
            label="Settings"
            title="Show YOLO detection settings"
            icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
            onClick={() => setSettingsModalOpen(true)}
            active={settingsModalOpen}
            tone="violet"
            testId="yolo-tool-settings"
          />
          <YoloToolButton
            label="All"
            title="Remove all bboxes from the current YOLO page"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={onClearYoloPage}
            disabled={annotationStatus === "loading" || annotationStatus === "saving"}
            tone="rose"
            testId="yolo-tool-clear-page"
          />
          <YoloToolButton
            label="Model"
            title="Remove only YOLO model proposal bboxes from this page"
            icon={<EyeOff className="h-3.5 w-3.5" />}
            onClick={onClearYoloAiPage}
            disabled={annotationStatus === "loading" || annotationStatus === "saving"}
            tone="rose"
            testId="yolo-tool-clear-model"
          />
          <YoloToolButton
            label="Human"
            title="Remove only human-reviewed/manual bboxes from this page"
            icon={<Hand className="h-3.5 w-3.5" />}
            onClick={onClearYoloHumanPage}
            disabled={annotationStatus === "loading" || annotationStatus === "saving"}
            tone="rose"
            testId="yolo-tool-clear-human"
          />
        </div>
        <div className={railPlacement ? "grid grid-cols-2 gap-1" : "grid grid-cols-2 gap-1.5"}>
          <CompactStatus label="bank" value={symbolBankStatus} />
          <CompactStatus label="save" value={annotationStatus} />
        </div>
      </section>
      {settingsModalOpen ? (
        <YoloDetectSettingsModal
          settings={yolov26DetectSettings}
          updateSetting={updateYolov26Setting}
          onClose={() => setSettingsModalOpen(false)}
          onDetectPage={() => {
            setSettingsModalOpen(false);
            onDetectYoloPage();
          }}
          detectDisabled={annotationStatus === "loading" || annotationStatus === "saving"}
          areaModeActive={yoloTool === "detect_area"}
        />
      ) : null}
    </>
  );
}

function YoloDetectSettingsModal({
  settings,
  updateSetting,
  onClose,
  onDetectPage,
  detectDisabled,
  areaModeActive,
}: {
  settings: Yolov26DetectSettings;
  updateSetting: (key: keyof Yolov26DetectSettings, value: number | boolean) => void;
  onClose: () => void;
  onDetectPage: () => void;
  detectDisabled: boolean;
  areaModeActive: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/58 px-4 backdrop-blur-[2px]"
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="YOLO detection settings"
        className="w-full max-w-sm rounded-2xl border border-amber-200/30 bg-slate-950/96 p-3 text-slate-100 shadow-[0_28px_90px_-30px_rgba(251,191,36,0.45)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-200">
              YOLO Detection
            </div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {areaModeActive ? "Area mode settings" : "Page detection settings"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300 transition hover:border-white/30 hover:text-white"
          >
            Close
          </button>
        </div>
        <div className="mt-3 grid gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3">
          <label className="grid gap-1.5">
            <span className="flex items-center justify-between text-[9px] font-black uppercase tracking-[0.15em] text-amber-100">
              <span>Confidence</span>
              <span>{settings.conf.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min="0.05"
              max="0.95"
              step="0.05"
              value={settings.conf}
              onChange={(event) =>
                updateSetting("conf", Number(event.currentTarget.value))
              }
              className="h-2 w-full accent-red-400"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="flex items-center justify-between text-[9px] font-black uppercase tracking-[0.15em] text-amber-100">
              <span>NMS IoU</span>
              <span>{settings.iou.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min="0.05"
              max="0.90"
              step="0.05"
              value={settings.iou}
              onChange={(event) =>
                updateSetting("iou", Number(event.currentTarget.value))
              }
              className="h-2 w-full accent-red-400"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[9px] font-black uppercase tracking-[0.15em] text-amber-100">
              Image size
            </span>
            <select
              value={settings.imgsz}
              onChange={(event) =>
                updateSetting("imgsz", Number(event.currentTarget.value))
              }
              className="h-9 rounded-lg border border-amber-200/20 bg-black/60 px-2 text-[11px] font-bold text-amber-50 outline-none"
            >
              <option value={960}>960</option>
              <option value={1280}>1280</option>
              <option value={1600}>1600</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 rounded-lg border border-amber-200/15 bg-black/35 px-2 py-2">
            <span className="text-[9px] font-black uppercase tracking-[0.15em] text-amber-100">
              Cross-class NMS
            </span>
            <input
              type="checkbox"
              checked={settings.agnosticNms}
              onChange={(event) =>
                updateSetting("agnosticNms", event.currentTarget.checked)
              }
              className="h-4 w-4 accent-red-400"
            />
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300 transition hover:border-white/30 hover:text-white"
          >
            Done
          </button>
          <button
            type="button"
            disabled={detectDisabled}
            onClick={onDetectPage}
            className="rounded-xl border border-red-300/35 bg-red-500/18 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-red-50 transition hover:border-red-200/70 hover:bg-red-500/28 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Run Page Detection
          </button>
        </div>
      </section>
    </div>
  );
}

function YoloToolButton({
  label,
  title,
  icon,
  onClick,
  disabled = false,
  active = false,
  tone,
  testId,
}: {
  label: string;
  title: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  tone: "red" | "cyan" | "amber" | "violet" | "rose" | "green";
  testId?: string;
}) {
  const toneClass = {
    red: "border-red-300/35 bg-red-500/12 text-red-100 hover:border-red-200/70 hover:bg-red-500/22",
    cyan: "border-cyan-300/35 bg-cyan-500/10 text-cyan-100 hover:border-cyan-200/70 hover:bg-cyan-500/20",
    amber: "border-amber-300/35 bg-amber-500/10 text-amber-100 hover:border-amber-200/70 hover:bg-amber-500/20",
    violet: "border-violet-300/35 bg-violet-500/10 text-violet-100 hover:border-violet-200/70 hover:bg-violet-500/20",
    rose: "border-rose-300/35 bg-rose-500/10 text-rose-100 hover:border-rose-200/70 hover:bg-rose-500/20",
    green: "border-emerald-300/35 bg-emerald-500/10 text-emerald-100 hover:border-emerald-200/70 hover:bg-emerald-500/20",
  }[tone];
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`flex aspect-square min-h-10 flex-col items-center justify-center gap-1 rounded-xl border text-[7px] font-black uppercase tracking-[0.1em] transition disabled:cursor-not-allowed disabled:opacity-45 ${
        active ? "shadow-[0_0_18px_rgba(103,232,249,0.22)] ring-1 ring-cyan-200/40" : ""
      } ${toneClass}`}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}
