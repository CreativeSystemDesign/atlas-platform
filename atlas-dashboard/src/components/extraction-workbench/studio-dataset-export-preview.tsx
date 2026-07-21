"use client";

import type { ReactNode } from "react";
import { FileJson, Link2 } from "lucide-react";

import { attachmentsOf } from "./annotation-box-helpers";
import {
  datasetAttachmentClassName,
  datasetComponentClassName,
  datasetComponentLinkedClassName,
  isDatasetComponentTrainingPairRoot,
} from "./dataset-class-tracker";
import { componentPartsTagForBox } from "./component-parts-tag";
import type { AnnotationAttachment, AnnotationBox } from "./studio-types";
import { DOCUMENT_ID, PAGE_HEIGHT_PX, PAGE_WIDTH_PX } from "./studio-types";

type DatasetExportPreviewProps = {
  boxesForPage: AnnotationBox[];
};

type DatasetTrack = {
  id: string;
  label: string;
  component: AnnotationBox;
  attachments: AnnotationAttachment[];
};

type DatasetObject = {
  id: string;
  trackId: string;
  trackLabel: string;
  className: string;
  role: string;
  bbox: AnnotationBox["bbox"];
  text?: string;
};

type DatasetClassCount = {
  label: string;
  count: number;
};

export function DatasetExportPreview({ boxesForPage }: DatasetExportPreviewProps) {
  const tracks = datasetTracksForPage(boxesForPage);
  const completeTracks = tracks.filter((track) => track.component.labelBbox);
  const incompleteTracks = tracks.filter((track) => !track.component.labelBbox);
  const incompleteCount = incompleteTracks.length;
  const pageNum = boxesForPage[0]?.pageNum ?? 0;
  const imageName = imageNameForPage(pageNum);
  const xml = formatTracksXml(completeTracks);
  const jsonl = formatTracksJsonl({
    imageName,
    pageNum,
    tracks: completeTracks,
  });
  const classCounts = datasetClassCountsForTracks(completeTracks);

  return (
    <aside className="flex min-h-0 flex-col gap-2 overflow-hidden pr-1">
      <div className="rounded-2xl border border-cyan-300/20 bg-black/70 p-3 shadow-[0_18px_48px_-34px_rgba(0,0,0,0.95)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
              <Link2 className="h-3.5 w-3.5" />
              Export Classes
            </div>
          </div>
          <div className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-100">
            {completeTracks.length}/{tracks.length}
          </div>
        </div>
        {incompleteCount > 0 ? (
          <div className="mt-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-2.5 py-2 text-[10px] leading-4 text-amber-100/85">
            <div className="font-semibold uppercase tracking-[0.12em] text-amber-100">
              {incompleteCount} component{incompleteCount === 1 ? "" : "s"} need
              label bbox{incompleteCount === 1 ? "" : "es"}
            </div>
            <div className="mt-1 text-amber-100/75">
              Amber boxes on the PDF are excluded until their label bbox is drawn.
            </div>
            <div className="mt-2 grid gap-1">
              {incompleteTracks.map((track) => (
                <div
                  key={track.component.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-lg border border-amber-200/20 bg-black/28 px-2 py-1.5"
                  title={`Missing label bbox for ${missingTrackTitle(track)}`}
                >
                  <span className="min-w-0 truncate font-semibold uppercase tracking-[0.08em] text-amber-50">
                    {missingTrackTitle(track)}
                  </span>
                  <span className="font-mono text-[9px] text-amber-100/75">
                    {formatBboxCenter(track.component.bbox)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-2 px-2 text-[8px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <span>Class</span>
          <span>Objects</span>
        </div>
        <div className="mt-2 grid max-h-28 grid-cols-2 gap-1.5 overflow-auto pr-1">
          {classCounts.length > 0 ? (
            classCounts.map((entry) => (
              <div
                key={entry.label}
                className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.055] px-2 py-1.5"
                title={`${entry.label}: ${entry.count} objects`}
              >
                <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <span className="truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-50">
                    {entry.label}
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-cyan-100">
                    {entry.count}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-2 rounded-lg border border-white/10 bg-white/[0.045] px-2 py-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              No exportable classes yet
            </div>
          )}
        </div>
      </div>

      <PreviewPanel
        title="XML Dataset"
        icon={<Link2 className="h-3.5 w-3.5" />}
        value={xml}
        empty="<!-- Draw component boxes with label boxes to generate export tracks. -->"
      />
      <PreviewPanel
        title="JSONL Dataset Row"
        icon={<FileJson className="h-3.5 w-3.5" />}
        value={jsonl}
        empty=""
        compact
      />
    </aside>
  );
}

function PreviewPanel({
  title,
  icon,
  value,
  empty,
  compact = false,
}: {
  title: string;
  icon: ReactNode;
  value: string;
  empty: string;
  compact?: boolean;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/60 p-3">
      <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.2em] text-primary">
        {icon}
        {title}
      </div>
      <pre
        className={`mt-2 min-h-0 flex-1 overflow-auto rounded-xl border border-cyan-300/15 bg-black/55 p-3 font-mono text-[10px] leading-5 text-cyan-50/90 shadow-[inset_0_0_34px_rgba(34,211,238,0.035)] ${
          compact ? "whitespace-pre-wrap break-words" : "whitespace-pre"
        }`}
      >
        {value || empty}
      </pre>
    </section>
  );
}

function datasetTracksForPage(boxesForPage: AnnotationBox[]): DatasetTrack[] {
  return boxesForPage
    .filter(isDatasetComponentTrainingPairRoot)
    .map((component, index) => {
      const attachments = [...attachmentsOf(component)].sort(
        compareDatasetAttachments
      );
      return {
        id: String(index + 1),
        label: sanitizeLabel(component.label || `component_${index + 1}`),
        component,
        attachments,
      };
    });
}

function formatTracksXml(tracks: DatasetTrack[]) {
  if (tracks.length === 0) return "";
  const componentBlock = tracks
    .map((track) => `  ${formatComponentXml(track).replaceAll("\n", "\n  ")}`)
    .join("\n");
  return `<annotation>
  <filename>${escapeXml(imageNameForPage(tracks[0]?.component.pageNum ?? 0))}</filename>
  <size>
    <width>${PAGE_WIDTH_PX}</width>
    <height>${PAGE_HEIGHT_PX}</height>
  </size>
${componentBlock}
</annotation>`;
}

function missingTrackTitle(track: DatasetTrack) {
  const tag = componentPartsTagForBox(track.component);
  const detectionClass = datasetDetectionClassName(track);
  return (
    tag?.label ||
    detectionClass ||
    track.component.label ||
    `component ${shortId(track.component.id)}`
  );
}

function formatBboxCenter(bbox: AnnotationBox["bbox"]) {
  const cx = Math.round(bbox.x + bbox.width / 2);
  const cy = Math.round(bbox.y + bbox.height / 2);
  return `${cx},${cy}`;
}

function shortId(id: string) {
  return id.replace(/^[^{\w]*|[^\w]*$/g, "").slice(-6) || id.slice(-6);
}

function formatTracksJsonl({
  imageName,
  pageNum,
  tracks,
}: {
  imageName: string;
  pageNum: number;
  tracks: DatasetTrack[];
}) {
  return JSON.stringify({
    image: imageName,
    page: pageNum,
    image_size: [PAGE_WIDTH_PX, PAGE_HEIGHT_PX],
    task: "schematic_component_grounding",
    annotations: tracks.map(datasetComponentRecordForTrack),
  }, null, 2);
}

function datasetObjectsForTrack(track: DatasetTrack): DatasetObject[] {
  const componentClassName = datasetDetectionClassName(track);
  const objects: DatasetObject[] = [
    {
      id: `${track.id}.body`,
      trackId: track.id,
      trackLabel: track.label,
      className: componentClassName,
      role: "component_body",
      bbox: track.component.bbox,
    },
  ];
  if (track.component.labelBbox) {
    objects.push({
      id: `${track.id}.label`,
      trackId: track.id,
      trackLabel: track.label,
      className: datasetComponentLinkedClassName(track.component.label, "label"),
      role: "component_label",
      bbox: track.component.labelBbox,
      text: datasetComponentClassName(track.component.label),
    });
  }
  return [...objects, ...datasetAttachmentObjectsForTrack(track)];
}

function datasetAttachmentObjectsForTrack(track: DatasetTrack): DatasetObject[] {
  const componentClassName = datasetDetectionClassName(track);
  return track.attachments.map((attachment, index) => ({
    id: `${track.id}.${index + 1}`,
    trackId: track.id,
    trackLabel: track.label,
    className: datasetLinkedClassName(
      datasetAttachmentClassName(attachment, track.component.label),
      componentClassName,
      attachment.type
    ),
    role: attachment.type,
    bbox: attachment.bbox,
    text: attachment.text ? sanitizeLabel(attachment.text) : undefined,
  }));
}

function formatComponentXml(track: DatasetTrack) {
  const identity = componentPartsTagForBox(track.component);
  const className = datasetDetectionClassName(track);
  const linkedRegions = linkedRegionObjectsForTrack(track)
    .map((object) => {
      return `    <region role="${escapeXml(object.role)}" class="${escapeXml(
        object.className
      )}"${formatXmlTextAttribute(object.text)}>
      ${formatBndboxXml(object.bbox, 6)}
    </region>`;
    })
    .join("\n");

  return `<component id="${escapeXml(track.id)}">
    <name>${escapeXml(className)}</name>
    <component_label>${escapeXml(datasetComponentClassName(track.component.label))}</component_label>
    <component_symbol>${escapeXml(componentSymbolForTrack(track))}</component_symbol>
    <component_description>${escapeXml(identity?.description || "")}</component_description>
    <component_part_number>${escapeXml(identity?.partNumber || "")}</component_part_number>
    <component_context_text>${escapeXml(componentContextTextForTrack(track))}</component_context_text>
    <component_location>${escapeXml(identity?.location || "")}</component_location>
    <parts_source_page>${escapeXml(identity?.sourcePage || "")}</parts_source_page>
    ${formatBndboxXml(track.component.bbox, 4)}
${linkedRegions}
  </component>`;
}

function datasetComponentRecordForTrack(track: DatasetTrack) {
  const identity = componentPartsTagForBox(track.component);
  return {
    id: track.id,
    class: datasetDetectionClassName(track),
    class_source: identity?.description ? "parts_list_description" : "annotation_label",
    schematic_class: datasetComponentClassName(track.component.label),
    component_label: datasetComponentClassName(track.component.label),
    component_symbol: componentSymbolForTrack(track) || null,
    component_description: identity?.description || null,
    component_part_number: identity?.partNumber || null,
    component_context_text: componentContextTextForTrack(track) || null,
    component_location: identity?.location || null,
    parts_source_page: identity?.sourcePage || null,
    bbox: bboxArray(track.component.bbox),
    normalized_bbox: normalizedBbox(track.component.bbox),
    linked_regions: linkedRegionObjectsForTrack(track).map((object) => ({
      id: object.id,
      role: object.role,
      class: object.className,
      bbox: bboxArray(object.bbox),
      normalized_bbox: normalizedBbox(object.bbox),
      ...(object.text ? { text: object.text } : {}),
    })),
  };
}

function componentSymbolForTrack(track: DatasetTrack) {
  const identity = componentPartsTagForBox(track.component);
  const schematicClass = datasetComponentClassName(track.component.label);
  return (
    leadingSymbolForClass(identity?.symbol, schematicClass) ||
    leadingSymbolForClass(track.component.label, schematicClass) ||
    schematicClass
  );
}

function leadingSymbolForClass(value: string | undefined, schematicClass: string) {
  const normalized = normalizeDatasetClassName(value);
  if (!normalized || schematicClass === "unknown_component") return "";
  const match = normalized.match(new RegExp(`^(${escapeRegExp(schematicClass)}\\\\d*)`));
  return match?.[1] ?? "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function linkedRegionObjectsForTrack(track: DatasetTrack): DatasetObject[] {
  return datasetObjectsForTrack(track).filter(
    (object) => object.role !== "component_body"
  );
}

function componentContextTextForTrack(track: DatasetTrack) {
  return track.attachments
    .filter((attachment) => attachment.type === "text")
    .map((attachment) => sanitizeLabel(attachment.text))
    .filter(Boolean)
    .join(" ");
}

function datasetDetectionClassName(track: DatasetTrack) {
  const identity = componentPartsTagForBox(track.component);
  return normalizeDatasetClassName(identity?.description) ||
    datasetComponentClassName(track.component.label);
}

function datasetLinkedClassName(
  fallbackClassName: string,
  componentClassName: string,
  role: AnnotationAttachment["type"]
) {
  if (role === "part_number") return `${componentClassName}_part_number`;
  if (role === "spec") return `${componentClassName}_spec`;
  return fallbackClassName;
}

function compareDatasetAttachments(
  left: AnnotationAttachment,
  right: AnnotationAttachment
) {
  const typeDelta =
    datasetAttachmentSortOrder(left.type) - datasetAttachmentSortOrder(right.type);
  if (typeDelta !== 0) return typeDelta;
  return left.bbox.y - right.bbox.y || left.bbox.x - right.bbox.x;
}

function datasetAttachmentSortOrder(type: AnnotationAttachment["type"]) {
  if (type === "terminal") return 10;
  if (type === "terminal_label") return 20;
  if (type === "part_number") return 30;
  if (type === "spec") return 40;
  if (type === "connection_point") return 50;
  if (type === "wire_label") return 60;
  if (type === "location") return 70;
  if (type === "text") return 80;
  return 90;
}

function formatXmlTextAttribute(value: string | undefined) {
  if (!value) return "";
  return ` text="${escapeXml(value)}"`;
}

function formatBndboxXml(box: AnnotationBox["bbox"], indent: number) {
  const pad = " ".repeat(indent);
  const [xmin, ymin, xmax, ymax] = bboxArray(box);
  return `<bndbox>
${pad}<xmin>${xmin}</xmin>
${pad}<ymin>${ymin}</ymin>
${pad}<xmax>${xmax}</xmax>
${pad}<ymax>${ymax}</ymax>
${" ".repeat(Math.max(0, indent - 2))}</bndbox>`;
}

function datasetClassCountsForTracks(tracks: DatasetTrack[]): DatasetClassCount[] {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    for (const object of datasetObjectsForTrack(track)) {
      counts.set(object.className, (counts.get(object.className) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({
      label,
      count,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function bboxArray(box: AnnotationBox["bbox"]) {
  const x1 = Math.round(box.x);
  const y1 = Math.round(box.y);
  const x2 = Math.round(box.x + box.width);
  const y2 = Math.round(box.y + box.height);
  return [x1, y1, x2, y2];
}

function normalizedBbox(box: AnnotationBox["bbox"]) {
  const [x1, y1, x2, y2] = bboxArray(box);
  return {
    x_min: normalizeCoordinate(x1, PAGE_WIDTH_PX),
    y_min: normalizeCoordinate(y1, PAGE_HEIGHT_PX),
    x_max: normalizeCoordinate(x2, PAGE_WIDTH_PX),
    y_max: normalizeCoordinate(y2, PAGE_HEIGHT_PX),
  };
}

function normalizeCoordinate(value: number, size: number) {
  return Math.max(0, Math.min(1, Number((value / size).toFixed(6))));
}

function sanitizeLabel(label: string) {
  return label.trim() || "unknown";
}

function normalizeDatasetClassName(value: string | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replaceAll("&", " AND ")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function imageNameForPage(pageNum: number) {
  return pageNum > 0
    ? `${DOCUMENT_ID}-page-${String(pageNum).padStart(3, "0")}.png`
    : `${DOCUMENT_ID}-page.png`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
