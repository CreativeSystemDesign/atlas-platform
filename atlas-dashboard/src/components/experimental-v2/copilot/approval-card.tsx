"use client";

// Rich approval card (full-SDK): the CLI's own prompt sentence + reason +
// blocked path, editable input, "always allow (this session)", deny with a
// reason, deny & stop. Replaces Allow/Deny over raw JSON.

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ApprovalAnswer, ApprovalRequest } from "./copilot-types";

export function ApprovalCard({
  approval,
  onAnswer,
}: {
  approval: ApprovalRequest;
  onAnswer: (answer: ApprovalAnswer) => void;
}) {
  const original = useMemo(
    () => (typeof approval.input === "string" ? approval.input : JSON.stringify(approval.input, null, 1)),
    [approval.input]
  );
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(original);
  const [denyReason, setDenyReason] = useState("");

  const editedValid = useMemo(() => {
    if (!editing || edited === original) return true;
    try {
      const parsed = JSON.parse(edited);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }, [editing, edited, original]);

  const updatedInput = (): Record<string, unknown> | undefined => {
    if (!editing || edited === original || !editedValid) return undefined;
    return JSON.parse(edited) as Record<string, unknown>;
  };

  const suggestionSummary = (approval.suggestions ?? [])
    .flatMap((sg) => sg.rules ?? [])
    .map((r) => r.ruleContent || r.toolName)
    .slice(0, 3)
    .join(", ");

  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2">
      <p className="text-[11px] font-semibold text-amber-300">
        {approval.title || `Approve: ${approval.display_name || approval.tool}`}
      </p>
      {approval.description && <p className="text-[10px] text-amber-200/80">{approval.description}</p>}
      {approval.decision_reason && (
        <p className="mt-0.5 text-[10px] italic text-amber-200/70" title="Why this asked (from a PreToolUse hook)">
          {approval.decision_reason}
        </p>
      )}
      {approval.blocked_path && (
        <p className="mt-0.5 font-mono text-[10px] text-amber-200/70">path: {approval.blocked_path}</p>
      )}
      {approval.agent_id && (
        <p className="mt-0.5 text-[9px] uppercase text-violet-300/80">from subagent {approval.agent_id.slice(0, 8)}</p>
      )}

      {editing ? (
        <textarea
          value={edited}
          onChange={(e) => setEdited(e.target.value)}
          rows={Math.min(8, edited.split("\n").length + 1)}
          className={`mt-1 w-full resize-y rounded border bg-background/60 p-1.5 font-mono text-[10px] outline-none ${editedValid ? "border-border/70 focus:border-primary/60" : "border-red-500/70"}`}
        />
      ) : (
        <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all text-[10px] text-amber-100/90">{original}</pre>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" className="h-6 px-2.5 text-[11px]" disabled={!editedValid}
          onClick={() => onAnswer({ id: approval.id, allow: true, updated_input: updatedInput() })}>
          {editing && edited !== original ? "Allow edited" : "Allow"}
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]"
          title={suggestionSummary ? `Persists for THIS SESSION only: ${suggestionSummary}` : "Persists a session-only allow rule for this tool"}
          onClick={() => onAnswer({ id: approval.id, allow: true, always_allow: true, updated_input: updatedInput() })}>
          Always (session)
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground"
          onClick={() => { setEditing((e) => !e); setEdited(original); }}>
          {editing ? "Cancel edit" : "Edit input"}
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <input
          value={denyReason}
          onChange={(e) => setDenyReason(e.target.value)}
          placeholder="why? (Arc reads this)"
          className="h-6 min-w-0 flex-1 rounded border border-border/60 bg-background/60 px-1.5 text-[10px] outline-none focus:border-primary/60"
        />
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]"
          onClick={() => onAnswer({ id: approval.id, allow: false, message: denyReason || undefined })}>
          Deny
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] text-red-400"
          title="Deny AND interrupt the whole turn"
          onClick={() => onAnswer({ id: approval.id, allow: false, message: denyReason || undefined, interrupt: true })}>
          Deny &amp; stop
        </Button>
      </div>
    </div>
  );
}
