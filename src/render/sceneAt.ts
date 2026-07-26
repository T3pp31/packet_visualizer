import type { AppConfig, PlaybackTimeline, SpriteScene, Topology } from '../core/types';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function getNodePosition(
  topology: Topology,
  nodeId: string,
): { x: number; y: number } | null {
  const node = topology.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  return { x: node.x, y: node.y };
}

export function sceneAt(
  t: number,
  timeline: PlaybackTimeline,
  topology: Topology,
  config: AppConfig,
  highlightedPacketIndex: number | null = null,
  selectedNodeId: string | null = null,
): SpriteScene {
  const activeSprites: SpriteScene['activeSprites'] = [];

  for (const keyframe of timeline.keyframes) {
    if (t < keyframe.tStart || t > keyframe.tEnd) continue;

    const from = getNodePosition(topology, keyframe.fromNodeId);
    const to = getNodePosition(topology, keyframe.toNodeId);
    if (!from || !to) continue;

    const span = keyframe.tEnd - keyframe.tStart || 1;
    const progress = (t - keyframe.tStart) / span;
    const color = config.colors[keyframe.colorKey] ?? config.colors.ipv4;

    activeSprites.push({
      packetId: keyframe.packetId,
      packetIndex: keyframe.packetIndex,
      x: lerp(from.x, to.x, progress),
      y: lerp(from.y, to.y, progress),
      color,
      label: keyframe.label,
      progress,
    });
  }

  return {
    activeSprites,
    highlightedPacketIndex,
    selectedNodeId,
  };
}

export function packetIndexAtTime(
  t: number,
  timeline: PlaybackTimeline,
): number | null {
  const active = timeline.keyframes.find(
    (keyframe) => t >= keyframe.tStart && t <= keyframe.tEnd,
  );
  return active?.packetIndex ?? null;
}
