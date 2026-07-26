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

  if (
    !canvas ||
    !dropzone ||
    !fileInput ||
    !sampleBtn ||
    !packetListContainer ||
    !playbackBarContainer ||
    !nodeInspectorContainer
  ) {
    throw new Error('UI 要素の初期化に失敗しました');
  }

  const renderer = new CanvasRenderer(canvas, config, basePath);
  await renderer.ready();

  let player = new Player(0, config.playback.defaultSpeed);
  const state: AppState = {
    events: [],
    topology: null,
    timeline: null,
    selectedNodeId: null,
    highlightedPacketIndex: null,
  };

  let draggingNodeId: string | null = null;

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
      renderFrame();
      showToast('自動レイアウトを再実行しました');
    },
  });

  function getSelectedNode(): NetworkNode | null {
    if (!state.topology || !state.selectedNodeId) return null;
    return state.topology.nodes.find((node) => node.id === state.selectedNodeId) ?? null;
  }

  function renderFrame(): void {
    if (!state.topology || !state.timeline) return;
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
    packetList.render(state.events, state.highlightedPacketIndex);
    playbackBar.update(playerState);
    nodeInspector.show(getSelectedNode());
  }

  function resizeCanvas(): void {
    const panel = canvas!.parentElement;
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

  canvas.addEventListener('pointerdown', (event) => {
    if (!state.topology) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const node = renderer.hitTestNode(state.topology, x, y);
    if (node && node.type !== 'broadcast') {
      draggingNodeId = node.id;
      state.selectedNodeId = node.id;
      canvas.setPointerCapture(event.pointerId);
      renderFrame();
    } else {
      state.selectedNodeId = node?.id ?? null;
      renderFrame();
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!draggingNodeId || !state.topology) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    state.topology = mergeTopologyEdits(state.topology, [
      { id: draggingNodeId, x, y, fixed: true },
    ]);
    renderFrame();
  });

  canvas.addEventListener('pointerup', () => {
    draggingNodeId = null;
  });

  player.subscribe(() => renderFrame());
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  await loadSample();
}
