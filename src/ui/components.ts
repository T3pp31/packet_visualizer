import type { PacketEvent } from '../core/types';

export function createDropzone(
  container: HTMLElement,
  onFile: (file: File) => void,
): void {
  container.addEventListener('dragover', (event) => {
    event.preventDefault();
    container.classList.add('dropzone--active');
  });

  container.addEventListener('dragleave', () => {
    container.classList.remove('dropzone--active');
  });

  container.addEventListener('drop', (event) => {
    event.preventDefault();
    container.classList.remove('dropzone--active');
    const file = event.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
}

export function createPacketList(
  container: HTMLElement,
  onSelect: (index: number) => void,
): {
  render: (events: PacketEvent[], activeIndex: number | null) => void;
} {
  const list = document.createElement('div');
  list.className = 'packet-list';
  container.replaceChildren(list);

  return {
    render(events, activeIndex) {
      list.replaceChildren();
      events.forEach((event) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'packet-list__row';
        if (activeIndex === event.index) row.classList.add('packet-list__row--active');

        row.innerHTML = `
          <span class="packet-list__index">${event.index + 1}</span>
          <span class="packet-list__time">${(event.timestampMs / 1000).toFixed(2)}s</span>
          <span class="packet-list__summary">${event.summaryJa}</span>
        `;
        row.addEventListener('click', () => onSelect(event.index));
        list.appendChild(row);
      });
    },
  };
}

export function createPlaybackBar(
  container: HTMLElement,
  speeds: number[],
  defaultSpeed: number,
  handlers: {
    onToggle: () => void;
    onSeek: (timeMs: number) => void;
    onSpeed: (speed: number) => void;
  },
): {
  update: (state: {
    playing: boolean;
    currentTimeMs: number;
    durationMs: number;
    speed: number;
  }) => void;
} {
  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.className = 'playback-bar__play';
  playButton.textContent = '▶';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'playback-bar__slider';
  slider.min = '0';
  slider.max = '1000';
  slider.value = '0';

  const timeLabel = document.createElement('span');
  timeLabel.className = 'playback-bar__time';

  const speedSelect = document.createElement('select');
  speedSelect.className = 'playback-bar__speed';
  speeds.forEach((speed) => {
    const option = document.createElement('option');
    option.value = String(speed);
    option.textContent = `${speed}x`;
    if (speed === defaultSpeed) option.selected = true;
    speedSelect.appendChild(option);
  });

  container.replaceChildren(playButton, slider, timeLabel, speedSelect);

  playButton.addEventListener('click', handlers.onToggle);
  slider.addEventListener('input', () => {
    const ratio = Number(slider.value) / 1000;
    handlers.onSeek(ratio * Number(slider.dataset.durationMs ?? '0'));
  });
  speedSelect.addEventListener('change', () => {
    handlers.onSpeed(Number(speedSelect.value));
  });

  return {
    update(state) {
      playButton.textContent = state.playing ? '⏸' : '▶';
      slider.dataset.durationMs = String(state.durationMs);
      const ratio =
        state.durationMs > 0 ? state.currentTimeMs / state.durationMs : 0;
      slider.value = String(Math.round(ratio * 1000));
      timeLabel.textContent = `${(state.currentTimeMs / 1000).toFixed(1)}s / ${(state.durationMs / 1000).toFixed(1)}s`;
      speedSelect.value = String(state.speed);
    },
  };
}

export function createNodeInspector(
  container: HTMLElement,
  handlers: {
    onTypeChange: (type: string) => void;
    onLabelChange: (label: string) => void;
    onRelayout: () => void;
  },
): {
  show: (node: { id: string; type: string; label: string; fixed: boolean } | null) => void;
} {
  const panel = document.createElement('div');
  panel.className = 'node-inspector';
  container.replaceChildren(panel);

  return {
    show(node) {
      if (!node || node.type === 'broadcast') {
        panel.innerHTML = '<p class="node-inspector__empty">ノードを選択してください</p>';
        return;
      }

      panel.innerHTML = `
        <h3 class="node-inspector__title">ノード設定</h3>
        <label class="node-inspector__field">
          <span>種別</span>
          <select id="node-type-select">
            <option value="host">端末</option>
            <option value="router">ルータ</option>
            <option value="server">サーバ</option>
            <option value="unknown">不明</option>
          </select>
        </label>
        <label class="node-inspector__field">
          <span>ラベル</span>
          <input id="node-label-input" type="text" />
        </label>
        <button type="button" id="node-relayout-btn" class="node-inspector__button">自動レイアウト再実行</button>
      `;

      const typeSelect = panel.querySelector<HTMLSelectElement>('#node-type-select');
      const labelInput = panel.querySelector<HTMLInputElement>('#node-label-input');
      const relayoutBtn = panel.querySelector<HTMLButtonElement>('#node-relayout-btn');

      if (typeSelect) {
        typeSelect.value = node.type;
        typeSelect.addEventListener('change', () => handlers.onTypeChange(typeSelect.value));
      }
      if (labelInput) {
        labelInput.value = node.label;
        labelInput.addEventListener('change', () => handlers.onLabelChange(labelInput.value));
      }
      if (relayoutBtn) {
        relayoutBtn.addEventListener('click', handlers.onRelayout);
      }
    },
  };
}

export function showToast(message: string, isError = false): void {
  const existing = document.querySelector('.toast');
  existing?.remove();

  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' toast--error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
