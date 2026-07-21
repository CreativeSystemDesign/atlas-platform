// Net classification for the 3D machine graph: maps electrical net labels
// (and T~owner~[pin~]net terminal names) to a role + instrument-palette color.

export type NetRole = "phase" | "dc-rail" | "earth" | "control" | "unlabeled";

// L covers the incoming supply legs (L1/L2/L3 into the main breaker) —
// component labels like LB11 don't match (digit must follow the letter).
const PHASE_RE = /^[RSTUVWL]\d/;
const DC_RAIL_RE = /^[PN]\d+$/;
const DC_24V_RE = /^\+?24V/;
const EARTH_LABELS = new Set(["PE", "E", "G", "GND", "FG"]);

export function classifyNet(label: string | null | undefined): NetRole {
  if (label == null) return "unlabeled";
  const name = label.trim().toUpperCase();
  if (name.length === 0) return "unlabeled";
  if (PHASE_RE.test(name)) return "phase";
  if (DC_RAIL_RE.test(name) || DC_24V_RE.test(name)) return "dc-rail";
  if (EARTH_LABELS.has(name)) return "earth";
  return "control";
}

// Last ~-segment of a T~owner~[pin~]net terminal name, else null.
export function terminalNet(label: string | null | undefined): string | null {
  if (label == null) return null;
  const name = label.trim();
  if (!name.startsWith("T~")) return null;
  const segments = name.split("~");
  const net = segments[segments.length - 1];
  return net.length > 0 ? net : null;
}

// The PRINTED pin designator, present only in the 4-segment form
// T~owner~pin~net (naming v3: the pin slot exists only where the print
// names the terminal). T~owner~net has no pin -> null.
export function terminalPin(label: string | null | undefined): string | null {
  if (label == null) return null;
  const name = label.trim();
  if (!name.startsWith("T~")) return null;
  const segments = name.split("~");
  if (segments.length < 4) return null;
  const pin = segments[2];
  return pin.length > 0 ? pin : null;
}

export const NET_ROLE_RGB: Record<NetRole, [number, number, number]> = {
  phase: [251, 191, 36],
  "dc-rail": [56, 189, 248],
  earth: [74, 222, 128],
  control: [129, 140, 248],
  unlabeled: [100, 116, 139],
};

export const NET_ROLE_LABEL: Record<NetRole, string> = {
  phase: "AC phase",
  "dc-rail": "DC rail",
  earth: "Earth",
  control: "Control",
  unlabeled: "Unlabeled",
};
