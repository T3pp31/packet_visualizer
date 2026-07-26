export type EtherType = 'ARP' | 'IPv4' | 'OTHER';

export type NodeType = 'host' | 'router' | 'server' | 'broadcast' | 'unknown';

export type PacketEvent = {
  id: string;
  index: number;
  timestampMs: number;
  absoluteTsNs?: bigint;
  etherType: EtherType;
  srcMac: string;
  dstMac: string;
  srcIp?: string;
  dstIp?: string;
  arp?: {
    op: 'request' | 'reply';
    senderMac: string;
    senderIp: string;
    targetMac: string;
    targetIp: string;
  };
  ipv4?: {
    protocol: number;
    srcIp: string;
    dstIp: string;
  };
  summaryJa: string;
  rawLength: number;
};

export type NetworkNode = {
  id: string;
  macs: string[];
  ips: string[];
  type: NodeType;
  typeSource: 'inferred' | 'user';
  label: string;
  x: number;
  y: number;
  fixed: boolean;
};

export type Link = {
  id: string;
  a: string;
  b: string;
  protocols: Array<'ARP' | 'IPv4'>;
  packetCount: number;
};

export type Topology = {
  nodes: NetworkNode[];
  links: Link[];
  broadcastNodeId: string;
};

export type TimelineKeyframe = {
  packetId: string;
  packetIndex: number;
  tStart: number;
  tEnd: number;
  fromNodeId: string;
  toNodeId: string;
  kind: 'unicast' | 'broadcast';
  label: string;
  colorKey: 'arpRequest' | 'arpReply' | 'ipv4';
};

export type PlaybackTimeline = {
  durationMs: number;
  keyframes: TimelineKeyframe[];
  timeMode: 'realtime' | 'compressed';
};

export type AppConfig = {
  playback: {
    speeds: number[];
    defaultSpeed: number;
    minPacketAnimMs: number;
    maxPacketAnimMs: number;
    idleGapCompress: boolean;
    maxIdleGapMs: number;
  };
  topology: {
    routerLastOctets: number[];
    multiSubnetAsRouter: boolean;
    layoutRadiusPx: number;
    nodeSizePx: number;
  };
  colors: Record<string, string>;
  ui: {
    locale: string;
    maxPacketListRows: number;
  };
};

export type SpriteScene = {
  activeSprites: Array<{
    packetId: string;
    packetIndex: number;
    x: number;
    y: number;
    color: string;
    label: string;
    progress: number;
  }>;
  highlightedPacketIndex: number | null;
  selectedNodeId: string | null;
};
