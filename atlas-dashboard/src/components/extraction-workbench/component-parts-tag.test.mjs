import assert from "node:assert/strict";
import test from "node:test";

import {
  componentIdentityMetadataFromSymbol,
  componentPartsTagForBox,
} from "./component-parts-tag.ts";

test("builds a generated parts-list tag from the active symbol candidate", () => {
  const box = annotationBox({
    label: "RTC",
    labelCandidates: [
      {
        normalizedText: "RTC",
        symbol: symbol({
          symbol: "RTC40",
          description: "REACTOR",
          part_number: "MR-DCL55K-4",
          location: "POWER PANEL",
          source_page: "10",
        }),
      },
    ],
  });

  const tag = componentPartsTagForBox(box);

  assert.equal(tag.symbol, "RTC40");
  assert.equal(tag.description, "REACTOR");
  assert.equal(tag.partNumber, "MR-DCL55K-4");
  assert.equal(tag.label, "RTC40 · REACTOR · MR-DCL55K-4");
});

test("prefers persisted component identity metadata after dataset label normalization", () => {
  const box = annotationBox({
    label: "WHM",
    metadata: {
      rootType: "component",
      componentIdentity: componentIdentityMetadataFromSymbol(
        symbol({
          symbol: "WHM10",
          description: "WATT-HOUR METER",
          part_number: "M8FM-N3L",
          location: "POWER PANEL",
          source_page: "10",
        })
      ),
    },
    labelCandidates: [],
  });

  const tag = componentPartsTagForBox(box);

  assert.equal(tag.symbol, "WHM10");
  assert.equal(tag.description, "WATT-HOUR METER");
  assert.equal(tag.partNumber, "M8FM-N3L");
});

test("uses an inactive symbol candidate when the selected label is nearby terminal text", () => {
  const box = annotationBox({
    label: "C",
    labelCandidateIndex: 0,
    labelCandidates: [
      {
        normalizedText: "C",
        source: "text_proximity",
      },
      {
        normalizedText: "R",
        source: "parts_symbol_match",
        symbol: symbol({
          symbol: "R40",
          family: "R",
          suffix: "40",
          description: "REGISTER",
          part_number: "MR-RB136-4",
          location: "POWER PANEL",
          source_page: "10",
        }),
      },
    ],
    metadata: {
      rootType: "component",
      attachments: [
        {
          type: "terminal",
          text: "R40",
        },
        {
          type: "part_number",
          text: "MR-RB136-4",
        },
      ],
    },
  });

  const tag = componentPartsTagForBox(box);

  assert.equal(tag.symbol, "R40");
  assert.equal(tag.description, "REGISTER");
  assert.equal(tag.partNumber, "MR-RB136-4");
});

function annotationBox(overrides = {}) {
  return {
    id: "box-1",
    pageNum: 7,
    label: "component",
    bbox: { x: 0, y: 0, width: 100, height: 100 },
    labelBbox: null,
    labelSource: "manual",
    labelCandidateIndex: -1,
    labelCandidates: [],
    source: "human",
    snapped: false,
    metadata: { rootType: "component", attachments: [] },
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
    ...overrides,
  };
}

function symbol(overrides = {}) {
  return {
    symbol: "RTC40",
    family: "RTC",
    suffix: "40",
    suffix_semantics: "opaque_identifier",
    description: "",
    part_number: "",
    location: "",
    source_page: "",
    ...overrides,
  };
}
