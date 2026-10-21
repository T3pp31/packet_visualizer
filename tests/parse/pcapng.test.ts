import { describe, expect, it } from 'vitest';
import { parsePcapng } from '../../src/core/parse/pcapng';
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
});
