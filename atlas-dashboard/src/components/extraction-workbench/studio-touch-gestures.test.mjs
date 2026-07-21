import assert from "node:assert/strict";
import test from "node:test";

import {
  beginTouchGesture,
  createTouchGestureState,
  finishTouchGesture,
  moveTouchGesture,
} from "./studio-touch-gestures.ts";

const rect = { left: 100, right: 900 };

test("right and left viewport edge taps request page navigation", () => {
  const rightState = createTouchGestureState();
  beginTouchGesture(rightState, touch({ pointerId: 1, clientX: 872 }), rect, {
    x: 0,
    y: 0,
  });
  assert.deepEqual(
    finishTouchGesture(rightState, touch({ pointerId: 1, clientX: 872 }), {
      navigate: true,
    }),
    { handled: true, pageDelta: 1 }
  );

  const leftState = createTouchGestureState();
  beginTouchGesture(leftState, touch({ pointerId: 2, clientX: 124 }), rect, {
    x: 0,
    y: 0,
  });
  assert.deepEqual(
    finishTouchGesture(leftState, touch({ pointerId: 2, clientX: 124 }), {
      navigate: true,
    }),
    { handled: true, pageDelta: -1 }
  );
});

test("dragging on an edge cancels touch page navigation", () => {
  const state = createTouchGestureState();
  beginTouchGesture(state, touch({ pointerId: 1, clientX: 872 }), rect, {
    x: 0,
    y: 0,
  });
  moveTouchGesture(state, touch({ pointerId: 1, clientX: 840, clientY: 150 }), {
    x: 0,
    y: 0,
  });

  assert.deepEqual(
    finishTouchGesture(state, touch({ pointerId: 1, clientX: 840, clientY: 150 }), {
      navigate: true,
    }),
    { handled: true, pageDelta: 0 }
  );
});

test("two active touch pointers produce a viewport pan delta", () => {
  const state = createTouchGestureState();
  beginTouchGesture(state, touch({ pointerId: 1, clientX: 300, clientY: 200 }), rect, {
    x: 20,
    y: 30,
  });
  beginTouchGesture(state, touch({ pointerId: 2, clientX: 500, clientY: 200 }), rect, {
    x: 20,
    y: 30,
  });

  moveTouchGesture(state, touch({ pointerId: 1, clientX: 360, clientY: 240 }), {
    x: 20,
    y: 30,
  });
  assert.deepEqual(
    moveTouchGesture(state, touch({ pointerId: 2, clientX: 560, clientY: 240 }), {
      x: 20,
      y: 30,
    }),
    { handled: true, nextPan: { x: 80, y: 70 } }
  );
});

function touch(overrides = {}) {
  return {
    pointerId: 1,
    clientX: 100,
    clientY: 100,
    ...overrides,
  };
}
