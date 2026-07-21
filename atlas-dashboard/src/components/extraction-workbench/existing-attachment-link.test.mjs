import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExistingAttachmentLinkCandidate,
  dedupeExistingAttachmentLinks,
  hasExistingAttachmentLink,
} from "./existing-attachment-link.ts";

test("builds a continuation candidate from a clicked wire endpoint with owner context", () => {
  const candidate = buildExistingAttachmentLinkCandidate({
    ownerBox: {
      id: "wire-s1",
      label: "S1",
      bbox: { x: 100, y: 200, width: 20, height: 400 },
    },
    attachment: {
      id: "wire-s1-endpoint-end",
      type: "wire_endpoint",
      text: "end",
      bbox: { x: 96, y: 596, width: 18, height: 18 },
    },
    anchorBbox: { x: 105, y: 605, width: 10, height: 10 },
  });

  assert.deepEqual(candidate, {
    bbox: { x: 105, y: 605, width: 10, height: 10 },
    text: "S1",
    type: "wire_endpoint",
    linkedBoxId: "wire-s1",
    linkedAttachmentId: "wire-s1-endpoint-end",
  });
});

test("builds a readable label for a clicked component connection point", () => {
  const candidate = buildExistingAttachmentLinkCandidate({
    ownerBox: {
      id: "component-whm10",
      label: "WHM10",
      bbox: { x: 1300, y: 500, width: 200, height: 300 },
    },
    attachment: {
      id: "whm10-terminal-1",
      type: "connection_point",
      text: "1",
      bbox: { x: 1300, y: 540, width: 18, height: 18 },
    },
  });

  assert.equal(candidate.text, "WHM10:1");
  assert.equal(candidate.linkedBoxId, "component-whm10");
  assert.equal(candidate.linkedAttachmentId, "whm10-terminal-1");
});

test("detects an existing link to the same wire endpoint", () => {
  assert.equal(
    hasExistingAttachmentLink({
      attachments: [
        {
          type: "wire_endpoint",
          relation: "continuation_to_object",
          linkedBoxId: "wire-s1",
          linkedAttachmentId: "wire-s1-endpoint-end",
        },
      ],
      candidate: {
        bbox: { x: 105, y: 605, width: 10, height: 10 },
        text: "S1",
        type: "wire_endpoint",
        linkedBoxId: "wire-s1",
        linkedAttachmentId: "wire-s1-endpoint-end",
      },
      relation: "continuation_to_object",
    }),
    true
  );
});

test("detects an existing link to the same wire root", () => {
  assert.equal(
    hasExistingAttachmentLink({
      attachments: [
        {
          type: "wire_segment",
          relation: "continuation_to_object",
          linkedBoxId: "wire-s1",
          linkedAttachmentId: null,
        },
      ],
      candidate: {
        bbox: { x: 105, y: 605, width: 10, height: 10 },
        text: "S1",
        type: "wire_segment",
        linkedBoxId: "wire-s1",
        linkedAttachmentId: null,
      },
      relation: "continuation_to_object",
    }),
    true
  );
});

test("dedupes repeated links while preserving the first copy", () => {
  const first = {
    id: "first",
    type: "wire_endpoint",
    relation: "continuation_to_object",
    linkedBoxId: "wire-s1",
    linkedAttachmentId: "wire-s1-endpoint-end",
  };
  const duplicate = {
    id: "duplicate",
    type: "wire_endpoint",
    relation: "continuation_to_object",
    linkedBoxId: "wire-s1",
    linkedAttachmentId: "wire-s1-endpoint-end",
  };
  const other = {
    id: "other",
    type: "wire_segment",
    relation: "continuation_to_object",
    linkedBoxId: "wire-r1",
    linkedAttachmentId: null,
  };

  assert.deepEqual(dedupeExistingAttachmentLinks([first, duplicate, other]), [
    first,
    other,
  ]);
});
