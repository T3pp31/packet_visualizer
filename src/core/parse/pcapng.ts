import type { PacketEvent } from '../types';
import { parseArp, summarizeArpJa } from './arp';
import { etherTypeLabel, parseEthernet } from './ethernet';
import { parseIpv4, summarizeIpv4Ja } from './ipv4';

const BLOCK_TYPE_SHB = 0x0a0d0d0a;
const BLOCK_TYPE_IDB = 0x00000001;
const BLOCK_TYPE_EPB = 0x00000006;
const LINKTYPE_ETHERNET = 1;
const OPT_ENDOFOPT = 0;
const OPT_IF_TSRESOL = 9;
const DEFAULT_TSRESOL = 6;

const TS_FROM_RAW = 'raw';
const TS_FROM_MICROS = 'micros';
const TS_FROM_NANOS = 'nanos';

// Timestamps are normalized to nanoseconds. To avoid recomputing BigInt powers
// per packet, each interface precomputes how its raw counter maps to ns.
type TsScale =
  | { kind: typeof TS_FROM_RAW; factor: bigint }
  | { kind: typeof TS_FROM_MICROS }
  | { kind: typeof TS_FROM_NANOS };

type InterfaceInfo = {
  linkType: number;
  tsScale: TsScale;
};

type RawPacket = {
  linkType: number;
  tsScale: TsScale;
  tsOffsetNs: bigint;
  timestampNs: bigint;
  data: Uint8Array;
};

function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readUint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function pow10(exponent: number): bigint {
  let result = 1n;
  for (let i = 0; i < exponent; i += 1) result *= 10n;
  return result;
}

function tsScaleForResolution(value: number): TsScale {
  if ((value & 0x80) !== 0) {
    const exponent = value & 0x7f;
    return { kind: TS_FROM_RAW, factor: 1_000_000_000n / 2n ** BigInt(exponent) };
  }
  if (value === 6) return { kind: TS_FROM_MICROS };
  if (value === 9) return { kind: TS_FROM_NANOS };
  if (value < 9) return { kind: TS_FROM_RAW, factor: pow10(9 - value) };
  return { kind: TS_FROM_RAW, factor: 1n };
}

function normalizeTimestamp(raw: bigint, scale: TsScale): bigint {
  if (scale.kind === TS_FROM_MICROS) return raw * 1_000n;
  if (scale.kind === TS_FROM_NANOS) return raw;
  return raw * scale.factor;
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
  let tsScale = tsScaleForResolution(DEFAULT_TSRESOL);

  let optOffset = blockStart + 16;
  while (optOffset + 4 <= blockEnd - 4) {
    const code = readUint16LE(view, optOffset);
    const length = readUint16LE(view, optOffset + 2);
    if (code === OPT_ENDOFOPT) break;
    const valueOffset = optOffset + 4;
    const paddedLength = (length + 3) & ~3;
    if (valueOffset + paddedLength > blockEnd - 4) break;
    if (code === OPT_IF_TSRESOL && length >= 1) {
      tsScale = tsScaleForResolution(view.getUint8(valueOffset));
    }
    optOffset = valueOffset + paddedLength;
  }

  return { linkType, tsScale };
}

function parseBlocks(buffer: ArrayBuffer): RawPacket[] {
  const view = new DataView(buffer);
  const packets: RawPacket[] = [];
  let interfaces: InterfaceInfo[] = [];
  let offset = 0;

  while (offset + 12 <= view.byteLength) {
    const blockType = readUint32LE(view, offset);
    const blockLength = readUint32LE(view, offset + 4);
    if (blockLength < 12) break;
    if (offset + blockLength > view.byteLength) break;

    if (blockType === BLOCK_TYPE_SHB) {
      // Interface IDs restart at 0 for every new section.
      interfaces = [];
    } else if (blockType === BLOCK_TYPE_IDB) {
      // Keep a placeholder for invalid IDBs so later interface IDs stay aligned.
      interfaces.push(parseIdb(view, offset, blockLength) ?? { linkType: -1, tsScale: tsScaleForResolution(DEFAULT_TSRESOL) });
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
          linkType: iface.linkType,
          tsScale: iface.tsScale,
          tsOffsetNs: 0n,
          timestampNs: normalizeTimestamp(rawTs, iface.tsScale),
          data,
        });
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

  const ethernetPackets = rawPackets.filter(
    (raw) => raw.linkType === LINKTYPE_ETHERNET,
  );

  if (ethernetPackets.length === 0) {
    const hasEthernetInterface = rawPackets.some(
      (raw) => raw.linkType === LINKTYPE_ETHERNET,
    );
    if (hasEthernetInterface) {
      throw new Error(
        'Ethernet インターフェースの解析可能なパケットがありません',
      );
    }
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
