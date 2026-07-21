const JOINED_CLASS_LABELS = new Map<string, string>([
  ["wirelabel", "wire label"],
  ["wirelabels", "wire label"],
  ["wiresegment", "wire segment"],
  ["cablesegment", "cable segment"],
  ["cablereference", "cable reference"],
  ["cablelabel", "cable label"],
  ["terminallabel", "terminal label"],
  ["groundreference", "ground reference"],
  ["groundlabel", "ground label"],
  ["partnumber", "part number"],
  ["connectionpoint", "connection point"],
  ["continuationsymbol", "continuation symbol"],
  ["pagedescriptor", "page descriptor"],
  ["circuitdescriptor", "circuit descriptor"],
  ["componentbody", "component body"],
  ["componentlabel", "component label"],
]);

export function normalizeClassLabel(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "unlabeled";
  const withWordBoundaries = trimmed
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const compact = withWordBoundaries.replace(/[\s_-]+/g, "");
  return JOINED_CLASS_LABELS.get(compact) ?? withWordBoundaries;
}
