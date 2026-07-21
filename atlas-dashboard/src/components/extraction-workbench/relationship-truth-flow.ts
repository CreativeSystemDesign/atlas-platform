import type { Edge, Node } from "@xyflow/react";
import * as dagre from "dagre";
import type { RelationshipTruthRow } from "./relationship-truth-rows";

export type FlowNodeData = {
  label: string;
  isCenter?: boolean;
};

export type TruthFlowData = {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
};

export function buildTruthFlow(
  truthRows: RelationshipTruthRow[]
): TruthFlowData {
  const nodes: Node<FlowNodeData>[] = [];
  const edges: Edge[] = [];
  const addedNodes = new Set<string>();
  const addedEdges = new Set<string>();

  if (!truthRows || truthRows.length === 0) {
    return { nodes, edges };
  }

  function addNode(id: string, label: string) {
    if (!id || addedNodes.has(id)) return;
    addedNodes.add(id);
    nodes.push({
      id,
      position: { x: 0, y: 0 },
      data: { label },
      type: "default"
    });
  }

  function addEdge(source: string, target: string, pathNumber: number) {
    if (!source || !target || source === target) return;
    const edgeId = `e-${source}-${target}-${pathNumber}`;
    if (addedEdges.has(edgeId)) return;
    addedEdges.add(edgeId);
    edges.push({
      id: edgeId,
      source,
      target,
      type: "smoothstep",
      animated: true,
      style: { stroke: "#67e8f9", strokeWidth: 1.5 },
    });
  }

  // Generate nodes and edges directly from the Truth panel's pre-computed rows
  for (const row of truthRows) {
    for (let i = 0; i < row.items.length; i++) {
      const item = row.items[i];
      // Use rootId if available, fallback to label for virtual endpoints (like "open end")
      const nodeId = item.rootId || `virtual-${item.label}-${row.pathNumber}-${i}`;
      addNode(nodeId, item.label);

      if (i > 0) {
        const prevItem = row.items[i - 1];
        const prevNodeId = prevItem.rootId || `virtual-${prevItem.label}-${row.pathNumber}-${i - 1}`;
        addEdge(prevNodeId, nodeId, row.pathNumber);
      }
    }
  }

  // Layout with Dagre
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 100 });

  nodes.forEach((node) => {
    // Estimate width based on label length
    const width = Math.max(150, node.data.label.length * 8 + 40);
    dagreGraph.setNode(node.id, { width, height: 40 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - (nodeWithPosition.width / 2),
        y: nodeWithPosition.y - 20,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
