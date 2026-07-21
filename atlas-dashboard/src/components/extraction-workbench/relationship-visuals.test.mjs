import assert from "node:assert/strict";
import test from "node:test";

import {
  relationshipAttachmentHighlightClass,
  relationshipAttachmentHighlightStyle,
  relationshipHighlightStroke,
  relationshipLineGlowStyle,
  relationshipRootHighlightClass,
  relationshipRootHighlightStyle,
  truthRowItemStyle,
  truthRowPathStyle,
} from "./relationship-visuals.ts";

const color = {
  pathNumber: 2,
  stroke: "rgba(251, 191, 36, 0.98)",
  border: "rgba(253, 230, 138, 0.95)",
  fill: "rgba(251, 191, 36, 0.14)",
  glow: "rgba(251, 191, 36, 0.52)",
  panelBackground: "rgba(251, 191, 36, 0.1)",
  text: "rgba(254, 243, 199, 0.98)",
};

const highlight = {
  rowIds: ["row-1"],
  pathNumbers: [2],
  primaryPathNumber: 2,
  color,
};

test("builds relationship truth row styles from path colors", () => {
  assert.deepEqual(truthRowItemStyle(color), {
    borderColor: color.border,
    backgroundColor: color.fill,
  });
  assert.deepEqual(truthRowPathStyle(color), {
    borderColor: color.border,
    backgroundColor: color.panelBackground,
    boxShadow: `0 0 0 1px rgba(0,0,0,0.35), 0 0 18px ${color.glow}`,
  });
});

test("builds root and attachment highlight classes and styles", () => {
  assert.equal(relationshipRootHighlightClass(), "ring-[3px]");
  assert.equal(relationshipAttachmentHighlightClass(null), "");
  assert.equal(relationshipAttachmentHighlightClass(highlight), "ring-[3px]");
  assert.deepEqual(relationshipRootHighlightStyle(null), {});
  assert.deepEqual(relationshipAttachmentHighlightStyle(null), {});

  const rootStyle = relationshipRootHighlightStyle(highlight);
  assert.equal(rootStyle.borderColor, color.border);
  assert.equal(rootStyle.backgroundColor, color.fill);
  assert.equal(rootStyle.outline, `2px solid ${color.border}`);
  assert.equal(rootStyle["--tw-ring-color"], color.border);
  assert.match(rootStyle.boxShadow, /0 0 24px/);

  const attachmentStyle = relationshipAttachmentHighlightStyle(highlight);
  assert.match(attachmentStyle.boxShadow, /0 0 18px/);
});

test("builds relationship line stroke and glow styles", () => {
  assert.equal(relationshipHighlightStroke(highlight), color.stroke);
  assert.deepEqual(relationshipLineGlowStyle(highlight, 14), {
    filter: `drop-shadow(0 0 2px rgba(0,0,0,0.85)) drop-shadow(0 0 14px ${color.glow}) drop-shadow(0 0 21px ${color.glow})`,
  });
});
