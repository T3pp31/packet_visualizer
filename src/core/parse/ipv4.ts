import { formatIp } from '../utils';

export type Ipv4Packet = {
  protocol: number;
  srcIp: string;
  dstIp: string;
};

const PROTOCOL_NAMES: Record<number, string> = {
  1: 'ICMP',
  6: 'TCP',
  17: 'UDP',
};

export function parseIpv4(payload: Uint8Array): Ipv4Packet | null {
  if (payload.length < 20) return null;
  const version = payload[0] >> 4;
  const ihl = payload[0] & 0x0f;
  if (version !== 4) return null;
  const headerLen = ihl * 4;
  if (headerLen < 20 || payload.length < headerLen) return null;

  const srcIp = formatIp(payload, 12);
  const dstIp = formatIp(payload, 16);
  if (!srcIp || !dstIp) return null;

  return {
    protocol: payload[9],
    srcIp,
    dstIp,
  };
}

export function summarizeIpv4Ja(ipv4: Ipv4Packet): string {
  const proto = PROTOCOL_NAMES[ipv4.protocol] ?? `proto ${ipv4.protocol}`;
  return `IPv4 ${proto}: ${ipv4.srcIp} → ${ipv4.dstIp}`;
}
