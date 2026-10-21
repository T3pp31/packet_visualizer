import type { PacketEvent } from '../types';
import { parseArp, summarizeArpJa } from './arp';
import { etherTypeLabel, parseEthernet } from './ethernet';
import { parseIpv4, summarizeIpv4Ja } from './ipv4';

const BLOCK_TYPE_IDB = 0x00000001;
const BLOCK_TYPE_EPB = 0x00000006;
const LINKTYPE_ETHERNET = 1;
const OPT_ENDOFOPT = 0;
const OPT_IF_TSRESOL = 9;
const DEFAULT_TSRESOL = 6;

type InterfaceInfo = {
  linkType: number;
  tsResol: number;
};

type RawPacket = {
  interfaceId: number;
  timestampNs: bigint;
  data: Uint8Array;
};

function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readUint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function parseIdb(
  view: DataView,
  blockStart: number,
  blockLength: number,
): InterfaceInfo | null {
  if (blockLength < 20) return null;
  const blockEnd = blockStart + blockLength;
  if (blockEnd > view.byteLength) return null;

  const linkType = readUint16LE(view, blockStart + 8);
  let tsResol = DEFAULT_TSRESOL;

  let optOffset = blockStart + 16;
  while (optOffset + 4 <= blockEnd - 4) {
    const code = readUint16LE(view, optOffset);
    const length = readUint16LE(view, optOffset + 2);
    if (code === OPT_ENDOFOPT) break;
    const valueOffset = optOffset + 4;
    const paddedLength = (length + 3) & ~3;
    if (valueOffset + paddedLength > blockEnd - 4) break;
    if (code === OPT_IF_TSRESOL && length >= 1) {
      const raw = view.getUint8(valueOffset);
      tsResol = raw & 0x80 ? raw & 0x7f : raw;
    }
    optOffset = valueOffset + paddedLength;
  }

  return { linkType, tsResol };
}

function normalizeTimestamp(raw: bigint, tsResol: number): bigint {
  if (tsResol <= 9) {
    return raw * 10n ** BigInt(9 - tsResol);
  }
  return raw / 10n ** BigInt(tsResol - 9);
}

function parseBlocks(buffer: ArrayBuffer): { interfaces: InterfaceInfo[]; packets: RawPacket[] } {
  const view = new DataView(buffer);
  const interfaces: InterfaceInfo[] = [];
  const packets: RawPacket[] = [];
  let offset = 0;

  while (offset + 12 <= view.byteLength) {
    const blockType = readUint32LE(view, offset);
    const blockLength = readUint32LE(view, offset + 4);
    if (blockLength < 12) break;
    if (offset + blockLength > view.byteLength) break;

    if (blockType === BLOCK_TYPE_IDB) {
      const idb = parseIdb(view, offset, blockLength);
      if (idb) interfaces.push(idb);
    } else if (blockType === BLOCK_TYPE_EPB) {
      if (blockLength < 32) {
        offset += blockLength;
        continue;
      }
      const interfaceId = readUint32LE(view, offset + 8);
      const timestampHigh = readUint32LE(view, offset + 12);
      const timestampLow = readUint32LE(view, offset + 16);
      const capturedLen = readUint32LE(view, offset + 20);
      const dataOffset = offset + 28;
      const blockEnd = offset + blockLength;
      const iface = interfaces[interfaceId];
      if (
        iface &&
        dataOffset + capturedLen <= blockEnd - 4 &&
        dataOffset + capturedLen <= view.byteLength
      ) {
        const data = new Uint8Array(buffer, dataOffset, capturedLen);
        const rawTs = (BigInt(timestampHigh) << 32n) | BigInt(timestampLow);
        packets.push({
          interfaceId,
          timestampNs: normalizeTimestamp(rawTs, iface.tsResol),
          data,
        });
      }
    }

    offset += blockLength;
  }

  return { interfaces, packets };
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
  const { interfaces, packets } = parseBlocks(buffer);
  if (packets.length === 0) {
    throw new Error('pcapng ファイルにパケットが見つかりません');
  }

  const ethernetPackets = packets.filter(
    (raw) => interfaces[raw.interfaceId]?.linkType === LINKTYPE_ETHERNET,
  );

  if (ethernetPackets.length === 0) {
    throw new Error(
      '未対応の LinkType です: Ethernet (linktype=1) のパケットがありません',
    );
  }

  const baseTimestampNs = ethernetPackets[0].timestampNs;
  const events: PacketEvent[] = [];

  ethernetPackets.forEach((raw) => {
    const event = toPacketEvent(raw, events.length, baseTimestampNs);
    if (event) events.push(event);
  });

  if (events.length === 0) {
    throw new Error('解析可能な Ethernet フレームがありません');
  }

  return events;
}
