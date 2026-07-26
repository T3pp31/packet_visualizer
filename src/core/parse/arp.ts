import { formatIp, formatMac } from '../utils';

export type ArpPacket = {
  op: 'request' | 'reply';
  senderMac: string;
  senderIp: string;
  targetMac: string;
  targetIp: string;
};

export function parseArp(payload: Uint8Array): ArpPacket | null {
  if (payload.length < 28) return null;
  const hwType = (payload[0] << 8) | payload[1];
  const protoType = (payload[2] << 8) | payload[3];
  const hwSize = payload[4];
  const protoSize = payload[5];
  const opcode = (payload[6] << 8) | payload[7];

  if (hwType !== 1 || protoType !== 0x0800 || hwSize !== 6 || protoSize !== 4) {
    return null;
  }

  const op: 'request' | 'reply' = opcode === 1 ? 'request' : opcode === 2 ? 'reply' : 'request';
  if (opcode !== 1 && opcode !== 2) return null;

  return {
    op,
    senderMac: formatMac(payload, 8),
    senderIp: formatIp(payload, 14),
    targetMac: formatMac(payload, 18),
    targetIp: formatIp(payload, 24),
  };
}

export function summarizeArpJa(arp: ArpPacket): string {
  if (arp.op === 'request') {
    return `ARP 要求: ${arp.senderIp} が ${arp.targetIp} の MAC を問い合わせ`;
  }
  return `ARP 応答: ${arp.senderIp} は ${arp.senderMac}`;
}
