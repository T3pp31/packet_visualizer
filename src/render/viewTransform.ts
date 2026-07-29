import type { NetworkNode } from '../core/types';

export type ViewTransform = {
  zoom: number;
  panX: number;
  panY: number;
};

export const MIN_VIEW_ZOOM = 0.1;
export const MAX_VIEW_ZOOM = 4;

export const DEFAULT_VIEW: ViewTransform = {
  zoom: 1,
  panX: 0,
  panY: 0,
};

export function clampViewZoom(zoom: number): number {
  return Math.min(MAX_VIEW_ZOOM, Math.max(MIN_VIEW_ZOOM, zoom));
}

export function zoomViewAt(
  view: ViewTransform,
  requestedZoom: number,
  anchorX: number,
  anchorY: number,
): ViewTransform {
  const zoom = clampViewZoom(requestedZoom);
  const worldX = (anchorX - view.panX) / view.zoom;
  const worldY = (anchorY - view.panY) / view.zoom;

  return {
    zoom,
    panX: anchorX - worldX * zoom,
    panY: anchorY - worldY * zoom,
  };
}

export function fitTopologyView(
  nodes: Array<Pick<NetworkNode, 'x' | 'y'>>,
  viewportWidth: number,
  viewportHeight: number,
  nodeSize: number,
): ViewTransform {
  if (nodes.length === 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { ...DEFAULT_VIEW };
  }

  const viewportPadding = 40;
  const horizontalNodePadding = nodeSize / 2 + 12;
  const topNodePadding = nodeSize / 2 + 12;
  const bottomNodePadding = nodeSize / 2 + 32;

  const minX = Math.min(...nodes.map((node) => node.x)) - horizontalNodePadding;
  const maxX = Math.max(...nodes.map((node) => node.x)) + horizontalNodePadding;
  const minY = Math.min(...nodes.map((node) => node.y)) - topNodePadding;
  const maxY = Math.max(...nodes.map((node) => node.y)) + bottomNodePadding;

  const contentWidth = Math.max(maxX - minX, 1);
  const contentHeight = Math.max(maxY - minY, 1);
  const availableWidth = Math.max(viewportWidth - viewportPadding * 2, 1);
  const availableHeight = Math.max(viewportHeight - viewportPadding * 2, 1);
  const zoom = clampViewZoom(
    Math.min(availableWidth / contentWidth, availableHeight / contentHeight, 1),
  );

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    zoom,
    panX: viewportWidth / 2 - centerX * zoom,
    panY: viewportHeight / 2 - centerY * zoom,
  };
}
