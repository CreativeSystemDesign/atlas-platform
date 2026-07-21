"use client";

// Create machine/project — the gate's second door (Platform Graduation R15).
// Identity comes from HUMAN declaration: machine id + family (manufacturer/
// model, R2 — never silently defaulted). The sibling guard (G51) surfaces
// near-identical machines BEFORE a blind insert: first submit returns the
// matches; creating a sibling is an explicit second act.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { PT, PT_PANEL_FROST } from "@/lib/platform-theme";

type Similar = { project_id: string; machine_id: string; display_name: string; slug: string };

const FIELD_STYLE = {
  background: PT.well,
  border: `1px solid ${PT.lineStrong}`,
  color: PT.text,
} as const;

export default function NewProjectPage() {
  const router = useRouter();
  const [machineId, setMachineId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [similar, setSimilar] = useState<Similar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(confirmSibling: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${agentBaseUrl()}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machine_id: machineId,
          display_name: displayName || null,
          manufacturer: manufacturer || null,
          model: model || null,
          confirm_sibling: confirmSibling,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body?.detail?.reason === "similar_machines_exist") {
        setSimilar(body.detail.matches ?? []);
      } else if (!res.ok) {
        setError(typeof body?.detail === "string" ? body.detail : `create failed (HTTP ${res.status})`);
      } else {
        router.push(`/platform/${body.slug}/library`);
      }
    } catch {
      setError("backend unreachable");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-6 py-10">
      <div>
        <h1 className="text-[20px] font-bold" style={{ color: PT.text }}>
          New machine
        </h1>
      </div>

      <section
        className="flex flex-col gap-4 rounded-2xl border p-6 backdrop-blur-2xl"
        style={{ borderColor: PT.line, background: PT_PANEL_FROST }}
      >
        {[
          { label: "Machine ID", value: machineId, set: setMachineId, ph: "e.g. UB1650-2" },
          { label: "Display name", value: displayName, set: setDisplayName, ph: "e.g. Machine 12 — Line 2" },
          { label: "Manufacturer", value: manufacturer, set: setManufacturer, ph: "e.g. the machine's OEM" },
          { label: "Model", value: model, set: setModel, ph: "e.g. M-300" },
        ].map((f) => (
          <label key={f.label} className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[.12em]" style={{ color: PT.textMute }}>
              {f.label}
            </span>
            <input
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              placeholder={f.ph}
              className="rounded-lg px-3 py-2 text-[13px] outline-none"
              style={FIELD_STYLE}
            />
          </label>
        ))}

        {similar && similar.length > 0 && (
          <div
            className="flex flex-col gap-2 rounded-xl border p-4"
            style={{ borderColor: "rgba(245,158,11,.4)", background: "rgba(245,158,11,.08)" }}
          >
            <div className="text-[12px] font-bold" style={{ color: PT.amberText }}>
              Near-identical machines already exist — is this one of them?
            </div>
            {similar.map((s) => (
              <Link
                key={s.project_id}
                href={`/platform/${s.slug}/library`}
                className="text-[12px] font-semibold"
                style={{ color: PT.cyanText }}
              >
                → continue {s.display_name} ({s.machine_id})
              </Link>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(true)}
              className="mt-1 cursor-pointer self-start rounded-lg border-0 px-3.5 py-1.5 text-[12px] font-bold"
              style={{ background: PT.amber, color: "#231303" }}
            >
              No — create &ldquo;{machineId}&rdquo; as a separate sibling machine
            </button>
          </div>
        )}

        {error && (
          <div className="text-[12px] font-semibold" style={{ color: PT.gapRed }}>
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy || !machineId.trim()}
            onClick={() => void submit(false)}
            className="cursor-pointer rounded-lg border-0 px-4 py-2 text-[12px] font-bold"
            style={{
              background: `linear-gradient(180deg, ${PT.cyanBright}, ${PT.cyanDeep})`,
              color: "#062430",
              boxShadow: "rgba(34,211,238,0.4) 0px 2px 8px",
              opacity: busy || !machineId.trim() ? 0.5 : 1,
            }}
          >
            {busy ? "Creating…" : "Create machine"}
          </button>
          <Link href="/platform" className="text-[12px]" style={{ color: PT.textMute }}>
            cancel
          </Link>
        </div>
      </section>
    </div>
  );
}
