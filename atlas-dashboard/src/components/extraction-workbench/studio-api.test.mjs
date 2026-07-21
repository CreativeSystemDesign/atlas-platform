import assert from "node:assert/strict";
import test from "node:test";

import {
  classTrackerUrl,
  fetchPageAnnotations,
  googleObjectDetectionBundleExportUrl,
  googleObjectDetectionExportUrl,
  googleObjectDetectionJsonlUrl,
  pageAnnotationsUrl,
  pageMetadataUrl,
  pageTruthUrl,
  savePageAnnotations,
  symbolBankUrl,
  wireLabelBankUrl,
  yolov26ExportUrl,
} from "./studio-api.ts";

test("builds stable workbench URLs for the Studio API", () => {
  const base = "https://agent.example";
  assert.equal(
    pageMetadataUrl(base, "project-1", "doc-1", 7),
    "https://agent.example/workbench/projects/project-1/documents/doc-1/pages/7/metadata"
  );
  assert.equal(
    pageAnnotationsUrl(base, "project-1", "doc-1", 7),
    "https://agent.example/workbench/projects/project-1/documents/doc-1/pages/7/annotations"
  );
  assert.equal(
    pageTruthUrl(base, "project-1", "doc-1", 7),
    "https://agent.example/workbench/projects/project-1/documents/doc-1/pages/7/truth"
  );
  assert.equal(
    yolov26ExportUrl(base, "project-1", "doc-1"),
    "https://agent.example/workbench/projects/project-1/documents/doc-1/exports/yolov26.zip"
  );
  assert.equal(
    googleObjectDetectionExportUrl(base, "project-1", "doc-1"),
    "https://agent.example/workbench/projects/project-1/documents/doc-1/exports/google-object-detection.csv"
  );
  assert.equal(
    googleObjectDetectionBundleExportUrl(base, "project-1", "doc-1"),
    "https://agent.example/workbench/projects/project-1/documents/doc-1/exports/google-object-detection.zip"
  );
  assert.equal(
    googleObjectDetectionJsonlUrl(base, "project-1", "doc-1"),
    "https://agent.example/workbench/projects/project-1/documents/doc-1/exports/google-object-detection.jsonl"
  );
  assert.equal(
    googleObjectDetectionExportUrl(
      base,
      "project-1",
      "doc-1",
      "gs://bucket/path with spaces"
    ),
    "https://agent.example/workbench/projects/project-1/documents/doc-1/exports/google-object-detection.csv?gcsBaseUri=gs%3A%2F%2Fbucket%2Fpath+with+spaces"
  );
  assert.equal(
    symbolBankUrl(base, "project-1", "doc-1"),
    "https://agent.example/workbench/projects/project-1/documents/doc-1/symbol-bank"
  );
  assert.equal(
    wireLabelBankUrl(base, "project-1", "doc-1"),
    "https://agent.example/workbench/projects/project-1/documents/doc-1/wire-label-bank"
  );
  assert.equal(
    classTrackerUrl(base, "project-1", "doc-1"),
    "https://agent.example/workbench/projects/project-1/documents/doc-1/class-tracker"
  );
});

test("loads annotation payloads and fails fast on non-ok responses", async () => {
  const payload = { annotations: [{ id: "box-1" }] };
  const fetchOk = async () => jsonResponse(payload);
  assert.deepEqual(
    await fetchPageAnnotations(fetchOk, "https://agent.example", "project-1", "doc-1", 7),
    payload
  );

  const fetchBad = async () => jsonResponse({ error: "bad" }, 503);
  await assert.rejects(
    () => fetchPageAnnotations(fetchBad, "https://agent.example", "project-1", "doc-1", 7),
    /annotations request failed: 503/
  );
});

test("saves annotation payloads with a PUT JSON body", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({ annotations: [{ id: "saved" }] });
  };

  const result = await savePageAnnotations(
    fetchImpl,
    "https://agent.example",
    "project-1",
    "doc-1",
    7,
    [{ id: "box-1" }]
  );

  assert.deepEqual(result, { annotations: [{ id: "saved" }] });
  assert.equal(
    calls[0].url,
    "https://agent.example/workbench/projects/project-1/documents/doc-1/pages/7/annotations"
  );
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ annotations: [{ id: "box-1" }] }));
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
