type PointerInputEvent = {
  button: number;
  buttons?: number;
  isPrimary?: boolean;
  pointerType?: string;
};

export const PEN_TOUCH_SUPPRESSION_MS = 700;

function isDirectPointer(event: PointerInputEvent) {
  return event.pointerType === "pen" || event.pointerType === "touch";
}

export function isPenPointer(event: PointerInputEvent) {
  return event.pointerType === "pen";
}

export function isTouchPointer(event: PointerInputEvent) {
  return event.pointerType === "touch";
}

export function isPenEraserPointer(event: PointerInputEvent) {
  return event.pointerType === "pen" && (event.button === 5 || Boolean((event.buttons ?? 0) & 32));
}

export function markPenPointer(
  event: PointerInputEvent,
  lastPenPointerAtRef: { current: number },
  now = Date.now()
) {
  if (isPenPointer(event)) {
    lastPenPointerAtRef.current = now;
  }
}

export function shouldSuppressTouchAfterPen(
  event: PointerInputEvent,
  lastPenPointerAtRef: { current: number },
  now = Date.now()
) {
  return (
    isTouchPointer(event) &&
    lastPenPointerAtRef.current > 0 &&
    now - lastPenPointerAtRef.current <= PEN_TOUCH_SUPPRESSION_MS
  );
}

export function isPrimaryPointerInput(event: PointerInputEvent) {
  return !isDirectPointer(event) || event.isPrimary !== false;
}

export function isPrimaryPointerActivation(event: PointerInputEvent) {
  if (!isPrimaryPointerInput(event)) return false;
  if (event.button === 0) return true;
  return isDirectPointer(event) && event.button === -1 && event.buttons === 1;
}

export function isPrimaryAnnotationPointerActivation(event: PointerInputEvent) {
  return !isTouchPointer(event) && isPrimaryPointerActivation(event);
}

export function isAuxiliaryPointerActivation(event: PointerInputEvent) {
  return !isDirectPointer(event) && event.button === 1;
}

export function isSecondaryPointerActivation(event: PointerInputEvent) {
  return !isDirectPointer(event) && event.button === 2;
}

export function isSupportedStagePointerActivation(event: PointerInputEvent) {
  return (
    isPrimaryPointerActivation(event) ||
    isAuxiliaryPointerActivation(event) ||
    isSecondaryPointerActivation(event)
  );
}
