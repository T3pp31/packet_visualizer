import { describe, expect, it } from 'vitest';
import {
  MAX_VIEW_ZOOM,
  MIN_VIEW_ZOOM,
  fitTopologyView,
  zoomViewAt,
} from '../../src/render/viewTransform';

describe('viewTransform', () => {
  it('keeps the world point under the cursor fixed while zooming', () => {
    const view = { zoom: 1.5, panX: 40, panY: -20 };
    const anchor = { x: 320, y: 180 };
    const worldBefore = {
      x: (anchor.x - view.panX) / view.zoom,
      y: (anchor.y - view.panY) / view.zoom,
    };

    const zoomed = zoomViewAt(view, 2.5, anchor.x, anchor.y);
    const worldAfter = {
      x: (anchor.x - zoomed.panX) / zoomed.zoom,
      y: (anchor.y - zoomed.panY) / zoomed.zoom,
    };

    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
  });

  it('clamps zoom to the supported range', () => {
    expect(zoomViewAt({ zoom: 1, panX: 0, panY: 0 }, 0, 0, 0).zoom).toBe(
      MIN_VIEW_ZOOM,
    );
    expect(zoomViewAt({ zoom: 1, panX: 0, panY: 0 }, 10, 0, 0).zoom).toBe(
      MAX_VIEW_ZOOM,
    );
  });

  it('fits a widely spaced topology inside the viewport', () => {
    const nodes = [
      { x: 100, y: 0 },
      { x: 700, y: 600 },
    ];

    const view = fitTopologyView(nodes, 800, 600, 56);
    const screenPoints = nodes.map((node) => ({
      x: node.x * view.zoom + view.panX,
      y: node.y * view.zoom + view.panY,
    }));

    expect(view.zoom).toBeLessThan(1);
    for (const point of screenPoints) {
      expect(point.x).toBeGreaterThan(40);
      expect(point.x).toBeLessThan(760);
      expect(point.y).toBeGreaterThan(40);
      expect(point.y).toBeLessThan(560);
    }
  });
});
