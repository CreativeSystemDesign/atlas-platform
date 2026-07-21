import assert from "node:assert/strict";
import test from "node:test";

import {
  ANNOTATION_MODES,
  DEFAULT_PAGE,
  DOCUMENT_ID,
  MAX_ZOOM,
  MIN_ZOOM,
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
  PROJECT_ID,
} from "./studio-types.ts";

test("keeps the extraction studio document and viewport constants stable", () => {
  assert.equal(DOCUMENT_ID, "schematic_<drawing-no>");
  assert.equal(PROJECT_ID, "00000000-0000-4000-8000-000000001650");
  assert.equal(DEFAULT_PAGE, 7);
  assert.equal(PAGE_WIDTH_PX, 2481);
  assert.equal(PAGE_HEIGHT_PX, 3509);
  assert.equal(MIN_ZOOM, 0.12);
  assert.equal(MAX_ZOOM, 2.4);
});

test("keeps annotation modes ordered for operator muscle memory", () => {
  assert.deepEqual(
    ANNOTATION_MODES.map((mode) => [mode.id, mode.shortLabel]),
    [
      ["component", "CMP"],
      ["wire-label", "LBL"],
      ["continuation-symbol", "HREF"],
      ["terminal", "TRM"],
      ["wire", "WIRE"],
      ["cable", "CAB"],
      ["junction", "JNC"],
      ["continuation", "REF"],
      ["descriptor", "DESC"],
      ["page-descriptor", "PAGE"],
      ["part-spec", "SPEC"],
      ["note", "NOTE"],
      ["trace", "TRC"],
      ["relationship", "REL"],
    ]
  );
  assert.ok(ANNOTATION_MODES[0].icon);
});
