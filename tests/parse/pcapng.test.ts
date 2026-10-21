import { describe, expect, it } from 'vitest';
import { parsePcapng } from '../../src/core/parse/pcapng';
import { loadFixture } from '../helpers/loadFixture';

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function buildIdb(linkType: number, tsResol?: number): Uint8Array {
  const options: number[] = [];
  if (tsResol !== undefined) {
    options.push(9, 0, 1, 0, tsResol, 0, 0, 0);
  }
  options.push(0, 0, 0, 0);
  const bodyLength = 8 + options.length;
  const blockLength = 8 + bodyLength + 4;
  const bytes = new Uint8Array(blockLength);
  const view = new DataView(bytes.buffer);
  writeUint32(view, 0, 0x00000001);
  writeUint32(view, 4, blockLength);
  writeUint16(view, 8, linkType);
  writeUint16(view, 10, 0);
  writeUint32(view, 12, 0);
  bytes.set(options, 16);
  writeUint32(view, blockLength - 4, blockLength);
  return bytes;
}

function buildEpb(
  interfaceId: number,
  timestamp: bigint,
  payload: Uint8Array,
  capturedLenOverride?: number,
): Uint8Array {
  const paddedLen = (payload.length + 3) & ~3;
  const blockLength = 28 + paddedLen + 4;
  const bytes = new Uint8Array(blockLength);
  const view = new DataView(bytes.buffer);
  writeUint32(view, 0, 0x00000006);
  writeUint32(view, 4, blockLength);
  writeUint32(view, 8, interfaceId);
  writeUint32(view, 12, Number(timestamp >> 32n));
  writeUint32(view, 16, Number(timestamp & 0xffffffffn));
  writeUint32(view, 20, capturedLenOverride ?? payload.length);
  writeUint32(view, 24, payload.length);
  bytes.set(payload, 28);
  writeUint32(view, blockLength - 4, blockLength);
  return bytes;
}

function buildShb(): Uint8Array {
  const blockLength = 28;
  const bytes = new Uint8Array(blockLength);
  const view = new DataView(bytes.buffer);
  writeUint32(view, 0, 0x0a0d0d0a);
  writeUint32(view, 4, blockLength);
  writeUint32(view, 8, 0x1a2b3c4d);
  writeUint16(view, 12, 1);
  writeUint16(view, 14, 0);
  bytes.set([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 16);
  writeUint32(view, blockLength - 4, blockLength);
  return bytes;
}

function buildEthernetArpPayload(
  srcMac: number[],
  srcIp: number[],
  targetIp: number[],
): Uint8Array {
  const bytes = new Uint8Array(42);
  bytes.set([0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 0);
  bytes.set(srcMac, 6);
  bytes[12] = 0x08;
  bytes[13] = 0x06;
  bytes.set([0x00, 0x01, 0x08, 0x00, 0x06, 0x04, 0x00, 0x01], 14);
  bytes.set(srcMac, 22);
  bytes.set(srcIp, 28);
  bytes.set(targetIp, 38);
  return bytes;
}

function buildSllPayload(): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes.set([0x00, 0x00, 0x00, 0x01], 0);
  bytes.set([0x00, 0x01, 0x00, 0x06], 4);
  bytes.set([0x00, 0x11, 0x22, 0x33, 0x44, 0x55], 8);
  bytes.set([0x08, 0x00], 14);
  bytes.set([0x45, 0x00], 16);
  return bytes;
}

function concatBlocks(blocks: Uint8Array[]): ArrayBuffer {
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out.buffer;
}

describe('parsePcapng', () => {
  it('parses sample.pcapng into 8 ARP packets', () => {
    const buffer = loadFixture('sample.pcapng');
    const events = parsePcapng(buffer);

    expect(events).toHaveLength(8);
    expect(events.every((event) => event.etherType === 'ARP')).toBe(true);
    expect(events.filter((event) => event.arp?.op === 'request')).toHaveLength(7);
    expect(events.filter((event) => event.arp?.op === 'reply')).toHaveLength(1);
  });

  it('extracts ARP sender and target IPs', () => {
    const buffer = loadFixture('sample.pcapng');
    const events = parsePcapng(buffer);
    const request = events[0];
    const reply = events[7];

    expect(request.arp?.senderIp).toBe('192.168.150.1');
    expect(request.arp?.targetIp).toBe('192.168.151.127');
    expect(reply.arp?.senderIp).toBe('192.168.150.1');
    expect(reply.arp?.targetIp).toBe('192.168.151.225');
  });

  it('throws when only non-Ethernet (Linux SLL) interfaces exist', () => {
    const shb = buildShb();
    const idb = buildIdb(113);
    const epb = buildEpb(0, 1_000_000n, buildSllPayload());
    const buffer = concatBlocks([shb, idb, epb]);

    expect(() => parsePcapng(buffer)).toThrowError(/LinkType/);
  });

  it('skips non-Ethernet EPBs in a mixed Ethernet/SLL capture', () => {
    const shb = buildShb();
    const idbEth = buildIdb(1);
    const idbSll = buildIdb(113);
    const ethPayload = buildEthernetArpPayload(
      [0x02, 0x00, 0x00, 0x00, 0x00, 0x01],
      [192, 168, 0, 1],
      [192, 168, 0, 2],
    );
    const epbSll = buildEpb(1, 1_000_000n, buildSllPayload());
    const epbEth = buildEpb(0, 2_000_000n, ethPayload);
    const buffer = concatBlocks([shb, idbEth, idbSll, epbSll, epbEth]);

    const events = parsePcapng(buffer);

    expect(events).toHaveLength(1);
    expect(events[0].etherType).toBe('ARP');
    expect(events[0].index).toBe(0);
    expect(events[0].id).toBe('pkt-0');
    expect(events[0].arp?.senderIp).toBe('192.168.0.1');
  });

  it('maps interfaceId to the correct IDB linktype', () => {
    const shb = buildShb();
    const idbSll = buildIdb(113);
    const idbEth = buildIdb(1);
    const ethPayload = buildEthernetArpPayload(
      [0x02, 0x00, 0x00, 0x00, 0x00, 0x02],
      [10, 0, 0, 1],
      [10, 0, 0, 2],
    );
    const epbEth = buildEpb(1, 5_000_000n, ethPayload);
    const epbSll = buildEpb(0, 6_000_000n, buildSllPayload());
    const buffer = concatBlocks([shb, idbSll, idbEth, epbEth, epbSll]);

    const events = parsePcapng(buffer);

    expect(events).toHaveLength(1);
    expect(events[0].arp?.senderIp).toBe('10.0.0.1');
  });

  it('normalizes timestamps using if_tsresol=9 (nanoseconds)', () => {
    const shb = buildShb();
    const idb = buildIdb(1, 9);
    const ethPayload = buildEthernetArpPayload(
      [0x02, 0x00, 0x00, 0x00, 0x00, 0x03],
      [192, 168, 1, 1],
      [192, 168, 1, 2],
    );
    const first = buildEpb(0, 1_000_000_000n, ethPayload);
    const second = buildEpb(0, 1_500_000_000n, ethPayload);
    const buffer = concatBlocks([shb, idb, first, second]);

    const events = parsePcapng(buffer);

    expect(events).toHaveLength(2);
    expect(events[0].timestampMs).toBe(0);
    expect(events[1].timestampMs).toBe(500);
    expect(events[1].absoluteTsNs).toBe(1_500_000_000n);
  });

  it('defaults to microseconds when if_tsresol is absent', () => {
    const shb = buildShb();
    const idb = buildIdb(1);
    const ethPayload = buildEthernetArpPayload(
      [0x02, 0x00, 0x00, 0x00, 0x00, 0x04],
      [192, 168, 2, 1],
      [192, 168, 2, 2],
    );
    const first = buildEpb(0, 1_000_000n, ethPayload);
    const second = buildEpb(0, 2_500_000n, ethPayload);
    const buffer = concatBlocks([shb, idb, first, second]);

    const events = parsePcapng(buffer);

    expect(events).toHaveLength(2);
    expect(events[0].absoluteTsNs).toBe(1_000_000_000n);
    expect(events[1].timestampMs).toBe(1500);
  });

  it('skips EPBs without a matching IDB and EPBs exceeding block bounds', () => {
    const shb = buildShb();
    const idb = buildIdb(1);
    const ethPayload = buildEthernetArpPayload(
      [0x02, 0x00, 0x00, 0x00, 0x00, 0x05],
      [192, 168, 3, 1],
      [192, 168, 3, 2],
    );
    const orphanEpb = buildEpb(5, 1_000_000n, ethPayload);
    const oversizedEpb = buildEpb(0, 2_000_000n, ethPayload, 1000);
    const validEpb = buildEpb(0, 3_000_000n, ethPayload);
    const buffer = concatBlocks([shb, idb, orphanEpb, oversizedEpb, validEpb]);

    const events = parsePcapng(buffer);

    expect(events).toHaveLength(1);
    expect(events[0].timestampMs).toBe(0);
    expect(events[0].arp?.senderIp).toBe('192.168.3.1');
  });
});
