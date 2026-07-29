import { loadConfig } from './config/loadConfig';
import { parsePcapng } from './core/parse/pcapng';
import { buildTimeline } from './core/timeline/buildTimeline';
import { inferTopology, mergeTopologyEdits } from './core/topology/infer';
import { autoLayout, relayoutUnfixed } from './core/topology/layout';
import type { NetworkNode, PacketEvent, PlaybackTimeline, Topology } from './core/types';
import { Player } from './player/player';
import { CanvasRenderer } from './render/canvasRenderer';
import { packetIndexAtTime, sceneAt } from './render/sceneAt';
import {
  DEFAULT_VIEW,
  fitTopologyView,
  zoomViewAt,
  type ViewTransform,
} from './render/viewTransform';
import {
  createDropzone,
  createNodeInspector,
  createPacketList,
  createPlaybackBar,
  showToast,
} from './ui/components';

const config = loadConfig();
const basePath = import.meta.env.BASE_URL;

type AppState = {
  events: PacketEvent[];
  topology: Topology | null;
  timeline: PlaybackTimeline | null;
  selectedNodeId: string | null;
  highlightedPacketIndex: number | null;
};

export async function createApp(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="app">
      <header class="app__header">
        <div class="app__brand">
          <h1>Packet Visualizer</h1>
          <p>ローカルネットワークのパケットの流れを可視化</p>
        </div>
        <div class="app__actions">
          <button type="button" id="sample-btn" class="btn btn--secondary">サンプルを試す</button>
          <label class="btn btn--primary">
            ファイルを開く
            <input id="file-input" type="file" accept=".pcapng" hidden />
          </label>
        </div>
      </header>
      <div class="app__body dropzone" id="dropzone">
        <section class="canvas-panel">
          <canvas id="topology-canvas"></canvas>
          <div class="canvas-controls" role="group" aria-label="キャンバスの表示倍率">
            <button type="button" id="zoom-out-btn" class="canvas-controls__button" aria-label="縮小" title="縮小">−</button>
            <output id="zoom-level" class="canvas-controls__level" aria-live="polite">100%</output>
            <button type="button" id="zoom-in-btn" class="canvas-controls__button" aria-label="拡大" title="拡大">＋</button>
            <button type="button" id="zoom-fit-btn" class="canvas-controls__button canvas-controls__button--fit" title="すべてのノードを画面内に表示">全体表示</button>
          </div>
          <p class="canvas-hint">ホイールで拡大・縮小 / 余白をドラッグで移動</p>
        </section>
        <aside class="sidebar">
          <div id="node-inspector"></div>
          <div id="packet-list-panel">
            <h2>パケット一覧</h2>
            <div id="packet-list"></div>
          </div>
        </aside>
      </div>
      <footer class="app__footer">
        <div id="playback-bar"></div>
      </footer>
    </div>
  `;

  const canvas = root.querySelector<HTMLCanvasElement>('#topology-canvas');
  const dropzone = root.querySelector<HTMLElement>('#dropzone');
  const fileInput = root.querySelector<HTMLInputElement>('#file-input');
  const sampleBtn = root.querySelector<HTMLButtonElement>('#sample-btn');
  const packetListContainer = root.querySelector<HTMLElement>('#packet-list');
  const playbackBarContainer = root.querySelector<HTMLElement>('#playback-bar');
  const nodeInspectorContainer = root.querySelector<HTMLElement>('#node-inspector');
  const zoomOutBtn = root.querySelector<HTMLButtonElement>('#zoom-out-btn');
  const zoomInBtn = root.querySelector<HTMLButtonElement>('#zoom-in-btn');
  const zoomFitBtn = root.querySelector<HTMLButtonElement>('#zoom-fit-btn');
  const zoomLevel = root.querySelector<HTMLOutputElement>('#zoom-level');

  if (
    !canvas ||
    !dropzone ||
    !fileInput ||
    !sampleBtn ||
    !packetListContainer ||
    !playbackBarContainer ||
    !nodeInspectorContainer ||
    !zoomOutBtn ||
    !zoomInBtn ||
    !zoomFitBtn ||
    !zoomLevel
  ) {
    throw new Error('UI 要素の初期化に失敗しました');
  }

  const topologyCanvas: HTMLCanvasElement = canvas;
  const zoomLevelOutput: HTMLOutputElement = zoomLevel;
  const renderer = new CanvasRenderer(topologyCanvas, config, basePath);
  await renderer.ready();

  let player = new Player(0, config.playback.defaultSpeed);
  let view: ViewTransform = { ...DEFAULT_VIEW };
  renderer.setView(view.zoom, view.panX, view.panY);
  const state: AppState = {
    events: [],
    topology: null,
    timeline: null,
    selectedNodeId: null,
    highlightedPacketIndex: null,
  };

  let draggingNodeId: string | null = null;
  let nodeDragOffset = { x: 0, y: 0 };
  let isPanning = false;
  let lastPointerPosition = { x: 0, y: 0 };

  const packetList = createPacketList(packetListContainer, (index) => {
    const keyframe = state.timeline?.keyframes.find((item) => item.packetIndex === index);
    if (keyframe) {
      player.seek(keyframe.tStart);
      state.highlightedPacketIndex = index;
      renderFrame();
    }
  });

  const playbackBar = createPlaybackBar(
    playbackBarContainer,
    config.playback.speeds,
    config.playback.defaultSpeed,
    {
      onToggle: () => player.toggle(),
      onSeek: (timeMs) => {
        player.seek(timeMs);
        renderFrame();
      },
      onSpeed: (speed) => player.setSpeed(speed),
    },
  );

  const nodeInspector = createNodeInspector(nodeInspectorContainer, {
    onTypeChange: (type) => {
      if (!state.topology || !state.selectedNodeId) return;
      state.topology = mergeTopologyEdits(state.topology, [
        { id: state.selectedNodeId, type: type as NetworkNode['type'] },
      ]);
      if (state.events.length > 0) {
        state.timeline = buildTimeline(state.events, state.topology, config);
        player.setDuration(state.timeline.durationMs);
      }
      renderFrame();
      nodeInspector.show(getSelectedNode());
    },
    onLabelChange: (label) => {
      if (!state.topology || !state.selectedNodeId) return;
      state.topology = mergeTopologyEdits(state.topology, [
        { id: state.selectedNodeId, label },
      ]);
      renderFrame();
    },
    onRelayout: () => {
      if (!state.topology) return;
      state.topology = relayoutUnfixed(state.topology, config);
      setViewToFit(false);
      renderFrame();
      showToast('自動レイアウトを再実行しました');
    },
  });

  function getSelectedNode(): NetworkNode | null {
    if (!state.topology || !state.selectedNodeId) return null;
    return state.topology.nodes.find((node) => node.id === state.selectedNodeId) ?? null;
  }

  function drawCurrentScene(): ReturnType<Player['getState']> | null {
    if (!state.topology || !state.timeline) return null;
    const playerState = player.getState();
    state.highlightedPacketIndex = packetIndexAtTime(
      playerState.currentTimeMs,
      state.timeline,
    );
    const scene = sceneAt(
      playerState.currentTimeMs,
      state.timeline,
      state.topology,
      config,
      state.highlightedPacketIndex,
      state.selectedNodeId,
    );
    renderer.draw(state.topology, scene);
    return playerState;
  }

  function renderFrame(): void {
    const playerState = drawCurrentScene();
    if (!playerState) return;
    packetList.render(state.events, state.highlightedPacketIndex);
    playbackBar.update(playerState);
    nodeInspector.show(getSelectedNode());
  }

  function applyView(nextView: ViewTransform, redraw = true): void {
    view = nextView;
    renderer.setView(view.zoom, view.panX, view.panY);
    const zoomPercent = Math.round(view.zoom * 100);
    zoomLevelOutput.textContent = `${zoomPercent}%`;
    zoomLevelOutput.setAttribute('aria-label', `表示倍率 ${zoomPercent}%`);
    if (redraw) drawCurrentScene();
  }

  function setViewToFit(redraw = true): void {
    if (!state.topology) {
      applyView({ ...DEFAULT_VIEW }, redraw);
      return;
    }
    applyView(
      fitTopologyView(
        state.topology.nodes,
        topologyCanvas.clientWidth,
        topologyCanvas.clientHeight,
        config.topology.nodeSizePx,
      ),
      redraw,
    );
  }

  function zoomAtCanvasPoint(scale: number, x: number, y: number): void {
    applyView(zoomViewAt(view, view.zoom * scale, x, y));
  }

  function resizeCanvas(): void {
    const panel = topologyCanvas.parentElement;
    if (!panel) return;
    renderer.resize(panel.clientWidth, panel.clientHeight);
    renderFrame();
  }

  async function loadBuffer(buffer: ArrayBuffer, label: string): Promise<void> {
    try {
      const events = parsePcapng(buffer);
      let topology = inferTopology(events, config);
      topology = autoLayout(topology, config);
      const timeline = buildTimeline(events, topology, config);

      player.destroy();
      player = new Player(timeline.durationMs, config.playback.defaultSpeed);
      player.subscribe(() => renderFrame());

      state.events = events;
      state.topology = topology;
      state.timeline = timeline;
      state.selectedNodeId = null;
      state.highlightedPacketIndex = null;

      setViewToFit(false);
      renderFrame();
      showToast(`${label} を読み込みました（${events.length} パケット）`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ファイルの読み込みに失敗しました';
      showToast(message, true);
    }
  }

  async function loadFile(file: File): Promise<void> {
    const buffer = await file.arrayBuffer();
    await loadBuffer(buffer, file.name);
  }

  async function loadSample(): Promise<void> {
    const response = await fetch(`${basePath}sample/sample.pcapng`);
    if (!response.ok) throw new Error('サンプルファイルの取得に失敗しました');
    const buffer = await response.arrayBuffer();
    await loadBuffer(buffer, 'sample.pcapng');
  }

  createDropzone(dropzone, (file) => {
    void loadFile(file);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void loadFile(file);
  });

  sampleBtn.addEventListener('click', () => {
    void loadSample();
  });

  topologyCanvas.addEventListener('pointerdown', (event) => {
    if (!state.topology || event.button !== 0) return;
    const rect = topologyCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const node = renderer.hitTestNode(state.topology, x, y);
    state.selectedNodeId = node?.id ?? null;

    if (node && node.type !== 'broadcast') {
      draggingNodeId = node.id;
      const worldPoint = renderer.screenToWorld(x, y);
      nodeDragOffset = {
        x: node.x - worldPoint.x,
        y: node.y - worldPoint.y,
      };
    } else if (!node) {
      isPanning = true;
      lastPointerPosition = { x: event.clientX, y: event.clientY };
    }

    if (draggingNodeId || isPanning) {
      topologyCanvas.setPointerCapture(event.pointerId);
      topologyCanvas.classList.add('topology-canvas--dragging');
      event.preventDefault();
    }
    renderFrame();
  });

  topologyCanvas.addEventListener('pointermove', (event) => {
    if (draggingNodeId && state.topology) {
      const rect = topologyCanvas.getBoundingClientRect();
      const worldPoint = renderer.screenToWorld(
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      state.topology = mergeTopologyEdits(state.topology, [
        {
          id: draggingNodeId,
          x: worldPoint.x + nodeDragOffset.x,
          y: worldPoint.y + nodeDragOffset.y,
          fixed: true,
        },
      ]);
      drawCurrentScene();
      return;
    }

    if (isPanning) {
      const deltaX = event.clientX - lastPointerPosition.x;
      const deltaY = event.clientY - lastPointerPosition.y;
      lastPointerPosition = { x: event.clientX, y: event.clientY };
      applyView({
        ...view,
        panX: view.panX + deltaX,
        panY: view.panY + deltaY,
      });
    }
  });

  function finishPointerInteraction(event: PointerEvent): void {
    draggingNodeId = null;
    isPanning = false;
    topologyCanvas.classList.remove('topology-canvas--dragging');
    if (topologyCanvas.hasPointerCapture(event.pointerId)) {
      topologyCanvas.releasePointerCapture(event.pointerId);
    }
  }

  topologyCanvas.addEventListener('pointerup', finishPointerInteraction);
  topologyCanvas.addEventListener('pointercancel', finishPointerInteraction);

  topologyCanvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = topologyCanvas.getBoundingClientRect();
      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * topologyCanvas.clientHeight
            : event.deltaY;
      const scale = Math.exp(-delta * 0.0015);
      zoomAtCanvasPoint(scale, event.clientX - rect.left, event.clientY - rect.top);
    },
    { passive: false },
  );

  zoomOutBtn.addEventListener('click', () => {
    zoomAtCanvasPoint(
      0.8,
      topologyCanvas.clientWidth / 2,
      topologyCanvas.clientHeight / 2,
    );
  });
  zoomInBtn.addEventListener('click', () => {
    zoomAtCanvasPoint(
      1.25,
      topologyCanvas.clientWidth / 2,
      topologyCanvas.clientHeight / 2,
    );
  });
  zoomFitBtn.addEventListener('click', () => setViewToFit());

  player.subscribe(() => renderFrame());
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  await loadSample();
}
