import assert from "node:assert/strict";
import test from "node:test";

import {
  PEN_TOUCH_SUPPRESSION_MS,
  isPenEraserPointer,
  isPrimaryAnnotationPointerActivation,
  markPenPointer,
  shouldSuppressTouchAfterPen,
} from "./studio-pointer-input.ts";

test("pen is accepted as an annotation pointer", () => {
  assert.equal(
    isPrimaryAnnotationPointerActivation({
      button: -1,
      buttons: 1,
      isPrimary: true,
      pointerType: "pen",
    }),
    true
  );
});

test("pen eraser pointer is recognized by button or buttons bitfield", () => {
  assert.equal(
    isPenEraserPointer({
      button: 5,
      buttons: 32,
      pointerType: "pen",
    }),
    true
  );
  assert.equal(
    isPenEraserPointer({
      button: 0,
      buttons: 32,
      pointerType: "pen",
    }),
    true
  );
  assert.equal(
    isPenEraserPointer({
      button: 2,
      buttons: 2,
      pointerType: "pen",
    }),
    false
  );
});

test("touch immediately after pen contact is suppressed as palm input", () => {
  const lastPenPointerAtRef = { current: 0 };
  markPenPointer(
    {
      button: -1,
      buttons: 1,
      pointerType: "pen",
    },
    lastPenPointerAtRef,
    1000
  );

  assert.equal(
    shouldSuppressTouchAfterPen(
      {
        button: 0,
        buttons: 1,
        pointerType: "touch",
      },
      lastPenPointerAtRef,
      1000 + PEN_TOUCH_SUPPRESSION_MS - 1
    ),
    true
  );
  assert.equal(
    shouldSuppressTouchAfterPen(
      {
        button: 0,
        buttons: 1,
        pointerType: "touch",
      },
      lastPenPointerAtRef,
      1000 + PEN_TOUCH_SUPPRESSION_MS + 1
    ),
    false
  );
});
