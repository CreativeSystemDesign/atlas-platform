// The bare project URL (/platform/machine-1) has no surface of its own — land on
// the Library, the project's natural home view. Added 2026-07-17 after the
// "everything is gone" scare: every reasonable URL must land somewhere real.
import { redirect } from "next/navigation";

export default async function ProjectHome({ params }: { params: Promise<{ projectSlug: string }> }) {
  const { projectSlug } = await params;
  redirect(`/platform/${projectSlug}/library`);
}
