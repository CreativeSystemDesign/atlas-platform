import type { AttachmentKind } from "./annotation-model.ts";

type SymbolBankEntryLike = {
  part_number: string;
};

type WireLabelBankEntryLike = {
  wire_label: string;
};

const WIRE_COLOR_ABBREVIATIONS = new Set([
  "BK",
  "BLK",
  "B",
  "W",
  "WH",
  "R",
  "RED",
  "BL",
  "BU",
  "BLUE",
  "Y",
  "YL",
  "YEL",
  "G",
  "GN",
  "GR",
  "GRN",
  "GREEN",
  "BR",
  "BN",
  "BRN",
  "OR",
  "ORG",
  "O",
  "GY",
  "GRAY",
  "GREY",
  "V",
  "VI",
  "VIO",
  "P",
  "PK",
  "PINK",
]);

export function normalizeSymbolText(value: string) {
  return value
    .trim()
    .replace(/[‐‑‒–—―－]/g, "-")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0)
    )
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

export function normalizePartText(value: string) {
  return normalizeSymbolText(value).replace(/-/g, "");
}

export function normalizeTerminalLabelText(value: string) {
  return value
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９＋－]/g, (char) => {
      if (char === "＋") return "+";
      if (char === "－") return "-";
      return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
    })
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function normalizeWireLabelText(value: string) {
  return value
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９＋－]/g, (char) => {
      if (char === "＋") return "+";
      if (char === "－") return "-";
      return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
    })
    .replace(/[‐‑‒–—―]/g, "-")
    .toUpperCase()
    .replace(/[^A-Z0-9+-]/g, "");
}

export function datasetWireLabelClassName(value: string) {
  const normalized = normalizeWireLabelText(value);
  if (normalized === "P5") return "Wire Label (+5v)";
  if (normalized === "N5") return "Wire Label (-5v)";
  if (normalized === "P24") return "Wire Label (+24v)";
  if (normalized === "N24") return "Wire Label (-24v)";
  if (normalized === "NC24") return "Wire Label (com24v)";
  if (/^X\d{4}$/.test(normalized)) return "Input Signal Wire";
  if (/^Y\d{4}$/.test(normalized)) return "Output Signal Wire";
  return "Wire Label";
}

export function normalizeLocationText(value: string) {
  return normalizeSymbolText(value);
}

export function normalizeWireColorText(value: string) {
  return normalizeSymbolText(value)
    .replace(/0/g, "O")
    .replace(/[^A-Z]/g, "");
}

export function isWireColorText(value: string) {
  return WIRE_COLOR_ABBREVIATIONS.has(normalizeWireColorText(value));
}

export function classifyAttachmentText(
  value: string,
  symbolBank: SymbolBankEntryLike[],
  wireLabelBank: WireLabelBankEntryLike[]
): AttachmentKind {
  const normalized = normalizeSymbolText(value);
  const compact = normalizePartText(value);
  const terminalLabel = normalizeTerminalLabelText(value);
  const normalizedWireLabel = normalizeWireLabelText(value);
  const locationText = normalizeLocationText(value);
  const knownPart = symbolBank.some(
    (entry) => normalizePartText(entry.part_number) === compact
  );
  const knownWireLabel = wireLabelBank.some(
    (entry) => normalizeWireLabelText(entry.wire_label) === normalizedWireLabel
  );
  if (knownPart) return "part_number";
  if (knownWireLabel) return "wire_label";
  if (/^(PP|CP|OP|HP|MP|TB|JB|BOX|PANEL)$/.test(locationText)) {
    return "location";
  }
  if (/^(G|FG|SG|PE|EARTH|GROUND)$/.test(terminalLabel)) return "ground_label";
  if (/^\d{1,3}$/.test(normalized)) return "terminal";
  if (/^(PE|L[+-]?|N|P\d{1,2}|T\d{1,2}|R\d{1,2}|S\d{1,2})$/.test(terminalLabel)) {
    return "terminal_label";
  }
  if (/[A-Z]/.test(normalized) && /\d/.test(normalized)) return "spec";
  return "text";
}
