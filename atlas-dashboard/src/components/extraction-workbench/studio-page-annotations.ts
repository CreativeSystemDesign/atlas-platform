import { normalizeStudioAnnotations } from "./annotation-persistence.ts";
import type { AnnotationBox } from "./studio-types.ts";

export function replacePageAnnotations(
  current: AnnotationBox[],
  pageNum: number,
  annotations: AnnotationBox[] = []
) {
  return [
    ...current.filter((box) => box.pageNum !== pageNum),
    ...normalizeStudioAnnotations(annotations, pageNum),
  ];
}

export function annotationsForPageSave(
  boxes: AnnotationBox[],
  pageNum: number
) {
  return normalizeStudioAnnotations(
    boxes.filter((box) => box.pageNum === pageNum),
    pageNum
  );
}
