"use client";

// Deep-link to a document's extraction workbench. The unified /extract page
// renders the same ExtractionWorkbench inline when a doc is picked; this route
// lets a bookmarked/linked document open it directly.

import { useParams } from "next/navigation";
import { ExtractionWorkbench } from "../extraction-workbench";

export default function ExtractionWorkbenchRoute() {
  const params = useParams<{ documentId: string }>();
  const documentId = decodeURIComponent(params.documentId);
  return <ExtractionWorkbench key={documentId} documentId={documentId} />;
}
