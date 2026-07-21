import { rootTypeOf } from "./annotation-box-helpers.ts";
import { normalizeClassLabel } from "./class-label-normalization.ts";
import type { AnnotationBox } from "./studio-types.ts";

export function rootDatasetClassName(box: AnnotationBox) {
  return normalizeClassLabel(box.label || rootTypeOf(box));
}
