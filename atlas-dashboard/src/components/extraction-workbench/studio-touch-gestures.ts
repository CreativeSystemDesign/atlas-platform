const EDGE_NAV_WIDTH_PX = 48;
const EDGE_TAP_MAX_MOVEMENT_PX = 16;

type TouchGesturePointEvent = {
  pointerId: number;
  clientX: number;
  clientY: number;
};

type ViewportRect = {
  left: number;
  right: number;
};

type PanOffset = {
  x: number;
  y: number;
};

type TouchPoint = {
  startX: number;
  startY: number;
  x: number;
  y: number;
};

type EdgeTap = {
  pointerId: number;
  side: "left" | "right";
  startX: number;
  startY: number;
  moved: boolean;
};

type TouchPan = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

export type TouchGestureState = {
  points: Map<number, TouchPoint>;
  edgeTap: EdgeTap | null;
  pan: TouchPan | null;
};

export function createTouchGestureState(): TouchGestureState {
  return {
    points: new Map(),
    edgeTap: null,
    pan: null,
  };
}

export function beginTouchGesture(
  state: TouchGestureState,
  event: TouchGesturePointEvent,
  viewportRect: ViewportRect,
  pan: PanOffset
) {
  state.points.set(event.pointerId, {
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
  });

  if (state.points.size === 1) {
    const side = edgeSideForPoint(viewportRect, event.clientX);
    state.edgeTap = side
      ? {
          pointerId: event.pointerId,
          side,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        }
      : null;
  } else {
    state.edgeTap = null;
  }

  if (state.points.size >= 2) {
    const center = touchCenter(state.points);
    state.pan = {
      startX: center.x,
      startY: center.y,
      originX: pan.x,
      originY: pan.y,
    };
    return { startedPan: true };
  }

  return { startedPan: false };
}

export function moveTouchGesture(
  state: TouchGestureState,
  event: TouchGesturePointEvent,
  pan: PanOffset
) {
  const point = state.points.get(event.pointerId);
  if (!point) return { handled: false, nextPan: null };

  point.x = event.clientX;
  point.y = event.clientY;

  if (
    state.edgeTap?.pointerId === event.pointerId &&
    pointerTravel(state.edgeTap.startX, state.edgeTap.startY, event.clientX, event.clientY) >
      EDGE_TAP_MAX_MOVEMENT_PX
  ) {
    state.edgeTap.moved = true;
  }

  if (state.points.size < 2) return { handled: true, nextPan: null };

  if (!state.pan) {
    const center = touchCenter(state.points);
    state.pan = {
      startX: center.x,
      startY: center.y,
      originX: pan.x,
      originY: pan.y,
    };
  }

  const center = touchCenter(state.points);
  return {
    handled: true,
    nextPan: {
      x: state.pan.originX + center.x - state.pan.startX,
      y: state.pan.originY + center.y - state.pan.startY,
    },
  };
}

export function finishTouchGesture(
  state: TouchGestureState,
  event: TouchGesturePointEvent,
  options: { navigate: boolean }
) {
  const point = state.points.get(event.pointerId);
  if (!point) return { handled: false, pageDelta: 0 };

  const edgeTap = state.edgeTap;
  const shouldNavigate =
    options.navigate &&
    !state.pan &&
    state.points.size === 1 &&
    edgeTap?.pointerId === event.pointerId &&
    !edgeTap.moved &&
    pointerTravel(edgeTap.startX, edgeTap.startY, event.clientX, event.clientY) <=
      EDGE_TAP_MAX_MOVEMENT_PX;

  state.points.delete(event.pointerId);
  if (state.points.size < 2) {
    state.pan = null;
  }
  if (state.points.size === 0 || edgeTap?.pointerId === event.pointerId) {
    state.edgeTap = null;
  }

  return {
    handled: true,
    pageDelta: shouldNavigate ? (edgeTap.side === "right" ? 1 : -1) : 0,
  };
}

function edgeSideForPoint(rect: ViewportRect, clientX: number) {
  if (clientX - rect.left <= EDGE_NAV_WIDTH_PX) return "left";
  if (rect.right - clientX <= EDGE_NAV_WIDTH_PX) return "right";
  return null;
}

function pointerTravel(startX: number, startY: number, x: number, y: number) {
  return Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));
}

function touchCenter(points: Map<number, TouchPoint>) {
  const pair = [...points.values()].slice(0, 2);
  if (pair.length === 0) return { x: 0, y: 0 };
  if (pair.length === 1) return { x: pair[0].x, y: pair[0].y };
  return {
    x: (pair[0].x + pair[1].x) / 2,
    y: (pair[0].y + pair[1].y) / 2,
  };
}
