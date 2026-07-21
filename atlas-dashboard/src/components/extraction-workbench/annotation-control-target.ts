export function isAnnotationControlPointerTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest('[data-atlas-annotation-control="true"]'))
  );
}
