"use client";

// The front door IS the platform (graduation completed 2026-07-16: "the old
// platform files are still in the project" — not anymore). The legacy
// operations console and its component tree were EXCISED, not hidden; they
// live on in git history before this commit. The fingerprint workbench (a
// PLANNED platform feature — the vector-fingerprinting detection lane) and
// the 3D machine graph remain — platform surfaces, not console legacy.
//
// Client-side redirect (not next/navigation's server redirect): a server 307
// on `/` reads as "not ready" to health probes — the preview manager's HEAD /
// probe never saw a 200, so it declared the dev server dead and killed it.
// `/` must answer 200 and then route the browser to /platform itself.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/platform");
  }, [router]);
  return null;
}
