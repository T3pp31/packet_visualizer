import type { PacketEvent } from '../types';
import { parseArp, summarizeArpJa } from './arp';
import { etherTypeLabel, parseEthernet } from './ethernet';
import { parseIpv4, summarizeIpv4Ja } from './ipv4';

const BLOCK_TYPE_EPB = 0x00000006;

type RawPacket = {
  timestampNs: bigint;
  data: Uint8Array;
};

function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function parseBlocks(buffer: ArrayBuffer): RawPacket[] {
  const view = new DataView(buffer);
  const packets: RawPacket[] = [];
  let offset = 0;

  while (offset + 12 <= view.byteLength) {
    const blockType = readUint32LE(view, offset);
    const blockLength = readUint32LE(view, offset + 4);
    if (blockLength < 12) break;

    if (blockType === BLOCK_TYPE_EPB) {
      const interfaceId = readUint32LE(view, offset + 8);
      void interfaceId;
      const timestampHigh = readUint32LE(view, offset + 12);
      const timestampLow = readUint32LE(view, offset + 16);
      const capturedLen = readUint32LE(view, offset + 20);
      const dataOffset = offset + 28;
      if (dataOffset + capturedLen <= view.byteLength) {
        const data = new Uint8Array(buffer, dataOffset, capturedLen);
        const timestampNs =
          (BigInt(timestampHigh) << 32n) | BigInt(timestampLow);
        packets.push({ timestampNs, data });
      }
    }

    offset += blockLength;
  }

  return packets;
}

function toPacketEvent(
  raw: RawPacket,
  index: number,
  baseTimestampNs: bigint,
): PacketEvent | null {
  const ethernet = parseEthernet(raw.data);
  if (!ethernet) return null;

  const etherType = etherTypeLabel(ethernet.etherType);
  const timestampMs = Number((raw.timestampNs - baseTimestampNs) / 1_000_000n);

  let arp;
  let ipv4;
  let summaryJa = `Ethernet ${etherType}`;

  if (etherType === 'ARP') {
    arp = parseArp(ethernet.payload) ?? undefined;
    if (arp) summaryJa = summarizeArpJa(arp);
  } else if (etherType === 'IPv4') {
    ipv4 = parseIpv4(ethernet.payload) ?? undefined;
    if (ipv4) summaryJa = summarizeIpv4Ja(ipv4);
  }

  return {
    id: `pkt-${index}`,
    index,
    timestampMs,
    absoluteTsNs: raw.timestampNs,
    etherType,
    srcMac: ethernet.srcMac,
    dstMac: ethernet.dstMac,
    srcIp: arp?.senderIp ?? ipv4?.srcIp,
    dstIp: arp?.targetIp ?? ipv4?.dstIp,
    arp,
    ipv4,
    summaryJa,
    rawLength: raw.data.length,
  };
}

export function parsePcapng(buffer: ArrayBuffer): PacketEvent[] {
  const rawPackets = parseBlocks(buffer);
  if (rawPackets.length === 0) {
    throw new Error('pcapng ファイルにパケットが見つかりません');
  }

  const baseTimestampNs = rawPackets[0].timestampNs;
  const events: PacketEvent[] = [];

  rawPackets.forEach((raw, index) => {
    const event = toPacketEvent(raw, index, baseTimestampNs);
    if (event) events.push(event);
  });

  if (events.length === 0) {
    throw new Error('解析可能な Ethernet フレームがありません');
  }

  return events;
}
