export type PlayerState = {
  playing: boolean;
  currentTimeMs: number;
  speed: number;
  durationMs: number;
};

export type PlayerListener = (state: PlayerState) => void;

export class Player {
  private state: PlayerState;
  private listeners = new Set<PlayerListener>();
  private rafId: number | null = null;
  private lastFrameAt: number | null = null;

  constructor(durationMs: number, defaultSpeed: number) {
    this.state = {
      playing: false,
      currentTimeMs: 0,
      speed: defaultSpeed,
      durationMs,
    };
  }

  getState(): PlayerState {
    return { ...this.state };
  }

  setDuration(durationMs: number): void {
    this.state.durationMs = durationMs;
    if (this.state.currentTimeMs > durationMs) {
      this.state.currentTimeMs = durationMs;
    }
    this.emit();
  }

  subscribe(listener: PlayerListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  play(): void {
    if (this.state.playing) return;
    this.state.playing = true;
    this.lastFrameAt = performance.now();
    this.tick();
    this.emit();
  }

  pause(): void {
    this.state.playing = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastFrameAt = null;
    this.emit();
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  seek(timeMs: number): void {
    this.state.currentTimeMs = Math.max(0, Math.min(timeMs, this.state.durationMs));
    this.emit();
  }

  setSpeed(speed: number): void {
    this.state.speed = speed;
    this.emit();
  }

  destroy(): void {
    this.pause();
    this.listeners.clear();
  }

  private tick = (): void => {
    const now = performance.now();
    if (this.lastFrameAt !== null) {
      const delta = (now - this.lastFrameAt) * this.state.speed;
      this.state.currentTimeMs += delta;
      if (this.state.currentTimeMs >= this.state.durationMs) {
        this.state.currentTimeMs = this.state.durationMs;
        this.pause();
      }
    }
    this.lastFrameAt = now;
    this.emit();

    if (this.state.playing) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
