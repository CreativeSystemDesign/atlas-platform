import { useEffect } from "react";

import type { AnnotationBox } from "./studio-types";
import type { MutableRefObject } from "react";

type UseStudioWorkspaceEffectsArgs = {
  relationNotice: string | null;
  setRelationNotice: (relationNotice: string | null) => void;
  boxes: AnnotationBox[];
  boxesRef: MutableRefObject<AnnotationBox[]>;
};

export function useStudioWorkspaceEffects({
  relationNotice,
  setRelationNotice,
  boxes,
  boxesRef,
}: UseStudioWorkspaceEffectsArgs): void {
  useEffect(() => {
    boxesRef.current = boxes;
  }, [boxes, boxesRef]);

  useEffect(() => {
    if (!relationNotice) return undefined;
    const timeout = window.setTimeout(() => {
      setRelationNotice(null);
    }, 4000);
    return () => window.clearTimeout(timeout);
  }, [relationNotice, setRelationNotice]);
}
