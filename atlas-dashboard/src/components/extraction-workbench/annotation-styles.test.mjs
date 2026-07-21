import assert from "node:assert/strict";
import test from "node:test";

import {
  annotationBboxStyle,
  attachmentClass,
  attachmentColor,
  draftBoxClass,
  handleClass,
  labelBoxClass,
  labelLeaderVisible,
  rootObjectClass,
  stageCursorClass,
  wireSegmentStroke,
} from "./annotation-styles.ts";

test("returns purpose-specific attachment color and class tokens", () => {
  assert.equal(attachmentColor("wire_endpoint"), "rgba(56, 189, 248, 0.96)");
  assert.equal(attachmentColor("cable_label"), "rgba(45, 212, 191, 0.94)");
  assert.equal(attachmentColor("cable_endpoint"), "rgba(94, 234, 212, 0.96)");
  assert.match(attachmentClass("wire_endpoint", true), /rounded-full/);
  assert.match(attachmentClass("cable_endpoint", true), /rounded-full/);
  assert.match(attachmentClass("wire_endpoint", true), /opacity-100/);
  assert.match(attachmentClass("cable_label", false), /border-teal-300/);
  assert.match(attachmentClass("ground_reference", false), /opacity-80/);
  assert.match(attachmentClass("ground_reference", false), /border-emerald-300/);
});

test("maps root object classes through descriptor and attachment presentation", () => {
  assert.match(rootObjectClass("component", true), /border-cyan-200/);
  assert.match(rootObjectClass("circuit_descriptor", false), /border-fuchsia-300/);
  assert.match(rootObjectClass("wire_segment", false), /border-sky-300/);
  assert.match(rootObjectClass("cable_segment", false), /border-teal-300/);
});

test("keeps training dataset bbox styling isolated from digital twin defaults", () => {
  assert.equal(attachmentColor("component"), "rgba(34, 211, 238, 0.92)");
  assert.match(attachmentClass("component", true), /bg-cyan-300\/12/);
  assert.match(rootObjectClass("component", true), /bg-cyan-300\/7/);
  assert.match(labelBoxClass(true, "digital_twin"), /bg-sky-400\/10/);
  assert.match(draftBoxClass("digital_twin"), /bg-amber-300\/10/);
  assert.deepEqual(annotationBboxStyle("digital_twin"), {});
  assert.equal(labelLeaderVisible("digital_twin"), true);
  assert.equal(wireSegmentStroke("digital_twin"), "rgba(14, 165, 233, 0.42)");
  assert.match(handleClass("se"), /bg-cyan-200/);

  assert.equal(attachmentColor("component", "training_dataset"), "#ff00ff");
  assert.match(attachmentClass("component", true, "training_dataset"), /bg-transparent/);
  assert.match(rootObjectClass("component", true, "training_dataset"), /bg-transparent/);
  assert.match(labelBoxClass(true, "training_dataset"), /bg-transparent/);
  assert.match(draftBoxClass("training_dataset"), /bg-transparent/);
  assert.equal(annotationBboxStyle("training_dataset").borderColor, "#ff00ff");
  assert.equal(annotationBboxStyle("training_dataset").backgroundColor, "transparent");
  assert.equal(labelLeaderVisible("training_dataset"), false);
  assert.equal(wireSegmentStroke("training_dataset"), "#ff00ff");
  assert.equal(attachmentColor("component", "yolo"), "#ef4444");
  assert.match(rootObjectClass("component", true, "yolo"), /border-red-100/);
  assert.match(labelBoxClass(true, "yolo"), /bg-red-500\/12/);
  assert.equal(annotationBboxStyle("yolo").borderColor, "#ef4444");
  assert.equal(labelLeaderVisible("yolo"), false);
  // In dataset workspace, the per-component color is applied via inline style
  // (the `color` prop on ResizeHandleButton/BoxEdgeHitTargets) rather than a
  // hardcoded Tailwind class, so handleClass should not bake in any specific
  // color — only the transparent-shell + cursor classes remain.
  assert.match(handleClass("se", "training_dataset"), /shadow-none/);
  assert.match(handleClass("se", "training_dataset"), /cursor-se-resize/);
  assert.doesNotMatch(handleClass("se", "training_dataset"), /bg-cyan-200/);
  assert.match(handleClass("se", "yolo"), /bg-red-400/);
});

test("keeps cursor and resize handle classes stable", () => {
  assert.match(stageCursorClass("box", "component"), /cursor-crosshair/);
  assert.match(stageCursorClass("pan", "component"), /cursor-grab/);
  assert.match(stageCursorClass("box", "cable"), /cursor-crosshair/);
  assert.match(stageCursorClass("select", "trace"), /cursor-default/);
  assert.match(stageCursorClass("select", "descriptor"), /cursor-crosshair/);

  assert.match(handleClass("se"), /cursor-se-resize/);
  assert.match(handleClass("nw"), /cursor-nw-resize/);
});
