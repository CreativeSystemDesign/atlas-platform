import assert from "node:assert/strict";
import test from "node:test";

import { detectTerminalBlockFromText } from "./terminal-block-authoring.ts";

test("detects terminal block position labels from fragmented schematic text", () => {
  const result = detectTerminalBlockFromText({
    boxBbox: { x: 100, y: 100, width: 240, height: 220 },
    textBlocks: [
      { text: "2", bbox: [115, 120, 125, 136] },
      { text: "0", bbox: [126, 120, 155, 136] },
      { text: "D", bbox: [265, 120, 273, 136] },
      { text: "I", bbox: [286, 120, 294, 136] },
      { text: "COM", bbox: [307, 120, 339, 136] },
      { text: "4", bbox: [115, 170, 125, 186] },
      { text: "6", bbox: [126, 170, 155, 186] },
      { text: "DO", bbox: [265, 171, 281, 187] },
      { text: "COM", bbox: [294, 171, 339, 187] },
      { text: "4", bbox: [115, 220, 125, 236] },
      { text: "2", bbox: [126, 220, 155, 236] },
      { text: "EMG", bbox: [265, 220, 295, 236] },
      { text: "(E-STOP)", bbox: [265, 244, 339, 260] },
    ],
    scale: 1,
    pageNum: 7,
    zoom: 1,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(result.status, "created");
  const attachments = result.box.metadata.attachments;
  assert.equal(attachments.length, 6);
  assert.deepEqual(
    attachments.map((attachment) => attachment.text),
    ["20", "D I COM", "46", "DO COM", "42", "EMG (E-STOP)"]
  );
  assert.deepEqual(
    attachments.map((attachment) => attachment.bbox),
    [
      { x: 115, y: 120, width: 40, height: 16 },
      { x: 265, y: 120, width: 74, height: 16 },
      { x: 115, y: 170, width: 40, height: 16 },
      { x: 265, y: 171, width: 74, height: 16 },
      { x: 115, y: 220, width: 40, height: 16 },
      { x: 265, y: 220, width: 74, height: 40 },
    ]
  );
  assert.equal(attachments[0].linkedAttachmentId, attachments[1].id);
  assert.equal(attachments[1].parentAttachmentId, attachments[0].id);
  assert.equal(attachments[2].linkedAttachmentId, attachments[3].id);
  assert.equal(attachments[3].parentAttachmentId, attachments[2].id);
  assert.equal(attachments[4].linkedAttachmentId, attachments[5].id);
  assert.equal(attachments[5].parentAttachmentId, attachments[4].id);
});
