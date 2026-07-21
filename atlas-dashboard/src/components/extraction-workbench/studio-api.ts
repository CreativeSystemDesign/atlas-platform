import type {
  AnnotationPayload,
  AnnotationWorkspaceMode,
  ClassTrackerResponse,
  PageMetadata,
  Qwen3vlDriveExportResponse,
  QwenRoiDetectResponse,
  SymbolBankResponse,
  VisionTrainingConfigResponse,
  VisionTrainingRun,
  WireLabelBankResponse,
  Yolov26DetectSettings,
  Yolov26PageDetectResponse,
} from "./studio-types.ts";

export type StudioFetch = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

function documentWorkbenchUrl(
  agentBase: string,
  projectId: string,
  documentId: string
) {
  return `${agentBase}/workbench/projects/${projectId}/documents/${documentId}`;
}

function documentExportUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  exportFileName: string
) {
  return `${documentWorkbenchUrl(agentBase, projectId, documentId)}/exports/${exportFileName}`;
}

function withAnnotationMode(url: string, annotationMode: AnnotationWorkspaceMode) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${new URLSearchParams({ annotationMode }).toString()}`;
}

export function pageMetadataUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  pageNum: number
) {
  return `${documentWorkbenchUrl(agentBase, projectId, documentId)}/pages/${pageNum}/metadata`;
}

export function pageAnnotationsUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  pageNum: number,
  annotationMode: AnnotationWorkspaceMode = "digital_twin"
) {
  return withAnnotationMode(
    `${documentWorkbenchUrl(agentBase, projectId, documentId)}/pages/${pageNum}/annotations`,
    annotationMode
  );
}

export function yolov26PageDetectUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  pageNum: number
) {
  return `${documentWorkbenchUrl(agentBase, projectId, documentId)}/pages/${pageNum}/yolov26-detect`;
}

export function pageTruthUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  pageNum: number,
  annotationMode: AnnotationWorkspaceMode = "digital_twin"
) {
  return withAnnotationMode(
    `${documentWorkbenchUrl(agentBase, projectId, documentId)}/pages/${pageNum}/truth`,
    annotationMode
  );
}

export function yolov26ExportUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  annotationMode: AnnotationWorkspaceMode = "digital_twin"
) {
  return withAnnotationMode(
    documentExportUrl(agentBase, projectId, documentId, "yolov26.zip"),
    annotationMode
  );
}

export function googleObjectDetectionExportUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  gcsBaseUri?: string,
  annotationMode: AnnotationWorkspaceMode = "digital_twin"
) {
  const url = documentExportUrl(
    agentBase,
    projectId,
    documentId,
    "google-object-detection.csv"
  );
  if (!gcsBaseUri) return withAnnotationMode(url, annotationMode);
  const params = new URLSearchParams({ gcsBaseUri });
  return withAnnotationMode(`${url}?${params.toString()}`, annotationMode);
}

export function googleObjectDetectionBundleExportUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  gcsBaseUri?: string,
  annotationMode: AnnotationWorkspaceMode = "digital_twin"
) {
  const url = documentExportUrl(
    agentBase,
    projectId,
    documentId,
    "google-object-detection.zip"
  );
  if (!gcsBaseUri) return withAnnotationMode(url, annotationMode);
  const params = new URLSearchParams({ gcsBaseUri });
  return withAnnotationMode(`${url}?${params.toString()}`, annotationMode);
}

export function googleObjectDetectionJsonlUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  gcsBaseUri?: string,
  annotationMode: AnnotationWorkspaceMode = "digital_twin"
) {
  const url = documentExportUrl(
    agentBase,
    projectId,
    documentId,
    "google-object-detection.jsonl"
  );
  if (!gcsBaseUri) return withAnnotationMode(url, annotationMode);
  const params = new URLSearchParams({ gcsBaseUri });
  return withAnnotationMode(`${url}?${params.toString()}`, annotationMode);
}

export function qwen3vlColabDatasetExportUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  annotationMode: AnnotationWorkspaceMode = "training_dataset",
  classes = "EARTH_LEAKAGE_BREAKER,MAGNETIC_CONTACTOR,ELB,MC"
) {
  const url = documentExportUrl(
    agentBase,
    projectId,
    documentId,
    "qwen3vl-colab-dataset.zip"
  );
  const params = new URLSearchParams({ classes });
  return withAnnotationMode(`${url}?${params.toString()}`, annotationMode);
}

export function qwen3vlColabNotebookExportUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  driveFolder = "atlas/qwen3vl",
  modelId = "Qwen/Qwen3-VL-32B-Instruct",
  exportName?: string
) {
  const url = documentExportUrl(
    agentBase,
    projectId,
    documentId,
    "qwen3vl-colab-starter.ipynb"
  );
  const params = new URLSearchParams({ driveFolder, modelId });
  if (exportName) params.set("exportName", exportName);
  return `${url}?${params.toString()}`;
}

export function qwen3vlColabDriveExportUrl(
  agentBase: string,
  projectId: string,
  documentId: string
) {
  return `${documentWorkbenchUrl(agentBase, projectId, documentId)}/exports/qwen3vl-colab-drive`;
}

export function symbolBankUrl(
  agentBase: string,
  projectId: string,
  documentId: string
) {
  return `${documentWorkbenchUrl(agentBase, projectId, documentId)}/symbol-bank`;
}

export function wireLabelBankUrl(
  agentBase: string,
  projectId: string,
  documentId: string
) {
  return `${documentWorkbenchUrl(agentBase, projectId, documentId)}/wire-label-bank`;
}

export function classTrackerUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  annotationMode: AnnotationWorkspaceMode = "digital_twin"
) {
  return withAnnotationMode(
    `${documentWorkbenchUrl(agentBase, projectId, documentId)}/class-tracker`,
    annotationMode
  );
}

export function qwenRoiDetectUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  pageNum: number
) {
  return `${documentWorkbenchUrl(agentBase, projectId, documentId)}/pages/${pageNum}/qwen-roi-detect`;
}

export function visionTrainingColabEnterpriseUrl(
  agentBase: string,
  projectId: string,
  documentId: string
) {
  return `${documentWorkbenchUrl(agentBase, projectId, documentId)}/vision-training/colab-enterprise`;
}

export function visionTrainingColabEnterpriseRunsUrl(
  agentBase: string,
  projectId: string,
  documentId: string
) {
  return `${visionTrainingColabEnterpriseUrl(agentBase, projectId, documentId)}/runs`;
}

export function visionTrainingColabEnterpriseRunUrl(
  agentBase: string,
  projectId: string,
  documentId: string,
  trainingRunId: string
) {
  return `${visionTrainingColabEnterpriseRunsUrl(agentBase, projectId, documentId)}/${trainingRunId}`;
}

async function fetchJson<T>(
  fetchImpl: StudioFetch,
  url: string,
  failureMessage: string,
  init?: RequestInit
) {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = apiErrorDetail(payload);
    } catch {
      try {
        detail = await response.text();
      } catch {
        detail = "";
      }
    }
    throw new Error(
      `${failureMessage}: ${response.status}${detail ? ` - ${detail}` : ""}`
    );
  }
  return response.json() as Promise<T>;
}

function apiErrorDetail(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    const runId = (detail as { training_run_id?: unknown }).training_run_id;
    const status = (detail as { status?: unknown }).status;
    const phase = (detail as { phase?: unknown }).phase;
    return [
      typeof message === "string" ? message : "",
      typeof runId === "string" ? `run ${runId}` : "",
      typeof status === "string" ? status : "",
      typeof phase === "string" ? phase : "",
    ]
      .filter(Boolean)
      .join(" / ");
  }
  return "";
}

export function fetchPageMetadata(
  fetchImpl: StudioFetch,
  agentBase: string,
  projectId: string,
  documentId: string,
  pageNum: number
) {
  return fetchJson<PageMetadata>(
    fetchImpl,
    pageMetadataUrl(agentBase, projectId, documentId, pageNum),
    "metadata request failed"
  );
}

export function fetchPageAnnotations(
  fetchImpl: StudioFetch,
  agentBase: string,
  projectId: string,
  documentId: string,
  pageNum: number,
  annotationMode: AnnotationWorkspaceMode = "digital_twin"
) {
  return fetchJson<AnnotationPayload>(
    fetchImpl,
    pageAnnotationsUrl(agentBase, projectId, documentId, pageNum, annotationMode),
    "annotations request failed"
  );
}

export function fetchSymbolBank(
  fetchImpl: StudioFetch,
  agentBase: string,
  projectId: string,
  documentId: string
) {
  return fetchJson<SymbolBankResponse>(
    fetchImpl,
    symbolBankUrl(agentBase, projectId, documentId),
    "symbol bank request failed"
  );
}

export function fetchWireLabelBank(
  fetchImpl: StudioFetch,
  agentBase: string,
  projectId: string,
  documentId: string
) {
  return fetchJson<WireLabelBankResponse>(
    fetchImpl,
    wireLabelBankUrl(agentBase, projectId, documentId),
    "wire label bank request failed"
  );
}

export function fetchClassTracker(
  fetchImpl: StudioFetch,
  agentBase: string,
  projectId: string,
  documentId: string,
  annotationMode: AnnotationWorkspaceMode = "digital_twin"
) {
  return fetchJson<ClassTrackerResponse>(
    fetchImpl,
    classTrackerUrl(agentBase, projectId, documentId, annotationMode),
    "class tracker request failed"
  );
}

export function fetchVisionTrainingConfig(
  fetchImpl: StudioFetch,
  agentBase: string,
  projectId: string,
  documentId: string
) {
  return fetchJson<VisionTrainingConfigResponse>(
    fetchImpl,
    visionTrainingColabEnterpriseUrl(agentBase, projectId, documentId),
    "vision training config request failed"
  );
}

export function launchVisionTrainingRun(
  fetchImpl: StudioFetch,
  agentBase: string,
  projectId: string,
  documentId: string,
  payload: Record<string, unknown>
) {
  return fetchJson<VisionTrainingRun>(
    fetchImpl,
    visionTrainingColabEnterpriseRunsUrl(agentBase, projectId, documentId),
    "vision training launch failed",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export function exportQwen3vlColabDrive(
  fetchImpl: StudioFetch,
  agentBase: string,
  projectId: string,
  documentId: string,
  body: {
    annotationMode?: AnnotationWorkspaceMode;
    classes: string;
    driveFolder: string;
    exportName?: string;
    modelId: string;
  }
) {
  return fetchJson<Qwen3vlDriveExportResponse>(
    fetchImpl,
    qwen3vlColabDriveExportUrl(agentBase, projectId, documentId),
    "qwen3vl Drive export failed",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export function fetchVisionTrainingRun(
  fetchImpl: StudioFetch,
  agentBase: string,
  projectId: string,
  documentId: string,
  trainingRunId: string
) {
  return fetchJson<VisionTrainingRun>(
    fetchImpl,
    visionTrainingColabEnterpriseRunUrl(
      agentBase,
      projectId,
      documentId,
      trainingRunId
    ),
    "vision training run request failed"
  );
}

export function detectQwenRoi(
  fetchImpl: StudioFetch,
  agentBase: string,
  projectId: string,
  documentId: string,
  pageNum: number,
  roi: { x: number; y: number; width: number; height: number }
) {
  return fetchJson<QwenRoiDetectResponse>(
    fetchImpl,
    qwenRoiDetectUrl(agentBase, projectId, documentId, pageNum),
    "qwen roi detect request failed",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        annotationMode: "training_dataset",
        mode: "component_center_click",
        roi,
      }),
    }
  );
}

export function detectYolov26Page(
  fetchImpl: StudioFetch,
  agentBase: string,
  projectId: string,
  documentId: string,
  pageNum: number,
  settings: Yolov26DetectSettings
) {
  return fetchJson<Yolov26PageDetectResponse>(
    fetchImpl,
    yolov26PageDetectUrl(agentBase, projectId, documentId, pageNum),
    "YOLOv26 page detection failed",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }
  );
}

export function savePageAnnotations(
  fetchImpl: StudioFetch,
  agentBase: string,
  projectId: string,
  documentId: string,
  pageNum: number,
  annotations: AnnotationPayload["annotations"],
  annotationMode: AnnotationWorkspaceMode = "digital_twin"
) {
  return fetchJson<AnnotationPayload>(
    fetchImpl,
    pageAnnotationsUrl(agentBase, projectId, documentId, pageNum, annotationMode),
    "save annotations failed",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotationMode, annotations }),
    }
  );
}
