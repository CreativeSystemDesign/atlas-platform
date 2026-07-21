// Phase-1 manufactured data — a full trace answer and its conversation
// script, shaped exactly as the real engine will emit them (grammar v0).
// Everything here is invented: generic designators, invented documents,
// invented part numbers. The point is to lock the FORMAT, not the facts.
//
// RULED 2026-07-17 (Shane): a circuit trace is done BY CONNECTION — from
// origination to termination, laid out in steps, one connection to the
// next. THE CHAIN RULE: the last location of one step is the first
// location of the next. All data in this room is certified by
// construction — no trust chrome anywhere.

import type { AnswerLayout } from "./answer-grammar";

const SCHEMATIC = "Machine Schematic";
const CABLE_LIST = "Cable List";
const TB_WIRING = "Terminal Box Wiring Diagram";
const PANEL_WIRING = "Panel Wiring Diagram";

export const MOCK_TRACE: AnswerLayout = {
  title: "Circuit trace — Y034 command to SV-104 (clamp extend)",
  subtitle:
    "Resolved from “the solenoid responsible for clamp extend” · origination → termination, connection by connection",
  root: {
    kind: "stack",
    children: [
      {
        kind: "narrative",
        text:
          "The command circuit originates at PLC output Y034 in control panel CP1 and travels connection by connection — panel wiring, cable C-12, junction box JB-3, field wiring — to the SV-104 coil on the valve stand, then returns to the 0 V bus in CP1. Each step below picks up exactly where the last one landed, beside the print it came from.",
      },
      {
        kind: "route",
        stops: [
          { label: "CP1", sublabel: "control panel" },
          { label: "JB-3", sublabel: "junction box" },
          { label: "SV-104", sublabel: "valve stand" },
          { label: "JB-3", sublabel: "junction box" },
          { label: "CP1 · 0 V bus", sublabel: "termination" },
        ],
        vias: ["cable C-12", "field wiring", "field return", "cable C-12"],
      },
      {
        kind: "step_list",
        steps: [
          {
            kind: "step",
            id: "s1",
            title: "Origination to PLC output Y034",
            claim:
              "The circuit originates at CP1's 24 VDC control supply; the slot-4 output card switches it onto output Y034 at terminal 5.",
            anchor: { document: SCHEMATIC, page: 8 },
            from: { enclosure: "CP1 · control panel", point: "24 VDC supply" },
            to: { enclosure: "CP1 · control panel", point: "Slot 4 : 5 (Y034)" },
            via: "output card",
            body: [
              {
                kind: "doc_crop",
                anchor: { document: SCHEMATIC, page: 8 },
                sketch: "plc-output",
                highlight: "Y034",
                caption: "Output card, sheet 8",
              },
            ],
          },
          {
            kind: "step",
            id: "s2",
            title: "Y034 to panel terminals",
            claim:
              "Panel wiring carries Y034 from the output card to CP1's field-side terminal strip, landing on TB-1 : 14.",
            anchor: { document: PANEL_WIRING, page: 6 },
            from: { enclosure: "CP1 · control panel", point: "Slot 4 : 5 (Y034)" },
            to: { enclosure: "CP1 · control panel", point: "TB-1 : 14" },
            via: "panel wiring · Y034",
            body: [
              {
                kind: "table",
                anchor: { document: PANEL_WIRING, page: 6 },
                caption: "Panel-wiring row",
                columns: ["Wire", "From", "To"],
                rows: [["Y034", "Slot 4 : 5", "TB-1 : 14"]],
              },
            ],
          },
          {
            kind: "step",
            id: "s3",
            title: "Panel to junction box",
            claim:
              "From TB-1 : 14 the wire leaves CP1 as conductor 2 of cable C-12 and lands in junction box JB-3 on strip TB-A, terminal 7.",
            anchor: { document: CABLE_LIST, page: 4 },
            from: { enclosure: "CP1 · control panel", point: "TB-1 : 14" },
            to: { enclosure: "JB-3 · junction box", point: "TB-A : 7" },
            via: "cable C-12 · conductor 2",
            body: [
              {
                kind: "doc_crop",
                anchor: { document: CABLE_LIST, page: 4 },
                sketch: "cable-run",
                highlight: "C-12",
                caption: "Route: CP1 → JB-3",
              },
              {
                kind: "table",
                anchor: { document: CABLE_LIST, page: 4 },
                caption: "Cable-list row",
                columns: ["Cable", "Wire", "From", "To"],
                rows: [["C-12", "Y034", "CP1", "JB-3"]],
              },
            ],
          },
          {
            kind: "step",
            id: "s4",
            title: "Junction box to device",
            claim:
              "From TB-A : 7 the field wire runs to the valve stand and lands on SV-104 coil terminal A1 — the device this trace exists to reach.",
            anchor: { document: TB_WIRING, page: 9 },
            from: { enclosure: "JB-3 · junction box", point: "TB-A : 7" },
            to: { enclosure: "SV-104 · valve stand", point: "Coil A1" },
            via: "field wire · Y034",
            body: [
              {
                kind: "doc_crop",
                anchor: { document: SCHEMATIC, page: 12 },
                sketch: "coil",
                highlight: "Y034",
                caption: "SV-104 coil, sheet 12",
              },
              {
                kind: "key_value",
                rows: [
                  { key: "Designator", value: "SV-104" },
                  { key: "Description", value: "Solenoid valve, 24 VDC" },
                  { key: "Part number", value: "4KA210-08" },
                ],
              },
            ],
          },
          {
            kind: "step",
            id: "s5",
            title: "Device to junction box — return",
            claim:
              "The circuit passes through the coil, A1 to A2, and the return conductor runs back to JB-3, landing on strip TB-A, terminal 8.",
            anchor: { document: TB_WIRING, page: 9 },
            from: { enclosure: "SV-104 · valve stand", point: "Coil A1 → A2" },
            to: { enclosure: "JB-3 · junction box", point: "TB-A : 8" },
            via: "field return · 0 V",
            body: [
              {
                kind: "doc_crop",
                anchor: { document: TB_WIRING, page: 9 },
                sketch: "terminal-strip",
                highlight: "8",
                caption: "TB-A, terminal 8",
              },
            ],
          },
          {
            kind: "step",
            id: "s6",
            title: "Junction box to termination",
            claim:
              "From TB-A : 8 the return rides conductor 3 of cable C-12 back into CP1 and lands on the 0 V bus — the circuit's termination.",
            anchor: { document: CABLE_LIST, page: 4 },
            from: { enclosure: "JB-3 · junction box", point: "TB-A : 8" },
            to: { enclosure: "CP1 · control panel", point: "0 V bus" },
            via: "cable C-12 · conductor 3",
          },
        ],
      },
      {
        kind: "callout",
        tone: "info",
        text:
          "If the coil is dead, the replacement part is 4KA210-08 (solenoid valve, 24 VDC — Electrical Parts List p.3).",
      },
    ],
  },
};

// (The scripted mock rail retired 2026-07-18 — the LIVE Arc panel now sits
// in the room on the industrial-engineer seat. MOCK_TRACE remains as the
// canvas's sample answer until the trace engine lands.)
