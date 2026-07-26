import type { AppConfig } from '../types';
import type { Topology } from '../types';

export function autoLayout(topology: Topology, config: AppConfig): Topology {
  const movable = topology.nodes.filter((node) => !node.fixed);
  const fixed = topology.nodes.filter((node) => node.fixed);
  const centerX = 400;
  const centerY = 300;
  const radius = config.topology.layoutRadiusPx;

  const broadcast = movable.find((node) => node.id === topology.broadcastNodeId);
  const others = movable.filter((node) => node.id !== topology.broadcastNodeId);

  const positioned = others.map((node, index) => {
    const angle = (2 * Math.PI * index) / Math.max(others.length, 1) - Math.PI / 2;
    return {
      ...node,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  });

  const broadcastNode = broadcast
    ? {
        ...broadcast,
        x: centerX,
        y: centerY,
      }
    : null;

  const allNodes = [
    ...fixed,
    ...positioned,
    ...(broadcastNode ? [broadcastNode] : []),
  ];

  const nodeMap = new Map(allNodes.map((node) => [node.id, node]));

  return {
    ...topology,
    nodes: topology.nodes.map((node) => nodeMap.get(node.id) ?? node),
  };
}

export function relayoutUnfixed(topology: Topology, config: AppConfig): Topology {
  return autoLayout(topology, config);
}
