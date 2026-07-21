import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { isAnnotationControlPointerTarget } from "./annotation-control-target.ts";

test("recognizes annotation controls so YOLO stage capture does not start drawing", () => {
  const dom = new JSDOM(`
    <div>
      <div id="stage">
        <button data-atlas-annotation-control="true">
          <span id="resize-handle">handle</span>
        </button>
        <div id="page"></div>
      </div>
    </div>
  `);
  const previousElement = globalThis.Element;
  globalThis.Element = dom.window.Element;
  try {
    assert.equal(
      isAnnotationControlPointerTarget(
        dom.window.document.getElementById("resize-handle")
      ),
      true
    );
    assert.equal(
      isAnnotationControlPointerTarget(dom.window.document.getElementById("page")),
      false
    );
  } finally {
    globalThis.Element = previousElement;
  }
});
