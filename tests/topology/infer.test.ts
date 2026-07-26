import { describe, expect, it } from 'vitest';
import { parsePcapng } from '../../src/core/parse/pcapng';
import { inferTopology } from '../../src/core/topology/infer';
import appConfig from '../../config/app.config.json';
import { loadFixture } from '../helpers/loadFixture';

describe('inferTopology', () => {
  it('creates broadcast, requester, unknown target, and reply peer nodes', () => {
    const buffer = loadFixture('sample.pcapng');
    const events = parsePcapng(buffer);
    const topology = inferTopology(events, appConfig);

    const labels = topology.nodes.map((node) => node.label);
    expect(labels).toContain('ブロードキャスト');
    expect(labels).toContain('192.168.150.1');
    expect(labels).toContain('192.168.151.127');
    expect(labels).toContain('192.168.151.225');

    const broadcast = topology.nodes.find(
      (node) => node.id === topology.broadcastNodeId,
    );
    expect(broadcast?.type).toBe('broadcast');
  });
});
