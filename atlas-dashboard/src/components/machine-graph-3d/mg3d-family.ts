// Component-class visual identity (Shane, 2026-07-11: "give each component
// class a visual identity that exists across pages"). A family's look is
// deterministic — same class, same signature, on every page of every
// machine: edge color, tinted body, nameplate, silhouette chamfer, and a
// height character on top of the footprint-area scaling.
//
// Curated palette for the classes a industrial schematic lives on; everything
// unknown gets a stable hashed hue so new families are consistent from
// their first appearance. Hues deliberately avoid the wire-role colors
// where possible (phase amber, rail cyan, earth green, control indigo).

export type FamilyStyle = {
  rgb: [number, number, number];
  chamfer: number; // corner cut in page px (0 = square block)
  heightScale: number;
};

const CURATED: Record<string, Omit<FamilyStyle, "rgb"> & { rgb: [number, number, number] }> = {
  // breakers — squared, tall, safety orange
  MCB: { rgb: [249, 115, 22], chamfer: 0, heightScale: 1.25 },
  ELB: { rgb: [251, 146, 60], chamfer: 0, heightScale: 1.25 },
  // fuses — low, chamfered, fuchsia
  F: { rgb: [217, 70, 239], chamfer: 14, heightScale: 0.8 },
  // contactors / relays — teal
  MC: { rgb: [20, 184, 166], chamfer: 0, heightScale: 1.1 },
  MS: { rgb: [20, 184, 166], chamfer: 0, heightScale: 1.1 },
  RL: { rgb: [45, 212, 191], chamfer: 8, heightScale: 1.0 },
  RY: { rgb: [45, 212, 191], chamfer: 8, heightScale: 1.0 },
  RTC: { rgb: [45, 212, 191], chamfer: 8, heightScale: 1.0 },
  // thermal overloads — warm red
  THR: { rgb: [248, 113, 113], chamfer: 10, heightScale: 0.9 },
  // instrument transformers / transformers — violet
  CT: { rgb: [167, 139, 250], chamfer: 12, heightScale: 0.95 },
  TR: { rgb: [167, 139, 250], chamfer: 12, heightScale: 1.05 },
  // meters — silver, wide and flat
  WHM: { rgb: [226, 232, 240], chamfer: 18, heightScale: 0.75 },
  AM: { rgb: [226, 232, 240], chamfer: 18, heightScale: 0.75 },
  VM: { rgb: [226, 232, 240], chamfer: 18, heightScale: 0.75 },
  // connectors / plugs — rose
  CON: { rgb: [251, 113, 133], chamfer: 6, heightScale: 0.85 },
  CN: { rgb: [251, 113, 133], chamfer: 6, heightScale: 0.85 },
  // pilot lights / indicators — bright yellow, small and round-ish
  PL: { rgb: [253, 224, 71], chamfer: 20, heightScale: 0.9 },
  SL: { rgb: [253, 224, 71], chamfer: 20, heightScale: 0.9 },
  // converters / inverters / drives — blue
  CNV: { rgb: [96, 165, 250], chamfer: 0, heightScale: 1.15 },
  INV: { rgb: [96, 165, 250], chamfer: 0, heightScale: 1.15 },
  // terminal strips / blocks — quiet slate
  T: { rgb: [148, 163, 184], chamfer: 0, heightScale: 0.7 },
  TB: { rgb: [148, 163, 184], chamfer: 0, heightScale: 0.7 },
};

/** Family key: the label engine's identity.family when present, else the
 * leading letter run of the label (ELB12 -> ELB, F12 -> F, MC347 -> MC). */
export function familyOf(label: string | null | undefined, identityFamily?: string | null): string {
  const fromIdentity = (identityFamily ?? "").trim().toUpperCase();
  if (fromIdentity) return fromIdentity;
  const m = (label ?? "").trim().toUpperCase().match(/^([A-Z]+)/);
  return m ? m[1] : "?";
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c);
  };
  return [f(0), f(8), f(4)];
}

function hashHue(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

const styleCache = new Map<string, FamilyStyle>();

export function familyStyle(family: string): FamilyStyle {
  const key = family.toUpperCase();
  const cached = styleCache.get(key);
  if (cached) return cached;
  const curated = CURATED[key];
  const style: FamilyStyle = curated
    ? { rgb: curated.rgb, chamfer: curated.chamfer, heightScale: curated.heightScale }
    : { rgb: hslToRgb(hashHue(key), 0.5, 0.62), chamfer: (hashHue(key) % 3) * 8, heightScale: 1 };
  styleCache.set(key, style);
  return style;
}
