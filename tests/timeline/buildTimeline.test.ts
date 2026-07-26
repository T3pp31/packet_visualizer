import { describe, expect, it } from 'vitest';
import { parsePcapng } from '../../src/core/parse/pcapng';
import { buildTimeline } from '../../src/core/timeline/buildTimeline';
import { inferTopology } from '../../src/core/topology/infer';
import { autoLayout } from '../../src/core/topology/layout';
import appConfig from '../../config/app.config.json';
import { loadFixture } from '../helpers/loadFixture';

describe('buildTimeline', () => {
  it('maps requests to broadcast and reply to unicast', () => {
    const buffer = loadFixture('sample.pcapng');
    const events = parsePcapng(buffer);
    const topology = autoLayout(inferTopology(events, appConfig), appConfig);
    const timeline = buildTimeline(events, topology, appConfig);

    expect(timeline.keyframes).toHaveLength(8);
    expect(timeline.keyframes.filter((kf) => kf.kind === 'broadcast')).toHaveLength(7);
    expect(timeline.keyframes.filter((kf) => kf.kind === 'unicast')).toHaveLength(1);
    expect(timeline.durationMs).toBeGreaterThan(0);
  });
});
