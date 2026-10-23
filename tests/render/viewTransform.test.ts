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

  it('fits a topology with more than 100,000 nodes without throwing', () => {
    const count = 150_000;
    const nodes = Array.from({ length: count }, (_, index) => ({
      x: (index * 37) % 5000,
      y: (index * 91) % 4000,
    }));

    const view = fitTopologyView(nodes, 1200, 800, 56);

    expect(Number.isFinite(view.zoom)).toBe(true);
    expect(Number.isFinite(view.panX)).toBe(true);
    expect(Number.isFinite(view.panY)).toBe(true);
    expect(view.zoom).toBeGreaterThan(0);
  });

  it('derives the same transform as a reference min/max loop on a large array', () => {
    const nodes = Array.from({ length: 120_000 }, (_, index) => ({
      x: Math.sin(index) * 1000,
      y: Math.cos(index * 1.3) * 800,
    }));

    const nodeSize = 56;
    const viewportWidth = 1024;
    const viewportHeight = 768;
    const viewportPadding = 40;
    const horizontalNodePadding = nodeSize / 2 + 12;
    const topNodePadding = nodeSize / 2 + 12;
    const bottomNodePadding = nodeSize / 2 + 32;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      if (node.x < minX) minX = node.x;
      if (node.x > maxX) maxX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.y > maxY) maxY = node.y;
    }
    minX -= horizontalNodePadding;
    maxX += horizontalNodePadding;
    minY -= topNodePadding;
    maxY += bottomNodePadding;

    const contentWidth = Math.max(maxX - minX, 1);
    const contentHeight = Math.max(maxY - minY, 1);
    const availableWidth = Math.max(viewportWidth - viewportPadding * 2, 1);
    const availableHeight = Math.max(viewportHeight - viewportPadding * 2, 1);
    const expectedZoom = Math.min(
      Math.max(MIN_VIEW_ZOOM, Math.min(availableWidth / contentWidth, availableHeight / contentHeight, 1)),
      MAX_VIEW_ZOOM,
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const view = fitTopologyView(nodes, viewportWidth, viewportHeight, nodeSize);

    expect(view.zoom).toBeCloseTo(expectedZoom);
    expect(view.panX).toBeCloseTo(viewportWidth / 2 - centerX * expectedZoom);
    expect(view.panY).toBeCloseTo(viewportHeight / 2 - centerY * expectedZoom);
  });
});
