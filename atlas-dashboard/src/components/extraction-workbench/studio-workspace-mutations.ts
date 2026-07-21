import { useStudioWorkspaceOperations } from "./studio-workspace-operations";
import { useStudioAnnotationActions } from "./studio-annotation-actions";

type StudioWorkspaceOperationsArgs = Parameters<typeof useStudioWorkspaceOperations>[0];
type StudioAnnotationActionsArgs = Parameters<typeof useStudioAnnotationActions>[0];
type StudioAnnotationActionsResolvedInputs = Pick<
  StudioAnnotationActionsArgs,
  | "resolveLabelCandidates"
  | "resolveWireLabelCandidates"
  | "resolveAttachmentCandidate"
  | "resolveContinuationCandidate"
  | "resolveGroundReferenceCandidate"
>;

type UseStudioWorkspaceMutationsArgs = StudioWorkspaceOperationsArgs &
  Omit<StudioAnnotationActionsArgs, keyof StudioAnnotationActionsResolvedInputs>;

export type StudioWorkspaceMutations = ReturnType<
  typeof useStudioWorkspaceOperations
> & ReturnType<typeof useStudioAnnotationActions>;

export function useStudioWorkspaceMutations(
  dependencies: UseStudioWorkspaceMutationsArgs
): StudioWorkspaceMutations {
  const workspaceOperations = useStudioWorkspaceOperations(dependencies);
  const annotationActions = useStudioAnnotationActions({
    ...dependencies,
    resolveLabelCandidates: workspaceOperations.resolveLabelCandidates,
    resolveWireLabelCandidates: workspaceOperations.resolveWireLabelCandidates,
    resolveAttachmentCandidate: workspaceOperations.resolveAttachmentCandidate,
    resolveContinuationCandidate: workspaceOperations.resolveContinuationCandidate,
    resolveGroundReferenceCandidate: workspaceOperations.resolveGroundReferenceCandidate,
  });

  return {
    ...workspaceOperations,
    ...annotationActions,
  };
}
