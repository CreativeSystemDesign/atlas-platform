"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { Activity, Download, Rocket, X } from "lucide-react";

import { datasetClassCountsForBoxes } from "./dataset-class-tracker";
import { Button } from "@/components/ui/button";
import { agentBaseUrl } from "@/lib/agent-base-url";
import {
  exportQwen3vlColabDrive,
  fetchVisionTrainingConfig,
  fetchVisionTrainingRun,
  launchVisionTrainingRun,
  qwen3vlColabDatasetExportUrl,
  qwen3vlColabNotebookExportUrl,
} from "./studio-api";
import type {
  AnnotationBox,
  AnnotationMode,
  AnnotationStatus,
  AnnotationWorkspaceMode,
  CableAuthoringMode,
  ComponentAuthoringMode,
  SnapStrength,
  StudioTool,
  VisionTrainingConfigResponse,
  VisionTrainingDatasetAudit,
  Qwen3vlDriveExportResponse,
  VisionTrainingRun,
  WireAuthoringMode,
  YoloTool,
  Yolov26DetectSettings,
  ClassTrackerEntry,
} from "./studio-types";
import {
  PROJECT_ID as ATLAS_PROJECT_ID,
  DOCUMENT_ID as ATLAS_DOCUMENT_ID,
} from "./studio-types";
import { StudioToolPanel } from "./studio-toolbars";

const RAIL_TARGET_ID = "extraction-studio-rail-tools";

type StudioWorkspaceRailControlsProps = {
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
  boxesForPage: AnnotationBox[];
  classTrackerStatus: "loading" | "ready" | "error";
  classTrackerCounts: ClassTrackerEntry[];
  classTrackerTotal: number;
  activeDatasetClassName: string | null;
  onDatasetClassSelect: (className: string | null) => void;
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
};

export function StudioWorkspaceRailControls({
  annotationWorkspaceMode,
  boxesForPage,
  classTrackerStatus,
  classTrackerCounts,
  classTrackerTotal,
  activeDatasetClassName,
  onDatasetClassSelect,
  exportQwen3vlColabDatasetUrl,
  ...toolPanelProps
}: StudioWorkspaceRailControlsProps) {
  const target = useRailTarget();
  const [trainingModalOpen, setTrainingModalOpen] = useState(false);
  const datasetCounts = useMemo(
    () => datasetClassCountsForBoxes(boxesForPage),
    [boxesForPage]
  );
  const datasetTotal = useMemo(
    () => datasetCounts.reduce((sum, entry) => sum + entry.count, 0),
    [datasetCounts]
  );
  if (!target) return null;

  return createPortal(
    <div className="flex h-full min-h-0 flex-col gap-2">
      <StudioToolPanel
        annotationWorkspaceMode={annotationWorkspaceMode}
        exportQwen3vlColabDatasetUrl={exportQwen3vlColabDatasetUrl}
        {...toolPanelProps}
        placement="rail"
      />
      {annotationWorkspaceMode === "training_dataset" ? (
        <>
          <VisionTrainingPanel onOpen={() => setTrainingModalOpen(true)} />
          <ClassTrackerPanel
            status="ready"
            counts={datasetCounts}
            total={datasetTotal}
            activeClassName={activeDatasetClassName}
            onClassSelect={(className) =>
              onDatasetClassSelect(
                activeDatasetClassName === className ? null : className
              )
            }
          />
          <VisionTrainingModal
            open={trainingModalOpen}
            onOpenChange={setTrainingModalOpen}
            exportQwen3vlColabDatasetUrl={exportQwen3vlColabDatasetUrl}
          />
        </>
      ) : null}
      {annotationWorkspaceMode === "yolo" ? (
        <ClassTrackerPanel
          title="YOLO Classes"
          subtitle="Annotated bboxes"
          emptyLabel="No YOLO bboxes"
          status={classTrackerStatus}
          counts={classTrackerCounts}
          total={classTrackerTotal}
          activeClassName={null}
          onClassSelect={() => undefined}
        />
      ) : null}
    </div>,
    target
  );
}

function useRailTarget() {
  return useSyncExternalStore(
    () => () => undefined,
    () =>
      typeof document === "undefined"
        ? null
        : document.getElementById(RAIL_TARGET_ID),
    () => null
  );
}

function VisionTrainingPanel({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="rounded-2xl border border-fuchsia-300/20 bg-black/82 p-2 text-slate-100 shadow-[0_18px_48px_-34px_rgba(0,0,0,0.95)]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[8px] font-semibold uppercase tracking-[0.2em] text-fuchsia-200">
            Vision Training
          </div>
          <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
            Colab Enterprise
          </div>
        </div>
        <button
          type="button"
          data-testid="vision-training-open"
          onClick={onOpen}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-fuchsia-300/30 bg-fuchsia-300/12 text-fuchsia-100 transition hover:border-fuchsia-100/70 hover:bg-fuchsia-300/22"
          title="Train model in Colab Enterprise"
          aria-label="Train model in Colab Enterprise"
        >
          <Rocket className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}

function VisionTrainingModal({
  open,
  onOpenChange,
  exportQwen3vlColabDatasetUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exportQwen3vlColabDatasetUrl: string;
}) {
  const [config, setConfig] = useState<VisionTrainingConfigResponse | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [run, setRun] = useState<VisionTrainingRun | null>(null);
  const [driveExport, setDriveExport] = useState<Qwen3vlDriveExportResponse | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "submitting" | "submitted" | "error">("idle");
  const [drivePhase, setDrivePhase] = useState<"idle" | "exporting" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const apiBase = useMemo(() => agentBaseUrl(), []);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setPhase("loading");
      setError(null);
    });
    fetchVisionTrainingConfig(fetch, apiBase, ATLAS_PROJECT_ID, ATLAS_DOCUMENT_ID)
      .then((nextConfig) => {
        setConfig(nextConfig);
        setForm(defaultTrainingForm(nextConfig));
        setRun(activeTrainingRun(nextConfig.recentRuns) ?? nextConfig.recentRuns[0] ?? null);
        setPhase("idle");
      })
      .catch((nextError) => {
        setError(errorMessage(nextError));
        setPhase("error");
      });
  }, [apiBase, open]);

  const pollingRun = isActiveTrainingRun(run) ? run : null;
  const pollingRunId = pollingRun?.training_run_id ?? "";
  const pollingRunStatus = pollingRun?.status ?? "";

  useEffect(() => {
    if (!open || !pollingRunId) return;
    const handle = window.setInterval(() => {
      fetchVisionTrainingRun(
        fetch,
        apiBase,
        ATLAS_PROJECT_ID,
        ATLAS_DOCUMENT_ID,
        pollingRunId
      )
        .then(setRun)
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(handle);
  }, [apiBase, open, pollingRunId, pollingRunStatus]);

  if (!open) return null;

  const modelLabel = modelLabelFromId(form.modelId || config?.defaults.modelId || "");
  const runtimeTemplates = config?.runtimeTemplates?.items ?? [];
  const selectedRuntimeTemplate =
    runtimeTemplates.find((template) => template.id === form.runtimeTemplate) ??
    runtimeTemplates.find((template) => template.displayName === form.runtimeTemplate) ??
    null;
  const costEffectiveGpuTemplate = runtimeTemplates.find(
    (template) =>
      runtimeAcceleratorRank(template.acceleratorType) > 0 &&
      (template.acceleratorCount || 0) === 1
  );
  const localExportUrl = qwen3vlColabDatasetExportUrl(
    apiBase,
    ATLAS_PROJECT_ID,
    ATLAS_DOCUMENT_ID,
    "training_dataset",
    form.classes || config?.defaults.classes || ""
  );
  const driveFolder = "atlas/qwen3vl";
  const proPlusNotebookUrl = qwen3vlColabNotebookExportUrl(
    apiBase,
    ATLAS_PROJECT_ID,
    ATLAS_DOCUMENT_ID,
    driveFolder,
    form.modelId || config?.defaults.modelId || ""
  );
  const fallbackLocalExportUrl = exportQwen3vlColabDatasetUrl || localExportUrl;
  const activeRun = isActiveTrainingRun(run)
    ? run
    : run
      ? null
      : activeTrainingRun(config?.recentRuns ?? []);
  const activeRunId = activeRun?.training_run_id ?? null;
  const displayedRun = activeRun ?? run;
  const canSubmit =
    !activeRunId &&
    phase !== "submitting" &&
    Boolean(form.gcsBucket?.trim()) &&
    Boolean(form.runtimeTemplate?.trim()) &&
    Boolean(form.modelId?.trim()) &&
    (Boolean(form.userEmail?.trim()) !== Boolean(form.serviceAccount?.trim()));

  const exportToDrive = () => {
    setDrivePhase("exporting");
    setDriveExport(null);
    setError(null);
    exportQwen3vlColabDrive(fetch, apiBase, ATLAS_PROJECT_ID, ATLAS_DOCUMENT_ID, {
      annotationMode: "training_dataset",
      classes: form.classes || config?.defaults.classes || "",
      driveFolder,
      modelId: form.modelId || config?.defaults.modelId || "",
    })
      .then((result) => {
        setDriveExport(result);
        setDrivePhase("saved");
      })
      .catch((nextError) => {
        setError(errorMessage(nextError));
        setDrivePhase("error");
      });
  };

  const submit = (launchModeOverride?: string) => {
    if (activeRunId) {
      setError(
        `Run ${activeRunId} is still ${activeRun?.status}/${activeRun?.phase}. Wait for it to finish before starting another.`
      );
      return;
    }
    setPhase("submitting");
    setError(null);
    launchVisionTrainingRun(fetch, apiBase, ATLAS_PROJECT_ID, ATLAS_DOCUMENT_ID, {
      trainer: form.trainer || "qwen3vl",
      modelId: form.modelId,
      datasetKind: form.datasetKind || "schematic_component_grounding",
      launchMode: launchModeOverride || form.launchMode || "stage_preflight",
      annotationMode: "training_dataset",
      classes: form.classes,
      region: form.region,
      gcsBucket: form.gcsBucket,
      gcsPrefix: form.gcsPrefix,
      runtimeTemplate: form.runtimeTemplate,
      userEmail: form.userEmail,
      serviceAccount: form.serviceAccount,
      executionTimeout: form.executionTimeout,
    })
      .then((nextRun) => {
        setRun(nextRun);
        setPhase("submitted");
      })
      .catch((nextError) => {
        setError(errorMessage(nextError));
        setPhase("error");
      });
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Vision training"
        className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-fuchsia-200/25 bg-slate-950 text-slate-100 shadow-[0_28px_120px_-36px_rgba(217,70,239,0.45)]"
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyan-300 via-fuchsia-300 to-amber-200" />
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-200">
              Colab Enterprise Training
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
              {modelLabel} schematic detector
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Export the current Dataset workspace locally, or stage the same object-detection package in GCS for Colab Enterprise.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-slate-300 transition hover:border-white/30 hover:text-white"
            aria-label="Close training modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-3">
            <div className="rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.055] p-3">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                <Download className="h-4 w-4" />
                Dataset Exports
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <a
                  href={localExportUrl || fallbackLocalExportUrl}
                  download
                  className="rounded-xl border border-cyan-200/30 bg-cyan-200/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:border-cyan-100/70 hover:bg-cyan-200/18"
                >
                  Export to Local Machine
                </a>
                <button
                  type="button"
                  onClick={exportToDrive}
                  disabled={drivePhase === "exporting"}
                  className="rounded-xl border border-emerald-200/30 bg-emerald-300/12 px-3 py-2 text-left text-xs font-semibold text-emerald-50 transition hover:border-emerald-100/70 hover:bg-emerald-300/22 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {drivePhase === "exporting" ? "Saving to Drive" : "Save to Drive for Pro+"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormValue(setForm, "launchMode", "stage_preflight");
                    submit("stage_preflight");
                  }}
                  disabled={!canSubmit}
                  className="rounded-xl border border-fuchsia-200/30 bg-fuchsia-300/14 px-3 py-2 text-left text-xs font-semibold text-fuchsia-50 transition hover:border-fuchsia-100/70 hover:bg-fuchsia-300/22 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Export to GCS for Colab
                </button>
                <a
                  href={proPlusNotebookUrl}
                  download
                  className="rounded-xl border border-white/15 bg-white/[0.055] px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-white/35 hover:bg-white/[0.09]"
                >
                  Download Pro+ Notebook
                </a>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-cyan-100/70">
                Local export downloads the dataset zip. Drive export saves the standalone Pro+ notebook, zip, and extracted dataset under lowercase atlas/qwen3vl/. GCS export stages the Enterprise package without starting training.
              </p>
              {driveExport ? (
                <div className="mt-3 rounded-xl border border-emerald-200/20 bg-emerald-300/[0.07] p-2 text-[11px] text-emerald-50">
                  <div className="font-semibold">Drive export saved: {driveExport.driveFolder}</div>
                  {driveExport.folder?.webViewLink ? (
                    <a
                      href={driveExport.folder.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block break-all text-emerald-100 underline decoration-emerald-200/40 underline-offset-2"
                    >
                      Open Drive folder
                    </a>
                  ) : null}
                  <div className="mt-1 text-emerald-100/70">
                    {(driveExport.files ?? []).length} files saved, including notebook, zip, and extracted dataset.
                  </div>
                </div>
              ) : null}
            </div>
            <TrainingField label="Model ID" value={form.modelId || ""} onChange={(value) => setFormValue(setForm, "modelId", value)} />
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Launch Mode
              </span>
              <select
                value={form.launchMode || "stage_preflight"}
                onChange={(event) => {
                  const launchMode = event.target.value;
                  setFormValue(setForm, "launchMode", launchMode);
                  if (launchMode === "eval_run" && costEffectiveGpuTemplate) {
                    setFormValue(setForm, "runtimeTemplate", costEffectiveGpuTemplate.id);
                  }
                  if (launchMode === "execute") {
                    const fastest = fastestRuntimeTemplate(runtimeTemplates);
                    if (fastest) setFormValue(setForm, "runtimeTemplate", fastest.id);
                  }
                }}
                className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-xs text-slate-100 outline-none transition focus:border-cyan-200/60"
              >
                <option value="stage_preflight">Preflight: export + stage to GCS, no execution</option>
                <option value="local_preflight">Local dry run: export + command validation only</option>
                <option value="eval_run">Eval run: 10-step low-cost execution</option>
                <option value="execute">Execute training: creates Colab Enterprise execution</option>
              </select>
            </label>
            <RuntimeTemplateSelector
              templates={runtimeTemplates}
              selectedTemplateId={form.runtimeTemplate || ""}
              status={config?.runtimeTemplates?.status || "loading"}
              error={config?.runtimeTemplates?.error}
              onChange={(value) => setFormValue(setForm, "runtimeTemplate", value)}
            />
            <RuntimeProfileControls
              templates={runtimeTemplates}
              selectedTemplate={selectedRuntimeTemplate}
              onSelectTemplate={(value) => setFormValue(setForm, "runtimeTemplate", value)}
            />
            <TrainingField label="Runtime Template ID" value={form.runtimeTemplate || ""} onChange={(value) => setFormValue(setForm, "runtimeTemplate", value)} />
            <TrainingField label="GCS Bucket" value={form.gcsBucket || ""} onChange={(value) => setFormValue(setForm, "gcsBucket", value)} />
            <TrainingField label="GCS Prefix" value={form.gcsPrefix || ""} onChange={(value) => setFormValue(setForm, "gcsPrefix", value)} />
            <TrainingField label="Class Filter" value={form.classes || ""} onChange={(value) => setFormValue(setForm, "classes", value)} />
            <div className="grid gap-3 md:grid-cols-2">
              <TrainingField label="Region" value={form.region || ""} onChange={(value) => setFormValue(setForm, "region", value)} />
              <TrainingField label="Timeout" value={form.executionTimeout || ""} onChange={(value) => setFormValue(setForm, "executionTimeout", value)} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <TrainingField label="User Email" value={form.userEmail || ""} onChange={(value) => setFormValue(setForm, "userEmail", value)} />
              <TrainingField label="Service Account" value={form.serviceAccount || ""} onChange={(value) => setFormValue(setForm, "serviceAccount", value)} />
            </div>
          </div>
          <div className="flex min-h-[360px] flex-col rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
              <Activity className="h-4 w-4" />
              Training Feedback
            </div>
            <div className="mt-3 space-y-2">
              {trainingSteps(phase, displayedRun).map((step) => (
                <div key={step.label} className="rounded-xl border border-white/10 bg-black/30 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-100">{step.label}</span>
                    <span className={stepClass(step.state)}>{step.state}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">{step.detail}</p>
                </div>
              ))}
            </div>
            {displayedRun ? (
              <div className="mt-3 space-y-1 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-2 text-[11px] text-cyan-50">
                <div className="flex items-center justify-between gap-2">
                  <span>Status: {displayedRun.status} / {displayedRun.phase}</span>
                  {activeRunId ? (
                    <span className="rounded-full border border-cyan-200/25 bg-cyan-200/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-cyan-100">
                      active
                    </span>
                  ) : null}
                </div>
                <div className="break-all">Run: {displayedRun.display_name || displayedRun.training_run_id}</div>
                <div>Updated: {formatTrainingTimestamp(displayedRun.updated_at)}</div>
                {displayedRun.dataset_uri ? <div className="break-all">Dataset: {displayedRun.dataset_uri}</div> : null}
                {displayedRun.notebook_uri ? <div className="break-all">Notebook: {displayedRun.notebook_uri}</div> : null}
                {displayedRun.execution_id ? <div>Execution: {displayedRun.execution_id}</div> : null}
                {displayedRun.execution_name ? <div className="break-all">Execution name: {displayedRun.execution_name}</div> : null}
                {displayedRun.output_uri ? <div className="break-all">Output: {displayedRun.output_uri}</div> : null}
              </div>
            ) : null}
            <TrainingRunLogPanel run={displayedRun} />
            <RuntimeEstimatePanel
              template={selectedRuntimeTemplate}
              executionTimeout={form.executionTimeout || ""}
              budgetNote={config?.budget?.note}
            />
            <DatasetAuditPanel run={displayedRun} />
            {error ? (
              <div className="mt-3 rounded-xl border border-rose-300/25 bg-rose-400/10 p-2 text-xs text-rose-100">
                {error}
              </div>
            ) : null}
            <div className="mt-auto flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button
                type="button"
                disabled={!canSubmit}
                onClick={() => submit()}
                data-testid="vision-training-submit"
                className="border border-fuchsia-200/30 bg-fuchsia-300/20 text-fuchsia-50 hover:bg-fuchsia-300/30"
              >
                {activeRunId
                  ? "Run In Progress"
                  : phase === "submitting"
                  ? "Submitting"
                  : form.launchMode === "eval_run"
                    ? "Start Eval Run"
                    : form.launchMode === "execute"
                      ? "Start Training"
                      : "Run Preflight"}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function TrainingField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-xs text-slate-100 outline-none transition focus:border-cyan-200/60"
      />
    </label>
  );
}

function RuntimeTemplateSelector({
  templates,
  selectedTemplateId,
  status,
  error,
  onChange,
}: {
  templates: NonNullable<VisionTrainingConfigResponse["runtimeTemplates"]>["items"];
  selectedTemplateId: string;
  status: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const sortedTemplates = [...templates].sort(compareRuntimeTemplatesFastestFirst);
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        Runtime
      </span>
      <select
        value={selectedTemplateId}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-xs text-slate-100 outline-none transition focus:border-cyan-200/60"
      >
        {sortedTemplates.length === 0 ? (
          <option value={selectedTemplateId}>
            {status === "unavailable" ? "Runtime API unavailable" : "Loading runtimes"}
          </option>
        ) : null}
        {sortedTemplates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.displayName || template.id} | {template.machineType} | {template.acceleratorCount || 0}x {template.acceleratorType || "CPU"}
          </option>
        ))}
      </select>
      {error ? (
        <span className="mt-1 block text-[10px] text-rose-200">{error}</span>
      ) : null}
    </label>
  );
}

function RuntimeEstimatePanel({
  template,
  executionTimeout,
  budgetNote,
}: {
  template: VisionTrainingConfigResponse["runtimeTemplates"]["items"][number] | null;
  executionTimeout: string;
  budgetNote?: string;
}) {
  if (!template) return null;
  const hours = executionTimeoutHours(executionTimeout);
  const gpuHours = hours * Math.max(0, template.acceleratorCount || 0);
  return (
    <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-2 text-[11px] text-amber-50">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-[0.12em]">
          Runtime API
        </span>
        <span className="font-mono">{template.id}</span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-300">
        <div>Machine: {template.machineType}</div>
        <div>Accelerator: {template.acceleratorCount || 0}x {template.acceleratorType}</div>
        <div>Data disk: {template.dataDiskSizeGb || 0} GB {template.dataDiskType || ""}</div>
        <div>Idle timeout: {template.idleTimeout || "not set"}</div>
        <div>Max runtime: {hours ? `${hours} h` : "unknown"}</div>
        <div>Expected GPU-hours: {gpuHours ? gpuHours.toFixed(2) : "0"}</div>
      </div>
      <div className="mt-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-slate-300">
        Cost: not exposed by Colab Enterprise runtime-template API. Remaining GPU/compute units: not exposed by this API.
        {budgetNote ? ` ${budgetNote}` : ""}
      </div>
    </div>
  );
}

function TrainingRunLogPanel({ run }: { run: VisionTrainingRun | null }) {
  if (!run) return null;
  const launcherText = [
    run.error_message ? `Error: ${run.error_message}` : "",
    run.stderr ? `stderr:\n${run.stderr}` : "",
    run.stdout ? `stdout:\n${run.stdout}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const hasLauncherText = Boolean(launcherText.trim());
  const command = run.metadata?.command;
  const commandText = Array.isArray(command)
    ? command.map((part) => String(part)).join(" ")
    : "";
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/28 p-2 text-[11px] text-slate-300">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-[0.12em] text-slate-100">
          Run Feedback
        </span>
        <span className={stepClass(run.status)}>{run.status}</span>
      </div>
      <div className="mt-1 grid gap-1">
        <div>Phase: {humanTrainingPhase(run.phase)}</div>
        {isActiveTrainingRun(run) ? (
          <div className="text-cyan-100">
            This run is active. Launch controls are locked until it reaches succeeded, failed, cancelled, blocked, or preflight complete.
          </div>
        ) : null}
        {run.dataset_uri || run.notebook_uri || run.output_uri ? (
          <div className="break-all text-slate-400">
            {[run.dataset_uri, run.notebook_uri, run.output_uri].filter(Boolean).join(" | ")}
          </div>
        ) : null}
      </div>
      {hasLauncherText ? (
        <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/35 p-2 font-mono text-[10px] leading-relaxed text-slate-300">
          {truncateMiddle(launcherText, 1600)}
        </pre>
      ) : (
        <div className="mt-2 rounded-lg border border-white/10 bg-black/22 px-2 py-1 text-[10px] text-slate-500">
          Waiting for launcher output. The backend has accepted the run and is exporting/staging the dataset.
        </div>
      )}
      {commandText ? (
        <details className="mt-2 text-[10px] text-slate-500">
          <summary className="cursor-pointer text-slate-400">Launch command</summary>
          <div className="mt-1 break-all font-mono">{commandText}</div>
        </details>
      ) : null}
    </div>
  );
}

function RuntimeProfileControls({
  templates,
  selectedTemplate,
  onSelectTemplate,
}: {
  templates: NonNullable<VisionTrainingConfigResponse["runtimeTemplates"]>["items"];
  selectedTemplate: VisionTrainingConfigResponse["runtimeTemplates"]["items"][number] | null;
  onSelectTemplate: (value: string) => void;
}) {
  if (templates.length === 0) return null;
  const sortedTemplates = [...templates].sort(compareRuntimeTemplatesFastestFirst);
  const acceleratorOptions = uniqueRuntimeValues(
    sortedTemplates.map((template) => runtimeAcceleratorKey(template))
  );
  const machineOptions = uniqueRuntimeValues(
    sortedTemplates.map((template) => template.machineType || "unassigned-machine")
  );
  const selectedAccelerator = selectedTemplate
    ? runtimeAcceleratorKey(selectedTemplate)
    : acceleratorOptions[0] || "";
  const selectedMachine = selectedTemplate?.machineType || machineOptions[0] || "";
  const selectMatchingTemplate = (nextAccelerator: string, nextMachine: string) => {
    const exactMatch = sortedTemplates.find(
      (template) =>
        runtimeAcceleratorKey(template) === nextAccelerator &&
        (template.machineType || "unassigned-machine") === nextMachine
    );
    const acceleratorMatch = sortedTemplates.find(
      (template) => runtimeAcceleratorKey(template) === nextAccelerator
    );
    const machineMatch = sortedTemplates.find(
      (template) => (template.machineType || "unassigned-machine") === nextMachine
    );
    const match = exactMatch || acceleratorMatch || machineMatch;
    if (match) onSelectTemplate(match.id || match.name || match.displayName);
  };
  const combinationAvailable = sortedTemplates.some(
    (template) =>
      runtimeAcceleratorKey(template) === selectedAccelerator &&
      (template.machineType || "unassigned-machine") === selectedMachine
  );
  return (
    <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/22 p-3 md:grid-cols-2">
      <label className="block">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          GPU / Accelerator
        </span>
        <select
          value={selectedAccelerator}
          onChange={(event) => selectMatchingTemplate(event.target.value, selectedMachine)}
          className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-xs text-slate-100 outline-none transition focus:border-cyan-200/60"
        >
          {acceleratorOptions.map((value) => (
            <option key={value} value={value}>
              {runtimeAcceleratorLabel(value)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Machine / Memory
        </span>
        <select
          value={selectedMachine}
          onChange={(event) => selectMatchingTemplate(selectedAccelerator, event.target.value)}
          className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-xs text-slate-100 outline-none transition focus:border-cyan-200/60"
        >
          {machineOptions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      {!combinationAvailable ? (
        <div className="md:col-span-2 rounded-xl border border-amber-200/25 bg-amber-300/10 px-3 py-2 text-[11px] text-amber-100">
          No Colab Enterprise runtime template currently exposes this exact GPU and machine combination. Create the template in Colab Enterprise, then refresh this modal.
        </div>
      ) : null}
    </div>
  );
}

function executionTimeoutHours(value: string) {
  const text = value.trim().toLowerCase();
  if (!text) return 0;
  const hours = text.match(/^(\d+(?:\.\d+)?)h$/);
  if (hours) return Number(hours[1]);
  const minutes = text.match(/^(\d+(?:\.\d+)?)m$/);
  if (minutes) return Number(minutes[1]) / 60;
  const seconds = text.match(/^(\d+(?:\.\d+)?)s$/);
  if (seconds) return Number(seconds[1]) / 3600;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 0;
}

function DatasetAuditPanel({ run }: { run: VisionTrainingRun | null }) {
  const audit = auditFromRun(run);
  if (!audit) return null;
  const blockers = audit.blockers ?? [];
  const blockerCount = audit.blocker_count ?? blockers.length;
  const tone =
    blockerCount > 0
      ? "border-rose-300/30 bg-rose-400/[0.08] text-rose-50"
      : "border-emerald-300/25 bg-emerald-300/[0.07] text-emerald-50";

  return (
    <div className={`mt-3 rounded-xl border p-2 text-[11px] ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-[0.12em]">
          Dataset QA
        </span>
        <span className="font-mono">{blockerCount} blockers</span>
      </div>
      <div className="mt-1 text-slate-300">
        {audit.training_record_count ?? 0} records from {audit.annotation_count ?? 0} component annotations.
      </div>
      {blockers.length > 0 ? (
        <div className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1">
          {blockers.slice(0, 8).map((blocker, index) => (
            <div
              key={`${blocker.annotation_id ?? index}`}
              className="rounded-lg border border-white/10 bg-black/25 px-2 py-1"
            >
              <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.1em]">
                <span>Page {blocker.page_num ?? "?"}</span>
                <span>{blocker.class ?? blocker.schematic_class ?? "UNKNOWN"}</span>
              </div>
              <div className="mt-0.5 break-all text-[10px] text-slate-300">
                {blocker.component_label ?? blocker.annotation_id ?? "unlabeled"}
                {blocker.component_part_number ? ` / ${blocker.component_part_number}` : ""}
              </div>
              {(blocker.issues ?? []).map((issue) => (
                <div key={issue} className="mt-0.5 text-[10px] text-rose-100">
                  {issue}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function auditFromRun(run: VisionTrainingRun | null): VisionTrainingDatasetAudit | null {
  const audit = run?.metadata?.datasetAudit;
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) {
    return null;
  }
  return audit as VisionTrainingDatasetAudit;
}

export function ClassTrackerPanel({
  title = "Dataset Classes",
  subtitle = "Annotated objects",
  emptyLabel = "No dataset classes",
  status,
  counts,
  total,
  activeClassName,
  onClassSelect,
}: {
  title?: string;
  subtitle?: string;
  emptyLabel?: string;
  status: "loading" | "ready" | "error";
  counts: Array<{ className: string; mark: string; count: number }>;
  total: number;
  activeClassName: string | null;
  onClassSelect: (className: string) => void;
}) {
  const maxCount = useMemo(
    () => Math.max(1, ...counts.map((entry) => entry.count)),
    [counts]
  );

  return (
    <section className="mt-auto flex max-h-[44%] min-h-[180px] shrink-0 flex-col rounded-2xl border border-cyan-300/20 bg-black/82 p-2 text-slate-100 shadow-[0_18px_48px_-34px_rgba(0,0,0,0.95)]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[8px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
          {title}
        </div>
        <div
          className={`text-[8px] font-semibold uppercase tracking-[0.12em] ${
            status === "ready"
              ? "text-emerald-200"
              : status === "loading"
                ? "text-amber-200"
                : "text-rose-200"
          }`}
        >
          {status}
        </div>
      </div>
      <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {subtitle} {total}
      </div>
      <div className="mt-2 grid min-h-0 flex-1 grid-cols-2 content-start gap-1.5 overflow-y-auto pr-0.5">
        {counts.length > 0 ? (
          counts.map((entry) => {
            const isEmpty = entry.count === 0;
            const isActive = activeClassName === entry.className;
            const width = isEmpty ? 0 : Math.max(8, (entry.count / maxCount) * 100);
            return (
              <button
                type="button"
                key={entry.className}
                className={`min-w-0 rounded-lg border px-1.5 py-1.5 text-left transition ${
                  isActive
                    ? "border-cyan-200/70 bg-cyan-200/15 shadow-[0_0_22px_rgba(34,211,238,0.2)]"
                    : isEmpty
                      ? "border-amber-300/25 bg-amber-300/[0.045] hover:border-amber-200/45"
                      : "border-white/10 bg-white/[0.045] hover:border-cyan-200/35 hover:bg-cyan-200/[0.08]"
                }`}
                title={`${entry.mark}: ${entry.count}`}
                aria-pressed={isActive}
                onClick={() => onClassSelect(entry.className)}
              >
                <div className="flex min-w-0 items-center justify-between gap-1">
                  <span className="truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-100">
                    {entry.mark}
                  </span>
                  <span
                    className={`font-mono text-[10px] ${
                      isEmpty ? "text-amber-100" : "text-cyan-100"
                    }`}
                  >
                    {entry.count}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full ${
                      isEmpty ? "bg-transparent" : "bg-cyan-300/70"
                    }`}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </button>
            );
          })
        ) : (
          <div className="col-span-2 rounded-lg border border-white/10 bg-white/[0.045] px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
            {emptyLabel}
          </div>
        )}
      </div>
    </section>
  );
}

function defaultTrainingForm(config: VisionTrainingConfigResponse) {
  const preferredRuntimeTemplate =
    fastestRuntimeTemplate(config.runtimeTemplates?.items ?? [])?.id ||
    config.defaults.runtimeTemplate ||
    "";
  return {
    trainer: config.defaults.trainer || "qwen3vl",
    modelId: config.defaults.modelId || "Qwen/Qwen3-VL-32B-Instruct",
    datasetKind: config.defaults.datasetKind || "schematic_component_grounding",
    launchMode: config.defaults.launchMode || "stage_preflight",
    classes: config.defaults.classes || "",
    region: config.defaults.region || "us-central1",
    gcsBucket: config.defaults.gcsBucket || "",
    gcsPrefix: config.defaults.gcsPrefix || "atlas/qwen3vl",
    runtimeTemplate: preferredRuntimeTemplate,
    userEmail: config.defaults.userEmail || "",
    serviceAccount: config.defaults.serviceAccount || "",
    executionTimeout: config.defaults.executionTimeout || "24h",
  };
}

function runtimeAcceleratorKey(
  template: VisionTrainingConfigResponse["runtimeTemplates"]["items"][number]
) {
  const type = template.acceleratorType || "CPU";
  const count = template.acceleratorCount || 0;
  return count > 0 ? `${type}:${count}` : "CPU:0";
}

function fastestRuntimeTemplate(
  templates: VisionTrainingConfigResponse["runtimeTemplates"]["items"]
) {
  return [...templates].sort(compareRuntimeTemplatesFastestFirst)[0] ?? null;
}

function compareRuntimeTemplatesFastestFirst(
  left: VisionTrainingConfigResponse["runtimeTemplates"]["items"][number],
  right: VisionTrainingConfigResponse["runtimeTemplates"]["items"][number]
) {
  return runtimeTemplateScore(right) - runtimeTemplateScore(left);
}

function runtimeTemplateScore(
  template: VisionTrainingConfigResponse["runtimeTemplates"]["items"][number]
) {
  const acceleratorScore =
    runtimeAcceleratorRank(template.acceleratorType) *
    Math.max(1, template.acceleratorCount || 0);
  return (
    acceleratorScore * 1_000_000 +
    (template.acceleratorCount || 0) * 100_000 +
    runtimeMachineRank(template.machineType) * 1_000 +
    (template.dataDiskSizeGb || 0)
  );
}

function runtimeAcceleratorRank(value: string) {
  const accelerator = value.toUpperCase();
  if (accelerator.includes("GB200")) return 1000;
  if (accelerator.includes("H200")) return 950;
  if (accelerator.includes("H100")) return 900;
  if (accelerator.includes("A100_80GB")) return 820;
  if (accelerator.includes("A100")) return 800;
  if (accelerator.includes("V100")) return 600;
  if (accelerator.includes("L4")) return 450;
  if (accelerator.includes("T4")) return 300;
  if (accelerator && accelerator !== "CPU") return 100;
  return 0;
}

function runtimeMachineRank(value: string) {
  const machine = value.toLowerCase();
  if (machine.includes("ultra")) return 500;
  if (machine.includes("highgpu")) return 420;
  if (machine.includes("megagpu")) return 410;
  if (machine.includes("highmem")) return 350;
  if (machine.startsWith("a")) return 300;
  if (machine.startsWith("g")) return 250;
  return 0;
}

function runtimeAcceleratorLabel(value: string) {
  if (value === "CPU:0") return "CPU";
  const [type, count] = value.split(":");
  return `${type} x${count || "1"}`;
}

function uniqueRuntimeValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );
}

function activeTrainingRun(runs: VisionTrainingRun[]) {
  return runs.find(isActiveTrainingRun) ?? null;
}

function isActiveTrainingRun(run: VisionTrainingRun | null | undefined) {
  return Boolean(
    run &&
      ["created", "staging", "submitted", "running"].includes(run.status)
  );
}

function humanTrainingPhase(value: string) {
  const normalized = value.replace(/_/g, " ").trim();
  return normalized ? normalized : "waiting for next update";
}

function formatTrainingTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "unknown";
  return date.toLocaleString();
}

function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const half = Math.floor((maxLength - 24) / 2);
  return `${value.slice(0, half)}\n... output truncated ...\n${value.slice(-half)}`;
}

function setFormValue(
  setForm: Dispatch<SetStateAction<Record<string, string>>>,
  key: string,
  value: string
) {
  setForm((current) => ({ ...current, [key]: value }));
}

function modelLabelFromId(modelId: string) {
  const leaf = modelId.split("/").pop() || modelId;
  return leaf
    .replace(/[-_]+Instruct$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\bvl\b/i, "VL")
    .replace(/\bqwen\b/i, "Qwen")
    .trim() || "Vision model";
}

function trainingSteps(
  phase: "idle" | "loading" | "submitting" | "submitted" | "error",
  run: VisionTrainingRun | null
) {
  const runPhase = run?.phase || "";
  const runStatus = run?.status || "";
  const isStaging = runStatus === "staging";
  const isExportingDataset = isStaging && runPhase === "exporting_dataset";
  const isSubmitting = phase === "submitting";
  const isLoadingConfig = phase === "loading";
  const isExecutionRun = run?.metadata?.executionSkipped !== true;
  return [
    {
      label: "Dataset export",
      state: run?.dataset_uri ? "done" : isSubmitting || isExportingDataset ? "active" : "ready",
      detail:
        run?.dataset_uri ||
        (isExportingDataset
          ? "Exporting saved Dataset workspace annotations into the object-detection package."
          : "Builds the object-detection dataset from saved Dataset workspace annotations."),
    },
    {
      label: "GCS staging",
      state: run?.notebook_uri
        ? "done"
        : isSubmitting || isStaging || run?.dataset_uri || isLoadingConfig
          ? "active"
          : "ready",
      detail:
        run?.notebook_uri ||
        (isLoadingConfig
          ? "Loading Colab Enterprise runtime templates and recent run state from the backend."
          : "") ||
        (isStaging
          ? "Uploading the dataset zip and GitHub-built notebook into the configured GCS path."
          : "Stages the dataset zip and patched notebook in your configured Cloud Storage path."),
    },
    {
      label: "Colab execution",
      state: run?.execution_name
        ? run.status
        : isSubmitting && isExecutionRun
          ? "active"
          : run?.metadata?.executionSkipped
            ? "done"
            : "ready",
      detail:
        run?.execution_name ||
        (run?.metadata?.executionSkipped
          ? "Execution is intentionally skipped for this preflight/export mode."
          : "Submits the notebook against the selected Colab Enterprise runtime template."),
    },
    {
      label: "Result persistence",
      state: run ? "done" : "ready",
      detail: "Training run state and cloud output locations are persisted in Neon.",
    },
  ];
}

function stepClass(state: string) {
  if (state === "done" || state === "succeeded") {
    return "text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-200";
  }
  if (state === "active" || state === "running" || state === "submitted") {
    return "text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-200";
  }
  if (state === "failed" || state === "error" || state === "blocked") {
    return "text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-200";
  }
  return "text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400";
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value || "Unknown error");
}
