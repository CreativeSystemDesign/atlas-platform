// Atlas-Platform design system — "Midnight Gallery", platform-wide.
//
// EXTRACTION CONTRACT (Platform Graduation R6a / G63): this module begins as
// a PURE COPY of smart-canvas-theme.ts's ratified tokens — zero value
// changes, verified by eye against the live canvas. The canvas keeps
// importing its own module until the final migration step; new platform
// surfaces (shell, Overview, Library, Extraction) import from HERE. At the
// root swap, the canvas re-points here and smart-canvas-theme.ts retires.
//
// THE ULTRA-PREMIUM BAR (Shane, at plan sign-off): "the UI must have the
// premium... ultra-premium design because this will hopefully, one day fund
// my retirement." No surface ships below the Smart Canvas's standard —
// these tokens are the floor, not the ceiling.

/** Core palette — verbatim from smart-canvas-theme.ts (design target of
    record: docs/vault/Smart Canvas v2 Design Target.md). */
export const PT = {
  // Accent — cyan leads; amber is the work/proposal accent.
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
  ink: "#0a0f1a",
  panel: "rgba(16,24,42,.75)",
  panelSolid: "#0d1423",
  well: "rgba(3,8,18,.7)",

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

/** Screen background gradient (radial navy wash) — verbatim. */
export const PT_SCREEN_BG =
  "radial-gradient(1200px 600px at 60% -10%, rgba(16,28,51,.62) 0%, rgba(10,15,26,.86) 55%)";

/** Header / rail glass fill — verbatim. */
export const PT_GLASS =
  "linear-gradient(180deg, rgba(20,30,50,.85), rgba(13,20,35,.85))";

export const PT_RAIL_GLASS =
  "linear-gradient(180deg, rgba(16,24,42,.7), rgba(11,17,30,.7))";

/** Panel / drawer frost — verbatim (dense enough for crisp text, blurred
    enough that the gallery glows through; pair with backdrop-blur-2xl). */
export const PT_PANEL_FROST =
  "linear-gradient(180deg, rgba(15,22,39,.86), rgba(9,14,26,.9))";

// --- Platform-level tokens (NEW surfaces only — nothing here restyles the
// canvas; built strictly from the palette above) ---------------------------

/** R0 trust-tier identities — one shared token set for row chips (extraction)
    and seal chips (canvas), per the workbench design's single-token note. */
export const PT_TIER = {
  machine: { fg: PT.textMute, bg: "rgba(139,155,180,.14)", label: "machine-verified" },
  arc: { fg: PT.amberText, bg: "rgba(245,158,11,.14)", label: "arc-verified" },
  shane: { fg: PT.amberBright, bg: "rgba(251,191,36,.18)", label: "shane-verified" },
} as const;

/** Honest-gap status ramp — the Overview's chip vocabulary. `pending` is a
    first-class visual state: a figure with no live feed yet renders AS a
    named gap, never as a fake zero (the honest-gap law applied to the UI
    skeleton itself). */
export const PT_STATUS = {
  ok: { fg: PT.ok, bg: "rgba(52,211,153,.12)" },
  working: { fg: PT.cyanText, bg: "rgba(34,211,238,.12)" },
  warn: { fg: PT.amberText, bg: "rgba(245,158,11,.12)" },
  gap: { fg: PT.gapRed, bg: "rgba(248,113,113,.12)" },
  pending: { fg: PT.textFaint, bg: "rgba(75,90,114,.16)" },
} as const;
