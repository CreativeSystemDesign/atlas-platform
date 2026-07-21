// Smart Canvas "Midnight Gallery" design tokens (design target of record:
// docs/vault/Smart Canvas v2 Design Target.md; artifact "Smart Canvas v4 -
// Midnight Gallery.dc.html"). The workspace has a deliberate, saturated
// deep-navy + cyan identity distinct from the app's neutral-gray dark theme,
// so the palette lives HERE — one source of truth — rather than as scattered
// magic hex across header / rail / HUD / panel. Values are lifted verbatim
// from the ratified mockup.

/** Core palette. */
export const MG = {
  // Accent — cyan leads (Annotate); amber is the work/proposal accent
  // (Fingerprint lead + issues + copilot proposals).
  cyan: "#22d3ee",
  cyanBright: "#38dcf5",
  cyanDeep: "#0e7490",
  cyanText: "#67e8f9",
  cyanTextBright: "#a5f3fc",
  amber: "#f59e0b",
  amberBright: "#fbbf24",
  amberDeep: "#d97706",
  amberText: "#fcd34d",
  gapRed: "#f87171",
  ok: "#34d399",

  // Surfaces — deep navy, layered.
  ink: "#0a0f1a", // deepest bg
  panel: "rgba(16,24,42,.75)", // rail / header glass
  panelSolid: "#0d1423",
  well: "rgba(3,8,18,.7)", // inset field / control well

  // Text ramp.
  text: "#e7ecf4",
  textDim: "#c7d2e0",
  textMute: "#8b9bb4",
  textFaint: "#5b6778",
  textGhost: "#4b5a72",

  // Hairlines.
  line: "rgba(148,163,184,.12)",
  lineStrong: "rgba(148,163,184,.2)",
} as const;

/** The screen background gradient (radial navy wash) — matches v4. */
export const MG_SCREEN_BG =
  "radial-gradient(1200px 600px at 60% -10%, rgba(16,28,51,.62) 0%, rgba(10,15,26,.86) 55%)";

/** Header / rail glass fill. */
export const MG_GLASS =
  "linear-gradient(180deg, rgba(20,30,50,.85), rgba(13,20,35,.85))";

export const MG_RAIL_GLASS =
  "linear-gradient(180deg, rgba(16,24,42,.7), rgba(11,17,30,.7))";

/** Copilot panel / drawer frost — dense enough that transcript text reads
    crisply, blurred enough that the ambient gallery still glows through as
    atmosphere rather than showing raw through the glass (Shane, 2026-07-08:
    "too transparent as it is now"). Pair with backdrop-blur-2xl + saturate. */
export const MG_PANEL_FROST =
  "linear-gradient(180deg, rgba(15,22,39,.86), rgba(9,14,26,.9))";

/** The two accent identities, keyed by mode. */
export type MgMode = "annotate" | "fingerprint";
export function modeAccent(mode: MgMode) {
  return mode === "annotate"
    ? { lead: MG.cyan, leadText: MG.cyanText, leadTextBright: MG.cyanTextBright }
    : { lead: MG.amber, leadText: MG.amberText, leadTextBright: MG.amberBright };
}
