import { describe, expect, it } from 'vitest';
import { parsePcapng } from '../../src/core/parse/pcapng';
import { loadFixture } from '../helpers/loadFixture';

const ARP_FRAME = new Uint8Array([
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
  0x08, 0x06,
  0x00, 0x01, 0x08, 0x00, 0x06, 0x04, 0x00, 0x01,
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
  0xc0, 0xa8, 0x96, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xc0, 0xa8, 0x96, 0x02,
]);

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function buildBlock(type: number, body: Uint8Array): Uint8Array {
  const total = 12 + pad4(body.length);
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, total, true);
  buf.set(body, 8);
  view.setUint32(total - 4, total, true);
  return buf;
}

function buildShb(): Uint8Array {
  const body = new Uint8Array(16);
  const view = new DataView(body.buffer);
  view.setUint32(0, 0x1a2b3c4d, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, 0xffffffff, true);
  view.setUint32(12, 0xffffffff, true);
  return buildBlock(0x0a0d0d0a, body);
}

function buildIdb(): Uint8Array {
  const body = new Uint8Array(8);
  const view = new DataView(body.buffer);
  view.setUint16(0, 1, true);
  view.setUint32(4, 0, true);
  return buildBlock(0x00000001, body);
}

function buildEpb(tsHigh: number, tsLow: number, frame: Uint8Array): Uint8Array {
  const body = new Uint8Array(20 + pad4(frame.length));
  const view = new DataView(body.buffer);
  view.setUint32(0, 0, true);
  view.setUint32(4, tsHigh, true);
  view.setUint32(8, tsLow, true);
  view.setUint32(12, frame.length, true);
  view.setUint32(16, frame.length, true);
  body.set(frame, 20);
  return buildBlock(0x00000006, body);
}

function buildPb(tsHigh: number, tsLow: number, frame: Uint8Array): Uint8Array {
  const body = new Uint8Array(20 + pad4(frame.length));
  const view = new DataView(body.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 0, true);
  view.setUint32(4, tsHigh, true);
  view.setUint32(8, tsLow, true);
  view.setUint32(12, frame.length, true);
  view.setUint32(16, frame.length, true);
  body.set(frame, 20);
  return buildBlock(0x00000002, body);
}

function buildSpb(frame: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + pad4(frame.length));
  const view = new DataView(body.buffer);
  view.setUint32(0, frame.length, true);
  body.set(frame, 4);
  return buildBlock(0x00000003, body);
}

function concat(blocks: Uint8Array[]): ArrayBuffer {
  const total = blocks.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const b of blocks) {
    out.set(b, pos);
    pos += b.length;
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

  it('parses an SPB-only file without throwing', () => {
    const buffer = concat([buildShb(), buildIdb(), buildSpb(ARP_FRAME)]);
    const events = parsePcapng(buffer);

    expect(events).toHaveLength(1);
    expect(events[0].etherType).toBe('ARP');
    expect(events[0].timestampMs).toBe(0);
  });

  it('interpolates SPB timestamps from the preceding packet block', () => {
    const buffer = concat([
      buildShb(),
      buildIdb(),
      buildEpb(1, 500, ARP_FRAME),
      buildSpb(ARP_FRAME),
    ]);
    const events = parsePcapng(buffer);

    expect(events).toHaveLength(2);
    expect(events[1].timestampMs).toBeGreaterThanOrEqual(events[0].timestampMs);
    expect(events[1].absoluteTsNs).toBe(events[0].absoluteTsNs);
  });

  it('parses legacy Packet Block like EPB', () => {
    const buffer = concat([
      buildShb(),
      buildIdb(),
      buildPb(2, 250, ARP_FRAME),
    ]);
    const events = parsePcapng(buffer);

    expect(events).toHaveLength(1);
    expect(events[0].etherType).toBe('ARP');
    expect(events[0].rawLength).toBe(ARP_FRAME.length);
    expect(events[0].absoluteTsNs).toBe((2n << 32n) | 250n);
  });

  it('does not throw or loop on invalid or oversized block lengths', () => {
    const badLength = new Uint8Array(16);
    new DataView(badLength.buffer).setUint32(4, 4, true);
    const oversized = new Uint8Array(16);
    const ov = new DataView(oversized.buffer);
    ov.setUint32(0, 0x00000006, true);
    ov.setUint32(4, 0xfffffff0, true);

    const buffer = concat([
      buildShb(),
      buildIdb(),
      buildEpb(1, 0, ARP_FRAME),
      badLength,
      oversized,
      buildSpb(ARP_FRAME),
    ]);
    const events = parsePcapng(buffer);

    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
