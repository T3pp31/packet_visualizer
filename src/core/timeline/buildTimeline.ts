import type { AppConfig } from '../types';
import type { PacketEvent, PlaybackTimeline, TimelineKeyframe, Topology } from '../types';
import { isBroadcastMac, isZeroMac, nodeIdFromIp, nodeIdFromMac } from '../utils';

function resolvePacketEndpoints(
  event: PacketEvent,
  topology: Topology,
): { fromNodeId: string; toNodeId: string; kind: 'unicast' | 'broadcast' } {
  const broadcastNodeId = topology.broadcastNodeId;

  if (event.arp) {
    const fromNodeId = nodeIdFromMac(event.arp.senderMac);

    if (event.arp.op === 'request') {
      if (isBroadcastMac(event.dstMac)) {
        return { fromNodeId, toNodeId: broadcastNodeId, kind: 'broadcast' };
      }
      if (isZeroMac(event.arp.targetMac)) {
        return {
          fromNodeId,
          toNodeId: nodeIdFromIp(event.arp.targetIp),
          kind: 'unicast',
        };
      }
      return {
        fromNodeId,
        toNodeId: nodeIdFromMac(event.arp.targetMac),
        kind: 'unicast',
      };
    }

    const targetMac = isZeroMac(event.arp.targetMac)
      ? event.dstMac
      : event.arp.targetMac;
    const toNodeId = isZeroMac(targetMac)
      ? nodeIdFromIp(event.arp.targetIp)
      : nodeIdFromMac(targetMac);

    return { fromNodeId, toNodeId, kind: 'unicast' };
  }

  const fromNodeId = nodeIdFromMac(event.srcMac);
  const toNodeId = isBroadcastMac(event.dstMac)
    ? broadcastNodeId
    : nodeIdFromMac(event.dstMac);

  return {
    fromNodeId,
    toNodeId,
    kind: isBroadcastMac(event.dstMac) ? 'broadcast' : 'unicast',
  };
}

function colorKeyForEvent(event: PacketEvent): TimelineKeyframe['colorKey'] {
  if (event.arp?.op === 'reply') return 'arpReply';
  if (event.arp?.op === 'request') return 'arpRequest';
  return 'ipv4';
}

function labelForEvent(event: PacketEvent): string {
  if (event.arp?.op === 'request') return 'ARP Req';
  if (event.arp?.op === 'reply') return 'ARP Rep';
  return 'IPv4';
}

export function buildTimeline(
  events: PacketEvent[],
  topology: Topology,
  config: AppConfig,
): PlaybackTimeline {
  const keyframes: TimelineKeyframe[] = [];
  let cursor = 0;

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    const prev = events[i - 1];
    const gap = prev ? event.timestampMs - prev.timestampMs : 0;
    const compressedGap =
      config.playback.idleGapCompress && gap > config.playback.maxIdleGapMs
        ? config.playback.maxIdleGapMs
        : gap;

    if (i > 0) cursor += compressedGap;

    const animDuration = Math.min(
      config.playback.maxPacketAnimMs,
      Math.max(config.playback.minPacketAnimMs, compressedGap || config.playback.minPacketAnimMs),
    );

    const endpoints = resolvePacketEndpoints(event, topology);
    keyframes.push({
      packetId: event.id,
      packetIndex: event.index,
      tStart: cursor,
      tEnd: cursor + animDuration,
      fromNodeId: endpoints.fromNodeId,
      toNodeId: endpoints.toNodeId,
      kind: endpoints.kind,
      label: labelForEvent(event),
      colorKey: colorKeyForEvent(event),
    });

    cursor += animDuration;
  }

  return {
    durationMs: cursor,
    keyframes,
    timeMode: config.playback.idleGapCompress ? 'compressed' : 'realtime',
  };
}
