"use client";

type WorkspacePageStatus = "loading" | "ready" | "error";

type StudioWorkspacePageStatusOverlayProps = {
  imageStatus: WorkspacePageStatus;
};

export function StudioWorkspacePageStatusOverlay({
  imageStatus,
}: StudioWorkspacePageStatusOverlayProps) {
  if (imageStatus === "ready") {
    return null;
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/45 backdrop-blur-sm">
      <div className="rounded-3xl border border-border/70 bg-card/80 px-5 py-4 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
          {imageStatus === "loading" ? "Loading page" : "Page unavailable"}
        </div>
        <div className="mt-2 max-w-[320px] text-[12px] leading-5 text-muted-foreground">
          {imageStatus === "loading"
            ? "Fetching the canonical schematic render from the Workbench API."
            : "The Workbench API could not serve this schematic page render."}
        </div>
      </div>
    </div>
  );
}
