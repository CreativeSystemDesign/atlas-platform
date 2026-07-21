"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const MachineGraph3dView = dynamic(
  () =>
    import("@/components/machine-graph-3d/machine-graph-3d-view").then(
      (m) => m.MachineGraph3dView,
    ),
  { ssr: false },
);

// useSearchParams must live under <Suspense> in the app router.
function MachineGraphInner() {
  const searchParams = useSearchParams();
  const raw = parseInt(searchParams.get("page") ?? "7", 10);
  const pageNum = Number.isFinite(raw) && raw >= 1 ? raw : 7;

  return <MachineGraph3dView pageNum={pageNum} />;
}

export default function MachineGraphPage() {
  return (
    <div style={{ minHeight: "100dvh", background: "#0a0e16" }}>
      <Suspense fallback={null}>
        <MachineGraphInner />
      </Suspense>
    </div>
  );
}
