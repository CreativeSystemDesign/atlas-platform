"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function DataIndex() {
  const params = useParams<{ projectSlug: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/platform/${params.projectSlug}/data/map`);
  }, [params.projectSlug, router]);
  return null;
}
