import type { AppConfig } from '../types';
import type { Link, NetworkNode, NodeType, PacketEvent, Topology } from '../types';
import {
  isBroadcastMac,
  isZeroMac,
  linkId,
  nodeIdFromIp,
  nodeIdFromMac,
  normalizeMac,
  subnet24,
} from '../utils';

const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff';

type NodeAccumulator = {
  id: string;
  macs: Set<string>;
  ips: Set<string>;
  type: NodeType;
  typeSource: 'inferred' | 'user';
  label: string;
  x: number;
  y: number;
  fixed: boolean;
};

function createBroadcastNode(): NodeAccumulator {
  return {
    id: nodeIdFromMac(BROADCAST_MAC),
    macs: new Set([BROADCAST_MAC]),
    ips: new Set(),
    type: 'broadcast',
    typeSource: 'inferred',
    label: 'ブロードキャスト',
    x: 0,
    y: 0,
    fixed: false,
  };
}

function ensureMacNode(
  nodes: Map<string, NodeAccumulator>,
  mac: string,
  ip?: string,
): string {
  const normalized = normalizeMac(mac);
  const id = nodeIdFromMac(normalized);
  let node = nodes.get(id);
  if (!node) {
    node = {
      id,
      macs: new Set([normalized]),
      ips: new Set(),
      type: 'host',
      typeSource: 'inferred',
      label: ip ?? normalized,
      x: 0,
      y: 0,
      fixed: false,
    };
    nodes.set(id, node);
  }
  if (ip) node.ips.add(ip);
  if (node.ips.size > 0) {
    node.label = [...node.ips][0];
  }
  return id;
}

function ensureIpNode(nodes: Map<string, NodeAccumulator>, ip: string): string {
  const id = nodeIdFromIp(ip);
  let node = nodes.get(id);
  if (!node) {
    node = {
      id,
      macs: new Set(),
      ips: new Set([ip]),
      type: 'unknown',
      typeSource: 'inferred',
      label: ip,
      x: 0,
      y: 0,
      fixed: false,
    };
    nodes.set(id, node);
  }
  return id;
}

function inferNodeType(
  node: NodeAccumulator,
  config: AppConfig,
): NodeType {
  if (node.type === 'broadcast') return 'broadcast';

  const subnets = new Set<string>();
  for (const ip of node.ips) {
    const subnet = subnet24(ip);
    if (subnet) subnets.add(subnet);
  }

  if (config.topology.multiSubnetAsRouter && subnets.size > 1) {
    return 'router';
  }

  for (const ip of node.ips) {
    const lastOctet = Number(ip.split('.').at(-1));
    if (config.topology.routerLastOctets.includes(lastOctet) && node.macs.size > 0) {
      return 'router';
    }
  }

  if (node.macs.size === 0) return 'unknown';
  return 'host';
}

function resolveEndpoint(
  nodes: Map<string, NodeAccumulator>,
  mac: string,
  ip?: string,
): string {
  if (isBroadcastMac(mac)) {
    return nodeIdFromMac(BROADCAST_MAC);
  }
  if (!isZeroMac(mac)) {
    return ensureMacNode(nodes, mac, ip);
  }
  if (ip) {
    return ensureIpNode(nodes, ip);
  }
  return ensureMacNode(nodes, mac);
}

function addLink(
  links: Map<string, Link>,
  a: string,
  b: string,
  protocol: 'ARP' | 'IPv4',
): void {
  const id = linkId(a, b);
  const existing = links.get(id);
  if (existing) {
    existing.packetCount += 1;
    if (!existing.protocols.includes(protocol)) {
      existing.protocols.push(protocol);
    }
    return;
  }
  links.set(id, { id, a, b, protocols: [protocol], packetCount: 1 });
}

export function inferTopology(
  events: PacketEvent[],
  config: AppConfig,
): Topology {
  const nodes = new Map<string, NodeAccumulator>();
  nodes.set(nodeIdFromMac(BROADCAST_MAC), createBroadcastNode());
  const links = new Map<string, Link>();

  for (const event of events) {
    const protocol: 'ARP' | 'IPv4' =
      event.etherType === 'IPv4' ? 'IPv4' : 'ARP';

    if (event.arp) {
      const senderId = ensureMacNode(nodes, event.arp.senderMac, event.arp.senderIp);
      let targetId: string;

      if (event.arp.op === 'request') {
        if (isZeroMac(event.arp.targetMac)) {
          ensureIpNode(nodes, event.arp.targetIp);
        }
        if (isBroadcastMac(event.dstMac)) {
          targetId = nodeIdFromMac(BROADCAST_MAC);
        } else if (isZeroMac(event.arp.targetMac)) {
          targetId = ensureIpNode(nodes, event.arp.targetIp);
        } else {
          targetId = nodeIdFromMac(event.arp.targetMac);
        }
      } else {
        targetId = resolveEndpoint(
          nodes,
          isZeroMac(event.arp.targetMac) ? event.dstMac : event.arp.targetMac,
          event.arp.targetIp,
        );
      }

      addLink(links, senderId, targetId, protocol);
      continue;
    }

    const srcId = resolveEndpoint(nodes, event.srcMac, event.srcIp);
    const dstId = resolveEndpoint(nodes, event.dstMac, event.dstIp);
    addLink(links, srcId, dstId, protocol);
  }

  for (const node of nodes.values()) {
    if (node.typeSource === 'inferred') {
      node.type = inferNodeType(node, config);
    }
  }

  return {
    nodes: [...nodes.values()].map((node) => ({
      id: node.id,
      macs: [...node.macs],
      ips: [...node.ips],
      type: node.type,
      typeSource: node.typeSource,
      label: node.label,
      x: node.x,
      y: node.y,
      fixed: node.fixed,
    })),
    links: [...links.values()],
    broadcastNodeId: nodeIdFromMac(BROADCAST_MAC),
  };
}

export function mergeTopologyEdits(
  base: Topology,
  edits: Partial<Pick<NetworkNode, 'id' | 'type' | 'label' | 'x' | 'y' | 'fixed'>>[],
): Topology {
  const editMap = new Map(edits.map((edit) => [edit.id!, edit]));
  return {
    ...base,
    nodes: base.nodes.map((node) => {
      const edit = editMap.get(node.id);
      if (!edit) return node;
      return {
        ...node,
        type: edit.type ?? node.type,
        typeSource: edit.type ? 'user' : node.typeSource,
        label: edit.label ?? node.label,
        x: edit.x ?? node.x,
        y: edit.y ?? node.y,
        fixed: edit.fixed ?? node.fixed,
      };
    }),
  };
}
