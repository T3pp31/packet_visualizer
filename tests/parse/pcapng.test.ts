import { describe, expect, it } from 'vitest';
import { parsePcapng } from '../../src/core/parse/pcapng';
import { parseArp } from '../../src/core/parse/arp';
import { parseEthernet } from '../../src/core/parse/ethernet';
import { parseIpv4 } from '../../src/core/parse/ipv4';
import { formatIp, formatMac } from '../../src/core/utils';
import { loadFixture } from '../helpers/loadFixture';

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

  it('handles truncated frames without crashing', () => {
    expect(parseArp(new Uint8Array(27))).toBeNull();
    expect(parseEthernet(new Uint8Array(13))).toBeNull();
    expect(parseIpv4(new Uint8Array(19))).toBeNull();
  });
});

describe('formatMac', () => {
  it('returns null for empty buffer', () => {
    expect(formatMac(new Uint8Array(0), 0)).toBeNull();
  });

  it('formats macs within bounds', () => {
    expect(formatMac(new Uint8Array(14), 0)).toBe('00:00:00:00:00:00');
    expect(formatMac(new Uint8Array(14), 6)).toBe('00:00:00:00:00:00');
  });

  it('returns null when out of bounds or negative offset', () => {
    expect(formatMac(new Uint8Array(13), 8)).toBeNull();
    expect(formatMac(new Uint8Array(6), -1)).toBeNull();
  });
});

describe('formatIp', () => {
  it('returns null for too-short buffer', () => {
    expect(formatIp(new Uint8Array(3), 0)).toBeNull();
  });

  it('formats an ip within bounds', () => {
    expect(formatIp(new Uint8Array(4), 0)).toBe('0.0.0.0');
  });

  it('returns null when offset+4 exceeds length', () => {
    expect(formatIp(new Uint8Array(5), 2)).toBeNull();
  });
});
