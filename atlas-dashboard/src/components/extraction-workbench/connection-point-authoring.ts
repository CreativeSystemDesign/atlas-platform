import { attachmentsOf, rootTypeOf } from "./annotation-box-helpers.ts";
import {
  buildSpatialProvenance,
  physicalSizeOf,
} from "./annotation-persistence.ts";
import {
  boxContainsPoint,
  clampBoxToPage,
  clampPointToBox,
  distanceToBox,
} from "./studio-geometry.ts";
import type {
  AnnotationAttachment,
  AnnotationBox,
} from "./studio-types.ts";
import {
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
} from "./studio-types.ts";
import { findNearbyConnectionPoint } from "./wire-connection-point.ts";

type PointPx = { x: number; y: number };

export type ConnectionPointAuthoringResult =
  | {
      status: "created";
      attachment: AnnotationAttachment;
    }
  | {
      status: "existing";
      attachment: AnnotationAttachment;
    }
  | {
      status: "blocked";
      notice: string;
    };

export function buildConnectionPointAuthoring({
  selectedBox,
  cursorPx,
  zoom,
  pageNum,
  capturedAt,
}: {
  selectedBox: AnnotationBox | null;
  cursorPx: PointPx | null;
  zoom: number;
  pageNum: number;
  capturedAt: string;
}): ConnectionPointAuthoringResult {
  if (!selectedBox || !cursorPx) {
    return {
      status: "blocked",
      notice:
        "Select a component, connector, cable reference, or wire and place the cursor before pressing C.",
    };
  }

  const rootType = rootTypeOf(selectedBox);
  if (
    rootType !== "component" &&
    rootType !== "connector" &&
    rootType !== "cable_reference" &&
    rootType !== "wire_segment"
  ) {
    return {
      status: "blocked",
      notice:
        "Connection points can be created on components, connectors, cable references, and wire segments.",
    };
  }
  if (rootType === "wire_segment") {
    return {
      status: "blocked",
      notice:
        "Wire endpoints are automatic. Link wires through endpoint-to-component connection links instead of creating manual wire connection points.",
    };
  }

  const tolerance = Math.max(10, 16 / zoom);
  if (
    !boxContainsPoint(selectedBox.bbox, cursorPx) &&
    distanceToBox(cursorPx, selectedBox.bbox) > tolerance
  ) {
    return {
      status: "blocked",
      notice: "Connection point must be placed inside the selected component bbox.",
    };
  }

  const size = Math.max(18, 18 / zoom);
  const point = clampPointToBox(cursorPx, selectedBox.bbox);
  const bbox = clampBoxToPage(
    {
      x: point.x - size / 2,
      y: point.y - size / 2,
      width: size,
      height: size,
    },
    {
      width: PAGE_WIDTH_PX,
      height: PAGE_HEIGHT_PX,
    }
  );
  const existingConnectionPoint = findNearbyConnectionPoint({
    attachments: attachmentsOf(selectedBox),
    point,
    tolerance: size * 0.9,
  });
  if (existingConnectionPoint) {
    return {
      status: "existing",
      attachment: existingConnectionPoint,
    };
  }

  return {
    status: "created",
    attachment: {
      id: `${selectedBox.id}-connection-point-${crypto.randomUUID()}`,
      type: "connection_point",
      text: "connection",
      bbox,
      parentAttachmentId: null,
      relation:
        rootType === "cable_reference"
          ? "cable_reference_has_connection_point"
          : rootType === "connector"
            ? "connector_has_connection_point"
          : "component_has_connection_point",
      provenance: buildSpatialProvenance(
        bbox,
        pageNum,
        rootType === "cable_reference"
          ? "manual_cable_reference_connection_point"
          : rootType === "connector"
            ? "manual_connector_connection_point"
          : "manual_connection_point",
        capturedAt
      ),
      physicalSizePx: physicalSizeOf(bbox),
      source: "ctrl_click",
      snapped: true,
      createdAt: capturedAt,
    },
  };
}
