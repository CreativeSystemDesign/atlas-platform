import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

// use-v2-persistence imports via the "@/" alias and extensionless relatives
// (Next's resolution). Map both for node — scoped to our own src tree so the
// hook never touches package internals.
register(
  "data:text/javascript," +
    encodeURIComponent(`
export function resolve(specifier, context, next) {
  const parent = context.parentURL ?? "";
  if (!parent.includes("/atlas-dashboard/src/")) return next(specifier, context);
  if (specifier.startsWith("@/")) {
    const root = parent.slice(0, parent.lastIndexOf("/src/") + 5);
    specifier = root + specifier.slice(2);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("file:")) && !/\\.[a-z]+$/.test(specifier)) {
    specifier += ".ts";
  }
  return next(specifier, context);
}
`)
);

// --- browser shims (the hook is a client hook: window, localStorage, fetch) ---
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Deferred fetch: every GET /experimental-v2/graph parks here until the test
// settles it — the stale-flip window lives between page flip and load-settle,
// so the test must own WHEN the load lands.
const pendingFetches = [];
globalThis.fetch = (url) =>
  new Promise((resolve, reject) => {
    pendingFetches.push({ url: String(url), resolve, reject });
  });
function takeFetch(urlPart) {
  const i = pendingFetches.findIndex((f) => f.url.includes(urlPart));
  assert.notEqual(i, -1, `no pending fetch matching ${urlPart}`);
  return pendingFetches.splice(i, 1)[0];
}

const { useV2NeonGraph, v2StorageKey, EMPTY_V2_GRAPH } = await import("./use-v2-persistence.ts");

// Mirrors the real consumers (continuation push / pending-select / cable
// auto-link): an effect keyed on (page, ready) that records what it saw. The
// stale-flip bug (2026-07-11) was exactly this shape observing ready=true with
// the OLD page's graph/sheetRef under the NEW pageNum on the flip commit.
function Harness({ page, log }) {
  const storageKey = v2StorageKey("p1", "d1", page);
  const [graph, setGraph] = React.useState(EMPTY_V2_GRAPH);
  const { ready, sheetRef } = useV2NeonGraph({
    projectId: "p1",
    documentId: "d1",
    page,
    storageKey,
    graph,
    setGraph,
  });
  React.useEffect(() => {
    log.push({ page, ready, sheetRef });
  }, [page, ready, sheetRef, log]);
  return null;
}

function neonResult(sheetRef) {
  return {
    ok: true,
    json: async () => ({
      graph: { nodes: [], ports: [], edges: [], continuations: [], grounds: [], cables: [] },
      seededFromLegacy: false,
      sheetRef,
    }),
  };
}

test("ready is keyed to the page: the flip commit itself sees ready=false", async () => {
  const log = [];
  const root = createRoot(document.body.appendChild(document.createElement("div")));

  // Mount on page 7; the load is in flight, so nothing is ready.
  await act(async () => {
    root.render(React.createElement(Harness, { page: 7, log }));
  });
  assert.deepEqual(log.at(-1), { page: 7, ready: false, sheetRef: null });

  // Neon lands for page 7 — now (and only now) page 7 speaks.
  await act(async () => {
    takeFetch("page_num=7").resolve(neonResult("5/207"));
  });
  assert.deepEqual(log.at(-1), { page: 7, ready: true, sheetRef: "5/207" });

  // THE regression: flip to page 8. Every commit until page 8's load settles
  // must read ready=false — the old boolean reset landed one commit late and
  // consumers saw {page: 8, ready: true} with page 7's graph and sheetRef.
  const flipStart = log.length;
  await act(async () => {
    root.render(React.createElement(Harness, { page: 8, log }));
  });
  const flipObservations = log.slice(flipStart);
  assert.ok(flipObservations.length > 0, "flip commit was observed");
  for (const o of flipObservations) {
    assert.equal(o.page, 8);
    assert.equal(o.ready, false, `stale-flip: consumers saw ready=true before page 8 loaded: ${JSON.stringify(o)}`);
  }

  await act(async () => {
    takeFetch("page_num=8").resolve(neonResult("6/207"));
  });
  assert.deepEqual(log.at(-1), { page: 8, ready: true, sheetRef: "6/207" });
  assert.ok(
    !log.some((o) => o.page === 8 && o.ready && o.sheetRef === "5/207"),
    "page 7's sheetRef must never be ready under page 8"
  );

  // Flip BACK to an already-visited page: readiness must not linger from the
  // earlier visit — the key names page 8, so page 7 re-arms as not-ready.
  const backStart = log.length;
  await act(async () => {
    root.render(React.createElement(Harness, { page: 7, log }));
  });
  for (const o of log.slice(backStart)) {
    assert.equal(o.ready, false, "revisited page reused stale readiness");
  }
  await act(async () => {
    takeFetch("page_num=7").resolve(neonResult("5/207"));
  });
  assert.deepEqual(log.at(-1), { page: 7, ready: true, sheetRef: "5/207" });

  // Offline flip: the fetch fails, the page still becomes ready (cache-only),
  // but the PREVIOUS page's sheetRef must not survive into this one.
  await act(async () => {
    root.render(React.createElement(Harness, { page: 9, log }));
  });
  await act(async () => {
    takeFetch("page_num=9").reject(new Error("offline"));
  });
  assert.deepEqual(log.at(-1), { page: 9, ready: true, sheetRef: null });

  await act(async () => {
    root.unmount();
  });
});
