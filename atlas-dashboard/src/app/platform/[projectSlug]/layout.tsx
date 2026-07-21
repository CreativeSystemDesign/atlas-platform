"use client";

// Project-scoped shell (Platform Graduation R15): everything under
// /platform/{projectSlug}/* operates inside ONE project — the gate made
// structural. During the parallel-route build this lives under /platform;
// the final root swap strips the prefix (R6b).

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { PT } from "@/lib/platform-theme";

export type PlatformProject = {
  project_id: string;
  machine_id: string;
  display_name: string;
  slug: string;
  status: string;
};

const ProjectContext = createContext<PlatformProject | null>(null);
export function useProject(): PlatformProject | null {
  return useContext(ProjectContext);
}

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ projectSlug: string }>();
  const [project, setProject] = useState<PlatformProject | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch(`${agentBaseUrl()}/projects`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((list: PlatformProject[]) => {
        const hit = list.find((p) => p.slug === params.projectSlug);
        if (hit) setProject(hit);
        else setMissing(true);
      })
      .catch(() => setMissing(true));
  }, [params.projectSlug]);

  // No second nav bar (Shane's ruling: the top bar owns navigation; the
  // machine context lives there as a chip). This layout only provides the
  // project context and the missing-project state.
  return (
    <ProjectContext.Provider value={project}>
      {missing ? (
        <div className="px-6 py-10 text-[13px]" style={{ color: PT.gapRed }}>
          No project with slug &ldquo;{params.projectSlug}&rdquo; — return to the{" "}
          <Link href="/platform" style={{ color: PT.cyanText }}>
            Fleet Overview
          </Link>
          .
        </div>
      ) : (
        children
      )}
    </ProjectContext.Provider>
  );
}
