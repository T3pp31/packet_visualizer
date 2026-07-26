import type { AppConfig, NetworkNode, SpriteScene, Topology } from '../core/types';

const ICON_PATHS: Record<string, string> = {
  host: 'host.svg',
  router: 'router.svg',
  server: 'server.svg',
  broadcast: 'broadcast.svg',
  unknown: 'unknown.svg',
};

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private icons = new Map<string, HTMLImageElement>();
  private iconLoadPromise: Promise<void>;
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private config: AppConfig,
    basePath: string,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context を取得できません');
    this.ctx = ctx;
    this.iconLoadPromise = this.loadIcons(basePath);
  }

  async ready(): Promise<void> {
    await this.iconLoadPromise;
  }

  resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setView(zoom: number, panX: number, panY: number): void {
    this.zoom = zoom;
    this.panX = panX;
    this.panY = panY;
  }

  draw(topology: Topology, scene: SpriteScene): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);
    this.drawBackground(width, height);
    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    this.drawLinks(topology);
    this.drawNodes(topology, scene);
    this.drawSprites(scene);

    ctx.restore();
  }

  hitTestNode(
    topology: Topology,
    x: number,
    y: number,
  ): NetworkNode | null {
    const worldX = (x - this.panX) / this.zoom;
    const worldY = (y - this.panY) / this.zoom;
    const size = this.config.topology.nodeSizePx;
    const radius = size / 2 + 8;

    for (let i = topology.nodes.length - 1; i >= 0; i -= 1) {
      const node = topology.nodes[i];
      const dx = worldX - node.x;
      const dy = worldY - node.y;
      if (Math.hypot(dx, dy) <= radius) return node;
    }
    return null;
  }

  private async loadIcons(basePath: string): Promise<void> {
    const entries = Object.entries(ICON_PATHS);
    await Promise.all(
      entries.map(
        ([type, file]) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              this.icons.set(type, img);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = `${basePath}icons/${file}`;
          }),
      ),
    );
  }

  private drawBackground(width: number, height: number): void {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, this.config.colors.background);
    gradient.addColorStop(1, '#E8EEF6');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.strokeStyle = this.config.colors.grid;
    ctx.lineWidth = 1;
    const step = 32;
    for (let x = 0; x < width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLinks(topology: Topology): void {
    const ctx = this.ctx;
    const nodeMap = new Map(topology.nodes.map((node) => [node.id, node]));

    ctx.strokeStyle = this.config.colors.link;
    ctx.lineWidth = 2;
    for (const link of topology.links) {
      const a = nodeMap.get(link.a);
      const b = nodeMap.get(link.b);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  private drawNodes(topology: Topology, scene: SpriteScene): void {
    const ctx = this.ctx;
    const size = this.config.topology.nodeSizePx;

    for (const node of topology.nodes) {
      const isSelected = scene.selectedNodeId === node.id;
      const icon = this.icons.get(node.type) ?? this.icons.get('host');
      const color =
        node.type === 'broadcast'
          ? this.config.colors.broadcastNode
          : this.config.colors.nodeStroke;

      ctx.save();
      ctx.translate(node.x, node.y);

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(0, 0, size / 2 + 8, 0, Math.PI * 2);
        ctx.strokeStyle = this.config.colors.arpRequest;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      if (icon) {
        const iconSize = size * 0.55;
        ctx.drawImage(icon, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
      }

      ctx.fillStyle = this.config.colors.text;
      ctx.font = '12px "IBM Plex Sans JP", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, 0, size / 2 + 16);
      ctx.restore();
    }
  }

  private drawSprites(scene: SpriteScene): void {
    const ctx = this.ctx;
    for (const sprite of scene.activeSprites) {
      const isHighlighted = scene.highlightedPacketIndex === sprite.packetIndex;
      const radius = isHighlighted ? 12 : 9;

      ctx.save();
      ctx.translate(sprite.x, sprite.y);

      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = sprite.color;
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sprite.label.replace(' ', '\n'), 0, 0);

      ctx.restore();
    }
  }
}
