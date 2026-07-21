export type AttachmentKind =
  | "component"
  | "part_number"
  | "spec"
  | "terminal"
  | "terminal_position"
  | "terminal_label"
  | "wire_label"
  | "wire_segment"
  | "cable_segment"
  | "cable_reference"
  | "cable_label"
  | "cable_endpoint"
  | "wire_endpoint"
  | "wire_color"
  | "connection_point"
  | "continuation"
  | "junction"
  | "ground_reference"
  | "ground_label"
  | "location"
  | "text";

export type RootObjectKind =
  | "component"
  | "connector"
  | "terminal_block"
  | "circuit_descriptor"
  | "page_descriptor"
  | AttachmentKind;

export type AnnotationRelation =
  | "component_has_terminal"
  | "component_has_terminal_label"
  | "component_has_part_number"
  | "component_has_spec"
  | "component_has_wire_label"
  | "component_has_location"
  | "component_has_connection_point"
  | "connector_has_connection_point"
  | "connector_has_part_number"
  | "connector_has_spec"
  | "connector_has_location"
  | "connector_connection_point_pair"
  | "terminal_block_has_position"
  | "position_conducts_to_wire"
  | "position_conducts_to_cable"
  | "location_has_component"
  | "wire_label_to_terminal"
  | "wire_segment_to_terminal"
  | "wire_segment_to_component"
  | "wire_segment_has_endpoint"
  | "wire_segment_has_wire_label"
  | "wire_segment_has_color"
  | "wire_segment_endpoint_to_connection_point"
  | "wire_segment_has_junction"
  | "wire_segment_to_wire_segment"
  | "wire_segment_to_ground_reference"
  | "cable_segment_has_endpoint"
  | "cable_segment_endpoint_to_connection_point"
  | "cable_segment_has_cable_label"
  | "cable_segment_has_part_number"
  | "cable_reference_has_connection_point"
  | "cable_reference_connection_point_to_connection_point"
  | "cable_reference_has_cable_label"
  | "cable_reference_has_part_number"
  | "terminal_label_to_terminal"
  | "terminal_has_terminal_label"
  | "ground_reference_has_ground_label"
  | "ground_reference_to_terminal"
  | "continuation_to_object"
  | "circuit_descriptor_applies_to_region"
  | "circuit_descriptor_applies_to_component"
  | "page_descriptor_applies_to_component"
  | "object_has_location"
  | "object_has_text"
  | "object_has_attachment";

export type LegacyAnnotationRelation = "component_attachment" | "terminal_label_for";

type RelationAttachmentLike = {
  type: AttachmentKind;
  relation?: AnnotationRelation | LegacyAnnotationRelation;
  parentAttachmentId?: string | null;
};

export const ATTACHMENT_TYPES: AttachmentKind[] = [
  "component",
  "part_number",
  "spec",
  "terminal",
  "terminal_position",
  "terminal_label",
  "wire_label",
  "wire_segment",
  "cable_segment",
  "cable_reference",
  "cable_label",
  "cable_endpoint",
  "wire_color",
  "connection_point",
  "continuation",
  "junction",
  "ground_reference",
  "ground_label",
  "location",
  "text",
];

export const ROOT_OBJECT_TYPES: RootObjectKind[] = [
  "component",
  "connector",
  "terminal_block",
  "circuit_descriptor",
  "page_descriptor",
  "wire_segment",
  "cable_segment",
  "cable_reference",
  "wire_label",
  "continuation",
  "ground_reference",
  "terminal",
  "terminal_label",
  "ground_label",
  "location",
  "part_number",
  "spec",
  "text",
];

export function inferRelationForAttachment(
  ownerRootType: RootObjectKind,
  attachment: Pick<RelationAttachmentLike, "type" | "parentAttachmentId">
): AnnotationRelation {
  if (attachment.parentAttachmentId && attachment.type === "terminal_label") {
    return "terminal_has_terminal_label";
  }
  if (
    ownerRootType === "cable_reference" &&
    attachment.parentAttachmentId &&
    attachment.type === "connection_point"
  ) {
    return "cable_reference_connection_point_to_connection_point";
  }
  if (
    ownerRootType === "connector" &&
    attachment.parentAttachmentId &&
    attachment.type === "connection_point"
  ) {
    return "connector_connection_point_pair";
  }
  return inferAttachmentRelation(ownerRootType, attachment.type);
}

export function inferAttachmentRelation(
  ownerRootType: RootObjectKind,
  attachmentType: AttachmentKind
): AnnotationRelation {
  if (ownerRootType === "continuation") {
    return "continuation_to_object";
  }
  if (ownerRootType === "terminal_block") {
    if (attachmentType === "terminal_position") return "terminal_block_has_position";
    if (attachmentType === "wire_segment") return "position_conducts_to_wire";
    if (attachmentType === "cable_segment") return "position_conducts_to_cable";
  }
  if (ownerRootType === "circuit_descriptor") {
    if (attachmentType === "component") {
      return "circuit_descriptor_applies_to_component";
    }
    if (attachmentType === "text") {
      return "circuit_descriptor_applies_to_region";
    }
  }
  if (ownerRootType === "page_descriptor" && attachmentType === "component") {
    return "page_descriptor_applies_to_component";
  }
  if (ownerRootType === "component") {
    if (attachmentType === "terminal") return "component_has_terminal";
    if (attachmentType === "terminal_label") return "component_has_terminal_label";
    if (attachmentType === "part_number") return "component_has_part_number";
    if (attachmentType === "spec") return "component_has_spec";
    if (attachmentType === "wire_label") return "component_has_wire_label";
    if (attachmentType === "location") return "component_has_location";
    if (attachmentType === "connection_point") return "component_has_connection_point";
  }
  if (ownerRootType === "connector") {
    if (attachmentType === "connection_point") return "connector_has_connection_point";
    if (attachmentType === "part_number") return "connector_has_part_number";
    if (attachmentType === "spec") return "connector_has_spec";
    if (attachmentType === "location") return "connector_has_location";
  }
  if (ownerRootType === "wire_label" && attachmentType === "terminal") {
    return "wire_label_to_terminal";
  }
  if (ownerRootType === "wire_segment" && attachmentType === "terminal") {
    return "wire_segment_to_terminal";
  }
  if (ownerRootType === "wire_segment" && attachmentType === "component") {
    return "wire_segment_to_component";
  }
  if (ownerRootType === "wire_segment" && attachmentType === "wire_endpoint") {
    return "wire_segment_has_endpoint";
  }
  if (ownerRootType === "wire_segment" && attachmentType === "wire_label") {
    return "wire_segment_has_wire_label";
  }
  if (ownerRootType === "wire_segment" && attachmentType === "wire_color") {
    return "wire_segment_has_color";
  }
  if (ownerRootType === "wire_segment" && attachmentType === "connection_point") {
    return "wire_segment_endpoint_to_connection_point";
  }
  if (ownerRootType === "wire_segment" && attachmentType === "junction") {
    return "wire_segment_has_junction";
  }
  if (ownerRootType === "wire_segment" && attachmentType === "wire_segment") {
    return "wire_segment_to_wire_segment";
  }
  if (ownerRootType === "wire_segment" && attachmentType === "ground_reference") {
    return "wire_segment_to_ground_reference";
  }
  if (ownerRootType === "cable_segment" && attachmentType === "cable_label") {
    return "cable_segment_has_cable_label";
  }
  if (ownerRootType === "cable_segment" && attachmentType === "cable_endpoint") {
    return "cable_segment_has_endpoint";
  }
  if (ownerRootType === "cable_segment" && attachmentType === "connection_point") {
    return "cable_segment_endpoint_to_connection_point";
  }
  if (ownerRootType === "cable_segment" && attachmentType === "part_number") {
    return "cable_segment_has_part_number";
  }
  if (ownerRootType === "cable_reference" && attachmentType === "connection_point") {
    return "cable_reference_has_connection_point";
  }
  if (ownerRootType === "cable_reference" && attachmentType === "cable_label") {
    return "cable_reference_has_cable_label";
  }
  if (ownerRootType === "cable_reference" && attachmentType === "part_number") {
    return "cable_reference_has_part_number";
  }
  if (ownerRootType === "terminal_label" && attachmentType === "terminal") {
    return "terminal_label_to_terminal";
  }
  if (ownerRootType === "terminal" && attachmentType === "terminal_label") {
    return "terminal_has_terminal_label";
  }
  if (ownerRootType === "ground_reference" && attachmentType === "ground_label") {
    return "ground_reference_has_ground_label";
  }
  if (ownerRootType === "ground_reference" && attachmentType === "terminal") {
    return "ground_reference_to_terminal";
  }
  if (ownerRootType === "location" && attachmentType === "component") {
    return "location_has_component";
  }
  if (attachmentType === "location") return "object_has_location";
  if (attachmentType === "text") return "object_has_text";
  return "object_has_attachment";
}

export function strictAttachmentRelation(
  ownerRootType: RootObjectKind,
  attachmentType: AttachmentKind,
  parentAttachmentId?: string | null
): AnnotationRelation | null {
  const relation = inferRelationForAttachment(ownerRootType, {
    type: attachmentType,
    parentAttachmentId: parentAttachmentId ?? null,
  });
  if (relation === "object_has_attachment" && attachmentType !== "text") {
    return null;
  }
  return relation;
}

export function relationDisplayLabel(
  relation: AnnotationRelation | LegacyAnnotationRelation | undefined
) {
  if (!relation) return "missing relation";
  if (relation === "component_attachment") return "legacy component attachment";
  if (relation === "terminal_label_for") return "legacy terminal label";
  return relation.replaceAll("_", " ");
}

export function normalizeRelation(
  ownerRootType: RootObjectKind,
  attachment: Pick<RelationAttachmentLike, "type" | "relation" | "parentAttachmentId">
): AnnotationRelation {
  if (
    attachment.relation &&
    attachment.relation !== "component_attachment" &&
    attachment.relation !== "terminal_label_for"
  ) {
    return attachment.relation;
  }
  if (attachment.relation === "terminal_label_for") {
    return "terminal_has_terminal_label";
  }
  return inferRelationForAttachment(ownerRootType, attachment);
}

export function attachmentTypeLabel(type: AttachmentKind) {
  if (type === "part_number") return "part number";
  if (type === "terminal_position") return "terminal position";
  if (type === "terminal_label") return "terminal label";
  if (type === "wire_label") return "wire label";
  if (type === "wire_segment") return "wire segment";
  if (type === "cable_segment") return "cable segment";
  if (type === "cable_reference") return "cable reference";
  if (type === "cable_label") return "cable label";
  if (type === "cable_endpoint") return "cable endpoint";
  if (type === "wire_endpoint") return "wire endpoint";
  if (type === "wire_color") return "wire color";
  if (type === "connection_point") return "connection point";
  if (type === "continuation") return "continuation";
  if (type === "junction") return "junction";
  if (type === "ground_reference") return "ground reference";
  if (type === "ground_label") return "ground label";
  if (type === "location") return "location";
  return type;
}

export function rootObjectTypeLabel(type: RootObjectKind) {
  if (type === "component") return "component";
  if (type === "connector") return "connector";
  if (type === "terminal_block") return "terminal block";
  if (type === "circuit_descriptor") return "circuit descriptor";
  if (type === "page_descriptor") return "page descriptor";
  return attachmentTypeLabel(type);
}

export function supportsConnectionPoints(type: RootObjectKind): boolean {
  return type === "component" || type === "connector" || type === "terminal_block";
}
